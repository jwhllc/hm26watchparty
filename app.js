/* HM26 Watch Party: UI, game layer, menu picker and budget math. Loads after data.js, seed.js and store.js. */
(() => {
'use strict';

/* ---------- constants ---------- */
const TABS = ['board','list','guests','menu','budget','room','venue','flyer'];
const PANELS = ['board','list','guests','menu','budget','room'];
const EVENT_DAY = '2026-11-03', DAY_AFTER = '2026-11-04';
const DOORS = Date.UTC(2026,10,3,23,0,0);     // 5:00 PM CST, Nov 3
const WRAP_UP = Date.UTC(2026,10,4,6,0,0);    // midnight CST
const SVC = 0.24, TAX = 0.125, MIN_FB = 5000, DEPOSIT = 767.30, BOARDROOM = 500;
const BAR_SLOTS = ['5 PM','6 PM','7 PM','8 PM','9 PM','10 PM','11 PM'];   // one-hour blocks; the bar closes at midnight
const SLOT_START = [17,18,19,20,21,22,23];
const DEFAULT_BAR = {slots:['cash','cash','cash','cash','cash','cash','cash'], basis:'drink', tier:'bw', billOn:'total', guests:null, dph:1, avg:8, cap:0};
const BAR_PRESETS = [
  {label:'Cash all night',        slots:['cash','cash','cash','cash','cash','cash','cash']},
  {label:'Open 5–7, then cash',   slots:['open','open','cash','cash','cash','cash','cash']},
  {label:'Open 8–10 for results', slots:['cash','cash','cash','open','open','cash','cash']},
  {label:'Open all night',        slots:['open','open','open','open','open','open','open']},
  {label:'No bar',                slots:['off','off','off','off','off','off','off']},
];
const DEFAULT_SETTINGS = {headcount:300, peak:null, cap:0, target:0, bartenders:null, cashierCount:null, bar:DEFAULT_BAR, layout:null};
const OFF_MSG = 'The shared board, checklist, guest list, menu picks and budget load when this page is opened in Claude while signed in. The Venue and Flyer tabs work anywhere.';
const LOCAL_WARN = "This browser isn't saving changes (a private window or blocked storage). Export a backup before you close the tab.";
const RO_MSG = "You're viewing. Checking things off and editing need Contributor or Editor access from Josh.";

const BADGES = [
  {id:'held',    name:'Date Held',         hint:'Hold Nov 3 at the hotel',              test:s=>s.has('hold-date')},
  {id:'signed',  name:'Signed & Sealed',   hint:'Sign the contract and pay the deposit', test:s=>s.has('sign-contract') && s.has('pay-deposit')},
  {id:'paid',    name:'Paid in Full',      hint:'Pay the remaining balance',             test:s=>s.has('pay-balance')},
  {id:'clean',   name:'Clean Disclaimer',  hint:'Fix the flyer disclaimer',              test:s=>s.has('fix-disclaimer')},
  {id:'menu',    name:'Menu Locked',       hint:'Food, bar and both AV orders done',     test:s=>['pick-food','pick-bar','av-screens','av-band'].every(i=>s.has(i))},
  {id:'feast',   name:'Feast Mode',        hint:'Menu picks clear the $5,000 minimum',   test:s=>s.budget.fb >= MIN_FB},
  {id:'count',   name:'Headcount Locked',  hint:'Send the final headcount',              test:s=>s.has('final-count')},
  {id:'books',   name:'Balanced Books',    hint:'Every cost priced and under the ceiling',   test:s=>s.budget.cap>0 && state.expenses.length>0 && s.budget.unpriced===0 && s.budget.all<=s.budget.cap},
  {id:'countdown', name:'Countdown Clear', hint:'Cross off everything on Leading up',    test:s=>s.cl.lead.total>0 && s.cl.lead.done===s.cl.lead.total},
  {id:'packed',  name:'Bags Packed',       hint:'Cross off every Grab & bring item',     test:s=>s.cl.grab.total>0 && s.cl.grab.done===s.cl.grab.total},
  {id:'doors',   name:'Doors Ready',       hint:'Every day-of item before 5 PM done',    test:s=>s.cl.doors.total>0 && s.cl.doors.done===s.cl.doors.total},
  {id:'half',    name:'Halfway Reporting', hint:'Finish half the to-dos and checklist',  test:s=>s.total>0 && s.done*2>=s.total},
  {id:'century', name:'Century Club',      hint:'Invite 100 people',                     test:s=>s.invitedNames>=100},
  {id:'full',    name:'Full House',        hint:'150 confirmed guests',                  test:s=>s.confirmed>=150},
  {id:'called',  name:'Race Called',       hint:'Finish every to-do and checklist item', test:s=>s.total>0 && s.done===s.total},
];

/* ---------- state ---------- */
const state = {
  dbStatus:'pending', mode:'pending', readOnly:false, me:null, quietUntil:0,
  tasks:[], checklist:[], guests:[], picks:{}, expenses:[], settings:Object.assign({}, DEFAULT_SETTINGS),
  loaded:{tasks:false, checklist:false, guests:false, picks:false, expenses:false, settings:false},
  clView:'all', clHide:false, clWho:'', clEditing:null, clDrafts:{},
  tab:'board', view:'deadline', hideDone:false, doneOpen:false,
  statusFilter:'all', editing:null, drafts:{}, confirm:null, secOpen:{},
  names:{}, badgeBase:null, pop:null, mSearch:'', mPicked:false,
};
let db = null, user = null;
const pending = new Set();
const mine = new Set();
const dirty = new Set();
let settingsDirty = false, settingsTimer = 0, settingsChain = Promise.resolve();

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)){
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const m0 = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const m2 = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const nf = new Intl.NumberFormat('en-US');
const fmt0 = n => m0.format(Math.round(n));
const fmt2 = n => m2.format(n);
const clamp = (n,a,b) => Math.min(b, Math.max(a, n));
const num = (v,d=0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v,max) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const isISO = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nowISO = () => new Date().toISOString();
const meId = () => (state.me && state.me.id) || null;
const canWrite = () => !!db && state.dbStatus === 'on' && !state.readOnly;
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){ return false; } };
const catOf = k => EXP_CATS.find(c => c.key === k) || EXP_CATS[EXP_CATS.length-1];
const plural = (n, one, many) => n === 1 ? one : many;

function todayISO(){
  try { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  catch(e){ return new Date().toISOString().slice(0,10); }
}
function dayNum(iso){ const [y,m,d] = iso.split('-').map(Number); return Date.UTC(y,m-1,d)/864e5; }
const daysFromToday = iso => dayNum(iso) - dayNum(todayISO());
function fmtDate(iso, opts){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).toLocaleDateString('en-US', Object.assign({weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}, opts||{}));
}
function fmtStamp(s){
  if (!s) return '';
  if (isISO(s)) return fmtDate(s, {weekday:undefined});
  const d = new Date(s); if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'});
}
function setIfIdle(el, v){ if (el && document.activeElement !== el) el.value = v; }
function withFocus(container, fn){
  const a = document.activeElement;
  const fk = a && container.contains(a) ? a.getAttribute('data-fk') : null;
  fn();
  if (fk){ const n = container.querySelector('[data-fk="'+ (window.CSS && CSS.escape ? CSS.escape(fk) : fk) +'"]'); if (n) n.focus({preventScroll:true}); }
}
function emptyCard(title, text){ return h('div',{class:'empty'}, h('b',null,title), h('span',null,text)); }

/* ---------- prefs (this browser only) ---------- */
const PREF_KEY = 'hm26-watch-prefs';
function loadPrefs(){
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    if (TABS.includes(p.tab)) state.tab = p.tab;
    if (p.view === 'stream' || p.view === 'deadline') state.view = p.view;
    state.hideDone = !!p.hideDone;
    if (['all','lead','day','grab'].includes(p.clView)) state.clView = p.clView;
    state.clHide = !!p.clHide;
    if (typeof p.clWho === 'string') state.clWho = p.clWho.slice(0,40);
    if (p.secOpen && typeof p.secOpen === 'object') for (const [k, v] of Object.entries(p.secOpen)) if (typeof v === 'boolean') state.secOpen[k] = v;
  } catch(e){}
}
function savePrefs(){ try { localStorage.setItem(PREF_KEY, JSON.stringify({tab:state.tab, view:state.view, hideDone:state.hideDone, secOpen:state.secOpen, clView:state.clView, clHide:state.clHide, clWho:state.clWho})); } catch(e){} }

