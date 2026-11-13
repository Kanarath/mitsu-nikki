/* 三つ日記 · Mitsu Nikki
 * Diario nocturno de gratitud. Todo estático: localStorage + sincronización
 * cifrada (AES-GCM) con data.json del repositorio vía la API REST de GitHub.
 */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- Almacenamiento local ---------- */
const LS = { entries: 'mn.entries', cfg: 'mn.cfg', dirty: 'mn.dirty', lastSync: 'mn.lastSync', notified: 'mn.notified' };
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage', e); } },
};

const DEFAULT_CFG = { owner: 'Kanarath', repo: 'mitsu-nikki', branch: 'main', path: 'data.json', token: '', pass: '', notif: false, hour: '21:00' };
let cfg = { ...DEFAULT_CFG, ...store.get(LS.cfg, {}) };
let entries = store.get(LS.entries, {});   // { "2026-11-13": { items: [a,b,c], updated: ISO } }

/* ---------- Fechas ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const fmtLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtShort = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const longDate = k => { const d = fromKey(k); return cap((d.getFullYear() === new Date().getFullYear() ? fmtShort : fmtLong).format(d)); };
const filled = e => (e && Array.isArray(e.items) ? e.items.filter(t => t && t.trim()).length : 0);
const KANJI = ['一', '二', '三'];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Es tarde. Respira hondo';
  if (h < 13) return 'Buenos días, sin prisa';
  if (h < 20) return 'Buenas tardes, un momento para ti';
  return 'Buenas noches, tómate un respiro';
}

/* ---------- Estado de la interfaz ---------- */
let currentKey = todayKey();
let calMonth = new Date(); calMonth.setDate(1);
let selectedKey = null;
let lastStampKey = null;

/* ---------- Avisos ---------- */
let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------- Vista HOY ---------- */
const areas = () => $$('#today-form textarea');

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  ta.closest('.thing').classList.toggle('has-text', !!ta.value.trim());
}

function renderToday() {
  const tk = todayKey();
  if (currentKey > tk) currentKey = tk;
  const isToday = currentKey === tk;
  $('#greeting').textContent = isToday ? greeting() : 'Volviendo a un día pasado';
  $('#date-label').textContent = longDate(currentKey);
  const e = entries[currentKey];
  areas().forEach((ta, i) => { ta.value = e?.items?.[i] ?? ''; autoGrow(ta); });
  $('#next-day').disabled = currentKey >= tk;
  $('#back-today').hidden = isToday;
  $('#save-hint').textContent = '';
}

/** Guarda en localStorage. Devuelve true si cambió algo. */
function saveLocal(k, items) {
  const clean = items.map(t => t.replace(/\s+$/, ''));
  const prev = entries[k];
  if (prev && prev.items.every((t, i) => t === clean[i])) return false;
  if (!prev && clean.every(t => !t.trim())) return false;
  entries[k] = { items: clean, updated: new Date().toISOString() };
  store.set(LS.entries, entries);
  store.set(LS.dirty, true);
  writeSwConfig();
  return true;
}

let draftTimer;
function onType(ev) {
  autoGrow(ev.target);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 500);
}
function flushDraft() {
  clearTimeout(draftTimer);
  return saveLocal(currentKey, areas().map(t => t.value));
}

async function onSave(ev) {
  ev.preventDefault();
  const before = filled(entries[currentKey]);
  flushDraft();
  const after = filled(entries[currentKey]);
  if (after === 3 && before < 3) lastStampKey = currentKey;

  const btn = $('#save-btn');
  btn.classList.remove('guardando'); void btn.offsetWidth;
  btn.classList.add('guardando');
  btn.disabled = true;
  const form = $('#today-form');
  form.classList.add('brilla');

  const [result] = await Promise.all([sync({ quiet: true }), new Promise(r => setTimeout(r, 1100))]);
  btn.classList.remove('guardando');
  btn.disabled = false;
  setTimeout(() => form.classList.remove('brilla'), 600);

  const msgs = {
    ok: 'Guardado y sincronizado ✦',
    local: 'Guardado en este móvil',
    read: 'Guardado en el móvil · sin token no se sube a GitHub',
    offline: 'Guardado · se sincronizará cuando vuelva la conexión',
    error: 'Guardado en el móvil, pero no se pudo sincronizar',
  };
  $('#save-hint').textContent = after === 3 && result !== 'error' ? 'お疲れさま · Tres cosas buenas. Que descanses.' : msgs[result];
  toast(msgs[result], result === 'error' ? 'error' : '');
  if (result === 'error' && lastSyncError) setTimeout(() => toast(lastSyncError, 'error'), 3300);
}

