import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeWav } from '../../web/audio.js';
function take(delay=0){
  const samples=new Float32Array(96000);
  for(const [start,end,hz] of [[.12,.42,220],[.65,.95,330],[1.15,1.45,440]])for(let i=Math.round((start+delay)*48000);i<Math.round((end+delay)*48000);i++){const t=i/48000-start-delay;samples[i]=.2*Math.max(0,Math.min(1,t/.015,(end-start-t)/.015))*Math.sin(2*Math.PI*hz*t);}
  return Buffer.from(encodeWav({length:samples.length,sampleRate:48000,numberOfChannels:1,getChannelData:()=>samples}));
}
test('pitch/timing tab analyzes, edits, saves, exports, restores and works offline',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('#audio-input').setInputFiles([{name:'vocal.wav',mimeType:'audio/wav',buffer:take()},{name:'guide.wav',mimeType:'audio/wav',buffer:take(.08)}]);
  await expect(page.locator('.file-row')).toHaveCount(2);await page.getByRole('button',{name:'ピッチ / タイミング',exact:true}).click();
  await expect(page.locator('.tune-note').first()).toBeVisible();await expect(page.locator('#dialog')).not.toBeVisible();
  const note=page.locator('.tune-note').first();await note.click();
  const start=page.getByRole('spinbutton',{name:'ノートの開始 (秒)',exact:true});
  const oldStart=Number(await start.inputValue()),oldEnd=Number(await page.getByRole('spinbutton',{name:'ノートの終了 (秒)'}).inputValue());
  await start.fill(String(oldStart+.06));await start.press('Tab');await expect(page.locator('#status')).toHaveText('ノートのタイミングを変更');
  await expect(page.locator('body')).not.toHaveAttribute('aria-busy','true');
  await expect(start).toHaveValue((oldStart+.06).toFixed(3));
  const end=page.getByRole('spinbutton',{name:'ノートの終了 (秒)'});await end.fill(String(oldEnd+.04));await end.press('Tab');await expect(page.locator('#status')).toHaveText('ノートのタイミングを変更');
  await expect(page.locator('body')).not.toHaveAttribute('aria-busy','true');
  const pitch=page.getByRole('spinbutton',{name:'ノートの音程 (MIDI)'});const oldPitch=Number(await pitch.inputValue());await pitch.fill(String(oldPitch+2));await pitch.press('Tab');await expect(page.locator('#status')).toHaveText('ノートのピッチを変更');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存',exact:true}).click();const saved=JSON.parse(await readFile(await(await download).path(),'utf8'));
  expect(saved.tracks[0].settings.tune.anchors.length).toBeGreaterThan(0);expect(saved.tracks[0].settings.tune.notes[0].target).toBeCloseTo(oldPitch+2,1);
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'↓ WAV書き出し'}).click();expect((await readFile(await(await exported).path())).length).toBe(44+96000*6);
  await page.screenshot({path:'test-results/pitch-timing.png',fullPage:true});
  await page.reload();await expect(page.locator('.file-row')).toHaveCount(2);await page.keyboard.press('8');await expect(page.locator('.tune-note').first()).toBeVisible();
  await page.locator('.tune-note').first().click();await expect(page.getByRole('spinbutton',{name:'ノートの開始 (秒)'})).toHaveValue((oldStart+.06).toFixed(3));
  await page.getByRole('combobox',{name:'ガイドトラック'}).selectOption({label:'guide'});
  await page.getByRole('button',{name:'ガイドに合わせる',exact:true}).click();await expect(page.locator('#status')).toHaveText('ガイドに合わせる');
  await page.getByRole('button',{name:'タイミングを戻す',exact:true}).click();await expect(page.locator('#status')).toHaveText('タイミングを戻す');
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);await context.setOffline(true);await page.reload();await expect(page.locator('.file-row')).toHaveCount(2);await page.keyboard.press('8');await expect(page.locator('.tune-note').first()).toBeVisible();
  await page.getByRole('button',{name:'全ノートをスケールに合わせる',exact:true}).click();await expect(page.locator('#status')).toHaveText('スケールに合わせる');
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.tune-scroll')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/pitch-timing-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('note dragging changes pitch and timing; undo restores both',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined}));
  await page.goto('/');await page.locator('#audio-input').setInputFiles({name:'vocal.wav',mimeType:'audio/wav',buffer:take()});await expect(page.locator('.file-row')).toHaveCount(1);await page.keyboard.press('8');
  const note=page.locator('.tune-note').first();await expect(note).toBeVisible();await note.scrollIntoViewIfNeeded();const box=await note.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+10);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y-10,{steps:5});await page.mouse.up();await expect(page.locator('#status')).toHaveText('ノートのピッチを変更');
  await page.keyboard.press('Control+z');await expect(page.locator('#status')).toHaveText('音源を読み込み');
  await note.scrollIntoViewIfNeeded();const moved=await note.boundingBox();await page.mouse.move(moved.x+moved.width/2,moved.y+10);await page.mouse.down();await page.mouse.move(moved.x+moved.width/2+15,moved.y+10,{steps:5});await page.mouse.up();await expect(page.locator('#status')).toHaveText('ノートのタイミングを変更');
});
