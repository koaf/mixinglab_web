import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPitchProcessor } from '../web/pitch-dsp.js';
const process = await createPitchProcessor(await readFile(new URL('../web/pitch.wasm', import.meta.url)));
const shiftChannel = (samples, pitch, formant = false) => process([samples], pitch, formant)[0];
const rate = 48000;
const tone = frequency => Float32Array.from({ length: rate }, (_, i) => .15 * Math.sin(2 * Math.PI * frequency * i / rate));
function frequency(samples) {
  let crossings = 0;
  for (let i = rate / 4 + 1; i < rate * .75; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return crossings * 2;
}
for (const [semitones, expected] of [[12, 880], [-12, 220], [7, 659.25]]) {
  test(`pitch ${semitones} semitones changes frequency while preserving duration`, () => {
    const input = tone(440), before = input.slice(), output = shiftChannel(input, semitones);
    assert.equal(output.length, input.length); assert.deepEqual(input, before);
    assert.ok(output.every(Number.isFinite));
    assert.ok(Math.abs(frequency(output) - expected) < 8, `frequency was ${frequency(output)}`);
    const rms = Math.sqrt(output.reduce((sum, n) => sum + n * n, 0) / output.length);
    assert.ok(rms > .02 && rms < .3, `RMS was ${rms}`);
  });
}
test('zero shift is sample-exact; silence and range limits remain safe', () => {
  const input = tone(440); assert.deepEqual(shiftChannel(input, 0), input);
  assert.ok(shiftChannel(new Float32Array(5000), -12).every(n => n === 0));
  assert.throws(() => shiftChannel(input, NaN)); assert.throws(() => shiftChannel(input, 13));
});

// The same resonance and acceptance thresholds as the desktop mix-core test.
test('desktop formant behavior keeps the vocal envelope in place', () => {
  const samples = new Float32Array(rate);
  const radius = .98, resonance = 1000, a1 = 2 * radius * Math.cos(2 * Math.PI * resonance / rate), a2 = -radius * radius;
  let y0 = 0, y1 = 0;
  for (let i = 0; i < rate; i++) { const value = (i % 320 === 0 ? 1 : 0) + a1 * y0 + a2 * y1; y1 = y0; y0 = value; samples[i] = value * .05; }
  function centroid(audio) {
    // Direct DFT at 5 Hz spacing, measured away from attack/release edges.
    let weighted = 0, total = 0;
    const window = audio.subarray(4800, 4800 + 16384);
    for (let hz = 5; hz < 6000; hz += 5) {
      const omega = 2 * Math.PI * hz / rate, coefficient = 2 * Math.cos(omega);
      let q1 = 0, q2 = 0;
      for (const value of window) { const q0 = value + coefficient * q1 - q2; q2 = q1; q1 = q0; }
      const magnitude = Math.sqrt(Math.max(0, q1 * q1 + q2 * q2 - coefficient * q1 * q2));
      weighted += hz * magnitude; total += magnitude;
    }
    return weighted / total;
  }
  const base = centroid(samples), kept = centroid(shiftChannel(samples, 7, true)), moved = centroid(shiftChannel(samples, 7, false));
  assert.ok(Math.abs(kept / base - 1) < .15, `kept ${kept}, base ${base}`);
  assert.ok(moved / base > 1.25, `moved ${moved}, base ${base}`);
  const stereo = process([tone(440), tone(220)], 12, false);
  assert.ok(Math.abs(frequency(stereo[0]) - 880) < 8); assert.ok(Math.abs(frequency(stereo[1]) - 440) < 8);
});