/* ---------- Vista CALENDARIO ---------- */
function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const now = new Date();
  $('#cal-title').textContent = cap(fmtMonth.format(calMonth));
  $('#cal-next').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());

  const grid = $('#cal-grid');
  grid.replaceChildren();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // lunes primero
  const days = new Date(y, m + 1, 0).getDate();
  const tk = todayKey();
  let full = 0, some = 0;

  for (let i = 0; i < offset; i++) grid.append(document.createElement('span'));
  for (let d = 1; d <= days; d++) {
    const k = keyOf(new Date(y, m, d));
    const n = filled(entries[k]);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-day';
    b.dataset.key = k;
    b.innerHTML = `<span class="num">${d}</span>`;
    if (n === 3) { b.classList.add('done'); full++; } else if (n > 0) { b.classList.add('partial'); some++; }
    if (k === lastStampKey) { b.classList.add('pop'); }
    if (k === tk) b.classList.add('today');
    if (k > tk) { b.disabled = true; b.classList.add('future'); }
    if (k === selectedKey) b.classList.add('selected');
    b.setAttribute('aria-label', `${d}: ${n} de 3 cosas buenas`);
    grid.append(b);
  }
  lastStampKey = null;
  $('#cal-stats').textContent = full + some === 0
    ? 'Aún no hay días escritos este mes'
    : `${full} ${full === 1 ? 'día completo' : 'días completos'}${some ? ` · ${some} a medias` : ''}`;
}

function itemsList(e) {
  const ol = document.createElement('ol');
  for (let i = 0; i < 3; i++) {
    const li = document.createElement('li');
    li.dataset.n = KANJI[i];
    const t = e?.items?.[i]?.trim();
    li.textContent = t || 'Sin escribir';
    if (!t) li.classList.add('vacio');
    ol.append(li);
  }
  return ol;
}

function showDayCard(k) {
  selectedKey = k;
  $$('.cal-day').forEach(b => b.classList.toggle('selected', b.dataset.key === k));
  const card = $('#day-card');
  const e = entries[k];
  card.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = longDate(k);
  card.append(h);
  if (filled(e)) card.append(itemsList(e));
  else {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Este día quedó en blanco. Aún puedes recordarlo.';
    card.append(p);
  }
  const row = document.createElement('div');
  row.className = 'row';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'ghost';
  edit.textContent = filled(e) ? 'Editar este día' : 'Escribir este día';
  edit.addEventListener('click', () => { currentKey = k; showView('today'); });
  row.append(edit);
  card.append(row);
  card.hidden = false;
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
}

/* ---------- Omikuji: recuerdo aleatorio ---------- */
let lastOmikuji = null;
function drawOmikuji() {
  const tk = todayKey();
  let pool = Object.keys(entries).filter(k => k < tk && filled(entries[k]) === 3);
  if (!pool.length) pool = Object.keys(entries).filter(k => k <= tk && filled(entries[k]) > 0);
  if (!pool.length) { toast('Aún no hay recuerdos. Vuelve tras unas noches escribiendo.'); return; }
  if (pool.length > 1) pool = pool.filter(k => k !== lastOmikuji);
  const k = pool[Math.floor(Math.random() * pool.length)];
  lastOmikuji = k;
  const luck = ['大吉', '大吉', '吉', '中吉'][Math.floor(Math.random() * 4)];
  $('.slip-luck').textContent = luck;
  $('#omikuji-title').textContent = longDate(k);
  $('#omikuji-items').replaceWith(Object.assign(itemsList(entries[k]), { id: 'omikuji-items', className: 'slip-items' }));
  const dlg = $('#omikuji-dialog');
  if (dlg.open) { const s = $('.slip', dlg); s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }
  else dlg.showModal();
}

