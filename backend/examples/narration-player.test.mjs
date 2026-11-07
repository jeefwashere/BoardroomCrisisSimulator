import assert from "node:assert/strict";
import test from "node:test";
import { createNarrationPlayer } from "./narration-player.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const snapshot = (phase = "result", phaseId = "phase1", narration = {
  narration_id: "narration1", text: "Committed outcome",
}) => ({ phase, game: { phase_id: phaseId, narration } });

class FakeAudio {
  listeners = new Map();
  plays = 0;
  paused = false;
  block = false;
  addEventListener(event, callback) { this.listeners.set(event, callback); }
  removeEventListener(event) { this.listeners.delete(event); }
  emit(event) { this.listeners.get(event)?.(); }
  async play() {
    this.plays++;
    if (this.block) throw Object.assign(new Error("Blocked"), { name: "NotAllowedError" });
  }
  pause() { this.paused = true; }
  removeAttribute(name) { delete this[name]; }
  load() {}
}

function harness(options = {}) {
  const calls = [], captions = [], states = [], audios = [], revoked = [];
  const request = async (url, init = {}) => {
    calls.push({ url, ...init });
    assert.equal(init.credentials, "include");
    if (url.endsWith("/prepare")) {
      assert.equal(captions.at(-1), "Committed outcome");
      if (options.prepare) return options.prepare();
      return { ok: true, json: async () => ({ status: "ready", text: "Committed outcome" }) };
    }
    if (url.endsWith("/audio")) {
      if (options.audioResponse) return options.audioResponse();
      return { ok: true, blob: async () => new Blob(["audio"]) };
    }
    return { ok: true };
  };
  const player = createNarrationPlayer({
    roomId: "room1", fetch: request,
    setCaptions: (text) => captions.push(text), onState: (state) => states.push(state),
    createAudio: () => {
      const audio = new FakeAudio();
      audio.block = options.block ?? false;
      audios.push(audio);
      return audio;
    },
    urls: { createObjectURL: () => "blob:audio", revokeObjectURL: (url) => revoked.push(url) },
  });
  const deliveries = () => calls.filter((call) => call.url.endsWith("/delivery"))
    .map((call) => JSON.parse(call.body).event);
  return { player, calls, captions, states, audios, revoked, deliveries };
}

test("captions precede media and delivery follows actual playing and ended events", async () => {
  const h = harness();
  await h.player.update(snapshot());
  assert.deepEqual(h.captions, ["Committed outcome"]);
  assert.deepEqual(h.calls.map((call) => call.url), [
    "/api/rooms/room1/narration/narration1/prepare",
    "/api/rooms/room1/narration/narration1/audio",
  ]);
  assert.equal(h.calls[0].method, "POST");
  assert.equal(h.audios[0].plays, 1);
  assert.deepEqual(h.deliveries(), []);
  h.audios[0].emit("playing");
  h.audios[0].emit("playing");
  h.audios[0].emit("ended");
  await tick();
  assert.deepEqual(h.deliveries(), ["started", "completed"]);
  assert.equal(h.states.at(-1).status, "completed");
  await h.player.update(snapshot());
  assert.equal(h.audios.length, 1);
  h.player.stop();
});

test("blocked autoplay exposes a button gesture and never implies delivery", async () => {
  const h = harness({ block: true });
  await h.player.update(snapshot());
  assert.equal(h.player.needsGesture, true);
  assert.deepEqual(h.deliveries(), []);
  h.audios[0].block = false;
  await h.player.play();
  assert.equal(h.player.needsGesture, false);
  assert.deepEqual(h.deliveries(), []);
  h.audios[0].emit("playing");
  await tick();
  assert.deepEqual(h.deliveries(), ["started"]);
  h.player.stop();
});

test("phase polling stops playback, revokes bytes and ignores old events", async () => {
  const h = harness();
  await h.player.update(snapshot());
  const old = h.audios[0];
  await h.player.update(snapshot("decision", "phase2", null));
  assert.equal(old.paused, true);
  assert.deepEqual(h.revoked, ["blob:audio"]);
  assert.equal(h.captions.at(-1), "");
  old.emit("playing");
  old.emit("ended");
  await tick();
  assert.deepEqual(h.deliveries(), []);
});

test("late preparation response cannot resurrect previous phase audio", async () => {
  let finish;
  const h = harness({ prepare: () => new Promise((resolve) => { finish = resolve; }) });
  const preparation = h.player.update(snapshot());
  await h.player.update(snapshot("decision", "phase2", null));
  finish({ ok: true, json: async () => ({ status: "ready", text: "Committed outcome" }) });
  await preparation;
  assert.equal(h.audios.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].signal.aborted, true);
});

test("late audio response cannot create a URL or play after phase change", async () => {
  let finish;
  const h = harness({ audioResponse: () => new Promise((resolve) => { finish = resolve; }) });
  const preparation = h.player.update(snapshot());
  await tick();
  await h.player.update(snapshot("ended", "phase2", null));
  finish({ ok: true, blob: async () => new Blob(["audio"]) });
  await preparation;
  assert.equal(h.audios.length, 0);
  assert.deepEqual(h.revoked, []);
});

test("disabled media and preparation errors retain captions", async () => {
  for (const response of [
    { ok: true, json: async () => ({ status: "disabled", text: "Committed outcome" }) },
    { ok: false },
    { ok: true, json: async () => ({ status: "ready", text: "Wrong caption" }) },
  ]) {
    const h = harness({ prepare: async () => response });
    await h.player.update(snapshot());
    assert.equal(h.captions.at(-1), "Committed outcome");
    assert.equal(h.audios.length, 0);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.deliveries(), []);
  }
});

test("actual media error reports failure without inventing started or completed", async () => {
  const h = harness();
  await h.player.update(snapshot());
  h.audios[0].emit("error");
  await tick();
  assert.deepEqual(h.deliveries(), ["failed"]);
  assert.equal(h.states.at(-1).status, "failed");
  h.player.stop();
});
