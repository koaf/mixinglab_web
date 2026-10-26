// Runs mix-core::pitch_shift from the desktop app, compiled to WebAssembly.
export async function createPitchProcessor(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes);
  const { memory, allocate, release, shift } = instance.exports;
  const process = (channels, semitones, formant = true) => {
    if (!Number.isFinite(semitones) || Math.abs(semitones) > 12) throw Error('ピッチは−12〜+12半音で指定してください。');
    if (!channels.length || channels.length > 2 || channels.some(channel => channel.length !== channels[0].length)) throw Error('モノラル／ステレオ音源を選んでください。');
    const frames = channels[0].length;
    if (frames > 48000 * 600) throw Error('音源は10分以内にしてください。');
    if (Math.abs(semitones) <= .001 || frames === 0) return channels.map(channel => channel.slice());
    const pointer = allocate(frames * 2);
    try {
      let interleaved = new Float32Array(memory.buffer, pointer, frames * 2);
      for (let i = 0; i < frames; i++) { interleaved[i * 2] = channels[0][i]; interleaved[i * 2 + 1] = channels[channels.length - 1][i]; }
      if (shift(pointer, frames, semitones, formant ? 1 : 0) !== 0) throw Error('ピッチの設定が範囲外です。');
      // Rust allocations may grow memory and invalidate the previous view.
      interleaved = new Float32Array(memory.buffer, pointer, frames * 2);
      return channels.map((_, c) => Float32Array.from({ length: frames }, (_, i) => interleaved[i * 2 + c]));
    } finally { release(pointer, frames * 2); }
  };
  const withJSON = (value, action) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value)), size = Math.ceil(bytes.length / 4), pointer = allocate(size);
    try { new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes); return action(pointer, bytes.length); }
    finally { release(pointer, size); }
  };
  const readJSON = pointer => {
    const length = instance.exports.result_length();
    try {
      const value = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length)));
      if (value.error) throw Error(value.error);
      return value;
    } finally { instance.exports.release_result(pointer, length); }
  };
  const withAudio = (channels, action) => {
    const frames = channels[0].length, pointer = allocate(frames * 2);
    try {
      const samples = new Float32Array(memory.buffer, pointer, frames * 2);
      for (let i = 0; i < frames; i++) { samples[2 * i] = channels[0][i]; samples[2 * i + 1] = channels[channels.length - 1][i]; }
      return action(pointer, frames);
    } finally { release(pointer, frames * 2); }
  };
  process.analyze = channels => withAudio(channels, (pointer, frames) => readJSON(instance.exports.analyze(pointer, frames)));
  process.edit = command => withJSON(command, (pointer, length) => readJSON(instance.exports.edit(pointer, length)));
  process.correct = (channels, tune) => withAudio(channels, (pointer, frames) => withJSON(tune, (settings, length) => {
    if (instance.exports.correct(pointer, frames, settings, length)) throw Error('補正データが不正です。');
    const output = new Float32Array(memory.buffer, pointer, frames * 2);
    return channels.map((_, c) => Float32Array.from({ length: frames }, (_, i) => output[2 * i + c]));
  }));
  process.align = (guide, dub, guideOffset, dubOffset, strength) => withAudio(guide, (g, gn) => withAudio(dub, (d, dn) => readJSON(instance.exports.align(g, gn, d, dn, guideOffset, dubOffset, strength))));
  return process;
}
