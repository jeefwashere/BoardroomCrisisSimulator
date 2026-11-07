/** Isolated integration example. Feed every room poll into update(snapshot).
 * Connect a user button to play() when needsGesture is true.
 */
export function createNarrationPlayer({
  roomId,
  setCaptions,
  onState = () => {},
  fetch: request = globalThis.fetch,
  createAudio = () => new Audio(),
  urls = globalThis.URL,
}) {
  let current = null;
  let needsGesture = false;

  const active = (session) => current === session;
  const state = (session, status, gesture = false) => {
    if (!active(session)) return;
    needsGesture = gesture;
    onState({ status, needsGesture });
  };

  function stop() {
    const old = current;
    current = null;
    needsGesture = false;
    if (!old) return;
    old.abort.abort();
    if (old.audio) {
      for (const [event, callback] of old.listeners) {
        old.audio.removeEventListener(event, callback);
      }
      old.audio.pause();
      old.audio.removeAttribute("src");
      old.audio.load();
    }
    if (old.url) urls.revokeObjectURL(old.url);
  }

  function delivery(session, event) {
    if (!active(session) || session.reported.has(event)) return;
    session.reported.add(event);
    // Preserve actual event order even when playback ends very quickly.
    session.delivery = session.delivery.then(async () => {
      if (!active(session)) return;
      await request(`${session.base}/delivery`, {
        method: "POST",
        credentials: "include",
        signal: session.abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });
    }).catch(() => {});
  }

  async function attemptPlay(session) {
    if (!active(session) || !session.audio) return;
    try {
      await session.audio.play();
      // The playing and ended events own delivery reporting.
      if (active(session)) needsGesture = false;
    } catch (error) {
      if (!active(session)) return;
      state(session, error?.name === "NotAllowedError" ? "ready" : "failed",
        error?.name === "NotAllowedError");
    }
  }

  async function prepare(session) {
    try {
      const prepared = await request(`${session.base}/prepare`, {
        method: "POST", credentials: "include", signal: session.abort.signal,
      });
      if (!active(session)) return;
      if (!prepared.ok) throw new Error("Narration preparation failed");
      const result = await prepared.json();
      if (!active(session)) return;
      if (result.text !== session.text) throw new Error("Narration text changed");
      if (result.status !== "ready") {
        state(session, result.status);
        return;
      }
      const response = await request(`${session.base}/audio`, {
        credentials: "include", signal: session.abort.signal,
      });
      if (!active(session)) return;
      if (!response.ok) throw new Error("Narration fetch failed");
      const blob = await response.blob();
      if (!active(session)) return;
      session.url = urls.createObjectURL(blob);
      session.audio = createAudio();
      session.listeners = [
        ["playing", () => {
          if (!active(session)) return;
          state(session, "playing");
          delivery(session, "started");
        }],
        ["ended", () => {
          if (!active(session)) return;
          state(session, "completed");
          if (session.reported.has("started")) delivery(session, "completed");
        }],
        ["error", () => {
          if (!active(session)) return;
          state(session, "failed");
          delivery(session, "failed");
        }],
      ];
      for (const [event, callback] of session.listeners) {
        session.audio.addEventListener(event, callback);
      }
      session.audio.src = session.url;
      state(session, "ready");
      await attemptPlay(session);
    } catch {
      if (active(session)) state(session, "failed");
    }
  }

  function update(snapshot) {
    const narration = snapshot.game?.narration;
    const key = JSON.stringify([
      snapshot.phase, snapshot.game?.phase_id,
      narration?.narration_id, narration?.text,
    ]);
    // Captions always precede preparation, audio fetch, and autoplay.
    setCaptions(narration?.text ?? "");
    if (current?.key === key) return current.preparation;
    stop();
    if (!narration) return Promise.resolve();
    const session = {
      key, text: narration.text,
      base: `/api/rooms/${encodeURIComponent(roomId)}/narration/${encodeURIComponent(narration.narration_id)}`,
      abort: new AbortController(), listeners: [], reported: new Set(),
      delivery: Promise.resolve(), audio: null, url: null,
    };
    current = session;
    state(session, "pending");
    session.preparation = prepare(session);
    return session.preparation;
  }

  return {
    update,
    stop,
    play: () => current ? attemptPlay(current) : Promise.resolve(),
    get needsGesture() { return needsGesture; },
  };
}
