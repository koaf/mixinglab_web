import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../web/', import.meta.url), output, { recursive: true });
await mkdir(new URL('demo/', output), { recursive: true });
for (const name of ['first_mix.meloa.json', 'lead.wav', 'bass.wav', 'pad.wav']) {
  await cp(new URL(`../demo/${name}`, import.meta.url), new URL(`demo/${name}`, output));
}
await cp(new URL('../assets/icon-256.png', import.meta.url), new URL('icons/icon-256.png', output));
await writeFile(new URL('.nojekyll', output), '');
console.log('Static app built in dist/');
