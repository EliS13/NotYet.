// offscreen-noise.js — an AudioWorklet that makes endless noise, sample by
// sample, so there's no loop to hear: white, pink (softer highs) or brown
// (deep, like a far-off waterfall).

class NyNoise extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kind = (options.processorOptions || {}).kind || 'white';
    this.last = [0, 0];
    this.b = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
  }
  process(inputs, outputs) {
    const out = outputs[0];
    for (let ch = 0; ch < out.length; ch++) {
      const d = out[ch], b = this.b[ch % 2];
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (this.kind === 'brown') {
          this.last[ch % 2] = (this.last[ch % 2] + 0.02 * w) / 1.02;
          d[i] = this.last[ch % 2] * 3.5;
        } else if (this.kind === 'pink') {                // Paul Kellet's filter
          b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759;
          b[2] = 0.96900 * b[2] + w * 0.1538520; b[3] = 0.86650 * b[3] + w * 0.3104856;
          b[4] = 0.55000 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.0168980;
          d[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11;
          b[6] = w * 0.115926;
        } else d[i] = w;
      }
    }
    return true;
  }
}
registerProcessor('ny-noise', NyNoise);
