import { audioTask } from './pitch.js';
const analyses = new WeakMap(), corrected = new WeakMap();
export const sourceBuffer = track => track.rawBuffer || track.buffer;
const channels = buffer => Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
export function validateTune(value) {
  if (value == null) return null;
  if (!Array.isArray(value.notes) || !Array.isArray(value.anchors) || value.notes.length > 60000 || value.anchors.length > 60002) throw Error('ピッチ／タイミング補正のデータが不正です。');
  const notes = value.notes.map(n => {
    if (!n || ![n.start, n.end, n.center, n.target, n.drift ?? 0].every(Number.isFinite) || n.start < 0 || n.end <= n.start || n.end > 600 || n.target < 0 || n.target > 127 || n.center < 0 || n.center > 127 || (n.drift ?? 0) < 0 || (n.drift ?? 0) > 1) throw Error('ノートのデータが不正です。');
    return { start: n.start, end: n.end, center: n.center, target: n.target, drift: n.drift ?? 0 };
  });
  let previous = [0, 0];
  const anchors = value.anchors.map(a => {
    if (!Array.isArray(a) || a.length !== 2 || !a.every(Number.isFinite) || a[0] <= previous[0] || a[1] <= previous[1] || a[0] > 1200 || a[1] > 600) throw Error('タイミング補正のデータが不正です。');
    previous = a; return [...a];
  });
  return { notes, anchors };
}
export function analyzeTrack(track) {
  const buffer = sourceBuffer(track);
  if (!analyses.has(buffer)) {
    const request = audioTask('analyze', { channels: channels(buffer) }).catch(error => { analyses.delete(buffer); throw error; });
    analyses.set(buffer, request);
  }
  return analyses.get(buffer);
}
export async function prepareTuneTracks(tracks, context) {
  for (const track of tracks) {
    track.rawBuffer ||= track.buffer;
    const source = track.rawBuffer, tune = track.settings.tune;
    if (!tune || (!tune.anchors.length && !tune.notes.some(n => Math.abs(n.target - n.center) > .0001 || n.drift > .0001))) { track.buffer = source; continue; }
    const key = JSON.stringify(tune), cached = corrected.get(source);
    if (cached?.key === key) { track.buffer = cached.buffer; continue; }
    const output = await audioTask('correct', { channels: channels(source), tune });
    const buffer = context.createBuffer(output.length, source.length, source.sampleRate);
    output.forEach((samples, c) => buffer.copyToChannel(samples, c));
    corrected.set(source, { key, buffer }); track.buffer = buffer;
  }
}
export async function editTune(command) { return (await audioTask('edit', { command })).tune; }
export async function alignTrack(guide, dub, strength) {
  return (await audioTask('align', { guide: channels(sourceBuffer(guide)), channels: channels(sourceBuffer(dub)), guideOffset: guide.settings.offset, dubOffset: dub.settings.offset, strength })).anchors;
}
export function outTime(tune, time) {
  let previous = [0, 0];
  for (const anchor of tune.anchors) {
    if (anchor[1] >= time) return previous[0] + (time - previous[1]) * (anchor[0] - previous[0]) / (anchor[1] - previous[1]);
    previous = anchor;
  }
  return previous[0] + time - previous[1];
}
export const noteName = midi => { const n = Math.round(midi); return `${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`; };
