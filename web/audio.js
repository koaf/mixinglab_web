import { preparePitchTracks, playbackBuffer } from './pitch.js';
export const DEFAULT_FX = Object.freeze({ bypass: false, low_db: 0, mid_db: 0, high_db: 0, mid_hz: 1000, mid_q: .7, threshold_db: -18, ratio: 1, attack_ms: 12, release_ms: 120, makeup_db: 0, reverb: 0, delay: 0, delay_ms: 250, pitch: 0, formant: true });
export const DEFAULT_SETTINGS = Object.freeze({ gain_db: 0, pan: 0, mute: false, solo: false, offset: 0 });
export const LIMITS = { tracks: 12, duration: 600, total: 1200, bytes: 120 * 1024 * 1024 };
export const FX_RANGES = {
  low_db: [-24, 24], mid_db: [-24, 24], high_db: [-24, 24], mid_hz: [80, 12000], mid_q: [.1, 10], threshold_db: [-60, 0], ratio: [1, 20], attack_ms: [1, 100], release_ms: [10, 1000], makeup_db: [0, 24], reverb: [0, 1], delay: [0, 1], delay_ms: [20, 1000], pitch: [-12, 12]
};
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const dbGain = db => 10 ** (db / 20);
const number = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;
export function normalizeSettings(settings = {}) {
  const fx = settings.fx || {};
  return {
    gain_db: number(settings.gain_db, 0, -60, 12), pan: number(settings.pan, 0, -1, 1), mute: !!settings.mute, solo: !!settings.solo, offset: number(settings.offset, 0, 0, 1200),
    fx: Object.fromEntries(Object.entries(DEFAULT_FX).map(([key, value]) => [key, typeof value === 'boolean' ? typeof fx[key] === 'boolean' ? fx[key] : value : number(fx[key], value, ...FX_RANGES[key])]))
  };
}
export function validateSession(data) {
  if (!data || !Array.isArray(data.tracks) || data.tracks.length > LIMITS.tracks || !data.tracks.every(t => t && typeof t.name === 'string' && (typeof t.path === 'string' || typeof t.audio === 'string'))) throw Error('対応するMeloaセッションではありません（最大12トラック）。');
  if (data.version !== 1) throw Error('このセッションのバージョンには対応していません。');
  return {
    version: 1, name: String(data.name || '無題').slice(0, 160), master_db: number(data.master_db, 0, -60, 12),
    tracks: data.tracks.map(t => ({ ...t, name: t.name.slice(0, 160), settings: normalizeSettings(t.settings) }))
  };
}
export function audible(track, tracks) { return !track.settings.mute && (!tracks.some(t => t.settings.solo) || track.settings.solo); }
export function sessionDuration(tracks) { return tracks.reduce((max, t) => Math.max(max, t.settings.offset + t.buffer.duration), 0); }
export function tailDuration(tracks) { return tracks.some(t => !t.settings.fx.bypass && (t.settings.fx.reverb || t.settings.fx.delay)) ? 3 : 0; }
export function formatTime(seconds) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function encodeWav(buffer) {
  const channels = 2, bytes = 3, frames = buffer.length;
  const data = new ArrayBuffer(44 + frames * channels * bytes), view = new DataView(data);
  const str = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytes, true); view.setUint16(32, channels * bytes, true); view.setUint16(34, 24, true);
  str(36, 'data'); view.setUint32(40, frames * channels * bytes, true);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
  let at = 44;
  for (let i = 0; i < frames; i++) for (const channel of [left, right]) {
    const sample = clamp(Number.isFinite(channel[i]) ? channel[i] : 0, -.98, .98);
    const pcm = Math.round(sample * (sample < 0 ? 8388608 : 8388607));
    view.setUint8(at++, pcm & 255); view.setUint8(at++, (pcm >> 8) & 255); view.setUint8(at++, (pcm >> 16) & 255);
  }
  return data;
}
function makeImpulse(context) {
  const impulse = context.createBuffer(2, context.sampleRate * 2, context.sampleRate);
  let seed = 42;
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < channel.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      channel[i] = (seed / 2147483648 - 1) * (1 - i / channel.length) ** 3;
    }
  }
  return impulse;
}
const impulses = new WeakMap();
export function trackGraph(context, track, tracks, destination, position, when) {
  const source = context.createBufferSource(); source.buffer = playbackBuffer(track);
  const nodes = [source]; let last = source;
  const chain = node => { last.connect(node); nodes.push(node); last = node; return node; };
  const fx = track.settings.fx;
  if (!fx.bypass) {
    for (const [type, hz, gain, q] of [['lowshelf', 200, fx.low_db, 1], ['peaking', fx.mid_hz, fx.mid_db, fx.mid_q], ['highshelf', 6000, fx.high_db, 1]]) {
      const filter = context.createBiquadFilter(); filter.type = type; filter.frequency.value = hz; filter.gain.value = gain; filter.Q.value = q; chain(filter);
    }
    const compressor = context.createDynamicsCompressor(); compressor.threshold.value = fx.threshold_db; compressor.ratio.value = fx.ratio; compressor.attack.value = fx.attack_ms / 1000; compressor.release.value = fx.release_ms / 1000; compressor.knee.value = 6; chain(compressor);
    const makeup = context.createGain(); makeup.gain.value = dbGain(fx.makeup_db); chain(makeup);
    const input = last, sum = context.createGain(); input.connect(sum); nodes.push(sum);
    if (fx.reverb) {
      if (!impulses.has(context)) impulses.set(context, makeImpulse(context));
      const convolver = context.createConvolver(); convolver.buffer = impulses.get(context);
      const wet = context.createGain(); wet.gain.value = fx.reverb;
      input.connect(convolver).connect(wet).connect(sum); nodes.push(convolver, wet);
    }
    if (fx.delay) {
      const delay = context.createDelay(1); delay.delayTime.value = fx.delay_ms / 1000;
      const wet = context.createGain(); wet.gain.value = fx.delay;
      input.connect(delay).connect(wet).connect(sum); nodes.push(delay, wet);
    }
    last = sum;
  }
  const pan = chain(context.createStereoPanner()); pan.pan.value = track.settings.pan;
  const gain = chain(context.createGain()); gain.gain.value = audible(track, tracks) ? dbGain(track.settings.gain_db) : 0;
  last.connect(destination);
  const localPosition = Math.max(0, position - track.settings.offset);
  if (localPosition < track.buffer.duration) source.start(when + Math.max(0, track.settings.offset - position), localPosition);
  return { source, gain, pan, nodes };
}
export class AudioEngine {
  context = null; graphs = []; playing = false; position = 0; startedAt = 0; masterDb = 0;
  async init(resume = false) {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 48000 });
      this.master = this.context.createGain();
      this.protection = this.context.createWaveShaper();
      this.protection.curve = Float32Array.from({ length: 65537 }, (_, i) => clamp(i / 32768 - 1, -.98, .98));
      this.master.connect(this.protection);
      const splitter = this.context.createChannelSplitter(2); this.protection.connect(splitter);
      this.analysers = [0, 1].map(c => { const a = this.context.createAnalyser(); a.fftSize = 1024; splitter.connect(a, c); return a; });
      this.meterData = this.analysers.map(a => new Float32Array(a.fftSize));
      this.protection.connect(this.context.destination);
    }
    if (resume) await this.context.resume();
    return this.context;
  }
  get time() { return this.playing ? this.position + this.context.currentTime - this.startedAt : this.position; }
  async play(tracks) {
    await this.init(true);
    this.pause();
    await preparePitchTracks(tracks, this.context);
    this.master.gain.value = dbGain(this.masterDb);
    this.startedAt = this.context.currentTime + .03;
    this.graphs = tracks.map(t => ({ track: t, ...trackGraph(this.context, t, tracks, this.master, this.position, this.startedAt) }));
    this.playing = true;
  }
  pause() {
    if (this.playing) this.position = Math.max(0, this.time);
    this.playing = false;
    for (const g of this.graphs) { try { g.source.stop(); } catch { /* Source may have ended. */ } for (const n of g.nodes) n.disconnect(); }
    this.graphs = [];
  }
  update(tracks, masterDb) {
    this.masterDb = masterDb;
    if (this.master) this.master.gain.setTargetAtTime(dbGain(masterDb), this.context.currentTime, .01);
    for (const g of this.graphs) {
      const t = tracks.find(t => t.id === g.track.id); if (!t) continue;
      g.gain.gain.setTargetAtTime(audible(t, tracks) ? dbGain(t.settings.gain_db) : 0, this.context.currentTime, .01);
      g.pan.pan.setTargetAtTime(t.settings.pan, this.context.currentTime, .01);
    }
  }
  peaks() {
    if (!this.playing) return [0, 0];
    return this.analysers.map((a, c) => { a.getFloatTimeDomainData(this.meterData[c]); return this.meterData[c].reduce((max, n) => Math.max(max, Math.abs(n)), 0); });
  }
}
