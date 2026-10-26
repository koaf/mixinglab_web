import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, validateSession, audible, sessionDuration, formatTime, encodeWav } from '../web/audio.js';
test('untrusted session settings are bounded, including NaN and missing effects', () => {
  const settings = normalizeSettings({ gain_db: 999, offset: -3, pan: NaN, fx: { ratio: -2, mid_hz: Infinity } });
  assert.equal(settings.gain_db, 12); assert.equal(settings.offset, 0); assert.equal(settings.pan, 0);
  assert.equal(settings.fx.ratio, 1); assert.equal(settings.fx.mid_hz, 1000);
  assert.throws(() => validateSession({ version: 2, tracks: [] }));
  assert.throws(() => validateSession({ version: 1, tracks: [null] }));
  assert.throws(() => validateSession({ version: 1, tracks: Array(13).fill({ name: 'a', path: 'a.wav' }) }));
});
test('solo and mute follow the mixer rules; offsets extend session length', () => {
  const a = { settings: normalizeSettings(), buffer: { duration: 8 } };
  const b = { settings: normalizeSettings({ solo: true, offset: 2 }), buffer: { duration: 8 } };
  assert.equal(audible(a, [a, b]), false); assert.equal(audible(b, [a, b]), true);
  b.settings.mute = true; assert.equal(audible(b, [a, b]), false);
  assert.equal(sessionDuration([a, b]), 10);
  assert.equal(formatTime(59.9996), '1:00.000');
});
test('WAV export writes 24-bit stereo, duplicates mono and protects peaks', () => {
  const wav = encodeWav({ length: 3, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array([-2, 0, 2]) });
  const view = new DataView(wav);
  assert.equal(Buffer.from(wav).toString('ascii', 0, 4), 'RIFF');
  assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 48000); assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 18); assert.equal(wav.byteLength, 62);
  const read = at => (view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getUint8(at + 2) << 16) << 8 >> 8;
  assert.equal(read(44), Math.round(-.98 * 8388608)); assert.equal(read(44), read(47)); assert.equal(read(56), Math.round(.98 * 8388607));
});
