const $ = selector => document.querySelector(selector);
let promptEvent;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (document.documentElement.dataset.device === 'desktop') {
  $('#install-card').hidden = true; $('#desktop-cta').hidden = false;
} else if (ios) {
  $('#install-steps').innerHTML = '<li>ブラウザーの共有ボタン <span aria-label="共有">↥</span> をタップ</li><li>「ホーム画面に追加」を選ぶ<br><small>見つからない場合はSafariで開いてください。</small></li><li>「追加」を押して、ホーム画面から起動</li>';
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); promptEvent = event;
  $('#install-button').hidden = false; $('#install-instructions').hidden = true;
});
$('#install-button').addEventListener('click', async () => {
  if (!promptEvent) return;
  try {
    await promptEvent.prompt();
    const result = await promptEvent.userChoice;
    $('#install-status').textContent = result.outcome === 'accepted' ? '追加が完了したら、ホーム画面から起動してください。' : 'あとからブラウザーのメニューでインストールできます。';
  } catch { $('#install-status').textContent = 'ブラウザーのメニューから「ホーム画面に追加」を選んでください。'; }
  promptEvent = null; $('#install-button').hidden = true; $('#install-instructions').hidden = false;
});
window.addEventListener('appinstalled', () => {
  $('#install-button').hidden = true; $('#install-instructions').hidden = true;
  $('#install-status').textContent = 'インストールできました。ホーム画面からmeloa_webを開いてください。';
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(() => {
  $('#install-status').textContent = 'オフラインの準備ができませんでした。接続を確認して再読み込みしてください。';
});
