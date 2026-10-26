const cache = new WeakMap();
let worker, nextId = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./pitch-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(Error(data.error)); else request.resolve(data.channels ?? data.data);
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(Error('ピッチ処理に失敗しました。音源の長さを短くして再度お試しください。'));
    pending.clear(); worker.terminate(); worker = null;
  };
  return worker;
}
export function audioTask(type, data = {}) {
  const transfer = [...(data.channels || []), ...(data.guide || [])].map(samples => samples.buffer);
  return new Promise((resolve, reject) => {
    const instance = getWorker(), id = ++nextId; pending.set(id, { resolve, reject });
    try { instance.postMessage({ id, type, ...data }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
}
export async function preparePitchTracks(tracks, context) {
  for (const track of tracks) {
    const semitones = track.settings.fx.pitch || 0;
    const formant = track.settings.fx.formant !== false;
    if (track.settings.fx.bypass || Math.abs(semitones) < .001) continue;
    const source = track.buffer, cached = cache.get(source);
    if (cached?.semitones === semitones && cached.formant === formant) continue;
    const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).slice());
    const shifted = await new Promise((resolve, reject) => {
      const instance = getWorker(), id = ++nextId;
      pending.set(id, { resolve, reject });
      instance.postMessage({ id, channels, semitones, formant }, channels.map(samples => samples.buffer));
    });
    const buffer = context.createBuffer(shifted.length, source.length, source.sampleRate);
    shifted.forEach((samples, c) => buffer.copyToChannel(samples, c));
    cache.set(source, { semitones, formant, buffer });
  }
}
export function playbackBuffer(track) {
  const semitones = track.settings.fx.pitch || 0;
  if (track.settings.fx.bypass || Math.abs(semitones) < .001) return track.buffer;
  const shifted = cache.get(track.buffer);
  if (shifted?.semitones !== semitones || shifted.formant !== (track.settings.fx.formant !== false)) throw Error('ピッチ処理の準備ができていません。');
  return shifted.buffer;
}