/* ---------- Navegación ---------- */
function showView(name) {
  flushDraft();
  $('#view-today').hidden = name !== 'today';
  $('#view-calendar').hidden = name !== 'calendar';
  $$('.tab').forEach(t => {
    const on = t.dataset.view === name;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (name === 'today') renderToday();
  else {
    if (selectedKey) calMonth = (d => (d.setDate(1), d))(fromKey(selectedKey));
    renderCalendar();
    if (selectedKey) showDayCard(selectedKey); else $('#day-card').hidden = true;
  }
  window.scrollTo({ top: 0 });
}

/* ---------- Cifrado (Web Crypto) ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const ITER = 250000;
const toB64 = buf => {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

class SyncError extends Error {}
const keyCache = new Map();
async function deriveKey(pass, salt, iter) {
  const id = `${iter}|${toB64(salt)}|${pass}`;
  if (keyCache.has(id)) return keyCache.get(id);
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyCache.set(id, key);
  return key;
}

async function encryptPayload(obj, pass, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { app: 'mitsu-nikki', v: 1, alg: 'AES-GCM-256', kdf: 'PBKDF2-SHA256', iter: ITER, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) };
}

/** Acepta el data.json inicial ([] o vacío) o el formato cifrado. */
async function decryptPayload(file, pass) {
  if (file == null || (Array.isArray(file) && file.length === 0)) return { entries: {}, salt: null };
  if (file.app !== 'mitsu-nikki' || !file.data) throw new SyncError('data.json no tiene el formato de Mitsu Nikki');
  const key = await deriveKey(pass, fromB64(file.salt), file.iter || ITER);
  let pt;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data)); }
  catch { throw new SyncError('La frase secreta no coincide con la usada en data.json'); }
  return { entries: JSON.parse(dec.decode(pt)).entries || {}, salt: file.salt };
}

/* ---------- Fusión por día (gana la edición más reciente) ---------- */
function merge(local, remote) {
  const out = { ...local };
  let changedLocal = false, needPush = false;
  for (const [k, r] of Object.entries(remote)) {
    const l = out[k];
    if (!l || (r.updated || '') > (l.updated || '')) { out[k] = r; changedLocal = true; }
  }
  for (const [k, l] of Object.entries(local)) {
    const r = remote[k];
    if (!r || (l.updated || '') > (r.updated || '')) needPush = true;
  }
  return { out, changedLocal, needPush };
}

function applyMerged(out) {
  entries = out;
  store.set(LS.entries, entries);
  writeSwConfig();
  if (!$('#view-today').hidden) {
    // No pisar lo que se esté escribiendo ahora mismo
    if (!areas().some(t => t === document.activeElement)) renderToday();
  } else {
    renderCalendar();
    if (selectedKey) showDayCard(selectedKey);
  }
}

/* ---------- API de GitHub ---------- */
const contentsPath = () => cfg.path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner.trim())}/${encodeURIComponent(cfg.repo.trim())}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}
async function ghError(r) {
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch { /* sin cuerpo */ }
  const map = {
    401: 'El token no es válido o ha caducado',
    403: 'El token no tiene permiso de escritura (Contents: Read and write)',
    404: 'No encuentro el repositorio, la rama o el token no tiene acceso a él',
    409: 'Conflicto de versión con GitHub',
    422: 'GitHub rechazó el cambio (conflicto de versión)',
  };
  const e = new SyncError(map[r.status] || `GitHub respondió ${r.status} ${msg}`.trim());
  e.status = r.status;
  return e;
}
async function ghGetFile() {
  const r = await gh(`/contents/${contentsPath()}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`);
  if (r.status === 404) {
    const repo = await gh('');
    if (!repo.ok) throw await ghError(repo);
    return { sha: null, file: null };
  }
  if (!r.ok) throw await ghError(r);
  const j = await r.json();
  const text = dec.decode(fromB64((j.content || '').replace(/\s/g, ''))).trim();
  let file = [];
  if (text) { try { file = JSON.parse(text); } catch { throw new SyncError('data.json en GitHub no es JSON válido'); } }
  return { sha: j.sha, file };
}
async function ghPutFile(file, sha) {
  const body = {
    message: 'Actualiza el diario cifrado',
    content: toB64(enc.encode(JSON.stringify(file, null, 1) + '\n')),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const r = await gh(`/contents/${contentsPath()}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw await ghError(r);
  return r.json();
}

/* ---------- Sincronización ---------- */
function syncMode() {
  if (!cfg.pass) return 'local';
  if (cfg.token.trim() && cfg.owner.trim() && cfg.repo.trim()) return 'write';
  return 'read';
}

let syncing = null;
let lastSyncError = '';
function sync(opts) {
  if (!syncing) syncing = doSync(opts).finally(() => { syncing = null; });
  return syncing;
}

async function doSync({ quiet = false } = {}) {
  const mode = syncMode();
  if (mode === 'local') { setStatus('local'); return 'local'; }
  if (!navigator.onLine) { setStatus('offline'); return 'offline'; }
  setStatus('syncing');
  try {
    if (mode === 'read') {
      // Sin token: se lee el data.json público de la propia web (solo lectura)
      const r = await fetch(`./${cfg.path.replace(/^\/+/, '')}?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) {
        const { entries: rem } = await decryptPayload(await r.json(), cfg.pass);
        const m = merge(entries, rem);
        if (m.changedLocal) applyMerged(m.out);
      }
      setStatus('read');
      return 'read';
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, file } = await ghGetFile();
      const { entries: rem, salt } = await decryptPayload(file, cfg.pass);
      const m = merge(entries, rem);
      if (m.changedLocal) applyMerged(m.out);
      if (!m.needPush) break;
      const payload = await encryptPayload({ entries: m.out }, cfg.pass, salt);
      try { await ghPutFile(payload, sha); break; }
      catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
    }
    store.set(LS.dirty, false);
    store.set(LS.lastSync, new Date().toISOString());
    setStatus('ok');
    return 'ok';
  } catch (e) {
    console.error(e);
    lastSyncError = e instanceof SyncError ? e.message : 'Sin conexión con GitHub';
    setStatus('error', lastSyncError);
    if (!quiet) toast(lastSyncError, 'error');
    return 'error';
  }
}

