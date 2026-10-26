import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function demo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'デモセッションを開く', exact: true }).last().click();
  await expect(page.locator('.file-row')).toHaveCount(3);
  await expect(page.locator('body')).not.toHaveAttribute('aria-busy', 'true');
}
test('demo playback, mixer, undo, effect application, drag and stereo export', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await demo(page);
  await expect(page.locator('#editor-tab')).toHaveText('エディター: First mix');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.locator('#play')).toHaveClass(/playing/);
  await expect.poll(async () => page.locator('#clock').textContent()).not.toBe('0:00.000');
  await expect.poll(async () => page.locator('#meter-l').evaluate(el => parseFloat(el.style.width))).toBeGreaterThan(5);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('button', { name: 'Lead melody ミュート', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lead melody ミュート', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Lead melody ミュート', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('slider', { name: 'Low', exact: true }).fill('6');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('エフェクトを適用しました。');
  const clip = page.locator('[data-clip]').first(), box = await clip.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 110, box.y + 30, { steps: 6 }); await page.mouse.up();
  await page.getByRole('button', { name: 'プロパティ', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('#track-offset').inputValue())).toBeGreaterThan(.1);
  await page.getByRole('button', { name: 'ミキサー', exact: true }).last().click();
  await expect(page.locator('.channel')).toHaveCount(4);
  await page.getByRole('slider', { name: 'マスター音量' }).fill('-3');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ WAV書き出し', exact: true }).click();
  const wav = await download; const bytes = await readFile(await wav.path());
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(bytes.readUInt32LE(24)).toBe(48000); expect(bytes.readUInt16LE(34)).toBe(24);
  expect(bytes.length).toBeGreaterThan(48_000 * 8 * 6);
  expect(bytes.subarray(44).some(n => n !== 0)).toBe(true);
  await page.screenshot({ path: 'test-results/mixer.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('portable sessions, IndexedDB restoration, source waveform and offline app', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await demo(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const sessionFile = await download, session = JSON.parse(await readFile(await sessionFile.path(), 'utf8'));
  expect(session.tracks.every(t => t.audio.length > 100)).toBe(true);
  await page.reload(); await expect(page.locator('.file-row')).toHaveCount(3);
  await expect(page.locator('#status')).toContainText('復元');
  await page.locator('.file-row').first().dblclick();
  await expect(page.locator('.wave-view canvas')).toBeVisible();
  await page.keyboard.press('0');
  await page.screenshot({ path: 'test-results/multitrack.png', fullPage: true });
  await page.locator('#session-input').setInputFiles({ name: 'saved.meloa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...session, name: 'Portable mix' })) });
  await expect(page.locator('#editor-tab')).toHaveText('エディター: Portable mix');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.file-row')).toHaveCount(3);
  await expect(page.locator('#network')).toHaveText('オフライン');
  const cache = await page.evaluate(async () => { const keys = await caches.keys(); const cache = await caches.open(keys[0]); return (await cache.keys()).map(r => new URL(r.url).pathname); });
  expect(cache).toContain('/demo/lead.wav'); expect(errors).toEqual([]);
});
test('imports codecs, reports invalid audio, and fits narrow screens', async ({ page }) => {
  await page.goto('/');
  await page.locator('#audio-input').setInputFiles(['demo/codecs/tone.mp3', 'demo/codecs/tone.flac', 'demo/codecs/tone.ogg']);
  await expect(page.locator('.file-row')).toHaveCount(3);
  await page.locator('#audio-input').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await expect(page.locator('#status')).toHaveClass('error');
  await expect(page.locator('.file-row')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '再生', exact: true })).toBeVisible();
  await expect(page.locator('#workspace')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('offline renderer applies offset, pan and mute to audio samples', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { trackGraph, normalizeSettings } = await import('./audio.js');
    const render = async settings => {
      const ctx = new OfflineAudioContext(2, 4800, 48000), buffer = ctx.createBuffer(1, 2400, 48000);
      buffer.getChannelData(0).fill(.1);
      const track = { buffer, settings: normalizeSettings({ ...settings, fx: { bypass: true } }) };
      trackGraph(ctx, track, [track], ctx.destination, 0, 0);
      const output = await ctx.startRendering();
      return [0, 1].map(c => [...output.getChannelData(c)]);
    };
    const panned = await render({ pan: -1, offset: .02 }), muted = await render({ mute: true });
    return { before: panned[0].slice(0, 900).every(n => n === 0), after: panned[0].slice(1000, 1200).every(n => n > .09), right: panned[1].every(n => Math.abs(n) < .0001), muted: muted.flat().every(n => n === 0) };
  });
  expect(result).toEqual({ before: true, after: true, right: true, muted: true });
});
