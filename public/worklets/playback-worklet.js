// Playback worklet — a jitter buffer on the dedicated audio rendering thread.
// The output AudioContext runs at 24kHz (Gemini Live's output rate). The main
// thread posts raw Int16 PCM ArrayBuffers as model audio chunks arrive; we
// convert to Float32 and enqueue. process() drains the queue into the output,
// writing silence when empty so the stream never gaps or glitches.
// {cmd:'flush'} clears the queue instantly for crisp barge-in.
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = []; // Float32Array chunks, FIFO
    this._offset = 0; // read offset into _queue[0]
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.cmd === "flush") {
        this._queue = [];
        this._offset = 0;
        return;
      }
      if (d instanceof ArrayBuffer && d.byteLength >= 2) {
        const i16 = new Int16Array(d, 0, d.byteLength >> 1);
        const f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
        this._queue.push(f32);
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    let n = 0;
    while (n < out.length && this._queue.length) {
      const head = this._queue[0];
      const avail = head.length - this._offset;
      const need = out.length - n;
      const take = avail < need ? avail : need;
      out.set(head.subarray(this._offset, this._offset + take), n);
      n += take;
      this._offset += take;
      if (this._offset >= head.length) {
        this._queue.shift();
        this._offset = 0;
      }
    }
    while (n < out.length) out[n++] = 0; // silence, never a gap
    return true;
  }
}

registerProcessor("playback", PlaybackProcessor);
