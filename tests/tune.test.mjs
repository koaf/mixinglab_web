import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPitchProcessor } from '../web/pitch-dsp.js';
import { validateTune, outTime } from '../web/tune.js';
const dsp = await createPitchProcessor(await readFile(new URL('../web/pitch.wasm', import.meta.url)));
const rate = 48000;
function voice(delay = 0) {
  const samples = new Float32Array(rate * 2);
  for (const [start,end,hz] of [[.12,.42,220],[.65,.95,330],[1.15,1.45,440]]) {
    for(let i=Math.round((start+delay)*rate);i<Math.round((end+delay)*rate);i++) {
      const time=i/rate-start-delay,edge=Math.min(1,time/.015,(end-start-time)/.015);
      samples[i]=.2*Math.max(0,edge)*Math.sin(2*Math.PI*hz*time);
    }
  }
  return samples;
}
const samples = voice(), analysis = dsp.analyze([samples]);
test('desktop YIN produces editable notes and serializable pitch curves', () => {
  assert.ok(analysis.notes.length >= 3); assert.equal(analysis.duration,2);
  assert.ok(analysis.pitch.some(value => value == null));
  assert.ok(Math.abs(analysis.notes[0].center-57)<.2);
  assert.ok(validateTune({notes:analysis.notes,anchors:[]}));
});
test('desktop TD-PSOLA shifts a single note, preserving duration and other notes', () => {
  const tune = { notes:structuredClone(analysis.notes), anchors:[] };
  tune.notes[0].target += 2;
  const corrected = dsp.correct([samples],tune)[0];
  let count=0;for(let i=rate*.22+1;i<rate*.32;i++)if(corrected[i-1]<=0&&corrected[i]>0)count++;
  assert.ok(Math.abs(count*10-220*2**(2/12))<15,`frequency ${count*10}`);assert.equal(corrected.length,samples.length);
  assert.deepEqual(dsp.correct([samples],{notes:analysis.notes,anchors:[]})[0],samples);
});
test('desktop time move and resize update anchors and audible onset', () => {
  const tune={notes:analysis.notes,anchors:[]}, note=tune.notes[0];
  const edited=dsp.edit({op:'move',tune,index:0,d0:.06,d1:.09,duration:2}).tune;
  assert.ok(Math.abs(outTime(edited,note.start)-note.start-.06)<.0001);
  assert.ok(Math.abs(outTime(edited,note.end)-note.end-.09)<.0001);
  const corrected=dsp.correct([samples],edited)[0];
  const energy=(data,start,end)=>data.slice(start*rate,end*rate).reduce((sum,n)=>sum+n*n,0);
  assert.ok(energy(corrected,.13,.16)<energy(samples,.13,.16)*.2);
  assert.equal(corrected.length,samples.length);
  assert.throws(()=>dsp.edit({op:'move',tune,index:0,d0:-2,d1:-2,duration:2}));
});
test('desktop guide alignment corrects a delayed take and respects zero strength', () => {
  const dub=voice(.08),aligned=dsp.align([samples],[dub],0,0,1).anchors;
  assert.ok(aligned.length>0);validateTune({notes:[],anchors:aligned});
  const mapped=outTime({anchors:aligned},.3);
  assert.ok(mapped < .27 && mapped > .17,`mapped ${mapped}`);
  const zero=dsp.align([samples],[dub],0,0,0).anchors;
  assert.ok(Math.abs(outTime({anchors:zero},.3)-.3)<.001);
});
test('invalid note and non-monotonic time maps are rejected', () => {
  assert.throws(()=>validateTune({notes:[{start:0,end:1,center:69,target:Infinity}],anchors:[]}));
  assert.throws(()=>validateTune({notes:[],anchors:[[.2,.3],[.1,.4]]}));
});