/* ---------- toasts + confetti ---------- */
function toast(title, text){
  const box = $('#toasts');
  const t = h('div',{class:'toast'}, h('b',null,title), text ? h('span',null,text) : null);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 3800);
}
const confetti = (() => {
  let cv = null, ctx = null, parts = [], raf = 0;
  function colors(){
    const cs = getComputedStyle(document.documentElement);
    return ['--brand','--red','--brand-ink','--red-ink','--plate'].map(v => cs.getPropertyValue(v).trim() || '#522A77');
  }
  function ensure(){
    if (cv) return;
    cv = h('canvas',{class:'confetti','aria-hidden':'true'}); document.body.append(cv);
    ctx = cv.getContext('2d'); size(); addEventListener('resize', size);
  }
  function size(){ const d = devicePixelRatio || 1; cv.width = innerWidth*d; cv.height = innerHeight*d; ctx.setTransform(d,0,0,d,0,0); }
  function add(x, y, n, power, down){
    if (reduceMotion()) return;
    ensure(); const cols = colors();
    for (let i = 0; i < n; i++){
      const a = down ? Math.PI/2 + (Math.random()-.5)*1.2 : -Math.PI/2 + (Math.random()-.5)*2.2;
      const sp = (down ? 2 : 4) + Math.random()*6*power;
      parts.push({x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, w:5+Math.random()*7, h:3+Math.random()*5, r:Math.random()*6.3, vr:(Math.random()-.5)*.35, c:cols[i % cols.length], life:0, max:80+Math.random()*80});
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick(){
    ctx.clearRect(0,0,innerWidth,innerHeight);
    parts = parts.filter(p => p.life < p.max && p.y < innerHeight + 30);
    for (const p of parts){
      p.vy += .22; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.life/p.max); ctx.translate(p.x,p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
    if (!raf) ctx.clearRect(0,0,innerWidth,innerHeight);
  }
  return {
    burst(x, y, n=40, power=1){ add(x, y, n, power, false); },
    rain(){ for (let i = 0; i < 9; i++) setTimeout(() => add(Math.random()*innerWidth, -10, 45, 1, true), i*140); },
  };
})();

/* ---------- copy ---------- */
async function copyText(text, label, fallbackEl){
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', label);
  } catch(e){
    if (fallbackEl){ try { const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch(_){} toast('Select to copy', 'Copying is blocked here. The text is highlighted.'); return; }
    const fb = $('#copyFb'); fb.hidden = false; const ta = $('#copyFbText'); ta.value = text; ta.focus(); ta.select();
    toast('Select to copy', 'Copying is blocked here, so the text is selected below.');
  }
}

/* ---------- cleaning shared data (untrusted) ---------- */
function cleanTask(d){
  const x = d.data() || {};
  return {id:d.id, title:str(x.title,140) || 'Untitled to-do', detail:str(x.detail,500),
    stream:STREAMS.some(s=>s.key===x.stream) ? x.stream : 'night', due:isISO(x.due) ? x.due : null,
    votes:clamp(Math.round(num(x.votes,10)),0,100), done:x.done===true,
    doneBy:typeof x.doneBy==='string' ? x.doneBy : null, doneAt:typeof x.doneAt==='string' ? x.doneAt : null,
    custom:x.custom===true, order:num(x.order,9999)};
}
function cleanGuest(d){
  const x = d.data() || {};
  return {id:d.id, name:str(x.name,80) || 'Unnamed guest', group:GROUPS.some(g=>g.key===x.group) ? x.group : 'friends',
    status:STATUSES.some(s=>s.key===x.status) ? x.status : 'todo', plusOnes:clamp(Math.round(num(x.plusOnes,0)),0,5),
    contact:str(x.contact,120), notes:str(x.notes,200), addedBy:typeof x.addedBy==='string' ? x.addedBy : null};
}
function cleanPick(d){ const x = d.data() || {}; return {id:d.id, qty:Math.max(0, num(x.qty,0)), follow:x.follow===true}; }
function cleanExp(d){
  const x = d.data() || {};
  return {id:d.id, label:str(x.label,80) || 'Untitled cost', cat:EXP_CATS.some(c=>c.key===x.cat) ? x.cat : 'other',
    vendor:str(x.vendor,80), amount:Math.max(0, num(x.amount,0)), status:EXP_STATUS.some(s=>s.key===x.status) ? x.status : 'estimate',
    notes:str(x.notes,200), order:num(x.order,9999)};
}
function cleanSettings(x){
  x = x || {};
  return {headcount:clamp(Math.round(num(x.headcount,300)),1,5000), cap:Math.max(0, num(x.cap,0)), target:Math.max(0, num(x.target,0)),
    peak:x.peak == null || x.peak === '' ? null : clamp(Math.round(num(x.peak,0)),1,5000),
    bartenders:x.bartenders == null || x.bartenders === '' ? null : clamp(Math.round(num(x.bartenders,0)),0,20),
    cashierCount:x.cashierCount == null || x.cashierCount === '' ? null : clamp(Math.round(num(x.cashierCount,0)),0,10),
    layout:x.layout === 'A' || x.layout === 'B' ? x.layout : null,
    bar:cleanBar(x.bar)};
}
function cleanBar(b){
  b = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
  const slots = Array.isArray(b.slots) && b.slots.length === 7 ? b.slots.map(s => (s === 'open' || s === 'cash' || s === 'off') ? s : 'cash') : DEFAULT_BAR.slots.slice();
  return {slots, basis:b.basis === 'package' ? 'package' : 'drink', tier:HOURLY.some(t => t.key === b.tier) ? b.tier : 'bw',
    billOn:b.billOn === 'peak' ? 'peak' : 'total',
    guests:b.guests == null || b.guests === '' ? null : clamp(Math.round(num(b.guests,0)),0,5000),
    dph:clamp(num(b.dph,1),0,5), avg:clamp(num(b.avg,8),0,100), cap:Math.max(0, num(b.cap,0))};
}

/* ---------- budget math ---------- */
function pickQty(item, pick, hc){ return (item.unit === 'pp' && pick.follow) ? hc : pick.qty; }
function lineCost(item, qty){ return item.unit === 'pc50' ? item.price*qty/50 : item.price*qty; }
function defaultQty(item, hc){
  if (item.def) return item.def;
  switch (item.unit){
    case 'pp': return hc;
    case 'pc50': return Math.max(50, Math.ceil(hc/50)*50);
    case 'dozen': return Math.max(1, Math.ceil(hc/12));
    case 'drink': return hc;
    case 'gallon': return 2;
    case 'bottle': return 12;
    default: return item.serves ? Math.max(1, Math.ceil(hc/item.serves)) : 50;
  }
}
const staffFee = hours => 150 + 25*Math.max(0, hours-2);
function budget(){
  const S = state.settings, hc = S.headcount, peak = S.peak || hc;
  const lines = [], avLines = []; let food = 0, bar = 0, av = 0, att = 0, carve = 0, pieces = 0, drinks = 0;
  for (const [id, p] of Object.entries(state.picks)){
    if (id.startsWith('hourly-')) continue;   // older saves; open-bar packages now live in the bar plan
    const it = ITEMS[id]; if (!it) continue;
    const q = pickQty(it, p, hc), c = lineCost(it, q);
    if (it.kind === 'av'){ av += c; avLines.push({item:it, qty:q, cost:c}); continue; }   // AV: service and tax apply, but not part of the F&B minimum
    lines.push({item:it, qty:q, cost:c});
    if (it.kind === 'bar') bar += c; else food += c;
    if (it.att) att += 100*it.att;
    if (it.carver) carve += 100;
    if (it.unit === 'pc50') pieces += q;
    if (it.unit === 'drink') drinks += q;
  }
  // Bar plan: each hour from 5 PM is open bar, cash bar or closed.
  const P = S.bar, openN = P.slots.filter(s => s === 'open').length, cashN = P.slots.filter(s => s === 'cash').length;
  const plan = {openN, cashN, basis:P.basis, cost:0, uncapped:0, drinksEst:0, capped:false, guests:0, tier:null, price:0, billed:0, over4:false};
  if (openN){
    if (P.basis === 'package'){
      const t = HOURLY.find(x => x.key === P.tier) || HOURLY[0], step = t.prices[3] - t.prices[2];
      plan.tier = t; plan.over4 = openN > 4;
      plan.price = openN <= 4 ? t.prices[openN-1] : t.prices[3] + step*(openN-4);   // past 4 hours is an estimate
      plan.billed = P.billOn === 'peak' ? peak : hc;
      plan.cost = plan.price*plan.billed;
    } else {
      plan.guests = P.guests == null ? peak : P.guests;
      plan.drinksEst = plan.guests*P.dph*openN; plan.uncapped = plan.drinksEst*P.avg;
      plan.cost = P.cap > 0 ? Math.min(plan.uncapped, P.cap) : plan.uncapped; plan.capped = P.cap > 0 && plan.uncapped > P.cap;
    }
    bar += plan.cost;
  }
  const autoBt = Math.max(1, Math.ceil(peak/100));
  let btHours = plan.basis === 'package' && openN ? cashN : openN + cashN;   // hourly packages include their own bartenders
  if (!btHours && drinks > 0) btHours = 2;
  const bartenders = btHours ? (S.bartenders == null ? autoBt : S.bartenders) : 0;
  const btFee = btHours ? bartenders*staffFee(btHours) : 0;
  const cashiers = cashN ? (S.cashierCount == null ? 1 : S.cashierCount) : 0;
  const cashFee = cashiers*staffFee(cashN);
  const fb = food + bar, shortfall = Math.max(0, MIN_FB - fb);
  const hotelExp = state.expenses.filter(e => catOf(e.cat).hotel), hotelExpSum = hotelExp.reduce((a,e)=>a+e.amount,0);
  const outside = state.expenses.filter(e => !catOf(e.cat).hotel), outsideSum = outside.reduce((a,e)=>a+e.amount,0);
  const fees = att + carve + btFee + cashFee;
  const sub = fb + shortfall + fees + BOARDROOM + av + hotelExpSum;
  const svc = sub*SVC, tax = (sub+svc)*TAX, hotelTotal = sub + svc + tax;
  const all = hotelTotal + outsideSum;
  return {hc, peak, lines, avLines, av, food, bar, fb, shortfall, att, carve, bartenders, autoBt, btHours, cashiers, plan, btFee, cashFee, fees, hotelExp, hotelExpSum,
    outside, outsideSum, sub, svc, tax, hotelTotal, balance:hotelTotal - DEPOSIT, all, perGuest: hc ? all/hc : 0,
    pieces, drinks, cap:S.cap, target:S.target, unpriced:state.expenses.filter(e => !(e.amount > 0)).length};
}

/* ---------- stats ---------- */
function stats(){
  // Precincts and votes count the Race board and the Checklist together.
  const T = state.tasks, C = state.checklist, A = T.concat(C), total = A.length, doneList = A.filter(t => t.done), done = doneList.length;
  const ids = new Set(T.filter(t => t.done).map(t => t.id));
  const votesAll = A.reduce((a,t)=>a+t.votes,0), votes = doneList.reduce((a,t)=>a+t.votes,0);
  const tally = list => ({total:list.length, done:list.filter(x => x.done).length});
  const cl = {lead:tally(C.filter(x => x.list === 'lead')), day:tally(C.filter(x => x.list === 'day')), grab:tally(C.filter(x => x.list === 'grab')),
    doors:tally(C.filter(x => x.list === 'day' && x.time && timeKey(x.time) < 17*60))};
  const pct = total ? (done === total ? 100 : Math.floor(done/total*100)) : 0;
  const streams = STREAMS.map(s => { const ts = T.filter(t => t.stream === s.key); return {key:s.key, total:ts.length, done:ts.filter(t=>t.done).length}; });
  const G = state.guests, ppl = st => G.filter(g => g.status === st).reduce((a,g)=>a+1+g.plusOnes,0);
  return {total, done, pct, votes, votesAll, streams, cl, has:id => ids.has(id),
    confirmed:ppl('yes'), maybe:ppl('maybe'), awaiting:ppl('invited'), declined:ppl('no'), notInvited:ppl('todo'),
    invitedNames:G.filter(g => g.status !== 'todo').length, budget:budget()};
}
const allLoaded = () => Object.values(state.loaded).every(Boolean);

/* ---------- names ---------- */
function nameFor(id){ return (id && state.names[id]) || 'a teammate'; }
async function resolveNames(ids){
  if (!user) return;
  const want = [...new Set(ids.filter(Boolean))]; if (!want.length) return;
  let ps; try { ps = await user.profiles(want); } catch(e){ return; }
  let changed = false;
  for (const id of want){ const n = (ps[id] && ps[id].name) || ''; if (state.names[id] !== n){ state.names[id] = n; changed = true; } }
  if (!changed) return;
  $$('[data-uid]').forEach(el => { el.textContent = el.getAttribute('data-tpl').replace('{n}', nameFor(el.getAttribute('data-uid'))); });
}

/* ---------- render scheduling ---------- */
let rafQueued = false;
function schedule(){ if (rafQueued) return; rafQueued = true; requestAnimationFrame(flush); }
function flush(){
  rafQueued = false;
  renderSummary();
  for (const p of PANELS){
    if (!dirty.has(p) || state.tab !== p) continue;
    if (p === 'guests' && document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.closest('#guestList .g-edit')) continue;
    if (p === 'list' && document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.closest('#clList .g-edit')) continue;
    dirty.delete(p); RENDER[p]();
  }
}
function changed(...names){ names.forEach(n => dirty.add(n)); dirty.add('board'); checkBadges(); schedule(); }
function renderAll(){ PANELS.forEach(p => dirty.add(p)); syncControls(); renderMe(); schedule(); }

/* ---------- budget status ---------- */
const HOTEL_K = (1+SVC)*(1+TAX);
function budgetStatus(B, short){
  const T = B.target, C = B.cap, a = B.all;
  if (C > 0 && a > C) return `${fmt0(a-C)} over the ${short ? '' : fmt0(C) + ' '}ceiling`;
  if (T > 0 && a > T) return C > 0 ? (short ? `${fmt0(a-T)} over target · ${fmt0(C-a)} to ceiling` : `${fmt0(a-T)} over the ${fmt0(T)} target · ${fmt0(C-a)} under the ${fmt0(C)} ceiling`) : `${fmt0(a-T)} over the ${short ? '' : fmt0(T) + ' '}target`;
  if (T > 0) return `${fmt0(T-a)} under the ${short ? '' : fmt0(T) + ' '}target`;
  if (C > 0) return `${fmt0(C-a)} under the ${short ? '' : fmt0(C) + ' '}ceiling`;
  return '';
}
function budgetLevel(B){ return B.cap > 0 && B.all > B.cap ? 'over' : B.target > 0 && B.all > B.target ? 'warn' : 'under'; }
function roomText(B){
  const T = B.target, C = B.cap, a = B.all, parts = [];
  if (C > 0 && a > C) return `To get back under the ceiling, cut about ${fmt0((a-C)/HOTEL_K)} of hotel spending (before service and tax). Every $1,000 at the hotel costs $1,395 after service and tax.`;
  if (T > 0 && a < T) parts.push(`${fmt0((T-a)/HOTEL_K)} to the target`);
  if (C > 0 && a < C) parts.push(`${fmt0((C-a)/HOTEL_K)} to the ceiling`);
  if (!parts.length) return '';
  return `Room left in hotel spending, before service and tax: ${parts.join(', ')}. Every $1,000 at the hotel costs $1,395 after service and tax; outside costs count dollar for dollar.`;
}

/* ---------- summary: ticker, hero bars, tiles ---------- */
function renderSummary(){
  const st = stats(), on = state.dbStatus === 'on' && state.loaded.tasks && state.loaded.checklist;
  $('#tkPct').textContent = on ? st.pct + '%' : '--%';
  $('#tkVotes').textContent = on ? nf.format(st.votes) : '--';
  $('#tPct').textContent = on ? st.pct + '%' : '--';
  $('#tPctSub').textContent = on ? `${st.done} of ${st.total} to-dos and checklist items` : (state.dbStatus === 'off' ? 'Opens in Claude' : 'Loading the board');
  $('#tPctBar').style.width = (on ? st.pct : 0) + '%';
  $('#tVotes').textContent = on ? nf.format(st.votes) : '--';
  $('#tVotesSub').textContent = on ? `of ${nf.format(st.votesAll)} up for grabs` : 'Every to-do and checklist item is worth votes';
  const gOn = state.dbStatus === 'on' && state.loaded.guests;
  $('#tGuests').textContent = gOn ? nf.format(st.confirmed) : '--';
  $('#tGuestsSub').textContent = gOn ? `${nf.format(st.maybe)} maybe · 300 expected` : 'Includes +1s';
  $('#tGuestsBar').style.width = gOn ? Math.min(100, st.confirmed/300*100) + '%' : '0%';
  const bOn = state.dbStatus === 'on' && state.loaded.picks && state.loaded.expenses && state.loaded.settings, B = st.budget;
  $('#tBudget').textContent = bOn ? fmt0(B.all) : '--';
  $('#tBudgetSub').textContent = !bOn ? 'Hotel plus outside costs'
    : (B.cap > 0 || B.target > 0) ? budgetStatus(B, true)
    : `${fmt0(B.perGuest)} per guest · no budget set`;
  STREAMS.forEach(s => {
    const ss = st.streams.find(x => x.key === s.key), p = on && ss.total ? ss.done/ss.total*100 : 0;
    const bar = $('#bar-' + s.key); bar.querySelector('.fill').style.width = p + '%';
    const txt = on ? `${s.short} ${ss.done}/${ss.total}` : s.short;
    bar.querySelectorAll('.lbl').forEach(l => { l.textContent = txt; });
    bar.setAttribute('role','img'); bar.setAttribute('aria-label', on ? `${s.label}: ${ss.done} of ${ss.total} done` : s.label);
  });
  $('#called').hidden = !(on && st.total > 0 && st.done === st.total);
}

function tickCountdown(){
  const now = Date.now(); let lab, val;
  if (now < DOORS){
    const m = Math.floor((DOORS - now)/60000), d = Math.floor(m/1440), hh = Math.floor((m % 1440)/60), mm = m % 60;
    lab = 'Doors in'; val = d > 0 ? `${d}d ${String(hh).padStart(2,'0')}h ${String(mm).padStart(2,'0')}m` : `${hh}h ${String(mm).padStart(2,'0')}m`;
  } else if (now < WRAP_UP){ lab = 'Doors are'; val = 'open'; }
  else { lab = "That's a"; val = 'wrap'; }
  $('#tkCountLab').textContent = lab; $('#tkCount').textContent = val;
}

function renderSteps(){
  let nextFound = false;
  $('#steps').replaceChildren(...DEADLINES.map(d => {
    const n = daysFromToday(d.date), past = n < 0; let cls = 'step';
    if (past) cls += ' past'; else if (!nextFound){ cls += ' next'; nextFound = true; }
    return h('li',{class:cls}, h('span',{class:'d'}, fmtDate(d.date)), h('span',{class:'l'}, d.label), h('span',{class:'s'}, d.sub),
      h('span',{class:'r'}, past ? 'Passed' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`));
  }));
}

function renderMe(){
  const el = $('#me');
  if (!state.me || state.dbStatus !== 'on'){ el.hidden = true; return; }
  el.hidden = false;
  el.replaceChildren(h('img',{src:state.me.avatarUrl, alt:''}), h('span',null, h('b',null, state.me.name || 'You'), ' · ', state.readOnly ? 'view only' : 'can edit'));
}

function noteFor(id){
  const n = $(id);
  if (state.dbStatus === 'off'){ n.hidden = false; n.textContent = OFF_MSG; }
  else if (state.readOnly){ n.hidden = false; n.textContent = RO_MSG; }
  else if (state.mode === 'local' && !LocalStore.persistent){ n.hidden = false; n.textContent = LOCAL_WARN; }
  else n.hidden = true;
}
function syncControls(){
  const ro = !canWrite();
  ['#taskSet','#clSet','#guestSet','#exSet'].forEach(s => { $(s).disabled = ro; });
  ['#addTaskBtn','#clAddBtn','#pasteBtn','#hcMenu','#hcBudget','#peakMenu','#peakBudget','#capInput','#targetInput','#useGuests'].forEach(s => { $(s).disabled = ro; });
}

/* ---------- race board ---------- */
function checkBadges(){
  if (!allLoaded()) return;
  const st = stats(), now = new Set(BADGES.filter(b => b.test(st)).map(b => b.id));
  if (state.badgeBase === null || Date.now() < state.quietUntil){ state.badgeBase = now; return; }
  const fresh = [...now].filter(id => !state.badgeBase.has(id));
  state.badgeBase = now;
  if (!fresh.length) return;
  state.pop = new Set(fresh);
  toast(fresh.length > 1 ? 'Badges earned' : 'Badge earned', fresh.map(id => BADGES.find(b => b.id === id).name).join(' · '));
  if (fresh.includes('called')) confetti.rain(); else confetti.burst(innerWidth/2, innerHeight*.3, 90, 1.4);
}
function renderStickers(st){
  const ready = state.dbStatus === 'on' && allLoaded();
  $('#stickers').replaceChildren(...BADGES.map(b => {
    const on = ready && b.test(st);
    const pop = on && state.pop && state.pop.has(b.id);
    return h('div',{class:'sticker ' + (on ? 'on' : 'off') + (pop ? ' pop' : ''), role:'img', 'aria-label': `${b.name}: ${on ? 'earned' : 'locked. ' + b.hint}`},
      h('span',{class:'st-top'}, 'HM26'), h('span',{class:'st-name'}, b.name), h('span',{class:'st-hint'}, on ? '★ Earned' : b.hint));
  }));
  state.pop = null;
}
function dueText(due){
  const n = daysFromToday(due);
  if (n < 0) return `Overdue · ${fmtDate(due)}`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return `Due ${fmtDate(due)}`;
}
function taskItem(t, showStream){
  const n = t.due ? daysFromToday(t.due) : null, ro = !canWrite();
  const overdue = !t.done && n !== null && n < 0, soon = !t.done && n !== null && n >= 0 && n <= 2;
  const s = STREAMS.find(x => x.key === t.stream);
  const meta = [];
  if (t.done){
    const when = fmtStamp(t.doneAt);
    if (t.doneBy){ const tpl = `Done${when ? ' ' + when : ''} by {n}`; meta.push(h('span',{class:'by','data-uid':t.doneBy,'data-tpl':tpl}, tpl.replace('{n}', nameFor(t.doneBy)))); }
    else meta.push(h('span',{class:'by'}, when ? `Done ${when}` : 'Done'));
  } else if (t.due) meta.push(h('span',{class:'due'}, dueText(t.due)));
  if (showStream && s) meta.push(h('span',{class:'tag'}, s.label));
  if (t.custom && !ro){
    const armed = state.confirm === 'task:' + t.id;
    meta.push(h('button',{type:'button', class:'linkbtn red', 'data-fk':'td-'+t.id, onclick:() => armed ? removeTask(t.id) : arm('task:' + t.id)}, armed ? 'Confirm remove' : 'Remove'));
  }
  return h('li',{class:'task' + (t.done ? ' is-done' : '') + (overdue ? ' is-overdue' : '') + (soon ? ' is-soon' : '')},
    h('button',{type:'button', class:'oval', 'aria-pressed':t.done ? 'true' : 'false', 'aria-label':(t.done ? 'Mark not done: ' : 'Mark done: ') + t.title,
      'data-fk':'ov-'+t.id, disabled:ro, onclick:e => toggleTask(t.id, e.currentTarget)}),
    h('div',null, h('div',{class:'t-title'}, t.title), t.detail ? h('div',{class:'t-detail'}, t.detail) : null, meta.length ? h('div',{class:'t-meta'}, meta) : null),
    h('span',{class:'votes'}, '+' + t.votes));
}
const byDue = (a,b) => (a.due||'9999') < (b.due||'9999') ? -1 : (a.due||'9999') > (b.due||'9999') ? 1 : a.order - b.order;
function buildTasks(){
  if (state.dbStatus === 'off') return [emptyCard('The race board lives in Claude', 'Open this page in Claude while signed in to see and check off the shared to-dos.')];
  if (state.dbStatus === 'pending' || !state.loaded.tasks) return [emptyCard('Loading the race board', 'To-dos, votes and badges appear here in a moment.')];
  if (!state.tasks.length) return [emptyCard('No to-dos yet', 'Use "Add a to-do" to start the board.')];
  const out = [];
  if (state.view === 'deadline'){
    const undone = state.tasks.filter(t => !t.done).sort(byDue);
    const done = state.tasks.filter(t => t.done).sort((a,b) => (b.doneAt||'').localeCompare(a.doneAt||''));
    const groups = new Map();
    undone.forEach(t => { const k = t.due || 'none'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    for (const [k, ts] of groups){
      const n = k === 'none' ? null : daysFromToday(k);
      const when = n === null ? 'No date' : n < 0 ? 'Overdue' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`;
      out.push(h('h3',{class:'grp' + (n !== null && n < 0 ? ' overdue' : '')}, h('span',{class:'when'}, when), k === 'none' ? null : h('span',null, fmtDate(k)),
        h('span',{class:'gv'}, `${ts.reduce((a,t)=>a+t.votes,0)} votes`)));
      out.push(h('ul',{class:'tl'}, ts.map(t => taskItem(t, true))));
    }
    if (!undone.length) out.push(emptyCard('Every precinct is in', 'Nothing left on the board. See you at the Renaissance.'));
    if (done.length && !state.hideDone){
      out.push(h('details',{class:'done-grp', open:state.doneOpen, ontoggle:e => { state.doneOpen = e.currentTarget.open; }},
        h('summary',null, `Already in · ${done.length} ${plural(done.length,'precinct','precincts')}`),
        h('ul',{class:'tl'}, done.map(t => taskItem(t, true)))));
    }
  } else {
    for (const s of STREAMS){
      const ts = state.tasks.filter(t => t.stream === s.key);
      if (!ts.length) continue;
      const undone = ts.filter(t => !t.done).sort(byDue), done = ts.filter(t => t.done).sort(byDue);
      const list = state.hideDone ? undone : undone.concat(done);
      out.push(h('h3',{class:'grp'}, h('span',{class:'when'}, s.label), h('span',{class:'gv'}, `${done.length} of ${ts.length} in`)));
      out.push(list.length ? h('ul',{class:'tl'}, list.map(t => taskItem(t, false))) : emptyCard('All in', 'Every to-do here is done.'));
    }
  }
  return out;
}
function renderBoard(){
  noteFor('#boardNote');
  $$('#p-board .board-head .seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === state.view ? 'true' : 'false'));
  $('#hideDone').checked = state.hideDone;
  renderStickers(stats());
  const box = $('#taskList');
  withFocus(box, () => box.replaceChildren(...buildTasks()));
  resolveNames(state.tasks.filter(t => t.done && t.doneBy).map(t => t.doneBy));
}
function arm(key){
  state.confirm = key; changed('guests','budget','list');
  setTimeout(() => { if (state.confirm === key){ state.confirm = null; changed('guests','budget','list'); } }, 4000);
}

/* ---------- checklist ---------- */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const listOf = k => CHECK_LISTS.find(l => l.key === k) || CHECK_LISTS[0];
function fmtTime(t){
  const [hh, mm] = t.split(':').map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
// Sort key in minutes; anything before 6 AM counts as after midnight, so 12:00 AM sorts last.
const timeKey = t => { if (!t) return 1e5; const [hh, mm] = t.split(':').map(Number); return (hh < 6 ? hh + 24 : hh)*60 + mm; };
function eventNow(){
  // Minutes into election night (Chicago time), or null when it isn't Nov 3 (or the small hours of Nov 4).
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    const iso = `${p.year}-${p.month}-${p.day}`, hh = Number(p.hour) % 24, mm = Number(p.minute);
    if (iso === EVENT_DAY && hh >= 6) return hh*60 + mm;
    if (iso === DAY_AFTER && hh < 6) return (hh + 24)*60 + mm;
  } catch(e){}
  return null;
}
function cleanItem(d){
  const x = d.data() || {};
  return {id:d.id, title:str(x.title,140) || 'Untitled item', list:CHECK_LISTS.some(l => l.key === x.list) ? x.list : 'lead',
    time:TIME_RE.test(x.time) ? x.time : null, who:str(x.who,40), notes:str(x.notes,200),
    votes:clamp(Math.round(num(x.votes,10)),0,100), done:x.done === true,
    doneBy:typeof x.doneBy === 'string' ? x.doneBy : null, doneAt:typeof x.doneAt === 'string' ? x.doneAt : null,
    order:num(x.order,9999)};
}
function clSort(list){
  return list === 'day'
    ? (a,b) => timeKey(a.time) - timeKey(b.time) || a.order - b.order || a.title.localeCompare(b.title)
    : (a,b) => a.order - b.order || a.title.localeCompare(b.title);
}
function clPeople(){
  const seen = new Map();
  state.checklist.forEach(it => { const k = it.who.toLowerCase(); if (k && !seen.has(k)) seen.set(k, it.who); });
  return [...seen.entries()].sort((a,b) => a[1].localeCompare(b[1]));
}
function clMatchWho(it){
  const w = state.clWho;
  if (!w) return true;
  if (w === '__none') return !it.who;
  return it.who.toLowerCase() === w;
}
function clSections(){
  // The lists in view, each with the items that pass the person filter (crossed-off items included).
  const keys = state.clView === 'all' ? CHECK_LISTS.map(l => l.key) : [state.clView];
  return keys.map(k => ({L:listOf(k), items:state.checklist.filter(it => it.list === k && clMatchWho(it)).sort(clSort(k))}));
}
function renderChecklist(){
  noteFor('#listNote');
  $$('#clView button').forEach(b => b.setAttribute('aria-pressed', b.dataset.cl === state.clView ? 'true' : 'false'));
  $('#clHide').checked = state.clHide;
  const people = clPeople();
  if (state.clWho && state.clWho !== '__none' && !people.some(([k]) => k === state.clWho)) state.clWho = '';
  $('#clWho').replaceChildren(h('option',{value:'', selected:!state.clWho}, 'Everyone'),
    ...people.map(([k, v]) => h('option',{value:k, selected:state.clWho === k}, v)),
    h('option',{value:'__none', selected:state.clWho === '__none'}, 'No one yet'));
  $('#clWhoList').replaceChildren(...people.map(([, v]) => h('option',{value:v})));
  const box = $('#clList');
  withFocus(box, () => box.replaceChildren(...buildChecklist()));
  resolveNames(state.checklist.filter(it => it.done && it.doneBy).map(it => it.doneBy));
}
function buildChecklist(){
  if (state.dbStatus === 'off') return [emptyCard('The checklist lives in Claude', 'Open this page in Claude while signed in to see and cross off the shared checklist.')];
  if (state.dbStatus === 'pending' || !state.loaded.checklist) return [emptyCard('Loading the checklist', 'Items appear here in a moment.')];
  if (!state.checklist.length) return [emptyCard('Nothing on the checklist yet', 'Use "Add an item" to start it.')];
  const out = [], now = eventNow(), ro = !canWrite();
  for (const {L, items} of clSections()){
    const done = items.filter(it => it.done).length, pct = items.length ? done/items.length*100 : 0;
    let next = null;
    if (L.key === 'day' && now !== null) next = items.find(it => !it.done && it.time && timeKey(it.time) >= now) || null;
    const shown = state.clHide ? items.filter(it => !it.done) : items;
    out.push(h('section',{class:'cl-sec cl-' + L.key, 'aria-label':L.label},
      h('h3',{class:'grp'}, h('span',{class:'when'}, L.label), h('span',null, L.sub),
        h('span',{class:'gv'}, items.length ? `${done} of ${items.length} crossed off` : 'Empty'),
        ro ? null : h('button',{type:'button', class:'linkbtn', 'data-fk':'cla-' + L.key, onclick:() => openClForm(L.key)}, '+ Add')),
      h('div',{class:'cl-bar', role:'img', 'aria-label':`${L.label}: ${done} of ${items.length} crossed off`}, h('i',{style:'width:' + pct.toFixed(1) + '%'})),
      shown.length ? h('ul',{class:'tl'}, shown.map(it => clRow(it, {next:next === it, late:L.key === 'day' && now !== null && !it.done && !!it.time && timeKey(it.time) < now})))
        : emptyCard(items.length ? 'All crossed off' : (state.clWho ? 'Nothing for this person' : 'Nothing here yet'),
            items.length ? `Every item on ${L.label} is done.` : 'Use "+ Add" to put something on this list.')));
  }
  return out;
}
function clRow(it, ctx){
  if (state.clEditing === it.id) return clEditRow(it);
  const ro = !canWrite(), meta = [];
  if (ctx.next) meta.push(h('span',{class:'cl-next'}, 'Next up'));
  if (ctx.late) meta.push(h('span',{class:'due'}, 'Past time'));
  if (it.who) meta.push(h('span',{class:'tag'}, it.who));
  if (it.done){
    const when = fmtStamp(it.doneAt);
    if (it.doneBy){ const tpl = `Crossed off${when ? ' ' + when : ''} by {n}`; meta.push(h('span',{class:'by','data-uid':it.doneBy,'data-tpl':tpl}, tpl.replace('{n}', nameFor(it.doneBy)))); }
    else meta.push(h('span',{class:'by'}, when ? `Crossed off ${when}` : 'Crossed off'));
  }
  return h('li',{class:'task cl' + (it.done ? ' is-done' : '') + (ctx.late ? ' is-overdue' : '') + (ctx.next ? ' is-next' : '')},
    h('button',{type:'button', class:'oval', 'aria-pressed':it.done ? 'true' : 'false', 'aria-label':(it.done ? 'Undo crossing off: ' : 'Cross off: ') + it.title,
      'data-fk':'co-' + it.id, disabled:ro, onclick:e => toggleItem(it.id, e.currentTarget)}),
    h('div',null,
      it.time ? h('div',{class:'cl-time'}, fmtTime(it.time)) : null,
      h('div',{class:'t-title'}, it.title),
      it.notes ? h('div',{class:'t-detail'}, it.notes) : null,
      meta.length ? h('div',{class:'t-meta'}, meta) : null),
    h('span',{class:'votes'}, '+' + it.votes),
    ro ? h('span') : h('button',{type:'button', class:'linkbtn', 'data-fk':'ce-' + it.id, 'aria-label':'Edit ' + it.title,
      onclick:() => { state.clEditing = it.id; dirty.add('list'); schedule(); }}, 'Edit'));
}
function clEditRow(it){
  const d = state.clDrafts[it.id] || (state.clDrafts[it.id] = {title:it.title, list:it.list, time:it.time || '', who:it.who, notes:it.notes, votes:String(it.votes)});
  const upd = k => e => { d[k] = e.target.value; };
  const armed = state.confirm === 'item:' + it.id;
  const worth = [10,20,50].includes(Number(d.votes)) ? [10,20,50] : [10,20,50,Number(d.votes)].sort((a,b) => a-b);
  return h('li',{class:'cl-edit g-edit', onkeydown:e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT'){ e.preventDefault(); saveItem(it.id); }
      else if (e.key === 'Escape'){ e.preventDefault(); closeClEdit(it.id); }
    }},
    h('div',{class:'g-edit-grid'},
      h('label',{class:'field span2'}, 'What', h('input',{value:d.title, maxlength:140, 'data-fk':'cet-' + it.id, oninput:upd('title')})),
      h('label',{class:'field'}, 'List', h('select',{'data-fk':'cel-' + it.id, onchange:upd('list')}, CHECK_LISTS.map(l => h('option',{value:l.key, selected:l.key === d.list}, l.label)))),
      h('label',{class:'field'}, 'Time', h('input',{type:'time', step:300, value:d.time, 'data-fk':'cetm-' + it.id, oninput:upd('time')})),
      h('label',{class:'field'}, "Who's on it", h('input',{value:d.who, maxlength:40, list:'clWhoList', autocomplete:'off', 'data-fk':'cew-' + it.id, oninput:upd('who')})),
      h('label',{class:'field span2'}, 'Notes', h('input',{value:d.notes, maxlength:200, 'data-fk':'cen-' + it.id, oninput:upd('notes')})),
      h('label',{class:'field'}, 'Worth', h('select',{'data-fk':'cev-' + it.id, onchange:upd('votes')}, worth.map(v => h('option',{value:String(v), selected:String(v) === String(d.votes)}, `${v} votes`))))),
    h('div',{class:'g-edit-actions'},
      h('button',{type:'button', class:'btn primary sm', 'data-fk':'ces-' + it.id, onclick:() => saveItem(it.id)}, 'Save'),
      h('button',{type:'button', class:'btn ghost sm', onclick:() => closeClEdit(it.id)}, 'Cancel'),
      h('button',{type:'button', class:'btn danger sm', 'data-fk':'cer-' + it.id, onclick:() => armed ? removeItem(it.id) : arm('item:' + it.id)}, armed ? 'Confirm remove' : 'Remove')));
}
function closeClEdit(id){
  const a = document.activeElement, inRow = !!(a && a.closest && a.closest('#clList .g-edit'));
  if (inRow) a.blur();
  delete state.clDrafts[id]; state.clEditing = null; dirty.add('list'); schedule();
  if (inRow) requestAnimationFrame(() => requestAnimationFrame(() => { const b = $('[data-fk="ce-' + id + '"]'); if (b) b.focus({preventScroll:true}); }));
}
function openClForm(list){
  const f = $('#clForm'); f.hidden = false; $('#clAddBtn').setAttribute('aria-expanded','true');
  if (list){ $('#cfList').value = list; $('#cfVotes').value = String(listOf(list).votes); }
  f.scrollIntoView({block:'nearest', behavior:reduceMotion() ? 'auto' : 'smooth'});
  $('#cfTitle').focus({preventScroll:true});
}
function checklistText(){
  const out = [`HM26 Watch Party checklist · ${fmtDate(todayISO())}`];
  if (state.clWho) out.push(state.clWho === '__none' ? 'Items with no one on them yet' : `Items for ${(clPeople().find(([k]) => k === state.clWho) || [,''])[1]}`);
  for (const {L, items} of clSections()){
    const shown = state.clHide ? items.filter(it => !it.done) : items;
    out.push('', L.key === 'day' ? 'DAY OF · TUE, NOV 3' : L.label.toUpperCase());
    if (!shown.length) out.push('(nothing here)');
    shown.forEach(it => out.push(`${it.done ? '[x]' : '[ ]'} ${it.time ? fmtTime(it.time) + '  ' : ''}${it.title}${it.who ? ' (' + it.who + ')' : ''}${it.notes ? ' · ' + it.notes : ''}`));
  }
  return out.join('\n');
}
function buildChecklistSheet(){
  const out = [], logo = $('.plate img');
  const who = state.clWho ? (state.clWho === '__none' ? 'Items with no one on them yet · ' : `Items for ${(clPeople().find(([k]) => k === state.clWho) || [,''])[1]} · `) : '';
  out.push(h('div',{class:'ps-head'},
    h('div',null, h('p',{class:'ps-title'}, 'Checklist'),
      h('p',{class:'ps-meta'}, 'Hillar Moore Election Night Watch Party · Tuesday, Nov 3, 2026 · Renaissance Baton Rouge, Salon 1 · Doors 5 PM, wrap at midnight'),
      h('p',{class:'ps-meta'}, `${who}Printed ${fmtDate(todayISO(), {year:'numeric'})}`)),
    logo ? h('img',{class:'ps-logo', src:logo.src, alt:'Hillar Moore DA'}) : null));
  for (const {L, items} of clSections()){
    const shown = state.clHide ? items.filter(it => !it.done) : items;
    if (!shown.length) continue;
    const timed = L.key === 'day';
    out.push(h('h2',{class:'ps-sec'}, L.key === 'day' ? 'Day of · Tuesday, Nov 3' : L.label));
    out.push(h('table',{class:'ps-table ps-cl'},
      h('colgroup',null, h('col',{style:'width:5%'}), timed ? h('col',{style:'width:12%'}) : null, h('col'), h('col',{style:'width:18%'})),
      h('thead',null, h('tr',null, h('th',null, h('span',{class:'sr'}, 'Done')), timed ? h('th',null,'Time') : null, h('th',null,'Item'), h('th',null,"Who's on it"))),
      h('tbody',null, shown.map(it => h('tr',{class:it.done ? 'done' : null},
        h('td',null, h('span',{class:'ps-box'}, it.done ? '✓' : '')),
        timed ? h('td',{class:'n tl'}, it.time ? fmtTime(it.time) : 'Anytime') : null,
        h('td',null, it.title, it.notes ? h('span',{class:'d'}, it.notes) : null),
        h('td',null, it.who || ''))))));
  }
  if (out.length === 1) out.push(h('p',{class:'ps-note'}, 'Nothing to print with these filters.'));
  return out;
}

/* ---------- guests ---------- */
function renderGuests(){
  noteFor('#guestNote');
  const st = stats(), on = state.dbStatus === 'on' && state.loaded.guests;
  const nums = [
    ['Coming', st.confirmed, 'var(--good)'], ['Maybe', st.maybe, 'var(--warn)'], ['Awaiting reply', st.awaiting, 'var(--brand-soft-strong)'],
    ['Not invited', st.notInvited, null], ["Can't come", st.declined, null]];
  $('#hcNums').replaceChildren(...nums.map(([l,v,c]) => h('div',{class:'hn'}, h('b',null, on ? nf.format(v) : '--'), h('span',null, c ? h('i',{class:'sw', style:'background:' + c}) : null, l))));
  const total = st.confirmed + st.maybe + st.awaiting, max = Math.max(320, total*1.06);
  const pct = v => (v/max*100).toFixed(2) + '%';
  $('#meter').replaceChildren(
    h('div',{class:'s seg-yes', style:'width:' + pct(on ? st.confirmed : 0)}),
    h('div',{class:'s seg-maybe', style:'width:' + pct(on ? st.maybe : 0)}),
    h('div',{class:'s seg-invited', style:'width:' + pct(on ? st.awaiting : 0)}),
    h('div',{class:'mark', style:'left:' + pct(150)}, h('span',null,'150 · Salon 1 set')),
    h('div',{class:'mark end', style:'left:' + pct(300)}, h('span',null,'300 total expected')));
  const counts = {all:state.guests.length}; STATUSES.forEach(s => { counts[s.key] = state.guests.filter(g => g.status === s.key).length; });
  $('#gStatusF').replaceChildren(...[{key:'all', label:'All'}].concat(STATUSES).map(s => h('button',{type:'button', class:'chip', 'aria-pressed':state.statusFilter === s.key ? 'true' : 'false',
    onclick:() => { state.statusFilter = s.key; dirty.add('guests'); schedule(); }}, `${s.label} ${on ? counts[s.key] : ''}`.trim())));
  const box = $('#guestList');
  withFocus(box, () => box.replaceChildren(...buildGuests()));
}
function buildGuests(){
  if (state.dbStatus === 'off') return [emptyCard('The guest list lives in Claude', 'Open this page in Claude while signed in to see and edit the shared list.')];
  if (state.dbStatus === 'pending' || !state.loaded.guests) return [emptyCard('Loading the guest list', 'Names appear here in a moment.')];
  if (!state.guests.length) return [emptyCard('No guests yet', 'Add a name above or paste a whole list.')];
  const q = $('#gSearch').value.trim().toLowerCase(), gf = $('#gGroupF').value;
  const list = state.guests.filter(g => (state.statusFilter === 'all' || g.status === state.statusFilter) && (!gf || g.group === gf) &&
    (!q || (g.name + ' ' + g.notes + ' ' + g.contact).toLowerCase().includes(q)));
  if (!list.length) return [emptyCard('No one matches', 'Try another search or filter.')];
  const out = [];
  for (const grp of GROUPS){
    const gs = list.filter(g => g.group === grp.key).sort((a,b) => a.name.localeCompare(b.name));
    if (!gs.length) continue;
    const ppl = gs.reduce((a,g)=>a+1+g.plusOnes,0);
    out.push(h('h3',{class:'grp'}, h('span',{class:'when'}, grp.label), h('span',{class:'gv'}, `${gs.length} ${plural(gs.length,'name','names')}` + (ppl !== gs.length ? ` · ${ppl} people with +1s` : ''))));
    out.push(h('ul',{class:'gl'}, gs.map(guestRow)));
  }
  return out;
}
function guestRow(g){
  if (state.editing === g.id) return editRow(g);
  const ro = !canWrite();
  const sub = [g.contact, g.notes].filter(Boolean).join(' · ');
  return h('li',{class:'guest'},
    h('div',{class:'g-main'}, h('div',{class:'g-name'}, g.name), sub ? h('div',{class:'g-sub'}, sub) : null),
    h('select',{class:'pill st-' + g.status, 'aria-label':'RSVP for ' + g.name, 'data-fk':'gs-'+g.id, disabled:ro, onchange:e => updateGuest(g.id, {status:e.target.value})},
      STATUSES.map(s => h('option',{value:s.key, selected:s.key === g.status}, s.label))),
    h('div',{class:'plus', role:'group', 'aria-label':'+1s for ' + g.name},
      h('button',{type:'button', 'aria-label':'Fewer +1s', 'data-fk':'gm-'+g.id, disabled:ro || g.plusOnes <= 0, onclick:() => updateGuest(g.id, {plusOnes:g.plusOnes-1})}, '−'),
      h('span',null, '+' + g.plusOnes),
      h('button',{type:'button', 'aria-label':'More +1s', 'data-fk':'gp-'+g.id, disabled:ro || g.plusOnes >= 5, onclick:() => updateGuest(g.id, {plusOnes:g.plusOnes+1})}, '+')),
    h('button',{type:'button', class:'linkbtn edit', 'data-fk':'ge-'+g.id, disabled:ro, onclick:() => { state.editing = g.id; dirty.add('guests'); schedule(); }}, 'Edit'));
}
function editRow(g){
  const d = state.drafts[g.id] || (state.drafts[g.id] = {name:g.name, group:g.group, contact:g.contact, notes:g.notes});
  const upd = k => e => { d[k] = e.target.value; };
  const armed = state.confirm === 'guest:' + g.id;
  return h('li',{class:'guest g-edit'},
    h('div',{class:'g-edit-grid'},
      h('label',{class:'field'}, 'Name', h('input',{value:d.name, maxlength:80, 'data-fk':'en-'+g.id, oninput:upd('name')})),
      h('label',{class:'field'}, 'Group', h('select',{'data-fk':'eg-'+g.id, onchange:upd('group')}, GROUPS.map(x => h('option',{value:x.key, selected:x.key === d.group}, x.label)))),
      h('label',{class:'field'}, 'Email or phone', h('input',{value:d.contact, maxlength:120, 'data-fk':'ec-'+g.id, oninput:upd('contact')})),
      h('label',{class:'field'}, 'Notes', h('input',{value:d.notes, maxlength:200, 'data-fk':'eo-'+g.id, oninput:upd('notes')}))),
    h('div',{class:'g-edit-actions'},
      h('button',{type:'button', class:'btn primary sm', 'data-fk':'es-'+g.id, onclick:() => saveGuest(g.id)}, 'Save'),
      h('button',{type:'button', class:'btn ghost sm', onclick:() => { delete state.drafts[g.id]; state.editing = null; dirty.add('guests'); schedule(); }}, 'Cancel'),
      h('button',{type:'button', class:'btn danger sm', 'data-fk':'er-'+g.id, onclick:() => armed ? removeGuest(g.id) : arm('guest:' + g.id)}, armed ? 'Confirm remove' : 'Remove')));
}
function matchGroup(t){
  t = (t || '').toLowerCase().trim(); if (!t) return null;
  const g = GROUPS.find(x => x.key === t) || GROUPS.find(x => x.label.toLowerCase().includes(t)) || GROUPS.find(x => t.includes(x.key));
  return g ? g.key : null;
}
function headcountText(){
  const st = stats();
  return `Hillar Moore Election Night Event (ref M-WQ83ATW), Tue Nov 3. Headcount as of ${fmtDate(todayISO())}: ${st.confirmed} confirmed, ${st.maybe} maybe, ${st.awaiting} awaiting reply. Counts include +1s.`;
}
function guestListText(){
  const rows = [['Name','Group','Status','+1s','Email or phone','Notes'].join('\t')];
  GROUPS.forEach(grp => state.guests.filter(g => g.group === grp.key).sort((a,b)=>a.name.localeCompare(b.name)).forEach(g => {
    rows.push([g.name, grp.label, STATUSES.find(s=>s.key===g.status).label, g.plusOnes, g.contact, g.notes].map(v => String(v).replace(/\t|\n/g,' ')).join('\t'));
  }));
  return rows.join('\n');
}

/* ---------- menu ---------- */
function priceLabel(it){
  const p = '$' + nf.format(it.price);
  switch (it.unit){
    case 'pp': return p + ' / guest';
    case 'pc50': return p + ' / 50 pcs';
    case 'dozen': return p + ' / dozen';
    case 'gallon': return p + ' / gallon';
    case 'drink': return p + ' / drink';
    case 'bottle': return p + ' / bottle';
    case 'foot': return p + ' / ft';
    case 'hour': return p + ' / hr';
    default: return it.per ? `${p} ${it.per}` : it.serves ? `${p} · serves ${it.serves}` : p + ' each';
  }
}
function qtyUnit(it, q){
  switch (it.unit){
    case 'pp': return plural(q,'guest','guests');
    case 'pc50': return 'pieces';
    case 'dozen': return 'dozen';
    case 'gallon': return plural(q,'gallon','gallons');
    case 'drink': return plural(q,'drink','drinks');
    case 'bottle': return plural(q,'bottle','bottles');
    case 'foot': return plural(q,'foot','feet');
    case 'hour': return plural(q,'hour','hours');
    default: return it.carver ? plural(q,'roast','roasts') : it.serves ? plural(q,'order','orders') : plural(q,'unit','units');
  }
}
function menuItem(it, hc){
  const p = state.picks[it.id], on = !!p, ro = !canWrite();
  const q = on ? pickQty(it, p, hc) : 0;
  const flags = [];
  if (it.att) flags.push(h('span',{class:'flag'}, it.att > 1 ? `${it.att} attendants +$${100*it.att}` : 'Attendant +$100'));
  if (it.carver) flags.push(h('span',{class:'flag'}, 'Carver +$100'));
  if (it.serves && !it.per) flags.push(h('span',{class:'flag'}, `Serves ${it.serves}`));
  if (it.max) flags.push(h('span',{class:'flag' + ((on ? q : hc) > it.max ? ' warn' : '')}, `Max ${it.max} guests`));
  let qty = null;
  if (on){
    qty = h('div',{class:'mi-qty'},
      h('label',{class:'sr', for:'q-'+it.id}, 'Quantity for ' + it.name),
      h('input',{id:'q-'+it.id, type:'number', min:it.unit === 'pc50' ? 50 : 1, step:it.unit === 'pc50' ? 50 : 1, value:q, inputmode:'numeric', 'data-fk':'q-'+it.id, disabled:ro,
        onchange:e => setPickQty(it.id, e.target.value)}),
      h('span',null, qtyUnit(it, q)),
      h('span',{class:'mi-cost'}, '= ' + fmt0(lineCost(it, q))),
      it.unit === 'pp' ? (p.follow ? h('span',null,'follows guest count') : h('button',{type:'button', class:'linkbtn', disabled:ro, onclick:() => followPick(it.id)}, `Match guest count (${nf.format(hc)})`)) : null);
  }
  return h('div',{class:'mi' + (on ? ' on' : '')},
    h('button',{type:'button', class:'pick', 'aria-pressed':on ? 'true' : 'false', 'aria-label':(on ? 'Remove ' : 'Add ') + it.name, 'data-fk':'pk-'+it.id, disabled:ro, onclick:() => togglePick(it.id)}, on ? 'Added' : 'Add'),
    h('div',{style:'min-width:0'}, h('div',{class:'mi-name'}, it.name), it.desc ? h('div',{class:'mi-desc'}, it.desc) : null, flags.length ? h('div',{class:'mi-flags'}, flags) : null),
    h('div',{class:'mi-price'}, priceLabel(it)),
    qty);
}
function barSegments(){
  const s = state.settings.bar.slots, out = [];
  s.forEach((k, i) => { const last = out[out.length-1]; if (last && last.kind === k) last.b = SLOT_START[i] + 1; else out.push({kind:k, a:SLOT_START[i], b:SLOT_START[i] + 1}); });
  return out;
}
function hourRange(a, b){ return b >= 24 ? `${a-12} PM–midnight` : `${a-12}–${b-12} PM`; }
function rangesOf(kind){ return barSegments().filter(g => g.kind === kind).map(g => hourRange(g.a, g.b)).join(' and '); }
function planText(){
  const segs = barSegments();
  if (segs.length === 1 && segs[0].kind === 'off') return 'No bar';
  const word = {open:'open bar', cash:'cash bar', off:'bar closed'};
  const t = segs.map(g => `${word[g.kind]} ${hourRange(g.a, g.b)}`).join(', then ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function saveBar(patch){ saveSettings({bar:Object.assign({}, state.settings.bar, patch)}); }
function barPlanBlock(B){
  const ro = !canWrite(), S = state.settings, P = S.bar, L = B.plan;
  const next = {open:'cash', cash:'off', off:'open'}, word = {open:'Open', cash:'Cash', off:'Closed'}, long = {open:'open bar', cash:'cash bar', off:'bar closed'};
  const presets = h('div',{class:'chips bp-presets', role:'group', 'aria-label':'Bar presets'},
    BAR_PRESETS.map((p, i) => h('button',{type:'button', class:'chip', 'aria-pressed':p.slots.join() === P.slots.join() ? 'true' : 'false', 'data-fk':'bpp-'+i, disabled:ro,
      onclick:() => saveBar({slots:p.slots.slice()})}, p.label)));
  const track = h('div',{class:'bp-track', role:'group', 'aria-label':'Bar by the hour, 5 PM to midnight'},
    P.slots.map((s, i) => h('button',{type:'button', class:'bp-slot bp-' + s, 'data-fk':'bps-'+i, disabled:ro,
      'aria-label':`${BAR_SLOTS[i]} hour: ${long[s]}. Click to change.`, onclick:() => { const slots = P.slots.slice(); slots[i] = next[s]; saveBar({slots}); }},
      h('span',{class:'bp-time'}, BAR_SLOTS[i]), h('span',{class:'bp-kind'}, word[s]))));
  const basis = h('div',{class:'bp-basis'},
    h('span',{class:'t-label'}, 'Price the open-bar hours'),
    h('div',{class:'seg', role:'group', 'aria-label':'Price open-bar hours as'},
      h('button',{type:'button', 'aria-pressed':P.basis === 'drink' ? 'true' : 'false', 'data-fk':'bpb-d', disabled:ro, onclick:() => saveBar({basis:'drink'})}, 'Pay per drink'),
      h('button',{type:'button', 'aria-pressed':P.basis === 'package' ? 'true' : 'false', 'data-fk':'bpb-p', disabled:ro, onclick:() => saveBar({basis:'package'})}, 'Hourly package')));
  const num0 = (v) => v == null ? '' : v;
  const fields = P.basis === 'drink'
    ? h('div',{class:'bp-fields'},
        h('label',{class:'field'}, 'Guests at the bar', h('input',{type:'number', min:0, step:10, value:num0(P.guests), placeholder:`Peak (${nf.format(B.peak)})`, 'data-fk':'bpf-g', disabled:ro, onchange:e => saveBar({guests:e.target.value === '' ? null : e.target.value})})),
        h('label',{class:'field'}, 'Drinks per guest per hour', h('input',{type:'number', min:0, max:5, step:0.25, value:P.dph, 'data-fk':'bpf-r', disabled:ro, onchange:e => saveBar({dph:e.target.value})})),
        h('label',{class:'field'}, 'Average drink ($)', h('input',{type:'number', min:0, step:0.5, value:P.avg, 'data-fk':'bpf-a', disabled:ro, onchange:e => saveBar({avg:e.target.value})})),
        h('label',{class:'field'}, 'Open-bar cap ($)', h('input',{type:'number', min:0, step:250, value:P.cap > 0 ? P.cap : '', placeholder:'No cap', 'data-fk':'bpf-c', disabled:ro, onchange:e => saveBar({cap:e.target.value})})),
        h('p',{class:'hint full'}, 'Hosted prices: beer $5–7, wine and cocktails $10–12. A cap tells the hotel to switch to cash once you hit that amount.'))
    : h('div',{class:'bp-fields'},
        h('label',{class:'field span2'}, 'Package', h('select',{'data-fk':'bpf-t', disabled:ro, onchange:e => saveBar({tier:e.target.value})},
          HOURLY.map(t => h('option',{value:t.key, selected:t.key === P.tier}, `${t.label} · $${t.prices[0]}–$${t.prices[3]} per guest`)))),
        h('label',{class:'field span2'}, 'Bill on', h('select',{'data-fk':'bpf-o', disabled:ro, onchange:e => saveBar({billOn:e.target.value})},
          h('option',{value:'total', selected:P.billOn === 'total'}, `Total guests (${nf.format(B.hc)})`),
          h('option',{value:'peak', selected:P.billOn === 'peak'}, `Peak at once (${nf.format(B.peak)}), if the hotel agrees`))),
        h('p',{class:'hint full'}, 'Packages charge a flat price per guest on the count you give the hotel, and include bartenders while they run.'));
  const staff = h('div',{class:'bp-fields'},
    h('label',{class:'field'}, 'Bartenders', h('input',{type:'number', min:0, max:20, step:1, value:num0(S.bartenders), placeholder:`Auto (${B.autoBt})`, 'data-fk':'bpf-bt', disabled:ro,
      onchange:e => saveSettings({bartenders:e.target.value === '' ? null : e.target.value})})),
    h('label',{class:'field'}, 'Cashiers', h('input',{type:'number', min:0, max:10, step:1, value:num0(S.cashierCount), placeholder:'Auto (1)', 'data-fk':'bpf-ca', disabled:ro,
      onchange:e => saveSettings({cashierCount:e.target.value === '' ? null : e.target.value})})),
    h('p',{class:'hint span2'}, 'Bartenders and cashiers are $150 each for 2 hours, plus $25 per extra hour. Leave blank to size automatically: one bartender per 100 guests at peak, one cashier when there is a cash bar.'));
  const sum = [rl('Plan', planText(), 'tot')];
  if (L.openN){
    if (L.basis === 'package'){
      sum.push(rl(`Open bar, ${L.tier.label.toLowerCase()} package, ${L.openN} hr: $${L.price} × ${nf.format(L.billed)} guests`, fmt0(L.cost)));
      if (L.over4) sum.push(rl('Packages stop at 4 hours; hours past 4 are an estimate. Ask Elizabeth.', '', 'sub bad'));
    } else {
      sum.push(rl(`Open bar, about ${nf.format(Math.round(L.drinksEst))} drinks (${nf.format(L.guests)} guests × ${P.dph}/hr × ${L.openN} hr × $${P.avg})`, fmt0(L.uncapped)));
      if (L.capped) sum.push(rl(`Capped at ${fmt0(P.cap)}, then cash`, fmt0(L.cost), 'good'));
    }
  }
  if (L.cashN) sum.push(rl(`Cash bar, ${L.cashN} hr: guests pay ($6–8 beer, $12–14 wine and cocktails)`, '$0'));
  if (B.btFee) sum.push(rl(`Bartenders: ${B.bartenders} × ${B.btHours} hr`, fmt0(B.btFee)));
  if (B.cashFee) sum.push(rl(`Cashier${B.cashiers === 1 ? '' : 's'}: ${B.cashiers} × ${L.cashN} hr`, fmt0(B.cashFee)));
  const pre = L.cost + B.btFee + B.cashFee;
  sum.push(rl('Bar total before service and tax', fmt0(pre), 'tot'));
  sum.push(rl('With 24% service and 12.5% tax', fmt0(pre*HOTEL_K), 'tot big'));
  if (L.cashN) sum.push(h('p',{class:'hint', style:'margin:6px 0 0'}, 'Ask Elizabeth whether cash bar sales count toward the $5,000 minimum.'));
  return [presets, track, h('p',{class:'hint'}, 'Each block is the hour starting at that time; the bar closes at midnight. Click a block to switch it: open bar, cash bar, closed.'),
    L.openN ? [basis, fields] : h('p',{class:'hint'}, 'No open-bar hours yet. Click an hour to switch it on.'), staff, h('div',{class:'bp-sum'}, sum)];
}
function renderMenu(){
  noteFor('#menuNote');
  const B = budget(), hc = B.hc, on = state.dbStatus === 'on' && state.loaded.picks;
  setIfIdle($('#hcMenu'), hc); setIfIdle($('#peakMenu'), B.peak);
  $('#feastNum').textContent = on ? fmt0(B.fb) : '--';
  const fm = $('#feastMeter'); fm.firstChild.style.width = (on ? Math.min(100, B.fb/MIN_FB*100) : 0) + '%'; fm.classList.toggle('met', B.fb >= MIN_FB);
  let sub = !on ? 'Before the 24% service charge and 12.5% tax.'
    : B.fb >= MIN_FB ? `Clears the $5,000 minimum by ${fmt0(B.fb - MIN_FB)}. Before 24% service and 12.5% tax.`
    : `${fmt0(MIN_FB - B.fb)} short of the $5,000 minimum. A shortfall is billed as room rental anyway.`;
  if (on && (B.cap > 0 || B.target > 0)) sub += ' ' + (roomText(B).split('. Every')[0] || budgetStatus(B, false)) + '.';
  if (on && B.pieces) sub += ` Hors d'oeuvres: ${nf.format(B.pieces)} pieces, about ${(B.pieces/hc).toFixed(1)} per guest. A common rule of thumb is 6 to 8 per guest when a meal follows, 10 to 15 when it doesn't.`;
  $('#feastSub').textContent = sub;
  const box = $('#menuList');
  if (state.dbStatus === 'off'){ box.replaceChildren(emptyCard('Menu picks live in Claude', 'Open this page in Claude while signed in to pick items. Prices below are for reference.'), ...buildMenu(B, hc, true)); return; }
  withFocus(box, () => box.replaceChildren(...buildMenu(B, hc, false)));
}
/* Collapsible menu sections. Searching or "Picked only" opens everything that matches;
   otherwise a section opens if you opened it last time, or if it has picks. */
function secIsOpen(key, hasPicks){
  if (state.mSearch.trim() || state.mPicked) return true;
  if (key in state.secOpen) return state.secOpen[key];
  return hasPicks || key === 'bar';
}
function collapsible(id, key, title, metaText, hasPicks, note, body){
  const open = secIsOpen(key, hasPicks);
  return h('details',{class:'msec', id, open},
    h('summary',{class:'msec-h', 'data-fk':'sum-' + key, onclick:e => {
      const d = e.currentTarget.parentElement;
      setTimeout(() => { state.secOpen[key] = d.open; savePrefs(); }, 0);
    }},
      h('h3',{class:'sec-h'}, title),
      h('span',{class:'msec-meta'}, metaText ? h('span',{class:'msec-sum' + (hasPicks ? '' : ' quiet')}, metaText) : null, h('span',{class:'chev', 'aria-hidden':'true'}))),
    h('p',{class:'msec-note'}, note), body);
}
function setAllSections(keys, open){
  keys.forEach(k => { state.secOpen[k] = open; }); savePrefs();
  dirty.add('menu'); dirty.add('room'); schedule();
}
function openSection(key, elId){
  state.secOpen[key] = true; savePrefs(); dirty.add(state.tab); schedule();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById(elId);
    if (el) el.scrollIntoView({behavior:reduceMotion() ? 'auto' : 'smooth', block:'start'});
    else toast('Hidden by your filters', 'Clear the search or "Picked only" to see this section.');
  }));
}
function buildMenu(B, hc){
  const q = state.mSearch.trim().toLowerCase(), pickedOnly = state.mPicked, out = [];
  for (const sec of MENU){
    let body = [];
    const sum = sec.special ? B.plan.cost + B.btFee + B.cashFee
      : B.lines.filter(l => l.item.sec === sec.key).reduce((a,l)=>a+l.cost,0) + (sec.key === 'action' || sec.key === 'sweets' || sec.key === 'carving'
        ? Object.keys(state.picks).map(id => ITEMS[id]).filter(it => it && it.sec === sec.key).reduce((a,it)=>a + (it.att ? 100*it.att : 0) + (it.carver ? 100 : 0), 0) : 0);
    if (sec.special){
      const show = (!q || 'bar plan open cash hourly package beer wine preferred premium bartender cashier'.includes(q)) && (!pickedOnly || B.plan.cost || B.btFee || B.cashFee);
      if (!show) continue;
      body = barPlanBlock(B);
    } else {
      const items = sec.items.map(a => ITEMS[a[0]]).filter(it => (!pickedOnly || state.picks[it.id]) && (!q || (it.name + ' ' + it.desc).toLowerCase().includes(q)));
      if (!items.length) continue;
      body = items.map(it => menuItem(it, hc));
    }
    const nPicked = sec.special ? 0 : sec.items.filter(x => state.picks[x[0]]).length;
    const hasPicks = sec.special ? !!(B.plan.openN || B.plan.cashN) : nPicked > 0;
    const meta = sec.special ? planText() : (sum ? `${nPicked} picked · ${fmt0(sum)}` : `${sec.items.length} items`);
    out.push(collapsible('m-' + sec.key, sec.key, sec.title, meta, hasPicks && (sec.special ? true : sum > 0), sec.note, body));
  }
  if (!out.length) out.push(emptyCard(pickedOnly ? 'Nothing picked yet' : 'No matches', pickedOnly ? 'Turn off "Picked only" and add items.' : 'Try another search.'));
  return out;
}
function orderText(){
  const B = budget(), S = state.settings, out = [`Hillar Moore Election Night Event (ref M-WQ83ATW), Tue Nov 3`, `Draft menu for ${nf.format(B.hc)} guests`, ''];
  for (const sec of MENU){
    if (sec.special){
      const L = B.plan;
      if (L.openN || L.cashN){
        out.push('Bar');
        out.push(`- ${planText()}`);
        if (L.openN) out.push(L.basis === 'package'
          ? `- Open bar as a ${L.tier.label.toLowerCase()} hourly package, ${L.openN} hours, billed on ${nf.format(L.billed)} guests (${fmt0(L.cost)})`
          : `- Open bar hosted per drink${S.bar.cap > 0 ? `, switching to cash at ${fmt0(S.bar.cap)}` : ''} (estimate ${fmt0(L.cost)})`);
        out.push(`- ${B.bartenders} ${plural(B.bartenders,'bartender','bartenders')}${B.cashiers ? `, ${B.cashiers} ${plural(B.cashiers,'cashier','cashiers')}` : ''}`);
        out.push('');
      }
      continue;
    }
    const ls = B.lines.filter(l => l.item.sec === sec.key); if (!ls.length) continue;
    out.push(sec.title);
    ls.forEach(l => out.push(`- ${l.item.name}: ${nf.format(l.qty)} ${qtyUnit(l.item, l.qty)} (${fmt0(l.cost)})`));
    out.push('');
  }
  out.push(`Estimated food and drink: ${fmt0(B.fb)} before 24% service and 12.5% tax.`);
  return out.join('\n');
}

/* ---------- print / save as PDF (menu) ---------- */
function psRow(cells, picked){
  return h('tr',{class:picked ? 'picked' : null},
    h('td',null, picked ? h('span',{class:'chk'},'✓\u00a0') : null, cells[0], cells[1] ? h('span',{class:'d'}, cells[1]) : null),
    h('td',{class:'n'}, cells[2] || ''), h('td',{class:'n'}, cells[3] || ''), h('td',{class:'n'}, cells[4] || ''));
}
function psTable(rows){
  return h('table',{class:'ps-table'},
    h('colgroup',null, h('col'), h('col',{style:'width:16%'}), h('col',{style:'width:17%'}), h('col',{style:'width:13%'})),
    h('thead',null, h('tr',null, h('th',null,'Item'), h('th',{class:'n'},'Qty'), h('th',{class:'n'},'Price'), h('th',{class:'n'},'Est. total'))),
    h('tbody',null, rows));
}
function buildPrintSheet(mode){
  const B = budget(), S = state.settings, all = mode === 'all', out = [];
  const logo = $('.plate img');
  out.push(h('div',{class:'ps-head'},
    h('div',null,
      h('p',{class:'ps-title'}, all ? 'Renaissance evening menu' : 'Menu selections'),
      h('p',{class:'ps-meta'}, 'Hillar Moore Election Night Event · Ref M-WQ83ATW · Tuesday, Nov 3, 2026 · Renaissance Baton Rouge, Salon 1'),
      h('p',{class:'ps-meta'}, `Planning for ${nf.format(B.hc)} guests through the night, about ${nf.format(B.peak)} at once · Prepared ${fmtDate(todayISO(), {year:'numeric'})}`),
      all ? h('p',{class:'ps-meta'}, 'Items we have picked are marked ✓ with quantities and estimated totals.') : null),
    logo ? h('img',{class:'ps-logo', src:logo.src, alt:'Hillar Moore DA'}) : null));
  for (const sec of MENU){
    const rows = [];
    if (sec.special){
      const L = B.plan;
      if (L.openN || L.cashN) rows.push(psRow([planText(), 'Bar plan, 5 PM to midnight'], true));
      if (L.openN && L.basis === 'package') rows.push(psRow([`Open bar: ${L.tier.label.toLowerCase()} hourly package`, `${rangesOf('open')}. Billed per guest; includes soft drinks, water and bartenders.` + (L.over4 ? ' Hours past 4 are an estimate.' : ''), `${nf.format(L.billed)} guests`, `$${L.price} / guest`, fmt0(L.cost)], true));
      if (L.openN && L.basis === 'drink') rows.push(psRow(['Open bar: hosted, pay per drink', `${rangesOf('open')}. About ${nf.format(Math.round(L.drinksEst))} drinks at about $${S.bar.avg}` + (S.bar.cap > 0 ? `; switch to cash at ${fmt0(S.bar.cap)}` : '') + '. Estimate.', `${L.openN} hr`, `~$${S.bar.avg} / drink`, fmt0(L.cost)], true));
      if (L.cashN) rows.push(psRow(['Cash bar', `${rangesOf('cash')}. Guests pay.`, `${L.cashN} hr`, '', '$0'], true));
      if (all){
        HOURLY.forEach(t => rows.push(psRow([`${t.label} hourly package`, t.prices.map((p,i) => `${i+1} hr $${p}`).join(' · ') + ' per guest'], false)));
        rows.push(psRow(['Cash bar prices', 'Tax included: preferred spirits $12 · premium $14 · house wine $12 · domestic beer $6 · imported $8 · soft drinks $5'], false));
      }
      if (B.btFee) rows.push(psRow(['Bartenders', `${B.btHours} hours. $150 each for 2 hours, plus $25 per extra hour.`, `${B.bartenders}`, `${fmt0(staffFee(B.btHours))} each`, fmt0(B.btFee)], true));
      if (B.cashFee) rows.push(psRow(['Cashiers', `${L.cashN} hours of cash bar`, `${B.cashiers}`, `${fmt0(staffFee(L.cashN))} each`, fmt0(B.cashFee)], true));
    } else {
      for (const a of sec.items){
        const it = ITEMS[a[0]], p = state.picks[it.id];
        if (!p && !all) continue;
        const desc = [it.desc, it.max ? `max ${it.max} guests` : ''].filter(Boolean).join(' · ');
        if (p){ const q = pickQty(it, p, B.hc); rows.push(psRow([it.name, desc + (it.max && q > it.max ? ' (over the limit, ask Elizabeth)' : ''), `${nf.format(q)} ${qtyUnit(it, q)}`, priceLabel(it), fmt0(lineCost(it, q))], true)); }
        else rows.push(psRow([it.name, desc, '', priceLabel(it), ''], false));
      }
    }
    if (!rows.length) continue;
    out.push(h('h2',{class:'ps-sec'}, sec.title));
    if (all) out.push(h('p',{class:'ps-secnote'}, sec.note));
    out.push(psTable(rows));
  }
  const feeRows = [];
  for (const id of Object.keys(state.picks)){
    const it = ITEMS[id]; if (!it) continue;
    if (it.att) feeRows.push(psRow([`${it.att > 1 ? it.att + ' attendants' : 'Attendant'} · ${it.name}`, '$100 per attendant', `${it.att}`, '$100', fmt0(100*it.att)], true));
    if (it.carver) feeRows.push(psRow([`Carver · ${it.name}`, '$100 per carving station', '1', '$100', '$100'], true));
  }
  if (feeRows.length){ out.push(h('h2',{class:'ps-sec'}, 'Attendants & carvers')); out.push(psTable(feeRows)); }
  const sub = B.fb + B.shortfall + B.fees, svc = sub*SVC, tax = (sub + svc)*TAX;
  const line = (l, v, cls) => h('div',{class:cls || null}, h('span',null,l), h('span',null,v));
  if (B.lines.length || B.plan.cost || B.fees){
    out.push(h('div',{class:'ps-sum'},
      line('Food & drink', fmt2(B.fb)),
      B.shortfall > 0 ? line('Short of the $5,000 minimum (billed as room rental)', fmt2(B.shortfall), 'warn') : line('$5,000 food & drink minimum', 'Met'),
      B.fees ? line('Attendants, carvers & bar staff', fmt2(B.fees)) : null,
      line('Service charge 24%', fmt2(svc)),
      line('Sales tax 12.5%', fmt2(tax)),
      line('Estimated menu total', fmt2(sub + svc + tax), 'tot')));
  }
  out.push(h('p',{class:'ps-note'}, 'Prices from the Renaissance Baton Rouge Meeting + Event Menus, 2026 edition, and subject to change. Estimate only: excludes the Kullman Boardroom ($500) and AV. Tax applies to the service charge as well. Final numbers come from the signed event order.'));
  return out;
}
function printMenu(mode){
  const B = budget();
  if (mode === 'picks' && !(B.lines.length || B.plan.cost || B.fees)){ toast('Nothing picked yet', 'Add items first, or print the full menu.'); return; }
  runPrint(buildPrintSheet(mode));
}
function runPrint(nodes){
  const sheet = $('#printSheet');
  sheet.replaceChildren(...nodes.filter(Boolean));
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); sheet.replaceChildren(); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch(e){ done(); toast("Couldn't open printing", 'Use your browser menu: File, then Print.'); } }, 60);
}

/* ---------- room & AV ---------- */
const LAYOUT_NAMES = {A:'Layout A, stage on the end wall', B:'Layout B, stage on the long wall'};
const isAvId = id => !!(ITEMS[id] && ITEMS[id].kind === 'av');
function kitCost(k){ return k.items.reduce((s,[id,q]) => s + lineCost(ITEMS[id], q), 0); }
function kitMatches(k){
  const ids = Object.keys(state.picks).filter(isAvId);
  return ids.length === k.items.length && k.items.every(([id,q]) => state.picks[id] && pickQty(ITEMS[id], state.picks[id], state.settings.headcount) === q);
}
async function applyKit(k){
  if (!canWrite() || pending.has('avkit')) return;
  const clearing = kitMatches(k), want = new Map(clearing ? [] : k.items);
  pending.add('avkit');
  try {
    for (const id of Object.keys(state.picks).filter(isAvId)) if (!want.has(id)) await db.doc('picks/' + id).delete();
    for (const [id, q] of want) await db.doc('picks/' + id).set({qty:q, follow:false, by:meId(), at:nowISO()});
    toast(clearing ? 'AV cleared' : `${k.label} kit loaded`, clearing ? 'No AV picked.' : `${fmt0(kitCost(k)*HOTEL_K)} with service and tax. Adjust any line below.`);
  } catch(e){ writeFail(e); } finally { pending.delete('avkit'); }
}
async function pickLayout(L){
  if (!canWrite()) return;
  saveSettings({layout:state.settings.layout === L ? null : L});
}
function renderRoom(){
  noteFor('#roomNote');
  const S = state.settings, ro = !canWrite(), B = budget(), on = state.dbStatus === 'on' && state.loaded.picks;
  $$('.fp-pick').forEach(b => {
    const picked = S.layout === b.dataset.layout;
    b.setAttribute('aria-pressed', picked ? 'true' : 'false'); b.textContent = picked ? 'Picked ✓' : 'Pick this layout'; b.disabled = ro;
    b.closest('.fp-card').classList.toggle('picked', picked);
  });
  $('#avKits').replaceChildren(...AV_KITS.map(k => h('button',{type:'button', class:'chip', 'aria-pressed':on && kitMatches(k) ? 'true' : 'false', 'data-fk':'avk-'+k.key, disabled:ro,
    onclick:() => applyKit(k)}, `${k.label} · ${fmt0(kitCost(k)*HOTEL_K)}`)));
  const n = B.avLines.length;
  $('#avSum').replaceChildren(
    rl(`AV picked (${n} ${plural(n,'item','items')})`, on ? fmt2(B.av) : '--', 'tot'),
    rl('Service charge 24%', on ? fmt2(B.av*SVC) : '--'),
    rl('Sales tax 12.5%', on ? fmt2(B.av*(1+SVC)*TAX) : '--'),
    rl('AV with service and tax', on ? fmt2(B.av*HOTEL_K) : '--', 'tot big'),
    h('p',{class:'rc-note'}, "AV doesn't count toward the $5,000 food and drink minimum. Encore's prices took effect Jan 1, 2026, and some packages may add labor."));
  const box = $('#avList');
  if (state.dbStatus === 'off'){ box.replaceChildren(emptyCard('AV picks live in Claude', 'Open this page in Claude while signed in to pick AV. Prices below are for reference.')); return; }
  withFocus(box, () => box.replaceChildren(...AV_MENU.map(sec => {
    const sum = B.avLines.filter(l => l.item.sec === sec.key).reduce((s,l) => s + l.cost, 0);
    const nPicked = sec.items.filter(x => state.picks[x[0]]).length;
    return collapsible('a-' + sec.key, sec.key, sec.title, sum ? `${nPicked} picked · ${fmt0(sum)}` : `${sec.items.length} items`, nPicked > 0, sec.note, sec.items.map(a => menuItem(ITEMS[a[0]], B.hc)));
  })));
}
function avOrderText(){
  const B = budget(), S = state.settings, out = ['Hillar Moore Election Night Event (ref M-WQ83ATW), Tue Nov 3, Salon 1, Renaissance Baton Rouge', 'Draft AV order from the Encore 2026 price sheet', ''];
  if (!B.avLines.length) out.push('(No AV picked yet.)');
  for (const sec of AV_MENU){
    const ls = B.avLines.filter(l => l.item.sec === sec.key); if (!ls.length) continue;
    out.push(sec.title); ls.forEach(l => out.push(`- ${l.item.name}: ${nf.format(l.qty)} ${qtyUnit(l.item, l.qty)} (${fmt0(l.cost)})`)); out.push('');
  }
  if (S.layout) out.push(`Floor plan: ${LAYOUT_NAMES[S.layout]}.`);
  out.push(`Estimated AV: ${fmt0(B.av)} before service and tax.`, '', 'Questions: What does each package include? Is setup or technician labor extra? Can uplights do purple and red?');
  return out.join('\n');
}
function buildAvSheet(){
  const B = budget(), S = state.settings, out = [], logo = $('.plate img');
  out.push(h('div',{class:'ps-head'},
    h('div',null, h('p',{class:'ps-title'}, 'AV order'),
      h('p',{class:'ps-meta'}, 'Hillar Moore Election Night Event · Ref M-WQ83ATW · Tuesday, Nov 3, 2026 · Renaissance Baton Rouge, Salon 1'),
      h('p',{class:'ps-meta'}, `From the Encore 2026 price sheet · ${S.layout ? LAYOUT_NAMES[S.layout] + ' · ' : ''}Prepared ${fmtDate(todayISO(), {year:'numeric'})}`)),
    logo ? h('img',{class:'ps-logo', src:logo.src, alt:'Hillar Moore DA'}) : null));
  for (const sec of AV_MENU){
    const ls = B.avLines.filter(l => l.item.sec === sec.key); if (!ls.length) continue;
    out.push(h('h2',{class:'ps-sec'}, sec.title));
    out.push(psTable(ls.map(l => psRow([l.item.name, l.item.desc, `${nf.format(l.qty)} ${qtyUnit(l.item, l.qty)}`, priceLabel(l.item), fmt0(l.cost)], true))));
  }
  const line = (l, v, cls) => h('div',{class:cls || null}, h('span',null,l), h('span',null,v));
  out.push(h('div',{class:'ps-sum'}, line('AV', fmt2(B.av)), line('Service charge 24%', fmt2(B.av*SVC)), line('Sales tax 12.5%', fmt2(B.av*(1+SVC)*TAX)), line('Estimated AV total', fmt2(B.av*HOTEL_K), 'tot')));
  out.push(h('p',{class:'ps-note'}, 'Estimate only. Encore prices are subject to change; labor may apply to some packages. Contact: Jacob A. Quebedeaux, Director of Event Technology, Jacob.Quebedeaux@EncoreGlobal.com, (225) 388-5694.'));
  return out;
}
let avMigrated = false;
function migrateAvPlaceholders(){
  // The AV tab replaces the two $0 placeholder cost lines from the first version.
  if (avMigrated || !canWrite()) return; avMigrated = true;
  ['av-projectors','av-band'].forEach(id => {
    const e = state.expenses.find(x => x.id === id);
    if (e && e.amount === 0 && e.status === 'estimate' && e.cat === 'av') db.doc('expenses/' + id).delete().catch(() => {});
  });
}

/* ---------- budget ---------- */
function rl(label, amount, cls){ return h('div',{class:'rl' + (cls ? ' ' + cls : '')}, h('span',{class:'lab'}, label), h('span',{class:'dots','aria-hidden':'true'}), h('span',{class:'amt'}, amount)); }
function renderBudget(){
  noteFor('#budgetNote');
  const B = budget(), S = state.settings, st = stats();
  const on = state.dbStatus === 'on' && state.loaded.picks && state.loaded.expenses && state.loaded.settings;
  $('#bAll').textContent = on ? fmt0(B.all) : '--';
  $('#bPer').textContent = on ? `${fmt0(B.perGuest)} per guest across ${nf.format(B.hc)} (about ${nf.format(B.peak)} at once) · hotel ${fmt0(B.hotelTotal)} + outside ${fmt0(B.outsideSum)}` : '';
  const cb = $('#capBar'), cm = $('#capMsg'), rm = $('#roomMsg');
  if (on && (B.cap > 0 || B.target > 0)){
    const top = B.cap > 0 ? B.cap : B.target, lvl = budgetLevel(B);
    cb.hidden = false; cb.classList.toggle('over', lvl === 'over'); cb.classList.toggle('warn', lvl === 'warn');
    cb.querySelector('i').style.width = Math.min(100, B.all/top*100) + '%';
    const tm = cb.querySelector('.tmark'); tm.hidden = !(B.target > 0 && B.cap > B.target); tm.style.left = (B.target/top*100) + '%';
    cm.className = 'cap-msg ' + lvl; cm.textContent = budgetStatus(B, false); rm.textContent = roomText(B);
  } else { cb.hidden = true; cm.className = 'cap-msg'; cm.textContent = on ? 'Set a target and ceiling to track against them.' : ''; rm.textContent = ''; }
  setIfIdle($('#hcBudget'), B.hc); setIfIdle($('#peakBudget'), B.peak); setIfIdle($('#capInput'), B.cap > 0 ? B.cap : ''); setIfIdle($('#targetInput'), B.target > 0 ? B.target : '');
  const gc = st.confirmed + st.maybe;
  $('#useGuests').textContent = `Use the guest list (${nf.format(gc)} coming or maybe)`;
  $('#receipt').replaceChildren(...[
    h('div',{class:'rc-head'}, h('b',null,'BANQUET CHECK · ESTIMATE'), h('span',null,'Renaissance Baton Rouge · M-WQ83ATW'), h('span',null,`Tue, Nov 3 · ${nf.format(B.hc)} guests, about ${nf.format(B.peak)} at once`)),
    ...checkLines(B).map(([l, v, cls]) => rl(l, v, cls)),
    h('p',{class:'rc-note'}, 'Tax applies on top of the service charge, which matches how the hotel figured the $767.30 deposit. With nothing picked, this shows the contract minimum: $7,672.50. Final numbers come from the signed event order.')].filter(Boolean));
  const box = $('#exList');
  withFocus(box, () => box.replaceChildren(...buildExpenses(B)));
}
function checkLines(B){
  const foodN = B.lines.filter(l => l.item.kind === 'food').length, unpricedHotel = B.hotelExp.filter(e => !(e.amount > 0)).length;
  return [
    [`Food (${foodN} ${plural(foodN,'item','items')})`, fmt2(B.food)],
    [B.plan.openN ? (B.plan.basis === 'package' ? `Open bar (${B.plan.tier.label.toLowerCase()} package) & drinks` : 'Open bar (per drink, est.) & drinks') : 'Bar & drinks', fmt2(B.bar)],
    [planText(), '', 'sub'],
    ['Food & drink subtotal', fmt2(B.fb), 'tot'],
    B.shortfall > 0 ? ['Short of $5,000 minimum, billed as rental', fmt2(B.shortfall), 'bad'] : ['$5,000 minimum', 'Met', 'good'],
    B.att + B.carve > 0 ? ['Attendants & carvers', fmt2(B.att + B.carve)] : null,
    B.btFee > 0 ? [`Bartenders (${B.bartenders} × ${B.btHours} hr)`, fmt2(B.btFee)] : null,
    B.cashFee > 0 ? [`Cashier${B.cashiers === 1 ? '' : 's'} (${B.cashiers} × ${B.plan.cashN} hr)`, fmt2(B.cashFee)] : null,
    ['Kullman Boardroom', fmt2(BOARDROOM)],
    ['Salon 1 + holding suite', 'Waived', 'good'],
    [`AV, Encore (${B.avLines.length} ${plural(B.avLines.length,'item','items')})`, fmt2(B.av)],
    B.hotelExp.length ? [`Other hotel charges${unpricedHotel ? ` (${unpricedHotel} unpriced)` : ''}`, fmt2(B.hotelExpSum), unpricedHotel ? 'bad' : ''] : null,
    ['Subtotal', fmt2(B.sub), 'tot'],
    ['Service charge 24%', fmt2(B.svc)],
    ['Sales tax 12.5%', fmt2(B.tax)],
    ['Hotel total', fmt2(B.hotelTotal), 'tot big'],
    ['Deposit paid Oct 6', '−' + fmt2(DEPOSIT), 'good'],
    ['Balance to the hotel', fmt2(B.balance), 'tot'],
    [`Outside the hotel (${B.outside.length} ${plural(B.outside.length,'line','lines')})`, fmt2(B.outsideSum)],
    ['All-in', fmt2(B.all), 'tot big'],
  ].filter(Boolean);
}

/* Internal budget printout: summary, banquet check, every line behind it, and outside costs. */
function buildBudgetSheet(){
  const B = budget(), S = state.settings, out = [], logo = $('.plate img');
  out.push(h('div',{class:'ps-head'},
    h('div',null, h('p',{class:'ps-title'}, 'Watch party budget'),
      h('p',{class:'ps-meta'}, 'Hillar Moore Election Night Event · Ref M-WQ83ATW · Tuesday, Nov 3, 2026 · Renaissance Baton Rouge, Salon 1'),
      h('p',{class:'ps-meta'}, `Planning for ${nf.format(B.hc)} guests through the night, about ${nf.format(B.peak)} at once · Prepared ${fmtDate(todayISO(), {year:'numeric'})}`),
      h('p',{class:'ps-tag'}, 'Internal planning estimate · not for the hotel')),
    logo ? h('img',{class:'ps-logo', src:logo.src, alt:'Hillar Moore DA'}) : null));
  const kpi = (label, value, sub) => h('div',{class:'ps-kpi'}, h('span',{class:'k-l'}, label), h('span',{class:'k-v'}, value), sub ? h('span',{class:'k-s'}, sub) : null);
  const status = (B.cap > 0 || B.target > 0) ? budgetStatus(B, false) : 'No target or ceiling set';
  out.push(h('div',{class:'ps-kpis'},
    kpi('All-in estimate', fmt0(B.all), status),
    kpi('Hotel total', fmt0(B.hotelTotal), `${fmt0(B.balance)} after the deposit`),
    kpi('Outside the hotel', fmt0(B.outsideSum), `${B.outside.length} ${plural(B.outside.length,'line','lines')}`),
    kpi('Per guest', fmt0(B.perGuest), `across ${nf.format(B.hc)} guests`)));
  if (B.target > 0 || B.cap > 0) out.push(h('p',{class:'ps-meta ps-budgetline'},
    [B.target > 0 ? `Target ${fmt0(B.target)}` : '', B.cap > 0 ? `Ceiling ${fmt0(B.cap)}` : ''].filter(Boolean).join(' · ') + '. ' + (roomText(B).split('. Every')[0] || '') + (roomText(B) ? '.' : '')));
  const line = ([l, v, cls]) => h('div',{class:cls || null}, h('span',null,l), h('span',null,v));
  out.push(h('h2',{class:'ps-sec'}, 'Hotel banquet check (estimate)'));
  out.push(h('div',{class:'ps-sum full'}, checkLines(B).map(line)));
  const fbRows = [];
  for (const sec of MENU){
    if (sec.special){
      const L = B.plan;
      if (L.openN || L.cashN) fbRows.push(psRow([`Bar plan: ${planText()}`, L.openN ? (L.basis === 'package' ? `${L.tier.label} package, $${L.price} × ${nf.format(L.billed)} guests` : `Open bar per drink, about ${nf.format(Math.round(L.drinksEst))} drinks` + (S.bar.cap > 0 ? `, capped at ${fmt0(S.bar.cap)}` : '')) : 'Guests pay at the cash bar', '', '', fmt0(L.cost)], true));
      continue;
    }
    B.lines.filter(l => l.item.sec === sec.key).forEach(l => fbRows.push(psRow([l.item.name, sec.title, `${nf.format(l.qty)} ${qtyUnit(l.item, l.qty)}`, priceLabel(l.item), fmt0(l.cost)], true)));
  }
  if (B.att + B.carve) fbRows.push(psRow(['Attendants & carvers', '$100 each', '', '', fmt0(B.att + B.carve)], true));
  if (B.btFee) fbRows.push(psRow(['Bartenders', `${B.bartenders} × ${B.btHours} hours`, '', `${fmt0(staffFee(B.btHours))} each`, fmt0(B.btFee)], true));
  if (B.cashFee) fbRows.push(psRow(['Cashiers', `${B.cashiers} × ${B.plan.cashN} hours`, '', `${fmt0(staffFee(B.plan.cashN))} each`, fmt0(B.cashFee)], true));
  out.push(h('h2',{class:'ps-sec'}, 'Food, drink & bar staff'));
  out.push(fbRows.length ? psTable(fbRows) : h('p',{class:'ps-meta'}, 'Nothing picked yet. The $5,000 minimum applies either way.'));
  out.push(h('h2',{class:'ps-sec'}, 'AV (Encore)'));
  out.push(B.avLines.length ? psTable(B.avLines.map(l => psRow([l.item.name, AV_MENU.find(s => s.key === l.item.sec).title, `${nf.format(l.qty)} ${qtyUnit(l.item, l.qty)}`, priceLabel(l.item), fmt0(l.cost)], true)))
    : h('p',{class:'ps-meta'}, 'No AV picked yet.'));
  const allExp = B.hotelExp.concat(B.outside);
  out.push(h('h2',{class:'ps-sec'}, 'Other costs'));
  out.push(allExp.length ? psTable(allExp.map(e => {
    const st = EXP_STATUS.find(s => s.key === e.status);
    return psRow([e.label, [catOf(e.cat).label + (catOf(e.cat).hotel ? ' (billed by the hotel)' : ''), st ? st.label : '', e.vendor, e.notes].filter(Boolean).join(' · '), '', '', e.amount > 0 ? fmt0(e.amount) : 'Needs a number'], e.amount > 0);
  })) : h('p',{class:'ps-meta'}, 'No other costs yet.'));
  out.push(h('p',{class:'ps-note'}, 'Hotel charges get a 24% service charge, then 12.5% sales tax on both, which matches how the hotel figured the $767.30 deposit. The $5,000 food and drink minimum excludes AV and staff fees; any shortfall is billed as room rental. Encore and menu prices are 2026 rates and subject to change. Final hotel numbers come from the signed event order.'));
  return out;
}
function buildExpenses(B){
  if (state.dbStatus === 'off') return [emptyCard('Budget lines live in Claude', 'Open this page in Claude while signed in to add costs.')];
  if (state.dbStatus === 'pending' || !state.loaded.expenses) return [emptyCard('Loading costs', 'Line items appear here in a moment.')];
  if (!state.expenses.length) return [emptyCard('No costs yet', 'Add balloons, the band, AV and anything else below.')];
  const sort = (a,b) => a.order - b.order || a.label.localeCompare(b.label);
  const priced = state.expenses.filter(e => e.amount > 0).length;
  const out = [h('p',{class:'hint', style:'margin:10px 0 0'}, h('b',null, `${priced} of ${state.expenses.length}`), ' lines have a number.')];
  const groups = [['Billed by the hotel', B.hotelExp, `${fmt0(B.hotelExpSum)} before service and tax`], ['Outside the hotel', B.outside, fmt0(B.outsideSum)]];
  for (const [title, list, total] of groups){
    if (!list.length) continue;
    out.push(h('div',{class:'ex-h'}, h('h3',null,title), h('span',null,total)));
    out.push(h('ul',{class:'ex-list'}, list.slice().sort(sort).map(exRow)));
  }
  return out;
}
function exRow(e){
  const ro = !canWrite(), armed = state.confirm === 'exp:' + e.id, stt = EXP_STATUS.find(s => s.key === e.status);
  const sub = [e.vendor, e.notes].filter(Boolean).join(' · ');
  return h('li',{class:'ex'},
    h('div',{class:'ex-main'}, h('div',{class:'ex-name'}, e.label), sub ? h('div',{class:'ex-sub'}, sub) : null, e.amount > 0 ? null : h('span',{class:'need'}, 'Needs a number')),
    h('select',{'aria-label':'Category for ' + e.label, 'data-fk':'xc-'+e.id, disabled:ro, onchange:ev => updateExp(e.id, {cat:ev.target.value})},
      EXP_CATS.map(c => h('option',{value:c.key, selected:c.key === e.cat}, c.label))),
    h('input',{type:'number', min:0, step:1, value:e.amount > 0 ? e.amount : '', placeholder:'$0', inputmode:'decimal', 'aria-label':'Amount for ' + e.label, 'data-fk':'xa-'+e.id, disabled:ro,
      onchange:ev => updateExp(e.id, {amount:Math.max(0, Math.round(num(ev.target.value,0)*100)/100)})}),
    h('select',{class:'pill ' + stt.pill, 'aria-label':'Status for ' + e.label, 'data-fk':'xs-'+e.id, disabled:ro, onchange:ev => updateExp(e.id, {status:ev.target.value})},
      EXP_STATUS.map(s => h('option',{value:s.key, selected:s.key === e.status}, s.label))),
    ro ? h('span') : h('button',{type:'button', class:'linkbtn red', 'data-fk':'xr-'+e.id, onclick:() => armed ? removeExp(e.id) : arm('exp:' + e.id)}, armed ? 'Confirm remove' : 'Remove'));
}

/* ---------- writes ---------- */
function writeFail(e){
  const code = e && e.code;
  if (code === 'invalid_argument' || code === 'not_granted'){
    state.readOnly = true; renderAll();
    toast("Can't save", 'This view is read-only. Ask Josh for Contributor or Editor access.');
  } else if (code === 'quota_exceeded') toast('Storage is full', 'Remove some entries, then try again.');
  else if (code === 'resource_exhausted') toast('Slow down a moment', 'Too many changes at once. Try again in a few seconds.');
  else toast("Couldn't save", 'Check your connection and try again.');
}
async function guarded(key, fn){
  if (!canWrite() || pending.has(key)) return false;
  pending.add(key);
  try { await fn(); return true; } catch(e){ writeFail(e); return false; } finally { pending.delete(key); }
}
async function toggleTask(id, el){
  const t = state.tasks.find(x => x.id === id); if (!t || !canWrite() || pending.has('t:'+id)) return;
  const done = !t.done;
  if (done){
    mine.add(id);
    const r = el && el.getBoundingClientRect();
    if (r) confetti.burst(r.left + r.width/2, r.top + r.height/2, 34, .8);
    toast(`+${t.votes} votes`, t.title);
  }
  const ok = await guarded('t:'+id, () => db.doc('tasks/' + id).update({done, doneBy:done ? meId() : null, doneAt:done ? nowISO() : null}));
  if (!ok) mine.delete(id);
}
function announceRemote(t){
  if (state.mode === 'local') return;
  const tpl = '{n} checked off';
  toast(tpl.replace('{n}', t.doneBy && state.names[t.doneBy] ? state.names[t.doneBy] : 'A teammate'), `${t.title} · +${t.votes} votes`);
  confetti.burst(innerWidth/2, 60, 26, .7);
}
async function removeTask(id){ state.confirm = null; await guarded('t:'+id, () => db.doc('tasks/' + id).delete()); }
async function addTask(ev){
  ev.preventDefault(); if (!canWrite()) return;
  const title = $('#tfTitle').value.trim().slice(0,120); if (!title){ $('#tfTitle').focus(); return; }
  const due = $('#tfDue').value;
  const doc = {title, detail:'', stream:$('#tfStream').value, due:isISO(due) ? due : null, votes:num($('#tfVotes').value,20),
    done:false, doneBy:null, doneAt:null, custom:true, order:1000 + state.tasks.length, addedBy:meId()};
  const ok = await guarded('newtask', () => db.collection('tasks').add(doc));
  if (ok){ $('#tfTitle').value = ''; $('#tfDue').value = ''; toast('Added to the board', title); $('#tfTitle').focus(); }
}
async function toggleItem(id, el){
  const it = state.checklist.find(x => x.id === id); if (!it || !canWrite() || pending.has('c:'+id)) return;
  const done = !it.done;
  if (done){
    mine.add(id);
    const r = el && el.getBoundingClientRect();
    if (r) confetti.burst(r.left + r.width/2, r.top + r.height/2, 34, .8);
    const left = state.checklist.filter(x => x.list === it.list && !x.done && x.id !== id).length;
    if (left === 0){ toast(`${listOf(it.list).label}: all crossed off`, `+${it.votes} votes · ${it.title}`); setTimeout(() => confetti.rain(), 250); }
    else toast(`+${it.votes} votes`, it.title);
  }
  const ok = await guarded('c:'+id, () => db.doc('checklist/' + id).update({done, doneBy:done ? meId() : null, doneAt:done ? nowISO() : null}));
  if (!ok) mine.delete(id);
}
async function announceRemoteItem(it){
  if (state.mode === 'local') return;
  if (it.doneBy && !state.names[it.doneBy]) await resolveNames([it.doneBy]);
  toast(`${it.doneBy && state.names[it.doneBy] ? state.names[it.doneBy] : 'A teammate'} crossed off`, `${it.title} · +${it.votes} votes`);
  confetti.burst(innerWidth/2, 60, 26, .7);
}
function itemFields(src){
  const title = (src.title || '').trim().slice(0,140);
  const time = TIME_RE.test(src.time || '') ? src.time : null;
  return {title, list:CHECK_LISTS.some(l => l.key === src.list) ? src.list : 'lead', time,
    who:(src.who || '').trim().slice(0,40), notes:(src.notes || '').trim().slice(0,200), votes:clamp(Math.round(num(src.votes,20)),0,100)};
}
async function addItem(ev){
  ev.preventDefault(); if (!canWrite()) return;
  const f = itemFields({title:$('#cfTitle').value, list:$('#cfList').value, time:$('#cfTime').value, who:$('#cfWho').value, notes:$('#cfNotes').value, votes:$('#cfVotes').value});
  if (!f.title){ $('#cfTitle').focus(); return; }
  const doc = Object.assign(f, {done:false, doneBy:null, doneAt:null, order:1000 + state.checklist.length, addedBy:meId(), addedAt:nowISO()});
  const ok = await guarded('newitem', () => db.collection('checklist').add(doc));
  if (!ok) return;
  ['#cfTitle','#cfTime','#cfNotes'].forEach(s => { $(s).value = ''; });
  // Make sure the new item is visible.
  if (state.clView !== 'all' && state.clView !== f.list) state.clView = f.list;
  if (state.clWho && !clMatchWho(f)) state.clWho = '';
  savePrefs(); dirty.add('list');
  toast(`Added to ${listOf(f.list).label}`, f.time ? `${fmtTime(f.time)} · ${f.title}` : f.title);
  $('#cfTitle').focus();
}
async function saveItem(id){
  const d = state.clDrafts[id]; if (!d) return;
  const f = itemFields(d);
  if (!f.title){ toast('Name needed', 'Say what the item is before saving.'); return; }
  const ok = await guarded('c:'+id, () => db.doc('checklist/' + id).update(f));
  if (ok) closeClEdit(id);
}
async function removeItem(id){
  state.confirm = null;
  const ok = await guarded('c:'+id, () => db.doc('checklist/' + id).delete());
  if (ok) closeClEdit(id);
}
async function updateGuest(id, patch){ await guarded('g:'+id, () => db.doc('guests/' + id).update(patch)); }
async function saveGuest(id){
  const d = state.drafts[id]; if (!d) return;
  const name = (d.name || '').trim().slice(0,80); if (!name){ toast('Name needed', 'Add a name before saving.'); return; }
  const ok = await guarded('g:'+id, () => db.doc('guests/' + id).update({name, group:d.group, contact:(d.contact||'').trim().slice(0,120), notes:(d.notes||'').trim().slice(0,200)}));
  if (ok){ delete state.drafts[id]; state.editing = null; dirty.add('guests'); schedule(); }
}
async function removeGuest(id){
  state.confirm = null;
  const ok = await guarded('g:'+id, () => db.doc('guests/' + id).delete());
  if (ok){ delete state.drafts[id]; state.editing = null; dirty.add('guests'); schedule(); }
}
async function addGuest(ev){
  ev.preventDefault(); if (!canWrite()) return;
  const name = $('#gfName').value.trim().slice(0,80); if (!name){ $('#gfName').focus(); return; }
  if (state.guests.some(g => g.name.toLowerCase() === name.toLowerCase())){ toast('Already on the list', name); return; }
  const doc = {name, group:$('#gfGroup').value, status:$('#gfStatus').value, plusOnes:clamp(Math.round(num($('#gfPlus').value,0)),0,5),
    contact:$('#gfContact').value.trim().slice(0,120), notes:$('#gfNotes').value.trim().slice(0,200), addedBy:meId(), addedAt:nowISO()};
  const ok = await guarded('newguest', () => db.collection('guests').add(doc));
  if (ok){ ['#gfName','#gfContact','#gfNotes'].forEach(s => { $(s).value = ''; }); $('#gfPlus').value = '0'; toast('Added to the list', name); $('#gfName').focus(); }
}
async function pasteGuests(){
  if (!canWrite() || pending.has('paste')) return;
  const lines = $('#pasteText').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length){ toast('Nothing to add', 'Paste at least one name.'); return; }
  pending.add('paste'); const btn = $('#pasteBtn'); btn.disabled = true;
  const seen = new Set(state.guests.map(g => g.name.toLowerCase()));
  let added = 0, skipped = 0, stopped = false; const left = [];
  for (const line of lines.slice(0,150)){
    const i = line.indexOf(','); const name = (i >= 0 ? line.slice(0,i) : line).trim().slice(0,80);
    const grp = matchGroup(i >= 0 ? line.slice(i+1) : '') || $('#gfGroup').value;
    if (!name || seen.has(name.toLowerCase())){ skipped++; continue; }
    if (stopped){ left.push(line); continue; }
    try {
      await db.collection('guests').add({name, group:grp, status:$('#gfStatus').value, plusOnes:0, contact:'', notes:'', addedBy:meId(), addedAt:nowISO()});
      seen.add(name.toLowerCase()); added++;
    } catch(e){ stopped = true; left.push(line); if (e && e.code !== 'resource_exhausted') writeFail(e); }
  }
  pending.delete('paste'); btn.disabled = !canWrite();
  $('#pasteText').value = left.concat(lines.slice(150)).join('\n');
  toast(`Added ${added} ${plural(added,'guest','guests')}`, [skipped ? `${skipped} already on the list` : '', left.length ? 'The rest are still in the box; try again in a minute.' : ''].filter(Boolean).join(' · '));
  if (added >= 10) confetti.burst(innerWidth/2, innerHeight*.4, 50, 1);
}
async function togglePick(id){
  const it = ITEMS[id]; if (!it) return;
  if (state.picks[id]) await guarded('p:'+id, () => db.doc('picks/' + id).delete());
  else {
    const ok = await guarded('p:'+id, () => db.doc('picks/' + id).set({qty:defaultQty(it, state.settings.headcount), follow:it.unit === 'pp' && !it.def, by:meId(), at:nowISO()}));
    if (ok) toast('Added to the menu', it.name);
  }
}
async function setPickQty(id, val){
  const it = ITEMS[id]; if (!it || !state.picks[id]) return;
  let q = Math.round(num(val, 0));
  if (q <= 0){ await guarded('p:'+id, () => db.doc('picks/' + id).delete()); return; }
  if (it.unit === 'pc50'){ const r = Math.max(50, Math.ceil(q/50)*50); if (r !== q) toast('Rounded to 50s', `${it.name} is sold by 50 pieces: ${r}.`); q = r; }
  await guarded('p:'+id, () => db.doc('picks/' + id).update({qty:q, follow:false}));
}
async function followPick(id){ await guarded('p:'+id, () => db.doc('picks/' + id).update({follow:true})); }
function saveSettings(patch){
  if (!canWrite()) return;
  state.settings = cleanSettings(Object.assign({}, state.settings, patch));
  settingsDirty = true; changed('menu','budget','room');
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const body = Object.assign({}, state.settings);
    settingsChain = settingsChain.then(() => db.doc('settings/budget').set(body)).catch(writeFail).then(() => { settingsDirty = false; });
  }, 450);
}
async function updateExp(id, patch){ await guarded('x:'+id, () => db.doc('expenses/' + id).update(patch)); }
async function removeExp(id){ state.confirm = null; await guarded('x:'+id, () => db.doc('expenses/' + id).delete()); }
async function addExp(ev){
  ev.preventDefault(); if (!canWrite()) return;
  const label = $('#efLabel').value.trim().slice(0,80); if (!label){ $('#efLabel').focus(); return; }
  const doc = {label, cat:$('#efCat').value, amount:Math.max(0, Math.round(num($('#efAmt').value,0)*100)/100), status:$('#efStatus').value,
    vendor:$('#efVendor').value.trim().slice(0,80), notes:$('#efNotes').value.trim().slice(0,200), order:1000 + state.expenses.length, addedBy:meId(), addedAt:nowISO()};
  const ok = await guarded('newexp', () => db.collection('expenses').add(doc));
  if (ok){ ['#efLabel','#efAmt','#efVendor','#efNotes'].forEach(s => { $(s).value = ''; }); toast('Added to the budget', label); $('#efLabel').focus(); }
}

