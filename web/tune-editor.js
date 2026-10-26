import { analyzeTrack, editTune, alignTrack, sourceBuffer, outTime, noteName } from './tune.js';
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export class TuneEditor {
  selection = new Set(); key = 0; scale = 'Major'; amount = 100; drift = 30; strength = 100; guide = ''; ready = new WeakMap(); loading = new WeakSet();
  constructor(options) {
    this.options = options; this.container = options.container;
    this.container.addEventListener('click', event => this.click(event));
    this.container.addEventListener('change', event => this.change(event));
    this.container.addEventListener('dblclick', event => {
      const note = event.target.closest('[data-note]'); if (!note || !this.active()) return;
      this.selection = new Set([Number(note.dataset.note)]);
      const tune = this.base(); tune.notes[Number(note.dataset.note)].target = Math.round(tune.notes[Number(note.dataset.note)].center);
      this.commit(tune, '半音に合わせる');
    });
    this.container.addEventListener('keydown', event => {
      if (!this.active() || event.target.matches('input,select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation(); this.selection = new Set(this.base().notes.map((_, i) => i)); this.render();
      } else if (['ArrowUp','ArrowDown'].includes(event.key) && this.selection.size) {
        event.preventDefault(); event.stopPropagation(); const tune = this.base();
        for (const i of this.selection) tune.notes[i].target = clamp(tune.notes[i].target + (event.key === 'ArrowUp' ? 1 : -1), 0, 127);
        this.commit(tune, 'ノートのピッチを変更');
      }
    });
    this.container.addEventListener('pointerdown', event => this.pointerDown(event));
    this.container.addEventListener('pointermove', event => this.pointerMove(event));
    this.container.addEventListener('pointerup', () => this.pointerUp());
    this.container.addEventListener('pointercancel', () => { this.gesture = null; if (this.active()) this.render(); });
  }
  active() { return this.options.active(); }
  track() { return this.options.track(); }
  base() {
    const track = this.track(), analysis = this.ready.get(sourceBuffer(track));
    return structuredClone(track.settings.tune || { notes: analysis?.notes || [], anchors: [] });
  }
  commit(tune, label) { this.options.run(async () => { try { await this.options.commit(tune, label); } finally { if (this.active()) this.render(); } }); }
  render() {
    if (!this.active()) return;
    const track = this.track(); if (!track) return;
    const source = sourceBuffer(track), analysis = this.ready.get(source);
    if (this.trackId !== track.id) { this.selection.clear(); this.trackId = track.id; }
    if (!analysis) {
      this.container.innerHTML = '<div class="empty-workspace"><h1>ピッチ / タイミング</h1><p>ノートを解析しています…</p><p>ボーカルなど、単音の素材に適しています。</p></div>';
      if (!this.loading.has(source)) {
        this.loading.add(source);
        analyzeTrack(track).then(value => { this.ready.set(source, value); if (this.active() && this.track()?.id === track.id) { this.options.status(`${value.notes.length}ノートを解析しました。`); this.render(); } }).catch(error => {
          this.options.status(error.message, true);
          if (this.active() && this.track()?.id === track.id) this.container.innerHTML = '<div class="empty-workspace"><h1>解析できませんでした</h1><button data-tune="retry">再解析</button></div>';
        }).finally(() => this.loading.delete(source));
      }
      return;
    }
    const tune = this.base(), others = this.options.tracks().filter(t => t.id !== track.id);
    this.selection = new Set([...this.selection].filter(i => i < tune.notes.length));
    if (this.guide && !others.some(t => t.id === this.guide)) this.guide = '';
    const selectedIndex = [...this.selection][0], selected = tune.notes[selectedIndex];
    const values = tune.notes.flatMap(n => [n.center, n.target]);
    this.high = Math.min(127, Math.max(72, Math.ceil(Math.max(60, ...values)) + 4));
    const low = Math.max(0, Math.min(48, Math.floor(Math.min(60, ...values)) - 4));
    this.rowHeight = 20; this.height = (this.high - low + 1) * this.rowHeight;
    this.duration = source.duration;
    const visibleWidth = Math.max(600, this.container.clientWidth - 70);
    this.width = Math.max(visibleWidth, visibleWidth * this.duration / this.options.span()); this.pixels = this.width / this.duration;
    const keys = Array.from({ length: this.high - low + 1 }, (_, i) => this.high - i);
    const scroll = this.container.querySelector('.tune-scroll'); const oldScroll = scroll ? [scroll.scrollLeft, scroll.scrollTop] : null;
    this.container.innerHTML = `<div class="tune-view"><div class="tune-title">${escape(track.name)} — ピッチ / タイミング <span>${tune.notes.length}ノート · 単音素材向け</span></div><div class="tune-toolbar"><strong>ピッチ</strong><label>キー<select data-tune-option="key">${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'].map((n,i)=>`<option value="${i}" ${i===this.key?'selected':''}>${n}</option>`).join('')}</select></label><select data-tune-option="scale" aria-label="スケール">${[['Major','メジャー'],['Minor','マイナー'],['Chromatic','クロマチック']].map(([v,n])=>`<option value="${v}" ${v===this.scale?'selected':''}>${n}</option>`).join('')}</select><label>補正量<input aria-label="補正量" data-tune-option="amount" type="number" min="0" max="100" value="${this.amount}">%</label><label>ドリフト<input aria-label="ドリフト" data-tune-option="drift" type="number" min="0" max="100" value="${this.drift}">%</label><button data-tune="scale" class="primary">${this.selection.size?'選択':'全'}ノートをスケールに合わせる</button><button data-tune="reset-pitch">ピッチを戻す</button></div><div class="tune-toolbar"><strong>タイミング</strong><label>ガイド<select data-tune-option="guide" aria-label="ガイドトラック"><option value="">選択してください</option>${others.map(t=>`<option value="${t.id}" ${this.guide===t.id?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label><label>強さ<input aria-label="タイミングの強さ" data-tune-option="strength" type="number" min="0" max="100" value="${this.strength}">%</label><button data-tune="align" class="primary" ${!this.guide?'disabled':''}>ガイドに合わせる</button><button data-tune="reset-time" ${!tune.anchors.length?'disabled':''}>タイミングを戻す</button><button data-tune="all">全選択</button></div><div class="tune-toolbar tune-note-fields"><span>${selected ? noteName(selected.target) : 'ノートを選択'}</span><label>音程<input aria-label="ノートの音程 (MIDI)" data-note-field="pitch" type="number" min="0" max="127" step="1" value="${selected?.target.toFixed(2) || ''}" ${selected?'':'disabled'}></label><label>開始<input aria-label="ノートの開始 (秒)" data-note-field="start" type="number" min="0" max="${this.duration}" step=".01" value="${selected?outTime(tune,selected.start).toFixed(3):''}" ${selected?'':'disabled'}>秒</label><label>終了<input aria-label="ノートの終了 (秒)" data-note-field="end" type="number" min="0" max="${this.duration}" step=".01" value="${selected?outTime(tune,selected.end).toFixed(3):''}" ${selected?'':'disabled'}>秒</label><span class="tune-shortcuts">上下: 音程 / 左右: 発音位置 / 両端: 長さ · Alt: 音程を微調整 · ↑↓: 半音 · Ctrl+A: 全選択</span></div><div class="tune-scroll"><div class="tune-roll" style="width:${this.width+64}px;height:${this.height+28}px"><div class="tune-ruler"><span style="width:64px">hms</span>${Array.from({length:7},(_,i)=>`<span style="left:${64+i*this.width/6}px">${(this.duration*i/6).toFixed(2)}</span>`).join('')}</div><div class="piano-keys">${keys.map(n=>`<div class="${[1,3,6,8,10].includes(n%12)?'black-key':''}">${noteName(n)}</div>`).join('')}</div><div class="tune-notes" tabindex="0" aria-label="ノート編集領域" style="left:64px;width:${this.width}px;height:${this.height}px;background-size:${this.width/6}px 20px">${tune.notes.map((n,i)=>`<div class="note-ghost" style="left:${n.start*this.pixels}px;top:${this.y(n.center)}px;width:${Math.max(3,(n.end-n.start)*this.pixels)}px"></div><button type="button" class="tune-note ${this.selection.has(i)?'selected':''}" data-note="${i}" aria-label="ノート ${noteName(n.target)} ${n.start.toFixed(2)}秒" style="left:${outTime(tune,n.start)*this.pixels}px;top:${this.y(n.target)}px;width:${Math.max(7,(outTime(tune,n.end)-outTime(tune,n.start))*this.pixels)}px"><span data-edge="left" class="tune-edge left"></span>${noteName(n.target)}<span data-edge="right" class="tune-edge right"></span></button>`).join('')}<svg class="pitch-trace" width="${this.width}" height="${this.height}" aria-hidden="true">${this.trace(analysis,tune,false)}${this.trace(analysis,tune,true)}</svg><div class="tune-marquee" hidden></div></div></div></div><div class="tune-legend"><span>細い灰色線・枠: 元の音程と位置</span><span>明るい線・ノート: 補正後</span>${!tune.notes.length?'<strong>音程を検出できませんでした。ボーカルなど単音の音源を選んでください。</strong>':''}</div></div>`;
    const next = this.container.querySelector('.tune-scroll');
    if (oldScroll) { next.scrollLeft=oldScroll[0]; next.scrollTop=oldScroll[1]; }
    else if (values.length) { const center=values.reduce((a,b)=>a+b,0)/values.length; next.scrollTop=Math.max(0,this.y(center)-next.clientHeight/2); }
  }
  y(midi) { return (this.high-midi)*this.rowHeight; }
  trace(analysis,tune,corrected) {
    let path='',pen=false,index=0;
    for(let i=0;i<analysis.pitch.length;i++) {
      const raw=analysis.pitch[i];if(raw==null){pen=false;continue;}
      const time=i*.01;while(index<tune.notes.length && tune.notes[index].end<=time)index++;
      const note=tune.notes[index];let midi=raw;
      if(corrected&&note&&note.start<=time)midi+=note.target-note.center+note.drift*clamp(note.center-raw,-2,2);
      const x=(corrected?outTime(tune,time):time)*this.pixels,y=this.y(midi)+10;
      path+=`${pen?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;pen=true;
    }
    return `<path d="${path}" fill="none" stroke="${corrected?'#b2ddff':'#777'}" stroke-width="${corrected?1.5:.8}"/>`;
  }
  click(event) {
    if(!this.active())return;
    const keyboardNote=event.target.closest('[data-note]');
    if(keyboardNote&&event.detail===0){this.selection=new Set([Number(keyboardNote.dataset.note)]);this.render();this.container.querySelector('.tune-notes')?.focus({preventScroll:true});return;}
    const action=event.target.closest('[data-tune]')?.dataset.tune;if(!action)return;
    const tune=this.base();
    if(action==='retry'){this.render();return;}
    if(action==='all'){this.selection=new Set(tune.notes.map((_,i)=>i));this.render();return;}
    if(action==='reset-time'){tune.anchors=[];this.commit(tune,'タイミングを戻す');}
    if(action==='reset-pitch'){tune.notes.forEach((n,i)=>{if(!this.selection.size||this.selection.has(i)){n.target=n.center;n.drift=0;}});this.commit(tune,'ピッチを戻す');}
    if(action==='scale')this.options.run(async()=>{await this.options.commit(await editTune({op:'scale',tune,key:this.key,scale:this.scale,amount:this.amount/100,drift:this.drift/100,selected:[...this.selection]}),'スケールに合わせる');});
    if(action==='align')this.options.run(async()=>{
      const guide=this.options.tracks().find(t=>t.id===this.guide);if(!guide)throw Error('ガイドトラックを選択してください。');
      this.options.status('ガイドと発音位置を比較しています…');tune.anchors=await alignTrack(guide,this.track(),this.strength/100);await this.options.commit(tune,'ガイドに合わせる');
    });
  }
  change(event) {
    if(!this.active())return;const option=event.target.dataset.tuneOption;
    if(option){this[option]=['guide','scale'].includes(option)?event.target.value:clamp(Number(event.target.value)||0,0,option==='key'?11:100);if(option==='guide')this.render();return;}
    const field=event.target.dataset.noteField;if(!field||!this.selection.size)return;
    const index=[...this.selection][0],tune=this.base(),note=tune.notes[index],value=Number(event.target.value);
    if(!Number.isFinite(value)){this.render();return;}
    if(field==='pitch'){note.target=clamp(value,0,127);this.commit(tune,'ノートのピッチを変更');}
    else this.options.run(async()=>{try{const edited=await editTune({op:'move',tune,index,d0:field==='start'?value-outTime(tune,note.start):0,d1:field==='end'?value-outTime(tune,note.end):0,duration:this.duration});await this.options.commit(edited,'ノートのタイミングを変更');}finally{this.render();}});
  }
  pointerDown(event) {
    if(!this.active()||event.button!==0||this.options.busy())return;
    const area=event.target.closest('.tune-notes');if(!area)return;
    const button=event.target.closest('[data-note]'),rect=area.getBoundingClientRect();
    if(button){const index=Number(button.dataset.note);if(event.shiftKey||event.ctrlKey||event.metaKey){if(this.selection.has(index))this.selection.delete(index);else this.selection.add(index);}else if(!this.selection.has(index))this.selection=new Set([index]);}
    else if(!event.shiftKey)this.selection.clear();
    this.container.querySelectorAll('[data-note]').forEach(el=>el.classList.toggle('selected',this.selection.has(Number(el.dataset.note))));
    this.gesture={area,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,index:button?Number(button.dataset.note):null,edge:event.target.dataset.edge,tune:this.base(),changed:false,mode:button?null:'box'};
    (button||area).setPointerCapture(event.pointerId);event.preventDefault();event.stopPropagation();
  }
  pointerMove(event) {
    const g=this.gesture;if(!g)return;
    const dx=event.clientX-g.x,dy=event.clientY-g.y;if(!g.changed&&Math.hypot(dx,dy)<4)return;g.changed=true;
    g.mode||=(g.edge?'time':Math.abs(dy)>Math.abs(dx)?'pitch':'time');
    if(g.mode==='pitch'){
      g.pitch=event.altKey?-dy/this.rowHeight:Math.round(-dy/this.rowHeight);
      for(const index of this.selection){const el=this.container.querySelector(`[data-note="${index}"]`);if(el)el.style.top=`${this.y(clamp(g.tune.notes[index].target+g.pitch,0,127))}px`;}
    }else if(g.mode==='time'){
      g.delta=dx/this.pixels;const note=g.tune.notes[g.index],el=this.container.querySelector(`[data-note="${g.index}"]`);
      const start=outTime(g.tune,note.start)+(g.edge==='right'?0:g.delta),end=outTime(g.tune,note.end)+(g.edge==='left'?0:g.delta);
      el.style.left=`${start*this.pixels}px`;el.style.width=`${Math.max(3,(end-start)*this.pixels)}px`;
    }else{
      const x0=Math.min(g.x,event.clientX)-g.left,x1=Math.max(g.x,event.clientX)-g.left,y0=Math.min(g.y,event.clientY)-g.top,y1=Math.max(g.y,event.clientY)-g.top;
      const marquee=this.container.querySelector('.tune-marquee');marquee.hidden=false;Object.assign(marquee.style,{left:`${x0}px`,top:`${y0}px`,width:`${x1-x0}px`,height:`${y1-y0}px`});
      this.selection.clear();g.tune.notes.forEach((n,i)=>{if(outTime(g.tune,n.end)*this.pixels>=x0&&outTime(g.tune,n.start)*this.pixels<=x1&&this.y(n.target)+20>=y0&&this.y(n.target)<=y1)this.selection.add(i);});
      this.container.querySelectorAll('[data-note]').forEach(el=>el.classList.toggle('selected',this.selection.has(Number(el.dataset.note))));
    }
  }
  pointerUp() {
    const g=this.gesture;if(!g)return;this.gesture=null;
    if(!g.changed){
      if(g.index===null)this.options.seek(this.track().settings.offset+clamp((g.x-g.left)/this.pixels,0,this.duration));
      const selected=g.tune.notes[[...this.selection][0]];
      this.container.querySelectorAll('[data-note-field]').forEach(input=>{
        input.disabled=!selected;
        input.value=!selected?'':input.dataset.noteField==='pitch'?selected.target.toFixed(2):outTime(g.tune,selected[input.dataset.noteField]).toFixed(3);
      });
      this.container.querySelector('.tune-note-fields>span').textContent=selected?noteName(selected.target):'ノートを選択';
      this.container.querySelector('[data-tune="scale"]').textContent=`${this.selection.size?'選択':'全'}ノートをスケールに合わせる`;
      this.container.querySelector('.tune-notes')?.focus({preventScroll:true});return;
    }
    if(g.mode==='pitch'){for(const i of this.selection)g.tune.notes[i].target=clamp(g.tune.notes[i].target+g.pitch,0,127);this.commit(g.tune,'ノートのピッチを変更');}
    else if(g.mode==='time')this.options.run(async()=>{try{const tune=await editTune({op:'move',tune:g.tune,index:g.index,d0:g.edge==='right'?0:g.delta,d1:g.edge==='left'?0:g.delta,duration:this.duration});await this.options.commit(tune,'ノートのタイミングを変更');}finally{this.render();}});
    else this.render();
  }
}