function setStatus(state, detail = '') {
  $('#sync-dot').dataset.state = state;
  const last = store.get(LS.lastSync, null);
  const when = last ? new Date(last).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const texts = {
    local: cfg.token ? 'Falta la frase secreta: sin ella no se sube nada a GitHub' : 'Solo en este móvil (sin sincronizar)',
    syncing: 'Sincronizando…',
    ok: `Sincronizado con GitHub${when ? ' · ' + when : ''}`,
    read: 'Solo lectura: se lee data.json, pero sin token no se sube nada',
    offline: 'Sin conexión: se sincronizará al volver',
    error: `Error: ${detail}`,
  };
  const line = $('#sync-status');
  line.textContent = texts[state];
  line.dataset.state = state;
  $('#open-settings').title = texts[state];
}

/* ---------- Configuración ---------- */
const sForm = () => $('#settings-form');
function fillSettings() {
  const f = sForm();
  for (const k of ['owner', 'repo', 'branch', 'path', 'token', 'pass']) f.elements[k].value = cfg[k];
  f.elements.notif.checked = cfg.notif && 'Notification' in window && Notification.permission === 'granted';
  f.elements.hour.value = cfg.hour;
  $('#gcal-link').href = googleCalUrl();
}
function readSettings() {
  const f = sForm();
  const next = { ...cfg };
  for (const k of ['owner', 'repo', 'branch', 'path', 'token']) next[k] = f.elements[k].value.trim();
  next.pass = f.elements.pass.value;
  next.branch ||= 'main';
  next.path ||= 'data.json';
  next.hour = f.elements.hour.value || '21:00';
  return next;
}
function persistCfg() { store.set(LS.cfg, cfg); }

async function onSaveSettings() {
  const next = readSettings();
  if (next.pass !== cfg.pass || next.token !== cfg.token) keyCache.clear();
  cfg = next;
  persistCfg();
  writeSwConfig();
  scheduleReminder();
  $('#gcal-link').href = googleCalUrl();
  if (cfg.token && !cfg.pass) { setStatus('local'); toast('Añade una frase secreta para poder sincronizar', 'error'); return; }
  const r = await sync();
  if (r === 'ok') toast('Conectado y sincronizado ✦');
  else if (r === 'local') toast('Configuración guardada');
  else if (r === 'read') toast('Guardado · modo solo lectura');
}

async function onTestConnection() {
  const next = readSettings();
  if (!next.token) { toast('Escribe primero el token', 'error'); return; }
  const prev = cfg; cfg = next;
  try {
    setStatus('syncing');
    const r = await gh('');
    if (!r.ok) throw await ghError(r);
    const repo = await r.json();
    if (repo.permissions && !repo.permissions.push) throw new SyncError('El token puede leer pero no escribir en el repositorio');
    const { file } = await ghGetFile();
    if (next.pass) await decryptPayload(file, next.pass);
    toast(next.pass ? 'Conexión correcta y frase válida ✦' : 'Conexión correcta · falta la frase secreta');
    setStatus(next.pass ? 'ok' : 'local');
  } catch (e) {
    const msg = e instanceof SyncError ? e.message : 'No se pudo conectar con GitHub';
    setStatus('error', msg);
    toast(msg, 'error');
  } finally { cfg = prev; }
}