/* ---------- static UI ---------- */
function opt(list, sel){ return list.map(x => h('option',{value:x.key, selected:x.key === sel}, x.label)); }
function fillStatic(){
  $('#tfStream').replaceChildren(...opt(STREAMS,'night'));
  $('#cfList').replaceChildren(...opt(CHECK_LISTS,'lead'));
  $('#gfGroup').replaceChildren(...opt(GROUPS,'friends'));
  $('#gfStatus').replaceChildren(...opt(STATUSES,'todo'));
  $('#gGroupF').replaceChildren(h('option',{value:''},'All groups'), ...opt(GROUPS));
  $('#efCat').replaceChildren(...opt(EXP_CATS,'decor'));
  $('#efStatus').replaceChildren(...opt(EXP_STATUS,'estimate'));
  $('#mJump').replaceChildren(...MENU.map(s => h('button',{type:'button', class:'chip', onclick:() => openSection(s.key, 'm-' + s.key)}, s.title.replace("Hors d'oeuvres · ","Hors d'oeuvres, ").replace('Bar · ','Bar, '))));
  const box = $('#contacts');
  CONTACTS.forEach(c => box.append(h('div',{class:'contact'}, h('span',{class:'who'}, c.who), h('span',{class:'role'}, c.role),
    c.vals.map(v => { const span = h('span',null,v); return h('div',{class:'cv'}, span, h('button',{type:'button', class:'linkbtn', onclick:() => copyText(v, v, span)}, 'Copy')); }))));
}
function applyTab(){
  TABS.forEach(t => { const b = $('#tab-' + t), p = $('#p-' + t), on = t === state.tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; p.hidden = !on; });
}
function setTab(t, focus){
  if (!TABS.includes(t)) return;
  state.tab = t; applyTab(); savePrefs(); if (focus) $('#tab-' + t).focus(); schedule();
}
function bindStatic(){
  $$('.tabs button').forEach(b => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      const i = TABS.indexOf(b.dataset.tab);
      if (e.key === 'ArrowRight'){ e.preventDefault(); setTab(TABS[(i+1) % TABS.length], true); }
      if (e.key === 'ArrowLeft'){ e.preventDefault(); setTab(TABS[(i-1+TABS.length) % TABS.length], true); }
    });
  });
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.goto); $('.tabs').scrollIntoView({behavior:reduceMotion() ? 'auto' : 'smooth'}); }));
  $$('#p-board .board-head .seg button').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; savePrefs(); dirty.add('board'); schedule(); }));
  $('#hideDone').addEventListener('change', e => { state.hideDone = e.target.checked; savePrefs(); dirty.add('board'); schedule(); });
  $('#addTaskBtn').addEventListener('click', () => { const f = $('#taskForm'); f.hidden = !f.hidden; $('#addTaskBtn').setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('#tfTitle').focus(); });
  $('#tfCancel').addEventListener('click', () => { $('#taskForm').hidden = true; $('#addTaskBtn').setAttribute('aria-expanded','false'); });
  $('#taskForm').addEventListener('submit', addTask);
  $$('#clView button').forEach(b => b.addEventListener('click', () => { state.clView = b.dataset.cl; savePrefs(); dirty.add('list'); schedule(); }));
  $('#clHide').addEventListener('change', e => { state.clHide = e.target.checked; savePrefs(); dirty.add('list'); schedule(); });
  $('#clWho').addEventListener('change', e => { state.clWho = e.target.value; savePrefs(); dirty.add('list'); schedule(); });
  $('#clAddBtn').addEventListener('click', () => { if ($('#clForm').hidden) openClForm(state.clView === 'all' ? null : state.clView); else { $('#clForm').hidden = true; $('#clAddBtn').setAttribute('aria-expanded','false'); } });
  $('#cfCancel').addEventListener('click', () => { $('#clForm').hidden = true; $('#clAddBtn').setAttribute('aria-expanded','false'); });
  $('#cfList').addEventListener('change', e => { $('#cfVotes').value = String(listOf(e.target.value).votes); });
  $('#clForm').addEventListener('submit', addItem);
  $('#clList').addEventListener('focusout', () => setTimeout(() => { if (dirty.has('list')) schedule(); }, 0));
  $('#clCopy').addEventListener('click', () => copyText(checklistText(), 'Checklist'));
  if ($('#clPrint')) $('#clPrint').addEventListener('click', () => runPrint(buildChecklistSheet()));
  $('#guestForm').addEventListener('submit', addGuest);
  $('#pasteBtn').addEventListener('click', pasteGuests);
  $('#gSearch').addEventListener('input', () => { dirty.add('guests'); schedule(); });
  $('#gGroupF').addEventListener('change', () => { dirty.add('guests'); schedule(); });
  $('#guestList').addEventListener('focusout', () => setTimeout(() => { if (dirty.has('guests')) schedule(); }, 0));
  $('#copyCount').addEventListener('click', () => copyText(headcountText(), 'Headcount summary'));
  $('#copyList').addEventListener('click', () => copyText(guestListText(), 'Guest list (pastes into a spreadsheet)'));
  $('#mSearch').addEventListener('input', e => { state.mSearch = e.target.value; dirty.add('menu'); schedule(); });
  $('#mPicked').addEventListener('change', e => { state.mPicked = e.target.checked; dirty.add('menu'); schedule(); });
  $('#copyOrder').addEventListener('click', () => copyText(orderText(), 'Menu order'));
  $$('.fp-pick').forEach(b => b.addEventListener('click', () => pickLayout(b.dataset.layout)));
  $('#copyAv').addEventListener('click', () => copyText(avOrderText(), 'AV order'));
  if ($('#printBudget')) $('#printBudget').addEventListener('click', () => runPrint(buildBudgetSheet()));
  $('#menuOpenAll').addEventListener('click', () => setAllSections(MENU.map(s => s.key), true));
  $('#menuCloseAll').addEventListener('click', () => setAllSections(MENU.map(s => s.key), false));
  $('#avOpenAll').addEventListener('click', () => setAllSections(AV_MENU.map(s => s.key), true));
  $('#avCloseAll').addEventListener('click', () => setAllSections(AV_MENU.map(s => s.key), false));
  if ($('#printAv')) $('#printAv').addEventListener('click', () => {
    if (!budget().avLines.length){ toast('No AV picked yet', 'Pick items or load a starter kit first.'); return; }
    runPrint(buildAvSheet());
  });
  if ($('#printPicks')){
    $('#printPicks').addEventListener('click', () => printMenu('picks'));
    $('#printAll').addEventListener('click', () => printMenu('all'));
  }
  ['#hcMenu','#hcBudget'].forEach(s => $(s).addEventListener('change', e => { const v = Math.round(num(e.target.value,0)); if (v >= 1) saveSettings({headcount:v}); }));
  $('#capInput').addEventListener('change', e => saveSettings({cap:num(e.target.value,0)}));
  ['#peakMenu','#peakBudget'].forEach(s => $(s).addEventListener('change', e => saveSettings({peak:e.target.value === '' ? null : Math.round(num(e.target.value,0)) || null})));
  $('#targetInput').addEventListener('change', e => saveSettings({target:num(e.target.value,0)}));
  $('#useGuests').addEventListener('click', () => {
    const st = stats(), n = st.confirmed + st.maybe;
    if (!n){ toast('No RSVPs yet', 'Mark guests as Coming or Maybe on the Guest list tab.'); return; }
    saveSettings({headcount:n}); toast('Planning for ' + nf.format(n), 'Coming plus maybe, including +1s.');
  });
  $('#exForm').addEventListener('submit', addExp);
  if ($('#exportBtn')){
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', e => importData(e.target.files && e.target.files[0]));
    $('#resetBtn').addEventListener('click', resetData);
  }
}
const RENDER = {board:renderBoard, list:renderChecklist, guests:renderGuests, menu:renderMenu, budget:renderBudget, room:renderRoom};

