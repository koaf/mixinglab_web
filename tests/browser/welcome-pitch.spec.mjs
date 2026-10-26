import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeWav } from '../../web/audio.js';

test('PC enters mixer directly; welcome remains accessible', async ({ page }) => {
  await page.goto('/'); await expect(page).toHaveURL(/\/mixer.html$/);
  await expect(page).toHaveTitle(/meloa_web/);
  await page.goto('/?welcome=1');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('いつものMIX');
  await expect(page.locator('#desktop-cta')).toBeVisible();
  await expect(page.locator('#install-card')).toBeHidden();
});
test('Android sees install welcome, can dismiss native prompt and try the mixer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36' });
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#install-card')).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => {}; event.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(event);
  });
  await page.locator('#install-button').click();
  await expect(page.locator('#install-status')).toContainText('あとから');
  await expect(page.locator('#install-instructions')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/welcome-android.png', fullPage: true });
  await page.getByRole('link', { name: /まずはブラウザー/ }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await context.close();
});
test('iPhone gets Share instructions; installed mode bypasses welcome', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#install-steps')).toContainText('共有ボタン');
  await expect(page.locator('#install-button')).toBeHidden();
  await page.screenshot({ path: 'test-results/welcome-ios.png', fullPage: true });
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('http://127.0.0.1:4173/'); await expect(page).toHaveURL(/mixer.html$/);
  await expect(page.locator('#workspace')).toBeVisible(); await context.close();
});
test('pitch worker applies to WAV output, saves settings, bypasses, and works offline', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const samples = Float32Array.from({ length: 48000 }, (_, i) => .15 * Math.sin(2 * Math.PI * 440 * i / 48000));
  const wav = encodeWav({ length: samples.length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples });
  await page.locator('#audio-input').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(wav) });
  await expect(page.locator('.file-row')).toHaveCount(1);
  await expect(page.locator('#fx-formant')).toBeChecked();
  await page.locator('#fx-formant').uncheck();
  await page.getByRole('slider', { name: 'ピッチ', exact: true }).fill('12');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('エフェクトを適用しました。');
  async function exportFrequency() {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '↓ WAV書き出し' }).click();
    const output = await readFile(await (await pending).path());
    expect(output.length).toBe(44 + 48000 * 6);
    let count = 0, previous = 0;
    for (let frame = 12000; frame < 36000; frame++) {
      const at = 44 + frame * 6, value = output.readIntLE(at, 3);
      if (frame > 12000 && previous <= 0 && value > 0) count++;
      previous = value;
    }
    return count * 2;
  }
  expect(await exportFrequency()).toBeGreaterThan(870);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '保存', exact: true }).click();
  const session = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  expect(session.tracks[0].settings.fx.pitch).toBe(12);
  expect(session.tracks[0].settings.fx.formant).toBe(false);
  await page.reload(); await expect(page.getByRole('slider', { name: 'ピッチ', exact: true })).toHaveValue('12');
  await page.locator('#fx-bypass').check();
  await expect(page.locator('body')).not.toHaveAttribute('aria-busy', 'true');
  expect(await exportFrequency()).toBeGreaterThan(430); expect(await exportFrequency()).toBeLessThan(450);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.file-row')).toHaveCount(1);
  await page.locator('#fx-bypass').uncheck(); await expect(page.locator('body')).not.toHaveAttribute('aria-busy', 'true');
  await page.getByRole('slider', { name: 'ピッチ', exact: true }).fill('-12');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('エフェクトを適用しました。');
  const frequency = await exportFrequency(); expect(frequency).toBeGreaterThan(210); expect(frequency).toBeLessThan(230);
  expect(errors).toEqual([]);
});