/* ---------- Recordatorios ---------- */
async function swReg() { return 'serviceWorker' in navigator ? navigator.serviceWorker.ready : null; }

/** Comparte la hora del aviso con el service worker (vía Cache API). */
async function writeSwConfig() {
  if (!('caches' in window)) return;
  try {
    const c = await caches.open('mn-config');
    const data = { notif: cfg.notif, hour: cfg.hour, doneDate: filled(entries[todayKey()]) === 3 ? todayKey() : null, notified: store.get(LS.notified, null) };
    await c.put('./__mn-config', new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* opcional */ }
}

async function showReminder(test = false) {
  const reg = await swReg();
  const opts = {
    body: 'Buenas noches. ¿Cuáles han sido tus 3 cosas buenas de hoy?',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'mn-recordatorio',
    renotify: true,
    data: { url: appUrl() },
  };
  if (reg) await reg.showNotification('三つ日記 · Mitsu Nikki', opts);
  else new Notification('三つ日記 · Mitsu Nikki', opts);
  if (!test) { store.set(LS.notified, todayKey()); writeSwConfig(); }
}

let reminderTimer;
function scheduleReminder() {
  clearTimeout(reminderTimer);
  if (!cfg.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
  const [h, mi] = cfg.hour.split(':').map(Number);
  const now = new Date();
  const t = new Date(); t.setHours(h, mi, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  reminderTimer = setTimeout(async () => {
    if (filled(entries[todayKey()]) < 3 && store.get(LS.notified, null) !== todayKey()) await showReminder();
    scheduleReminder();
  }, Math.min(t - now, 2 ** 31 - 1));
}

async function registerPeriodic() {
  try {
    const reg = await swReg();
    if (!reg || !('periodicSync' in reg)) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state !== 'granted') return;
    if (cfg.notif) await reg.periodicSync.register('mn-recordatorio', { minInterval: 3 * 60 * 60 * 1000 });
    else await reg.periodicSync.unregister('mn-recordatorio');
  } catch { /* no soportado: se queda en el aviso con la app abierta */ }
}

async function onToggleNotif(ev) {
  const box = ev.target;
  if (box.checked) {
    if (!('Notification' in window)) { box.checked = false; toast('Este navegador no admite notificaciones', 'error'); return; }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { box.checked = false; toast('Permiso de notificaciones denegado', 'error'); return; }
  }
  cfg.notif = box.checked;
  cfg.hour = sForm().elements.hour.value || '21:00';
  persistCfg();
  writeSwConfig();
  scheduleReminder();
  registerPeriodic();
  toast(cfg.notif ? `Te avisaré a las ${cfg.hour}` : 'Avisos desactivados');
}

function onHourChange(ev) {
  cfg.hour = ev.target.value || '21:00';
  persistCfg();
  writeSwConfig();
  scheduleReminder();
  $('#gcal-link').href = googleCalUrl();
}

async function onTestNotif() {
  if (!('Notification' in window)) { toast('Este navegador no admite notificaciones', 'error'); return; }
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Permiso de notificaciones denegado', 'error'); return; }
  }
  showReminder(true);
}

/* ---------- Calendario externo (.ics y Google Calendar) ---------- */
function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'; } catch { return 'Europe/Madrid'; } };
function startStamp(offsetMin = 0) {
  const [h, mi] = cfg.hour.split(':').map(Number);
  const d = new Date(); d.setHours(h, mi + offsetMin, 0, 0);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function googleCalUrl() {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: '三つ日記 · 3 cosas buenas del día',
    details: `Tómate un respiro y escribe tus 3 cosas buenas: ${appUrl()}`,
    dates: `${startStamp()}/${startStamp(10)}`,
    ctz: tzName(),
    recur: 'RRULE:FREQ=DAILY',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
function foldIcs(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
function downloadIcs() {
  const url = appUrl();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mitsu Nikki//Diario de gratitud//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:mitsu-nikki-recordatorio-${Date.now()}@mitsu-nikki`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${tzName()}:${startStamp()}`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:三つ日記 · 3 cosas buenas del día',
    `DESCRIPTION:Tómate un respiro y escribe tus 3 cosas buenas.\\n${url}`,
    `URL:${url}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:3 cosas buenas del día', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.map(foldIcs).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  saveBlob(blob, 'mitsu-nikki-recordatorio.ics');
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Copia de seguridad ---------- */
function exportBackup() {
  flushDraft();
  const data = { app: 'mitsu-nikki-backup', v: 1, exported: new Date().toISOString(), entries };
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `mitsu-nikki-${todayKey()}.json`);
}
async function importBackup(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const rem = data.entries;
    if (!rem || typeof rem !== 'object') throw new Error();
    const valid = {};
    for (const [k, e] of Object.entries(rem)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(e?.items)) valid[k] = { items: [0, 1, 2].map(i => String(e.items[i] ?? '')), updated: e.updated || new Date(0).toISOString() };
    }
    const m = merge(entries, valid);
    applyMerged(m.out);
    store.set(LS.dirty, true);
    toast(`Copia importada: ${Object.keys(valid).length} días`);
    sync({ quiet: true });
  } catch { toast('Ese archivo no es una copia de Mitsu Nikki', 'error'); }
}
function forgetToken() {
  cfg.token = '';
  persistCfg();
  sForm().elements.token.value = '';
  setStatus(syncMode() === 'read' ? 'read' : 'local');
  toast('Token borrado de este navegador');
}

/* ---------- Arranque ---------- */
let hiddenTodayKey = todayKey();
function bind() {
  $('#today-form').addEventListener('submit', onSave);
  areas().forEach(t => t.addEventListener('input', onType));
  $('#prev-day').addEventListener('click', () => { flushDraft(); currentKey = addDays(currentKey, -1); renderToday(); });
  $('#next-day').addEventListener('click', () => { flushDraft(); currentKey = addDays(currentKey, 1); renderToday(); });
  $('#back-today').addEventListener('click', () => { flushDraft(); currentKey = todayKey(); renderToday(); });
  $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

  $('#cal-prev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });
  $('#cal-grid').addEventListener('click', ev => { const b = ev.target.closest('.cal-day'); if (b && !b.disabled) showDayCard(b.dataset.key); });
  $('#omikuji-btn').addEventListener('click', drawOmikuji);
  $('#omikuji-again').addEventListener('click', drawOmikuji);
  $('#omikuji-close').addEventListener('click', () => $('#omikuji-dialog').close());

  const sDlg = $('#settings-dialog');
  $('#open-settings').addEventListener('click', () => { fillSettings(); sDlg.showModal(); });
  for (const d of [sDlg, $('#omikuji-dialog')]) d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
  $('#save-settings').addEventListener('click', onSaveSettings);
  $('#test-conn').addEventListener('click', onTestConnection);
  $$('.reveal').forEach(b => b.addEventListener('click', () => {
    const inp = sForm().elements[b.dataset.for];
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.textContent = inp.type === 'password' ? 'ver' : 'ocultar';
  }));
  sForm().elements.notif.addEventListener('change', onToggleNotif);
  sForm().elements.hour.addEventListener('change', onHourChange);
  $('#test-notif').addEventListener('click', onTestNotif);
  $('#ics-btn').addEventListener('click', downloadIcs);
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-input').addEventListener('change', importBackup);
  $('#forget-btn').addEventListener('click', forgetToken);

  window.addEventListener('online', () => { if (store.get(LS.dirty, false)) sync({ quiet: true }); else setStatus(syncMode() === 'write' ? 'ok' : syncMode()); });
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenTodayKey = todayKey();
      if (flushDraft() || store.get(LS.dirty, false)) sync({ quiet: true });
    }
    else {
      // Al volver al día siguiente, si estabas en "hoy", pasa al nuevo día
      if (currentKey === hiddenTodayKey) currentKey = todayKey();
      if (!$('#view-today').hidden) renderToday(); else renderCalendar();
      sync({ quiet: true });
      scheduleReminder();
    }
  });
}

function init() {
  bind();
  renderToday();
  setStatus(syncMode() === 'write' ? (store.get(LS.lastSync, null) ? 'ok' : 'local') : syncMode());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => { writeSwConfig(); registerPeriodic(); }).catch(e => console.warn('SW', e));
  }
  sync({ quiet: true });
  scheduleReminder();
}

init();