/* ---------- live data ---------- */
function dbErr(e){
  if (e && e.code === 'revoked'){ state.dbStatus = 'off'; renderAll(); return; }
  toast('Live updates paused', 'Reload the page to reconnect.');
}
function subscribe(){
  db.collection('tasks').onSnapshot(snap => {
    const prev = new Map(state.tasks.map(t => [t.id, t])), first = !state.loaded.tasks;
    state.tasks = snap.docs.map(cleanTask); state.loaded.tasks = true;
    if (!first) for (const t of state.tasks){ const p = prev.get(t.id); if (p && !p.done && t.done){ if (mine.has(t.id)) mine.delete(t.id); else announceRemote(t); } }
    changed('board');
  }, dbErr);
  db.collection('checklist').onSnapshot(snap => {
    const prev = new Map(state.checklist.map(t => [t.id, t])), first = !state.loaded.checklist;
    state.checklist = snap.docs.map(cleanItem); state.loaded.checklist = true;
    if (state.clEditing && !state.checklist.some(t => t.id === state.clEditing)){ delete state.clDrafts[state.clEditing]; state.clEditing = null; }
    if (!first) for (const t of state.checklist){ const p = prev.get(t.id); if (p && !p.done && t.done){ if (mine.has(t.id)) mine.delete(t.id); else announceRemoteItem(t); } }
    changed('list');
  }, dbErr);
  db.collection('guests').onSnapshot(snap => { state.guests = snap.docs.map(cleanGuest); state.loaded.guests = true; changed('guests','budget'); }, dbErr);
  db.collection('picks').onSnapshot(snap => { const o = {}; snap.docs.forEach(d => { o[d.id] = cleanPick(d); }); state.picks = o; state.loaded.picks = true; changed('menu','budget','room'); }, dbErr);
  db.collection('expenses').onSnapshot(snap => { state.expenses = snap.docs.map(cleanExp); state.loaded.expenses = true; migrateAvPlaceholders(); changed('budget'); }, dbErr);
  db.doc('settings/budget').onSnapshot(snap => {
    if (!settingsDirty) state.settings = cleanSettings(snap.exists ? snap.data() : {});
    state.loaded.settings = true; changed('menu','budget','room');
  }, dbErr);
}
async function connect(){
  // Inside Claude: use the artifact's shared database. Anywhere else (GitHub Pages, a local file): this browser.
  const c = window.claude;
  if (c && typeof c.use === 'function'){
    let d = null, u = null;
    try { [d, u] = await Promise.all([c.use('db'), c.use('user')]); } catch(e){}
    if (d){
      db = d; user = u; state.mode = 'shared'; state.dbStatus = 'on';
      if (user){
        try { state.me = await user.me(); } catch(e){}
        try { if (await user.can('data.write') === false) state.readOnly = true; } catch(e){}
      }
      subscribe(); renderAll(); renderModeUI(); return;
    }
  }
  if (typeof LocalStore === 'undefined'){ state.dbStatus = 'off'; renderAll(); return; }
  db = LocalStore.open(); state.mode = 'local'; state.dbStatus = 'on';
  subscribe(); renderAll(); renderModeUI();
}

