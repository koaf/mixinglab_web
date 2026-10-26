import { createPitchProcessor } from './pitch-dsp.js';
let processor;
const ready = () => processor ||= fetch(new URL('./pitch.wasm', import.meta.url)).then(response => {
  if (!response.ok) throw Error('ピッチ処理を読み込めません。');
  return response.arrayBuffer();
}).then(createPitchProcessor);
self.onmessage = async ({ data: { id, type = 'shift', channels, semitones, formant, tune, command, guide, guideOffset, dubOffset, strength } }) => {
  try {
    const process = await ready();
    if (type === 'analyze') self.postMessage({ id, data: process.analyze(channels) });
    else if (type === 'edit') self.postMessage({ id, data: process.edit(command) });
    else if (type === 'align') self.postMessage({ id, data: process.align(guide, channels, guideOffset, dubOffset, strength) });
    else {
      const output = type === 'correct' ? process.correct(channels, tune) : process(channels, semitones, formant);
      self.postMessage({ id, channels: output }, output.map(samples => samples.buffer));
    }
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
