import { AudioEngine, DEFAULT_FX, LIMITS, clamp, normalizeSettings, validateSession, audible, sessionDuration, tailDuration, formatTime, dbGain, encodeWav, trackGraph } from './audio.js';
import { readAutosave, writeAutosave } from './storage.js';
import { preparePitchTracks } from './pitch.js';

const $ = selector => document.querySelector(selector);
const engine = new AudioEngine();
const colors = ['#2eaa78', '#4688d6', '#9e68d2', '#d25c84', '#d88e3c', '#bab240', '#3aacba', '#cc5448'];
const state = { name: '無題', tracks: [], master_db: 0, selected: null, view: 'multitrack', side: 'rack', span: 20 };
let history = [], historyIndex = -1, busy = false, dirty = false, autosaveTimer, saveQueue = Promise.resolve(), stagedSession, installPrompt;
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const selected = () => state.tracks.find(t => t.id === state.selected);
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
const panLabel = value => Math.abs(value) < .005 ? 'C' : `${value < 0 ? 'L' : 'R'}${Math.round(Math.abs(value) * 100)}`;
const gainLabel = value => `${Number(value).toFixed(1)} dB`;
const trackColor = track => colors[state.tracks.indexOf(track) % colors.length];
const snapshot = () => ({ name: state.name, master_db: state.master_db, selected: state.selected, tracks: state.tracks.map(t => ({ ...t, settings: structuredClone(t.settings) })) });
function record(label) {
  history = history.slice(0, historyIndex + 1);
  history.push({ label, data: snapshot() });
  if (history.length > 41) history.shift();
  historyIndex = history.length - 1; dirty = true; scheduleSave();
}
function scheduleSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 500);
}
async function flushAutosave() {
  clearTimeout(autosaveTimer); autosaveTimer = null;
  const data = { version: 1, name: state.name, master_db: state.master_db, tracks: state.tracks.map(t => ({ name: t.name, path: t.path, settings: structuredClone(t.settings), raw: t.raw })) };
  saveQueue = saveQueue.catch(() => {}).then(() => writeAutosave(data)).catch(error => status(`自動保存できません。セッションをファイルに保存してください: ${error.message}`, true));
  await saveQueue;
}
function info(title, html, confirm = false) {
  const dialog = $('#dialog');
  if (dialog.open) dialog.close();
  $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; $('#dialog-confirm').hidden = !confirm;
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function replaceAllowed() {
  return !dirty || await info('セッションを切り替えますか？', '<p>現在の編集内容が置き換わります。必要な場合は一度閉じて「保存」で音源を含むセッションを保存してください。</p>', true);
}
async function run(task) {
  await startup;
  if (busy) return;
  busy = true; document.body.setAttribute('aria-busy', 'true');
  try { await task(); } catch (error) { status(error.message || String(error), true); }
  finally { busy = false; document.body.removeAttribute('aria-busy'); }
}
function resetHistory(label) { history = [{ label, data: snapshot() }]; historyIndex = 0; dirty = false; }
async function restart() { engine.update(state.tracks, state.master_db); if (engine.playing) { engine.pause(); await engine.play(state.tracks); } }
async function seek(position) {
  const playing = engine.playing; engine.pause(); engine.position = clamp(position, 0, sessionDuration(state.tracks));
  if (playing) await engine.play(state.tracks);
  tickPosition();
}
function fit() { state.span = Math.max(2, sessionDuration(state.tracks) * 1.08); updateZoom(); renderWorkspace(); }
function updateZoom() { $('#zoom').max = Math.max(120, state.span, sessionDuration(state.tracks) * 1.2); $('#zoom').value = state.span; }
function render() {
  renderFiles(); renderSide(); renderWorkspace();
  $('#mode-wave').classList.toggle('active', state.view === 'waveform');
  $('#mode-multi').classList.toggle('active', state.view !== 'waveform');
  $('#editor-tab').classList.toggle('active', state.view !== 'mixer'); $('#mixer-tab').classList.toggle('active', state.view === 'mixer');
  $('#editor-tab').textContent = `エディター: ${state.name}`;
  $('#duration').textContent = formatTime(sessionDuration(state.tracks));
  document.title = `${state.name} — meloa_web`;
  updateZoom(); tickPosition();
}
function renderFiles() {
  $('#files').innerHTML = state.tracks.map(t => `<div class="file-row ${t.id === state.selected ? 'selected' : ''}" data-select="${t.id}" role="button" tabindex="0" style="--track:${trackColor(t)}"><span class="file-name"><i>▥</i>${escape(t.name)}</span><span>${formatTime(t.buffer.duration)}</span><span>${t.buffer.numberOfChannels === 1 ? 'モノラル' : 'ステレオ'}</span></div>`).join('');
  $('#file-empty').hidden = !!state.tracks.length;
}
const fxGroups = [
  ['パラメトリック EQ', [['low_db', 'Low', -24, 24, .1, 'dB'], ['mid_db', 'Mid', -24, 24, .1, 'dB'], ['mid_hz', '周波数', 80, 12000, 10, 'Hz'], ['mid_q', 'Q', .1, 10, .1, ''], ['high_db', 'High', -24, 24, .1, 'dB']]],
  ['ダイナミクス (コンプレッサー)', [['threshold_db', 'スレッショルド', -60, 0, .1, 'dB'], ['ratio', 'レシオ', 1, 20, .1, ':1'], ['attack_ms', 'アタック', 1, 100, 1, 'ms'], ['release_ms', 'リリース', 10, 1000, 1, 'ms'], ['makeup_db', 'メイクアップ', 0, 24, .1, 'dB']]],
  ['リバーブ / ディレイ', [['reverb', 'リバーブ', 0, 1, .01, '%'], ['delay', 'ディレイ', 0, 1, .01, '%'], ['delay_ms', 'ディレイ時間', 20, 1000, 1, 'ms']]],
  ['ピッチシフター', [['pitch', 'ピッチ', -12, 12, .1, '半音']]]
];
const fxLabel = (value, unit) => unit === '%' ? `${Math.round(value * 100)} %` : `${unit === 'Hz' || unit === 'ms' ? Math.round(value) : value.toFixed(1)}${unit === ':1' ? ':1' : ' ' + unit}`;
function renderSide() {
  document.querySelectorAll('[data-side]').forEach(b => b.classList.toggle('active', b.dataset.side === state.side));
  const t = selected(), body = $('#side-content');
  if (state.side === 'history') {
    body.innerHTML = history.map((entry, i) => `<button class="history-item ${i === historyIndex ? 'active' : ''}" data-history="${i}">${i === historyIndex ? '▸ ' : ''}${escape(entry.label)}</button>`).join(''); return;
  }
  if (!t) { body.innerHTML = '<div class="hint">トラックを選択してください。</div>'; return; }
  if (state.side === 'properties') {
    body.innerHTML = `<label class="property">セッション名<input type="text" id="session-name" value="${escape(state.name)}" maxlength="160"></label><div class="rack-title" style="--track:${trackColor(t)}">${escape(t.name)}</div><label class="property">トラック名<input type="text" id="track-name" value="${escape(t.name)}" maxlength="160"></label><label class="property">開始位置（秒）<input type="number" id="track-offset" value="${t.settings.offset.toFixed(3)}" min="0" max="1200" step=".01"></label><p>長さ: ${formatTime(t.buffer.duration)}</p><p>${t.buffer.sampleRate.toLocaleString()} Hz / ${t.buffer.numberOfChannels} ch</p><p class="side-note">元ファイル: ${escape(t.path)}</p><button data-action="delete" class="danger">トラックを削除</button>`; return;
  }
  body.innerHTML = `<div class="fx-top"><span>トラックエフェクト</span><span class="spacer"></span><label><input id="fx-bypass" type="checkbox" ${t.settings.fx.bypass ? 'checked' : ''}>バイパス</label></div><div class="rack-title" style="--track:${trackColor(t)}">トラック: ${escape(t.name)}</div><p class="side-note">内蔵エフェクト（「適用」で再生に反映）</p>${fxGroups.map(([title, fields], i) => `<details class="fx-group" open><summary>${i + 1} ⏻ ${title}</summary><div class="fx-fields">${fields.map(([key, label, min, max, step, unit]) => `<label class="field"><span>${label}</span><input type="range" data-fx="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${t.settings.fx[key]}" aria-label="${label}"><output>${fxLabel(t.settings.fx[key], unit)}</output></label>`).join('')}${i === 3 ? `<label class="formant-option"><input id="fx-formant" type="checkbox" ${t.settings.fx.formant ? 'checked' : ''}>フォルマントを保持 (声質を変えない)</label>` : ''}</div></details>`).join('')}<button data-action="apply-fx" class="primary">適用</button><button data-action="reset-fx">初期値に戻す</button><p class="side-note">VST3・ノート単位のピッチ／タイミング補正はWeb版では未対応です。EQ・コンプレッサー・リバーブ・ディレイ・ピッチシフターは再生と書き出しに適用します。ピッチは長さを保ったまま±12半音。デスクトップ版と同じフォルマント保持にも対応します。</p>`;
}
function controls(t) {
  return `<div class="track-buttons"><button data-toggle="mute" data-track="${t.id}" class="chip ${t.settings.mute ? 'muted-on' : ''}" aria-label="${escape(t.name)} ミュート" aria-pressed="${t.settings.mute}">M</button><button data-toggle="solo" data-track="${t.id}" class="chip ${t.settings.solo ? 'solo-on' : ''}" aria-label="${escape(t.name)} ソロ" aria-pressed="${t.settings.solo}">S</button><button data-rack="${t.id}" class="chip">fx</button></div>`;
}
function renderWorkspace() {
  const workspace = $('#workspace'), scrollLeft = workspace.scrollLeft, scrollTop = workspace.scrollTop;
  if (!state.tracks.length) {
    workspace.innerHTML = '<div class="empty-workspace"><span class="empty-icon">▥</span><h1>マルチトラックセッション</h1><p>音源を読み込んで、MIXを始めましょう。</p><div class="empty-actions"><button data-action="import" class="primary">音源を読み込み…</button><button data-action="demo">デモセッションを開く</button></div><p>WAV / MP3 / FLAC / OGG · 最大12トラック</p></div>'; return;
  }
  if (state.view === 'mixer') {
    workspace.innerHTML = `<div class="mixer">${state.tracks.map(t => `<div class="channel" style="--track:${trackColor(t)}"><div class="channel-name">${escape(t.name)}</div>${controls(t)}<label>パン<input type="range" data-control="pan" data-track="${t.id}" min="-1" max="1" step=".01" value="${t.settings.pan}" aria-label="${escape(t.name)} パン"><output>${panLabel(t.settings.pan)}</output></label><input class="fader" type="range" data-control="gain_db" data-track="${t.id}" min="-60" max="12" step=".1" value="${t.settings.gain_db}" aria-label="${escape(t.name)} 音量"><output>${gainLabel(t.settings.gain_db)}</output><span class="routing">→ マスター</span></div>`).join('')}<div class="channel master"><div class="channel-name">マスター</div><span class="routing">ステレオ出力</span><input type="range" id="master-gain" class="fader" min="-60" max="12" step=".1" value="${state.master_db}" aria-label="マスター音量"><output>${gainLabel(state.master_db)}</output><span class="routing">48 kHz / 24 bit WAV</span></div></div>`;
    return;
  }
  if (state.view === 'waveform') {
    const t = selected() || state.tracks[0];
    workspace.innerHTML = `<div class="wave-view" data-wave="${t.id}"><div class="wave-label">${escape(t.name)} — ソース波形（エフェクト適用前）</div><canvas aria-label="${escape(t.name)} ソース波形"></canvas><div class="playhead"></div></div>`;
    drawWave(workspace.querySelector('canvas'), t.buffer, '#2ce086', t.buffer.duration); tickPosition(); return;
  }
  const headWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head'));
  const available = Math.max(250, workspace.clientWidth - headWidth);
  const total = sessionDuration(state.tracks), shown = Math.max(state.span, total + .5), width = available * shown / state.span;
  const step = [ .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300 ].find(n => n >= state.span / 8) || 600;
  let ticks = ''; for (let sec = 0; sec <= shown; sec += step) ticks += `<span class="ruler-tick" style="left:${sec / shown * 100}%">${formatTime(sec).replace('.000', '')}</span>`;
  workspace.innerHTML = `<div class="timeline" style="width:${width + headWidth}px;--grid:${step / shown * width}px" data-pixels="${width / shown}"><div class="ruler"><div class="ruler-label">hms</div><div class="ruler-scale" data-seek>${ticks}</div></div>${state.tracks.map(t => `<div class="track ${t.id === state.selected ? 'selected' : ''}" style="--track:${trackColor(t)}"><div class="track-head" data-select="${t.id}"><div class="track-name">${escape(t.name)}</div>${controls(t)}<div class="track-control"><input type="range" data-control="gain_db" data-track="${t.id}" min="-60" max="12" step=".1" value="${t.settings.gain_db}" aria-label="${escape(t.name)} 音量"><output>${gainLabel(t.settings.gain_db)}</output><input type="range" data-control="pan" data-track="${t.id}" min="-1" max="1" step=".01" value="${t.settings.pan}" aria-label="${escape(t.name)} パン"><output>${panLabel(t.settings.pan)}</output></div><div class="routing">→ マスター</div></div><div class="lane" data-seek><div class="clip" data-clip="${t.id}" style="left:${t.settings.offset / shown * 100}%;width:${t.buffer.duration / shown * 100}%"><div class="clip-name">${escape(t.name)}</div><canvas aria-label="${escape(t.name)} 波形"></canvas></div></div></div>`).join('')}<div class="playhead"></div></div>`;
  workspace.querySelectorAll('[data-clip]').forEach(el => { const t = state.tracks.find(t => t.id === el.dataset.clip); drawWave(el.querySelector('canvas'), t.buffer, trackColor(t)); });
  workspace.scrollLeft = scrollLeft; workspace.scrollTop = scrollTop; tickPosition();
}
const waveCache = new WeakMap();
function drawWave(canvas, buffer, color) {
  const dpr = Math.min(2, devicePixelRatio || 1), width = Math.max(1, Math.round(canvas.clientWidth)), height = Math.max(1, Math.round(canvas.clientHeight));
  canvas.width = width * dpr; canvas.height = height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.fillStyle = color; ctx.globalAlpha = .85;
  // Cache min/max envelopes rather than rescanning long audio on every selection.
  let cached = waveCache.get(buffer);
  if (!cached) {
    const bins = Math.min(6000, buffer.length), block = Math.ceil(buffer.length / bins);
    cached = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => {
      const samples = buffer.getChannelData(c), peaks = [];
      for (let start = 0; start < samples.length; start += block) {
        let min = 0, max = 0; for (let i = start; i < Math.min(start + block, samples.length); i++) { min = Math.min(min, samples[i]); max = Math.max(max, samples[i]); }
        peaks.push([min, max]);
      }
      return peaks;
    }); waveCache.set(buffer, cached);
  }
  for (let c = 0; c < 2; c++) {
    const peaks = cached[Math.min(c, cached.length - 1)], center = height * (c ? .75 : .25), amplitude = height * .21;
    ctx.globalAlpha = .22; ctx.fillRect(0, center, width, 1); ctx.globalAlpha = .85;
    for (let x = 0; x < width; x++) {
      let min = 0, max = 0;
      const start = Math.floor(x / width * peaks.length), end = Math.max(start + 1, Math.ceil((x + 1) / width * peaks.length));
      for (let i = start; i < Math.min(end, peaks.length); i++) { min = Math.min(min, peaks[i][0]); max = Math.max(max, peaks[i][1]); }
      ctx.fillRect(x, center - max * amplitude, 1, Math.max(1, (max - min) * amplitude));
    }
  }
}
function tickPosition() {
  const time = Math.max(0, engine.time), text = formatTime(time);
  $('#clock').textContent = text; $('#position').textContent = text;
  $('#play').textContent = engine.playing ? 'Ⅱ' : '▶'; $('#play').classList.toggle('playing', engine.playing); $('#play').setAttribute('aria-label', engine.playing ? '一時停止' : '再生');
  const head = $('#workspace .playhead');
  if (head) {
    const timeline = $('.timeline');
    if (timeline) head.style.left = `${parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head')) + time * Number(timeline.dataset.pixels)}px`;
    else { const t = selected() || state.tracks[0]; head.style.left = `${clamp((time - t.settings.offset) / t.buffer.duration * 100, 0, 100)}%`; }
  }
}
function animate() {
  if (engine.playing && engine.time >= sessionDuration(state.tracks) + tailDuration(state.tracks)) { engine.pause(); engine.position = 0; }
  tickPosition();
  const peaks = engine.peaks();
  ['l', 'r'].forEach((channel, i) => { const peak = peaks[i]; $(`#meter-${channel}`).style.width = `${clamp((20 * Math.log10(Math.max(1e-5, peak)) + 60) / 60 * 100, 0, 100)}%`; if (peak >= .979) $('#clip').classList.add('clipped'); });
  requestAnimationFrame(animate);
}
async function decodeTrack(raw, name, path, settings) {
  if (!(raw instanceof ArrayBuffer) || raw.byteLength > LIMITS.bytes) throw Error('音源は1ファイル120 MB以下にしてください。');
  const context = await engine.init();
  let buffer; try { buffer = await context.decodeAudioData(raw.slice(0)); } catch { throw Error(`${name}: 音源を読み込めません。このブラウザーが対応するWAV / MP3 / FLAC / OGGを選んでください。`); }
  if (buffer.duration > LIMITS.duration || buffer.numberOfChannels > 2) throw Error(`${name}: 10分以内のモノラル／ステレオ音源を選んでください。`);
  return { id: crypto.randomUUID(), name, path, raw, buffer, settings: normalizeSettings(settings) };
}
function checkTracks(tracks) {
  if (tracks.length > LIMITS.tracks) throw Error('最大12トラックまで読み込めます。');
  if (tracks.reduce((sum, t) => sum + t.buffer.duration, 0) > LIMITS.total) throw Error('音源長の合計は20分以内にしてください。');
}
async function importAudio(files) {
  if (!files.length) return;
  if (stagedSession) {
    for (const file of files) stagedSession.files.set(file.name, await file.arrayBuffer());
    await finishStaged(); return;
  }
  if (state.tracks.length + files.length > LIMITS.tracks) throw Error('最大12トラックまで読み込めます。');
  status('音源を読み込んでいます…');
  const added = [];
  for (const file of files) added.push(await decodeTrack(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''), file.name));
  checkTracks([...state.tracks, ...added]);
  engine.pause(); state.tracks.push(...added); state.selected = added[0].id;
  fit(); record('音源を読み込み'); render(); status(`${added.length}トラックを読み込みました。`);
}
function fromBase64(text) {
  if (typeof text !== 'string' || text.length > LIMITS.bytes * 4 / 3 + 4) throw Error('音源データのサイズが上限を超えています。');
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
const basename = path => String(path).split(/[\\/]/).pop();
async function loadSession(data, { demo = false, restoring = false } = {}) {
  const session = validateSession(data), tracks = [];
  for (const item of session.tracks) {
    let raw;
    if (item.raw instanceof ArrayBuffer) raw = item.raw;
    else if (item.audio) raw = fromBase64(item.audio);
    else if (demo) {
      const name = basename(item.path);
      if (!['lead.wav', 'bass.wav', 'pad.wav'].includes(name)) throw Error('不明なデモ音源です。');
      const response = await fetch(new URL(`./demo/${name}`, import.meta.url)); if (!response.ok) throw Error('デモ音源を取得できません。'); raw = await response.arrayBuffer();
    } else raw = stagedSession?.files.get(basename(item.path));
    if (!raw) throw Error(`音源が必要です: ${basename(item.path)}`);
    tracks.push(await decodeTrack(raw, item.name, basename(item.path || item.name), item.settings));
  }
  checkTracks(tracks);
  const unsupported = data.master_inserts?.length || data.tracks.some(t => t.settings?.tune || t.tune || t.plugins?.length || t.inserts?.length);
  engine.pause(); engine.position = 0;
  state.name = session.name; state.master_db = session.master_db; state.tracks = tracks; state.selected = tracks[0]?.id || null;
  state.view = 'multitrack'; engine.update(tracks, state.master_db); stagedSession = null;
  fit(); resetHistory(restoring ? '自動保存から復元' : 'セッションを開く'); render(); await flushAutosave();
  status(`${restoring ? '自動保存から復元しました' : 'セッションを開きました'}: ${state.name}`);
  if (unsupported) await info('Web版の対応範囲', '<p>このセッションに含まれるVST3・ノート単位のピッチ／タイミング補正は再現できません。Web版で保存したファイルには、これらの設定を含みません。元のセッションは保管してください。</p>');
}
async function finishStaged() {
  const missing = stagedSession.data.tracks.filter(t => !t.audio && !stagedSession.files.has(basename(t.path))).map(t => basename(t.path));
  if (missing.length) { status(`元の音源を選択してください: ${missing.join(', ')}。ファイル → 音源を読み込み で追加できます。`, true); return; }
  await loadSession(stagedSession.data);
}
async function openSession(file) {
  if (!file || !await replaceAllowed()) return;
  if (file.size > 256 * 1024 * 1024) throw Error('セッションファイルは256 MB以下にしてください。');
  const original = JSON.parse(await file.text());
  const data = validateSession(original);
  if (data.tracks.some(t => !t.audio)) {
    stagedSession = { data: original, files: new Map(state.tracks.map(t => [t.path, t.raw])) };
    await finishStaged();
    if (stagedSession) await info('元の音源を選択してください', `<p>デスクトップ版のセッションは音源への参照を保存しています。「読み込み…」から次の元ファイルを追加してください。</p><p>${data.tracks.filter(t => !t.audio).map(t => escape(basename(t.path))).join('<br>')}</p><p>音源が揃うまで、現在のセッションは保持します。</p>`);
  } else await loadSession(original);
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const safeName = () => state.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'meloa_web';
async function saveSession() {
  status('音源を含むセッションを準備しています…'); await new Promise(resolve => setTimeout(resolve, 0));
  const data = { version: 1, format: 'meloa-web', name: state.name, master_db: state.master_db, tracks: state.tracks.map(t => ({ name: t.name, path: t.path, settings: t.settings, audio: toBase64(t.raw) })) };
  const json = JSON.stringify(data);
  if (new Blob([json]).size > 256 * 1024 * 1024) throw Error('音源を含むセッションが256 MBを超えています。トラック数や音源の長さを減らしてください。');
  await flushAutosave();
  download(json, `${safeName()}.meloa.json`, 'application/json'); dirty = false; status('音源を含むセッションを保存しました。');
}
async function exportMix() {
  if (!state.tracks.length) return status('書き出す音源を読み込んでください。');
  engine.pause(); status('ミックスダウンを書き出しています…');
  const seconds = sessionDuration(state.tracks) + tailDuration(state.tracks), frames = Math.ceil(seconds * 48000);
  const context = new OfflineAudioContext(2, frames, 48000), master = context.createGain(); master.gain.value = dbGain(state.master_db); master.connect(context.destination);
  await preparePitchTracks(state.tracks, context);
  for (const t of state.tracks) if (audible(t, state.tracks)) trackGraph(context, t, state.tracks, master, 0, 0);
  const buffer = await context.startRendering();
  download(encodeWav(buffer), `${safeName()}.wav`, 'audio/wav'); status('48 kHz / 24 bit ステレオWAVを書き出しました。');
}
async function restoreHistory(index) {
  if (index < 0 || index >= history.length || index === historyIndex) return;
  engine.pause(); Object.assign(state, history[index].data, { tracks: history[index].data.tracks.map(t => ({ ...t, settings: structuredClone(t.settings) })) });
  historyIndex = index; engine.update(state.tracks, state.master_db); dirty = true; scheduleSave(); render(); status(history[index].label);
}
const actions = {
  import: () => $('#audio-input').click(), open: () => $('#session-input').click(), save: saveSession, export: exportMix,
  demo: async () => { if (!await replaceAllowed()) return; const response = await fetch(new URL('./demo/first_mix.meloa.json', import.meta.url)); if (!response.ok) throw Error('デモを取得できません。'); status('デモを読み込んでいます…'); await loadSession(await response.json(), { demo: true }); },
  new: async () => { if (!await replaceAllowed()) return; engine.pause(); engine.position = 0; Object.assign(state, { name: '無題', tracks: [], master_db: 0, selected: null }); stagedSession = null; resetHistory('新規セッション'); render(); scheduleSave(); status('新規セッションを作成しました。'); },
  undo: () => restoreHistory(historyIndex - 1), redo: () => restoreHistory(historyIndex + 1),
  delete: async () => { const t = selected(); if (!t) return; engine.pause(); state.tracks = state.tracks.filter(item => item.id !== t.id); state.selected = state.tracks[0]?.id || null; engine.position = Math.min(engine.position, sessionDuration(state.tracks)); record('トラックを削除'); render(); },
  waveform: () => { state.view = 'waveform'; render(); }, multitrack: () => { state.view = 'multitrack'; render(); }, mixer: () => { state.view = 'mixer'; render(); },
  rack: () => { state.side = 'rack'; renderSide(); },
  bypass: async () => { const t = selected(); if (!t) return; t.settings.fx.bypass = !t.settings.fx.bypass; record('ラックのバイパスを変更'); renderSide(); await restart(); },
  'apply-fx': async () => {
    const t = selected(); if (!t || state.side !== 'rack') return;
    const fx = { ...t.settings.fx, bypass: $('#fx-bypass').checked, formant: $('#fx-formant').checked };
    document.querySelectorAll('[data-fx]').forEach(el => fx[el.dataset.fx] = Number(el.value));
    const candidate = { ...t, settings: { ...t.settings, fx } };
    status('エフェクトを準備しています。ピッチ処理中は少しお待ちください…');
    await preparePitchTracks([candidate], await engine.init());
    t.settings.fx = fx; record('エフェクトを適用'); await restart(); await flushAutosave(); status('エフェクトを適用しました。');
  },
  'reset-fx': async () => { const t = selected(); if (!t) return; t.settings.fx = { ...DEFAULT_FX }; record('エフェクトを初期化'); renderSide(); await restart(); },
  'reset-offset': async () => { const t = selected(); if (!t) return; t.settings.offset = 0; record('クリップを先頭へ移動'); render(); await restart(); },
  play: async () => { if (engine.playing) engine.pause(); else if (state.tracks.length) { if (engine.position >= sessionDuration(state.tracks)) engine.position = 0; engine.update(state.tracks, state.master_db); await engine.play(state.tracks); } },
  stop: () => { engine.pause(); engine.position = 0; tickPosition(); }, start: () => seek(0), end: () => seek(sessionDuration(state.tracks)),
  fit, 'zoom-in': () => { state.span = Math.max(.5, state.span / 1.5); updateZoom(); renderWorkspace(); }, 'zoom-out': () => { state.span = Math.min(2400, state.span * 1.5); updateZoom(); renderWorkspace(); },
  'pitch-info': () => info('ピッチ / タイミング', '<p>全体のキー変更は、エフェクトラックの「ピッチシフター」で±12半音を調整できます。ノート単位のピッチ解析・補正、タイミング補正はWeb版では未対応です。</p>'),
  help: () => info('meloa_web', '<p>音源を読み込み、音量・パン・M（ミュート）・S（ソロ）を調整します。クリップは左右にドラッグして開始位置を変更、ダブルクリックで波形を表示します。空のレーンや時間目盛りをクリックすると再生位置が変わります。</p><p>エフェクトは「適用」で反映。「保存」は音源を含むセッション、「WAV書き出し」は48 kHz / 24 bitのステレオ音声を保存します。編集は端末内に自動保存されます。</p><p>Space: 再生／一時停止 · Home/End: 先頭／末尾<br>9/0: 波形／マルチトラック · −/=: ズーム · \\: 全体表示<br>Ctrl+I/O/S: 読み込み／開く／保存 · Ctrl+Z: 取り消し</p><p>最大12トラック、1本10分、合計20分。形式対応はブラウザーに依存します。VST3・ノート単位のピッチ／タイミング補正・録音は未対応です。デスクトップ版の全機能との互換性はありません。</p><p>初回読み込み完了後はオフラインでも利用できます。対応ブラウザーではアドレスバーからアプリとしてインストールできます。iPhone/iPadではSafariの共有 →「ホーム画面に追加」を使います。</p>')
};
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button) {
    document.querySelectorAll('nav details').forEach(el => el.open = false);
    if (actions[button.dataset.action]) void run(actions[button.dataset.action]); return;
  }
  const tab = event.target.closest('[data-side]'); if (tab) { state.side = tab.dataset.side; renderSide(); return; }
  const toggle = event.target.closest('[data-toggle]'); if (toggle) {
    const t = state.tracks.find(t => t.id === toggle.dataset.track); t.settings[toggle.dataset.toggle] = !t.settings[toggle.dataset.toggle];
    engine.update(state.tracks, state.master_db); record(toggle.dataset.toggle === 'mute' ? 'ミュートを変更' : 'ソロを変更'); renderWorkspace(); return;
  }
  const rack = event.target.closest('[data-rack]'); if (rack) { state.selected = rack.dataset.rack; state.side = 'rack'; render(); return; }
  const select = event.target.closest('[data-select]'); if (select && !event.target.closest('input,button')) { state.selected = select.dataset.select; document.querySelectorAll('.file-row').forEach(el => el.classList.toggle('selected', el.dataset.select === state.selected)); renderSide(); if (state.view !== 'multitrack') renderWorkspace(); else document.querySelectorAll('.track').forEach(el => el.classList.toggle('selected', el.querySelector('[data-select]').dataset.select === state.selected)); return; }
  const historyButton = event.target.closest('[data-history]'); if (historyButton) { void run(() => restoreHistory(Number(historyButton.dataset.history))); return; }
  const seekTarget = event.target.closest('[data-seek]');
  if (seekTarget && !event.target.closest('[data-clip]')) { const timeline = $('.timeline'); void run(() => seek((event.clientX - seekTarget.getBoundingClientRect().left) / Number(timeline.dataset.pixels))); }
  const wave = event.target.closest('[data-wave]'); if (wave) { const t = state.tracks.find(t => t.id === wave.dataset.wave); void run(() => seek(t.settings.offset + (event.clientX - wave.getBoundingClientRect().left) / wave.clientWidth * t.buffer.duration)); }
});
document.addEventListener('click', event => { if (!event.target.closest('nav')) document.querySelectorAll('nav details').forEach(el => el.open = false); });
document.addEventListener('dblclick', event => {
  const el = event.target.closest('[data-clip],[data-select]'); if (!el || event.target.closest('button,input')) return;
  state.selected = el.dataset.clip || el.dataset.select; state.view = 'waveform'; render();
});
let gesture = null;
document.addEventListener('pointerdown', event => {
  const clip = event.target.closest('[data-clip]'); if (!clip || event.button !== 0) return;
  const t = state.tracks.find(t => t.id === clip.dataset.clip); state.selected = t.id; renderFiles(); renderSide();
  gesture = { clip, track: t, start: event.clientX, offset: t.settings.offset, changed: false, pixels: Number($('.timeline').dataset.pixels), playing: engine.playing };
  clip.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!gesture) return;
  const delta = event.clientX - gesture.start;
  if (!gesture.changed && Math.abs(delta) < 4) return;
  if (!gesture.changed) engine.pause();
  gesture.changed = true;
  gesture.track.settings.offset = clamp(gesture.offset + delta / gesture.pixels, 0, 1200);
  gesture.clip.style.left = `${gesture.track.settings.offset * gesture.pixels}px`;
});
async function endGesture(cancelled = false) {
  if (!gesture) return;
  const g = gesture; gesture = null;
  if (!g.changed) return;
  if (cancelled) g.track.settings.offset = g.offset; else record('クリップを移動');
  render(); if (g.playing) await engine.play(state.tracks);
}
document.addEventListener('pointerup', () => { void run(() => endGesture()); });
document.addEventListener('pointercancel', () => { void run(() => endGesture(true)); });
document.addEventListener('input', event => {
  const el = event.target;
  if (el.matches('[data-control]')) {
    const t = state.tracks.find(t => t.id === el.dataset.track); t.settings[el.dataset.control] = Number(el.value);
    el.nextElementSibling.textContent = el.dataset.control === 'pan' ? panLabel(Number(el.value)) : gainLabel(Number(el.value)); engine.update(state.tracks, state.master_db);
  }
  if (el.id === 'master-gain') { state.master_db = Number(el.value); el.nextElementSibling.textContent = gainLabel(state.master_db); engine.update(state.tracks, state.master_db); }
  if (el.matches('[data-fx]')) el.nextElementSibling.textContent = fxLabel(Number(el.value), el.dataset.unit);
  if (el.id === 'zoom') { state.span = Number(el.value); renderWorkspace(); }
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.matches('[data-control],#master-gain')) { record('ミキサーを調整'); if (state.side === 'history') renderSide(); }
  if (el.id === 'fx-bypass') void run(actions.bypass);
  if (el.id === 'track-name') { const t = selected(); if (!t) return; t.name = el.value.trim() || t.path; record('トラック名を変更'); render(); }
  if (el.id === 'session-name') { state.name = el.value.trim() || '無題'; record('セッション名を変更'); render(); }
  if (el.id === 'track-offset') void run(async () => { const t = selected(); if (!t) return; t.settings.offset = clamp(Number(el.value) || 0, 0, 1200); record('開始位置を変更'); render(); await restart(); });
  if (el.id === 'audio-input') { const files = [...el.files]; el.value = ''; void run(() => importAudio(files)); }
  if (el.id === 'session-input') { const file = el.files[0]; el.value = ''; void run(() => openSession(file)); }
});
$('#clip').addEventListener('click', () => $('#clip').classList.remove('clipped'));
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select') || $('#dialog').open) return;
  if (event.target.closest('[data-select]') && event.key === 'Enter') { event.target.click(); return; }
  if (event.code === 'Space' && event.target.closest('button,summary')) return;
  const mod = event.ctrlKey || event.metaKey;
  const action = mod ? ({ i: 'import', o: 'open', s: 'save', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' })[event.key.toLowerCase()] : ({ ' ': 'play', Home: 'start', End: 'end', '9': 'waveform', '0': 'multitrack', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '\\': 'fit' })[event.key];
  if (action) { event.preventDefault(); void run(actions[action]); }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files], session = files.find(f => f.name.endsWith('.json'));
  void run(async () => { if (session) await openSession(session); if (!session || stagedSession) await importAudio(files.filter(f => f !== session)); });
});
let resizeTimer;
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderWorkspace, 100); }).observe($('#workspace'));
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && autosaveTimer) void flushAutosave(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install').hidden = false; });
$('#install').addEventListener('click', async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('#install').hidden = true; });
window.addEventListener('appinstalled', () => { $('#install').hidden = true; });
const network = () => $('#network').textContent = navigator.onLine ? 'ローカル処理' : 'オフライン';
window.addEventListener('online', network); window.addEventListener('offline', network); network();
if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).then(registration => {
  registration.addEventListener('updatefound', () => { const worker = registration.installing; worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) status('新しいバージョンがあります。すべてのmeloa_webタブを閉じてから、開き直してください。'); }); });
}).catch(error => status(`オフライン準備に失敗しました: ${error.message}`, true));
render(); resetHistory('新規セッション'); requestAnimationFrame(animate);
const startup = (async () => {
  try {
    const saved = await readAutosave();
    if (saved?.tracks?.length) {
      await loadSession(saved, { restoring: true });
    }
  } catch (error) { status(`自動保存を復元できません: ${error.message}。保存したセッションから開き直せます。`, true); }
})();
