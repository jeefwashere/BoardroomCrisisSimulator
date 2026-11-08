'use strict';
// PCM chunks are playable immediately; no complete file or decodeAudioData wait.
class PCMStreamPlayer {
  constructor(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
    if (!Context) throw new Error('Audio playback is unavailable. Choose text only.');
    this.context = new Context(); this.next = 0; this.sources = new Set(); this.tail = null; this.stopped = false;
  }
  async unlock() { await this.context.resume(); }
  append(encoded, rate = 24000) {
    if (this.stopped) return;
    if (rate !== 24000) throw new Error('Unexpected speech sample rate');
    const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const data = new Uint8Array(raw.length + (this.tail === null ? 0 : 1));
    if (this.tail !== null) data[0] = this.tail;
    data.set(raw, this.tail === null ? 0 : 1);
    this.tail = data.length % 2 ? data[data.length - 1] : null;
    const count = Math.floor(data.length / 2); if (!count) return;
    const buffer = this.context.createBuffer(1, count, rate), values = buffer.getChannelData(0), view = new DataView(data.buffer);
    for (let i = 0; i < count; i++) values[i] = view.getInt16(i * 2, true) / 32768;
    if (this.next - this.context.currentTime > 90) throw new Error('Audio queue exceeded its limit');
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination);
    this.sources.add(source); source.onended = () => this.sources.delete(source);
    const start = Math.max(this.context.currentTime + .04, this.next);
    this.next = start + count / rate; source.start(start);
  }
  async drain() {
    while (!this.stopped && this.sources.size) await new Promise(resolve => setTimeout(resolve, 50));
  }
  async stop() {
    this.stopped = true;
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear(); this.tail = null;
    if (this.context.state !== 'closed') await this.context.close();
  }
}
async function consumeNDJSON(stream, onEvent, signal) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let pending = '', complete = false;
  try {
    while (!signal?.aborted) {
      const {value, done} = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, {stream:true});
      let boundary;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
        if (line.trim() && !signal?.aborted) await onEvent(JSON.parse(line));
      }
      if (pending.length > 100000) throw new Error('Stream frame is too large');
      if (done) { if (pending.trim() && !signal?.aborted) await onEvent(JSON.parse(pending)); complete = true; break; }
    }
  } finally { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
