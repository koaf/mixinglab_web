// Runs mix-core::pitch_shift from the desktop app, compiled to WebAssembly.
export async function createPitchProcessor(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes);
  const { memory, allocate, release, shift } = instance.exports;
  return (channels, semitones, formant = true) => {
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
}
