// Mic capture worklet — runs on the dedicated audio rendering thread.
// The mic AudioContext is created at 16kHz mono, so inputs arrive as 16kHz
// Float32 frames (128 samples per render quantum). We convert to Int16 PCM,
// accumulate ~2048 samples (~128ms), and post the buffer to the main thread
// as a transferable ArrayBuffer for base64 + sendRealtimeInput.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(2048);
    this._len = 0;
  }

  _flush() {
    if (this._len === 0) return;
    const out = this._buf.slice(0, this._len);
    this._len = 0;
    this.port.postMessage(out.buffer, [out.buffer]);
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input && input.length) {
      for (let i = 0; i < input.length; i++) {
        let s = input[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        this._buf[this._len++] = s < 0 ? s * 32768 : s * 32767;
        if (this._len === this._buf.length) this._flush();
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
