import { createPitchProcessor } from './pitch-dsp.js';
let processor;
const ready = () => processor ||= fetch(new URL('./pitch.wasm', import.meta.url)).then(response => {
  if (!response.ok) throw Error('ピッチ処理を読み込めません。');
  return response.arrayBuffer();
}).then(createPitchProcessor);
self.onmessage = async ({ data: { id, channels, semitones, formant } }) => {
  try {
    const process = await ready();
    const output = process(channels, semitones, formant);
    self.postMessage({ id, channels: output }, output.map(samples => samples.buffer));
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