/* ---------- browser-only mode: backup, restore, reset ---------- */
function renderModeUI(){
  const local = state.mode === 'local';
  const tools = $('#dataTools'); if (tools) tools.hidden = !local;
  const pt = $('#printTools'); if (pt) pt.hidden = !local;
  const pa = $('#printAv'); if (pa) pa.hidden = !local;
  const pb = $('#printBudgetTools'); if (pb) pb.hidden = !local;
  const pc = $('#clPrint'); if (pc) pc.hidden = !local;   // the Claude viewer can't open a print window
  const hint = $('#shareHint'); if (hint && local) hint.textContent = 'Saved in this browser. Export a backup at the bottom of the page to move it or share it.';
}
function exportData(){
  try {
    const blob = new Blob([JSON.stringify(LocalStore.dump(), null, 2)], {type:'application/json'});
    const a = h('a', {href:URL.createObjectURL(blob), download:`hm26-watch-party-${todayISO()}.json`});
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Backup saved', a.download);
  } catch(e){ toast("Couldn't export", 'This browser blocked the download.'); }
}
function importData(file){
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const obj = JSON.parse(String(r.result));
      state.quietUntil = Date.now() + 1500; state.editing = null; state.drafts = {};
      LocalStore.replace(obj);
      const n = o => (o && typeof o === 'object') ? Object.keys(o).length : 0;
      toast('Backup imported', `${n(obj.tasks)} to-dos · ${n(obj.checklist)} checklist items · ${n(obj.guests)} guests · ${n(obj.expenses)} costs`);
    } catch(e){ toast("Couldn't import", (e && e.message) || 'That file is not a watch party backup.'); }
    $('#importFile').value = '';
  };
  r.onerror = () => toast("Couldn't import", 'The file could not be read.');
  r.readAsText(file);
}
let resetArmed = 0;
function resetData(){
  const btn = $('#resetBtn');
  if (!resetArmed){
    btn.textContent = 'Click again to erase this browser\'s data';
    resetArmed = setTimeout(() => { resetArmed = 0; btn.textContent = 'Reset to starting data'; }, 4000);
    return;
  }
  clearTimeout(resetArmed); resetArmed = 0; btn.textContent = 'Reset to starting data';
  state.quietUntil = Date.now() + 1500; state.editing = null; state.drafts = {};
  LocalStore.reset(); toast('Reset', 'Back to the starting to-dos, checklist, guests and costs.');
}
function boot(){
  loadPrefs();
  const hash = (location.hash || '').slice(1); if (TABS.includes(hash)) state.tab = hash;
  fillStatic(); bindStatic(); applyTab(); renderSteps(); renderAll(); tickCountdown();
  setInterval(() => { tickCountdown(); if (eventNow() !== null && state.tab === 'list'){ dirty.add('list'); schedule(); } }, 30000);
  connect();
}
boot();

})();
