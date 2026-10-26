import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const asset = async path => `data:image/png;base64,${(await readFile(new URL(path, import.meta.url))).toString('base64')}`;
const preview = await asset('../web/preview.png');
const icon = await asset('../assets/icon-256.png');
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const [name, headline, subtitle, accent] of [
    ['home', 'いつものMIXを、<br>ブラウザーから。', 'あなたの、小さなミキシングルーム。', '#a7edc4'],
    ['mixer', '音を重ねる。<br>響きをつくる。', 'ピッチも、タイミングも。その場で編集。', '#8ac6ff'],
  ]) {
    await page.setContent(`<!doctype html><html lang="ja"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:#111613;color:#edf4ef;font-family:"Yu Gothic","Meiryo",sans-serif}
      .glow{position:absolute;inset:0;background:radial-gradient(ellipse at 95% 20%,${accent}22,transparent 65%)}
      .brand{position:absolute;left:64px;top:48px;display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700;letter-spacing:-1px}.brand img{width:54px;height:54px;border-radius:13px}
      .eyebrow{position:absolute;left:66px;top:149px;color:${accent};font-size:13px;font-weight:700;letter-spacing:3px}
      h1{position:absolute;left:60px;top:173px;margin:0;font-size:49px;line-height:1.6;letter-spacing:-2px;font-weight:800}h1 span{color:${accent}}
      .subtitle{position:absolute;left:65px;top:365px;color:#bbc9bf;font-size:19px}
      .screen{position:absolute;left:618px;top:134px;width:700px;padding:9px;background:#27312b;border:1px solid #ffffff35;border-radius:13px;box-shadow:0 24px 65px #0009;transform:rotate(-4deg)}.screen img{display:block;width:100%;border-radius:6px}
      .bottom{position:absolute;left:65px;right:65px;bottom:42px;padding-top:24px;border-top:1px solid #ffffff26;display:flex;justify-content:space-between;align-items:center;background:#111613}.features{color:${accent};font-size:13px;letter-spacing:1.5px}.url{color:#c3d0c8;font-size:17px}
    </style><div class="glow"></div><div class="brand"><img src="${icon}" alt="">Meloa WebEditor</div><div class="eyebrow">YOUR LITTLE MIXING ROOM</div><h1>${headline.replace('<br>', '<br><span>')} </span></h1><p class="subtitle">${subtitle}</p><div class="screen"><img src="${preview}" alt="Meloa WebEditorの編集画面"></div><div class="bottom"><span class="features">12 TRACKS &nbsp; / &nbsp; PITCH & TIMING &nbsp; / &nbsp; WAV EXPORT</span><span class="url">meloa.wbsk.me</span></div></html>`);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    await page.screenshot({ path: fileURLToPath(new URL(`../web/ogp-${name}.png`, import.meta.url)) });
  }
} finally {
  await browser.close();
}
