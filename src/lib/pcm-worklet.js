// Runs on the audio thread. Sends the raw samples in blocks of 4096 for the recording, and
// every 50 ms the per-10 ms features the voice tracker reads: RMS of the 300 to 3000 Hz band
// and zero crossings per second. This mirrors frameFeatures() in syllables.ts; keep them in step.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.filled = 0;
    this.hop = Math.round(sampleRate / 100);
    this.hpA = Math.exp((-2 * Math.PI * 300) / sampleRate);
    this.lpA = Math.exp((-2 * Math.PI * 3000) / sampleRate);
    this.hpIn = 0;
    this.hpOut = 0;
    this.lpOut = 0;
    this.prev = 0;
    this.energy = 0;
    this.crossings = 0;
    this.n = 0;
    this.features = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let k = 0; k < channel.length; k++) {
      const x = channel[k];
      this.buffer[this.filled++] = x;
      if (this.filled === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer.slice(0) });
        this.filled = 0;
      }
      this.hpOut = this.hpA * (this.hpOut + x - this.hpIn);
      this.hpIn = x;
      this.lpOut = (1 - this.lpA) * this.hpOut + this.lpA * this.lpOut;
      this.energy += this.lpOut * this.lpOut;
      if (x >= 0 !== this.prev >= 0) this.crossings++;
      this.prev = x;
      if (++this.n === this.hop) {
        this.features.push(Math.sqrt(this.energy / this.n), (this.crossings / this.n) * sampleRate);
        this.energy = 0;
        this.crossings = 0;
        this.n = 0;
        if (this.features.length === 10) {
          this.port.postMessage({ features: Float32Array.from(this.features) });
          this.features = [];
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
