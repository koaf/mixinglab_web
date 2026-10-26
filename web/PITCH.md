# Pitch shifter

`pitch.wasm` contains the desktop Meloa engine's `mix-core::pitch_shift`, compiled
for `wasm32-unknown-unknown`. The browser runs it in `pitch-worker.js` before EQ,
compression and ambience. Playback and WAV export use the same processed buffer.

The controls match the desktop pitch shifter: −12 to +12 semitones, Apply, rack
bypass, and “フォルマントを保持 (声質を変えない)” enabled by default. The core uses
a 2048-sample FFT, 256-sample hop, Hann windows, and the original cepstral envelope
correction with a 48-sample lifter. Duration and stereo channels are preserved.
This is the track-wide pitch shifter; the separate note/timing editor is not included.

The checked-in WebAssembly binary is an app asset, so the static build needs only
Node.js. In the desktop source workspace, rebuild it with
`node scripts/build-pitch.mjs` after installing the Rust wasm target. The wrapper is
`crates/web-pitch`, which links the existing `crates/mix-core` implementation.
The engine is MIT licensed; see the repository LICENSE.

The WebAssembly tests cover shifted frequency, duration, zero shift, silence,
stereo isolation and the same synthetic vocal formant test as the desktop engine.
Other web effects and browser audio output are separate from the desktop engine.
