/* Suivi muscu - appli mobile (V1)
   Donnees : Google Sheet via le moteur Apps Script. Hors ligne : file d'attente locale. */
(function () {
'use strict';

/* ================================================================== */
/* Utilitaires                                                         */
/* ================================================================== */
const LS = {
  get: function (k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } }
};
const uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
const $ = function (id) { return document.getElementById(id); };
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return isNaN(n) ? null : n;
}
function r1(x) { return Math.round(x * 10) / 10; }
function fmtN(x) { return x === null || x === undefined || x === '' ? '' : String(r1(x)).replace('.', ','); }
function e1rm(c, r) { return r <= 1 ? c : c * (1 + r / 30); }
function p2(n) { return String(n).padStart(2, '0'); }
function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
function hhmm(ms) { const d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function mmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? h + ':' + p2(m) + ':' + p2(s) : m + ':' + p2(s);
}
function daysAgo(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : 'il y a ' + d + ' j';
}
function weekStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x';
}
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function dayKey(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3); }
const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const DAY_NAMES = { lun: 'Lundi', mar: 'Mardi', mer: 'Mercredi', jeu: 'Jeudi', ven: 'Vendredi', sam: 'Samedi', dim: 'Dimanche' };
const GROUPES = ['Pectoraux', 'Dos', 'Épaules', 'Biceps', 'Triceps', 'Quadriceps', 'Ischios', 'Fessiers', 'Mollets', 'Abdos', 'Autre'];
const EVENTS = ['Malade', 'Blessure', 'Resto', 'Mauvaise nuit', 'Voyage', 'Autre'];

function h(tag, a) {
  const e = document.createElement(tag);
  let val;
  if (a) {
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'value') val = v;
      else if (k === 'checked') e.checked = !!v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
  }
  const kids = Array.prototype.slice.call(arguments, 2);
  (function add(list) {
    list.forEach(function (c) {
      if (Array.isArray(c)) return add(c);
      if (c === null || c === undefined || c === false) return;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
  })(kids);
  if (val !== undefined) e.value = val;
  return e;
}

/* ================================================================== */
/* Etat                                                                */
/* ================================================================== */
function emptyData() {
  return {
    config: { programmes: [], modeles: [], plan: [], exercices: [], objectifs: [], reglages: [] },
    history: { lastByModel: {}, lastAny: {}, best: {}, stagn: [], prs: [], n: {} },
    sessions: [], measures: []
  };
}
const S = {
  cfg: LS.get('cfg', { url: '', key: '' }),
  data: LS.get('data', null) || emptyData(),
  outbox: LS.get('outbox', []),
  active: LS.get('active', null),
  drafts: {},
  view: 'home',
  tab: 'ex',
  syncErr: '',
  online: true
};
if (!S.data.config || !S.data.history) S.data = emptyData();
S.view = S.cfg.url && S.cfg.key ? 'home' : 'setup';
let inflight = null, flushing = false;

function setting(k, d) {
  const r = (S.data.config.reglages || []).find(function (x) { return x.cle === k; });
  if (!r || r.valeur === '' || r.valeur === null || r.valeur === undefined) return d;
  const n = num(r.valeur);
  return n === null ? d : n;
}
function EX(id) { return (S.data.config.exercices || []).find(function (e) { return e.id === id; }); }
function exName(id) { const e = EX(id); return e ? e.nom : id; }
function MOD(id) { return (S.data.config.modeles || []).find(function (m) { return m.id === id; }); }
function planFor(modele, ex) {
  return (S.data.config.plan || []).find(function (p) { return p.modele === modele && p.exercice === ex; });
}
function planRows(modele) {
  return (S.data.config.plan || []).filter(function (p) { return p.modele === modele; })
    .sort(function (a, b) { return (num(a.ordre) || 0) - (num(b.ordre) || 0); });
}
function latestWeight() {
  const m = (S.data.measures || []).filter(function (x) { return num(x.poids) !== null; });
  return m.length ? num(m[m.length - 1].poids) : null;
}
function parsePile(s) {
  return String(s || '').split(/[;\s]+/).map(num).filter(function (x) { return x !== null; });
}
function stepRound(ex, v) {
  const pile = parsePile(ex && ex.pile);
  if (pile.length) {
    let best = pile[0];
    pile.forEach(function (p) { if (Math.abs(p - v) < Math.abs(best - v)) best = p; });
    return best;
  }
  const step = num(ex && ex.pas) || 2.5;
  return Math.max(0, Math.round(v / step) * step);
}

/* ================================================================== */
/* Synchronisation (file d'attente hors ligne)                          */
/* ================================================================== */
async function api(body) {
  const res = await fetch(S.cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ key: S.cfg.key }, body)),
    redirect: 'follow'
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Erreur du moteur');
  return j;
}
function saveOutbox() { LS.set('outbox', S.outbox); }
function enqueue(item) {
  S.outbox = S.outbox.filter(function (o) {
    if (o === inflight) return true;
    if (item.action === 'saveTable' && o.action === 'saveTable' && o.table === item.table) return false;
    if (item.action === 'upsertSession' && o.action === 'upsertSession' && o.session.id === item.session.id) return false;
    return true;
  });
  S.outbox.push(item);
  saveOutbox();
  renderBadge();
  flush();
}
async function flush() {
  if (flushing || !S.cfg.url || !S.outbox.length) { renderBadge(); return; }
  flushing = true;
  try {
    while (S.outbox.length) {
      inflight = S.outbox[0];
      await api(inflight);
      const i = S.outbox.indexOf(inflight);
      if (i >= 0) S.outbox.splice(i, 1);
      inflight = null;
      saveOutbox();
    }
    S.syncErr = '';
  } catch (e) {
    S.syncErr = e && e.message ? e.message : 'hors ligne';
  } finally {
    inflight = null;
    flushing = false;
    renderBadge();
  }
}
async function refresh() {
  if (!S.cfg.url || !S.cfg.key) return;
  await flush();
  if (S.outbox.length) return;
  try {
    const j = await api({ action: 'bootstrap' });
    S.data = j.data;
    LS.set('data', S.data);
    S.syncErr = '';
    if (S.view === 'home') render();
  } catch (e) {
    S.syncErr = e && e.message ? e.message : 'hors ligne';
  }
  renderBadge();
}
function saveConfig(table) {
  LS.set('data', S.data);
  enqueue({ action: 'saveTable', table: table, rows: S.data.config[table] });
}
function renderBadge() {
  const b = $('badge');
  if (!b) return;
  b.className = 'badge';
  if (S.syncErr) {
    const offline = /fetch|network|load failed|hors ligne/i.test(S.syncErr);
    if (offline) { b.classList.add(S.outbox.length ? 'wait' : 'ok'); b.textContent = S.outbox.length ? '● ' + S.outbox.length + ' en attente' : '● hors ligne'; }
    else { b.classList.add('err'); b.textContent = '● erreur : ' + S.syncErr.slice(0, 40); }
  } else if (S.outbox.length) { b.classList.add('wait'); b.textContent = '● ' + S.outbox.length + ' en attente'; }
  else { b.classList.add('ok'); b.textContent = '● à jour'; }
}

/* ================================================================== */
/* Fenetres et messages                                                */
/* ================================================================== */
function openModal(node) {
  const m = $('modal');
  m.innerHTML = '';
  m.append(h('div', { class: 'sheet' }, node));
  m.hidden = false;
  m.onclick = function (e) { if (e.target === m) closeModal(); };
}
function closeModal() { const m = $('modal'); m.hidden = true; m.innerHTML = ''; }
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
}
function field(label, input, cls) { return h('div', { class: 'field ' + (cls || '') }, h('label', { text: label }), input); }
function opts(list, sel) {
  return list.map(function (o) {
    const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
    return h('option', { value: v, selected: String(v) === String(sel) }, l);
  });
}

/* ================================================================== */
/* Historique et calculs cote appli                                    */
/* ================================================================== */
function groupSets(sets) {
  const g = {};
  (sets || []).forEach(function (s) { (g[s.n] = g[s.n] || []).push(s); });
  return Object.keys(g).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
    return g[k].slice().sort(function (a, b) { return a.o - b.o; });
  });
}
function fmtSet(ex, c, r, type) {
  const bw = ex && ex.type === 'poids_du_corps';
  if (type === 'test_1RM') return '1RM ' + fmtN(c) + ' kg';
  const load = bw ? (c === 0 ? 'PdC' : (c > 0 ? 'PdC+' + fmtN(c) : 'PdC' + fmtN(c))) : fmtN(c);
  return load + '×' + r;
}
function fmtGroup(ex, grp) { return grp.map(function (s) { return fmtSet(ex, s.c, s.r, s.t); }).join(' → '); }
function lastRec(modele, exId) {
  const H = S.data.history;
  return (modele && H.lastByModel[modele] && H.lastByModel[modele][exId]) || H.lastAny[exId] || null;
}
function bestOf(ex, sets, dateIso) {
  const bw = ex && ex.type === 'poids_du_corps';
  const weight = bw ? latestWeight() : null;
  let best = null, bv = -1;
  sets.forEach(function (x) {
    if (x.o > 1) return;
    let eff = x.c;
    if (bw) { if (weight === null) return; eff = weight + x.c; }
    if (!(eff > 0)) return;
    let v;
    if (x.t === 'test_1RM') v = eff;
    else if (x.r >= 1 && x.r <= 12) v = e1rm(eff, x.r);
    else return;
    if (v > bv) { bv = v; best = { c: x.c, r: x.r, e: v, t: x.t }; }
  });
  return best;
}
function applyToHistory(A) {
  const H = S.data.history;
  const byEx = {};
  A.sets.forEach(function (s) { (byEx[s.ex] = byEx[s.ex] || []).push(s); });
  Object.keys(byEx).forEach(function (exId) {
    const sets = byEx[exId].slice().sort(function (a, b) { return a.numero - b.numero || a.ordre - b.ordre; })
      .map(function (x) { return { n: x.numero, c: x.charge, r: x.reps, o: x.ordre, t: x.type }; });
    const rec = { sid: A.id, date: A.start, sets: sets };
    if (A.modele) { H.lastByModel[A.modele] = H.lastByModel[A.modele] || {}; H.lastByModel[A.modele][exId] = rec; }
    H.lastAny[exId] = rec;
    H.n[exId] = (H.n[exId] || 0) + 1;
    const b = bestOf(EX(exId), sets, A.start);
    if (b && (!H.best[exId] || b.e > H.best[exId].e + 1e-9)) {
      H.best[exId] = { sid: A.id, date: A.start, c: b.c, r: b.r, e: r1(b.e), t: b.t };
      H.stagn = H.stagn.filter(function (x) { return x !== exId; });
    }
  });
  LS.set('data', S.data);
}

/* ================================================================== */
/* Rendu general                                                       */
/* ================================================================== */
function render() {
  const root = $('app');
  root.innerHTML = '';
  let node;
  if (S.view === 'setup') node = renderSetup();
  else if (S.view === 'session' && S.active) node = renderSession();
  else if (S.view === 'manage') node = renderManage();
  else { S.view = 'home'; node = renderHome(); }
  root.append(node);
  renderBadge();
  tick();
}
function topbar(title, left) {
  return h('div', { class: 'topbar' },
    left || null,
    h('h1', { class: 'grow', text: title }),
    h('span', { id: 'badge', class: 'badge', onclick: function () { refresh(); } }, '…'));
}
function go(view) { S.view = view; render(); window.scrollTo(0, 0); }

/* ------------------------------------------------------------------ */
/* Connexion au moteur                                                 */
/* ------------------------------------------------------------------ */
function renderSetup() {
  const url = h('input', { type: 'text', placeholder: 'https://script.google.com/macros/s/…/exec', value: S.cfg.url });
  const key = h('input', { type: 'text', placeholder: 'ta clé secrète', value: S.cfg.key });
  const msg = h('p', { class: 'small muted' });
  return h('div', { class: 'screen' },
    h('h1', { text: 'Connexion au moteur' }),
    h('p', { class: 'muted', text: "Colle l'adresse de l'application web Apps Script et la clé secrète définie dans Code.gs. Ces deux informations restent sur ce téléphone." }),
    field('Adresse du moteur', url),
    field('Clé secrète', key),
    msg,
    h('button', {
      class: 'btn primary', text: 'Tester et enregistrer',
      onclick: async function () {
        const u = url.value.trim(), k = key.value.trim();
        if (!u || !k) { msg.textContent = 'Les deux champs sont requis.'; return; }
        msg.textContent = 'Test en cours…';
        const prev = S.cfg;
        S.cfg = { url: u, key: k };
        try {
          const j = await api({ action: 'bootstrap' });
          S.data = j.data; LS.set('data', S.data); LS.set('cfg', S.cfg);
          S.syncErr = ''; S.view = 'home'; render(); toast('Connecté');
        } catch (e) {
          S.cfg = prev;
          msg.textContent = 'Échec : ' + (e && e.message ? e.message : e) + '. Vérifie l\'adresse (elle finit par /exec) et la clé.';
        }
      }
    }));
}

/* ------------------------------------------------------------------ */
/* Accueil                                                             */
/* ------------------------------------------------------------------ */
function activeModels() {
  const progs = S.data.config.programmes || [];
  const act = progs.filter(function (p) { return String(p.actif).toLowerCase() === 'oui'; }).map(function (p) { return p.id; });
  const all = S.data.config.modeles || [];
  const ms = act.length ? all.filter(function (m) { return act.indexOf(m.programme) >= 0; }) : all;
  return ms.slice().sort(function (a, b) { return (num(a.ordre) || 0) - (num(b.ordre) || 0); });
}
function suggestModel() {
  const ms = activeModels();
  if (!ms.length) return null;
  const today = DAYS[new Date().getDay()];
  const byDay = ms.find(function (m) { return dayKey(m.jour) === today; });
  if (byDay) return { m: byDay, why: 'prévue aujourd\'hui' };
  const lastS = S.data.sessions.slice().reverse().find(function (s) { return ms.some(function (m) { return m.id === s.modele; }); });
  if (!lastS) return { m: ms[0], why: 'début du programme' };
  const i = ms.findIndex(function (m) { return m.id === lastS.modele; });
  return { m: ms[(i + 1) % ms.length], why: 'suite de ta rotation' };
}
function renderHome() {
  const root = h('div', { class: 'screen' });
  root.append(topbar('Muscu', h('button', { class: 'btn small ghost', text: '⚙', onclick: function () { go('manage'); } })));
  const empty = !(S.data.config.exercices || []).length && !(S.data.config.modeles || []).length;
  if (S.active) {
    root.append(h('div', { class: 'card' },
      h('h2', { text: 'Séance en cours' }),
      h('p', { class: 'muted', text: S.active.nom + ' · démarrée à ' + hhmm(Date.parse(S.active.start)) }),
      h('button', { class: 'btn primary', text: 'Reprendre la séance', onclick: function () { go('session'); } })));
  } else if (empty) {
    root.append(h('div', { class: 'card' },
      h('h2', { text: 'Bienvenue' }),
      h('p', { class: 'muted', text: 'Aucun exercice ni séance pour l\'instant. Charge un exemple (Push / Pull / Legs) pour démarrer vite, ou crée tout toi-même.' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', text: 'Charger l\'exemple', onclick: seedExample }),
        h('button', { class: 'btn ghost', text: 'Tout créer', onclick: function () { go('manage'); } }))));
  } else {
    root.append(h('button', { class: 'go', onclick: openGo }, 'GO!', h('small', { text: 'Lancer une séance' })));
  }
  root.append(h('div', { class: 'row even', style: 'margin:8px 0 14px' },
    h('button', { class: 'btn grow ghost', text: '⚖ Pesée', onclick: openWeigh }),
    h('button', { class: 'btn grow ghost', text: '🏃 Autre sport', onclick: openSport }),
    h('button', { class: 'btn grow ghost', text: '📌 Événement', onclick: openEvent })));
  root.append(renderKpis());
  return root;
}

function renderKpis() {
  const H = S.data.history;
  const wrap = h('div', { class: 'card' }, h('h2', { text: 'Repères' }));
  const sessions = S.data.sessions || [];
  const wk = sessions.filter(function (s) { return Date.parse(s.debut) >= weekStart(); }).length;
  const target = setting('cible_seances_semaine', 0);
  const last = sessions.length ? sessions[sessions.length - 1] : null;
  const tiles = h('div', { class: 'grid2' });
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'v', text: wk + (target ? ' / ' + target : '') }), h('div', { class: 'l', text: 'séances cette semaine' })));
  tiles.append(h('div', { class: 'tile' }, h('div', { class: 'v', text: last ? daysAgo(last.debut) : '–' }), h('div', { class: 'l', text: 'dernière séance' })));
  const ms = (S.data.measures || []).filter(function (m) { return num(m.poids) !== null; });
  if (ms.length) {
    const lw = ms[ms.length - 1];
    const ref = ms.slice().reverse().find(function (m) { return (Date.parse(lw.date) - Date.parse(m.date)) / 864e5 >= 5; });
    let trend = '';
    if (ref) { const d = num(lw.poids) - num(ref.poids); trend = (d > 0 ? '+' : '') + fmtN(d) + ' kg sur ' + Math.round((Date.parse(lw.date) - Date.parse(ref.date)) / 864e5) + ' j'; }
    tiles.append(h('div', { class: 'tile' }, h('div', { class: 'v', text: fmtN(num(lw.poids)) + ' kg' }), h('div', { class: 'l', text: 'poids' + (trend ? ' · ' + trend : '') })));
    if (num(lw.mg) !== null) tiles.append(h('div', { class: 'tile' }, h('div', { class: 'v', text: fmtN(num(lw.mg)) + ' %' }), h('div', { class: 'l', text: 'masse grasse' })));
  }
  wrap.append(tiles);

  const goals = (S.data.config.objectifs || []).map(function (o) { return goalView(o); }).filter(Boolean);
  if (goals.length) { wrap.append(h('h3', { style: 'margin-top:14px', text: 'Objectifs' })); goals.forEach(function (g) { wrap.append(g); }); }

  if (H.prs && H.prs.length) {
    wrap.append(h('h3', { style: 'margin-top:14px', text: 'Derniers records' }));
    const chips = h('div', { class: 'chips' });
    H.prs.forEach(function (p) {
      chips.append(h('span', { class: 'chip best', text: exName(p.ex) + ' ' + fmtN(p.c) + '×' + p.r + ' · ' + daysAgo(p.date) }));
    });
    wrap.append(chips);
  }
  return wrap;
}
function goalView(o) {
  const dep = num(o.depart), cib = num(o.cible);
  if (dep === null || cib === null || dep === cib) return null;
  let cur = null, label = '', unit = '';
  const lastM = (S.data.measures || []).slice().reverse();
  if (o.type === '1RM') { const b = S.data.history.best[o.exercice]; cur = b ? b.e : null; label = '1RM ' + exName(o.exercice); unit = ' kg'; }
  else if (o.type === 'poids') { const m = lastM.find(function (x) { return num(x.poids) !== null; }); cur = m ? num(m.poids) : null; label = 'Poids'; unit = ' kg'; }
  else if (o.type === 'mg') { const m = lastM.find(function (x) { return num(x.mg) !== null; }); cur = m ? num(m.mg) : null; label = 'Masse grasse'; unit = ' %'; }
  else return null;
  if (cur === null) cur = dep;
  const pct = Math.max(0, Math.min(1, (cur - dep) / (cib - dep)));
  let when = '';
  if (o.dcible) { const d = Math.ceil((Date.parse(o.dcible) - Date.now()) / 864e5); when = d >= 0 ? ' · J-' + d : ' · échéance dépassée'; }
  return h('div', { class: 'goal' },
    h('div', { class: 't' }, h('span', { text: label }), h('span', { text: fmtN(cur) + ' / ' + fmtN(cib) + unit })),
    h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(pct * 100) + '%' })),
    h('div', { class: 'small muted', text: Math.round(pct * 100) + ' % du chemin' + when }));
}

/* ------------------------------------------------------------------ */
/* Lancer une seance (bouton GO!)                                      */
/* ------------------------------------------------------------------ */
function openGo() {
  const sug = suggestModel();
  if (!sug) { toast('Crée d\'abord une séance (⚙)'); go('manage'); return; }
  showLaunch(sug.m, sug.why);
}
function showLaunch(m, why) {
  const exIds = planRows(m.id).map(function (p) { return p.exercice; });
  const weeks = setting('stagnation_semaines', 4);
  const stag = (S.data.history.stagn || []).filter(function (x) { return exIds.indexOf(x) >= 0; });
  const box = h('div', {},
    h('h2', { text: 'Séance du jour' }),
    h('p', {}, h('b', { text: m.nom }), why ? h('span', { class: 'muted', text: ' · ' + why }) : null));
  if (exIds.length) box.append(h('p', { class: 'small muted', text: exIds.map(exName).join(' · ') }));
  if (stag.length) {
    box.append(h('div', { class: 'warnbox' },
      h('b', { text: 'Exercices qui stagnent (' + weeks + ' sem. sans progrès)' }),
      h('div', { text: stag.map(exName).join(', ') }),
      h('div', { class: 'small', text: 'Pistes : monter la charge, changer la fourchette de reps, ou alléger une semaine.' })));
  }
  const others = h('div', { class: 'list', hidden: true });
  activeModels().filter(function (x) { return x.id !== m.id; }).forEach(function (x) {
    others.append(h('div', { class: 'item', onclick: function () { showLaunch(x, ''); } }, h('span', { text: x.nom }), h('span', { class: 'muted', text: '›' })));
  });
  others.append(h('div', { class: 'item', onclick: function () { closeModal(); startSession(null); } }, h('span', { text: 'Séance libre (sans plan)' }), h('span', { class: 'muted', text: '›' })));
  box.append(
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', text: 'Lancer', onclick: function () { closeModal(); startSession(m); } })),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Autre séance', onclick: function () { others.hidden = !others.hidden; } }),
      h('button', { class: 'btn ghost grow', text: 'Autre sport', onclick: openSport })),
    others);
  openModal(box);
}
function startSession(m) {
  const id = uid(), now = new Date().toISOString();
  S.active = {
    id: id, modele: m ? m.id : '', nom: m ? m.nom : 'Séance libre', start: now,
    exercises: m ? planRows(m.id).map(function (p) { return p.exercice; }) : [],
    sets: [], restEnd: null, restTotal: 0
  };
  S.drafts = {};
  LS.set('active', S.active);
  enqueue({ action: 'upsertSession', session: { id: id, modele: S.active.modele, debut: now, fin: '', duree: '', statut: 'en cours', note: '' } });
  go('session');
}

/* ================================================================== */
/* Seance en cours                                                     */
/* ================================================================== */
function persistActive() { LS.set('active', S.active); }
function renderSession() {
  const A = S.active;
  const root = h('div', { class: 'screen' });
  root.append(h('div', { class: 'sessionbar' },
    h('div', { class: 'row' }, h('div', { class: 'sb-title', text: A.nom }), h('span', { id: 'badge', class: 'badge', onclick: function () { flush(); } }, '…')),
    h('div', { class: 'sb-times' },
      h('span', { id: 't-global', text: '0:00' }),
      h('span', { id: 't-rest', class: 'rest', title: 'Toucher pour arrêter le repos', onclick: function () { A.restEnd = null; persistActive(); tick(); } }))));
  const list = h('div', { id: 'cards' });
  A.exercises.forEach(function (id) { list.append(card(id)); });
  root.append(list);
  root.append(h('div', { class: 'row' },
    h('button', { class: 'btn ghost grow', text: '+ Exercice', onclick: addExercisePicker }),
    h('button', { class: 'btn ghost grow', text: 'Accueil', onclick: function () { go('home'); } })));
  root.append(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'btn primary grow', text: 'Terminer la séance', onclick: openFinish })));
  return root;
}
function nextNumero(exId) {
  let m = 0;
  S.active.sets.forEach(function (s) { if (s.ex === exId && s.numero > m) m = s.numero; });
  return m + 1;
}
function prefill(exId) {
  const A = S.active, ex = EX(exId) || {}, plan = planFor(A.modele, exId), last = lastRec(A.modele, exId);
  const numero = nextNumero(exId);
  const d = { charge: '', reps: '', numero: numero, ordre: 1, groupe: null, type: 'travail', hint: '' };
  const mine = A.sets.filter(function (s) { return s.ex === exId; });
  const groups = last ? groupSets(last.sets.filter(function (s) { return s.t !== 'test_1RM'; })) : [];
  const ref = groups.length ? (groups[numero - 1] || groups[groups.length - 1])[0] : null;
  if (ref) { d.charge = fmtN(ref.c); d.reps = ref.r; }
  else if (mine.length) { const l = mine[mine.length - 1]; d.charge = fmtN(l.charge); d.reps = l.reps; }
  if (plan && groups.length) {
    const rmax = num(plan.rmax), series = num(plan.series) || groups.length;
    const allTop = rmax && groups.length >= series && groups.every(function (g) { return g[0].r >= rmax; });
    if (allTop && ref && numero === 1) {
      const step = num(ex.pas) || 2.5;
      d.charge = fmtN(ref.c + step);
      d.hint = '↑ ' + fmtN(ref.c + step) + ' suggéré : tu as atteint ' + rmax + ' reps partout';
    }
  }
  return d;
}
function getDraft(exId) { if (!S.drafts[exId]) S.drafts[exId] = prefill(exId); return S.drafts[exId]; }
function replaceCard(exId) {
  const old = $('card-' + exId);
  if (old) old.replaceWith(card(exId)); else render();
}

function card(exId) {
  const A = S.active, ex = EX(exId) || { id: exId, nom: exId, type: 'charge' };
  const bw = ex.type === 'poids_du_corps';
  const plan = planFor(A.modele, exId), last = lastRec(A.modele, exId), best = S.data.history.best[exId];
  const sets = A.sets.filter(function (s) { return s.ex === exId; });
  const d = getDraft(exId);
  const el = h('div', { class: 'card', id: 'card-' + exId });
  let target = '';
  if (plan) { const a = num(plan.rmin), b = num(plan.rmax); target = plan.series + ' × ' + (a === b || !b ? a : a + '-' + b); }
  el.append(h('h2', {}, h('span', { text: ex.nom }), h('span', { class: 'small muted', text: target })));

  if (last) {
    const chips = h('div', { class: 'chips' });
    groupSets(last.sets).forEach(function (g) { chips.append(h('span', { class: 'chip', text: fmtGroup(ex, g) })); });
    el.append(h('div', { class: 'small muted', text: 'Dernière fois · ' + daysAgo(last.date) }), chips);
  }
  const lastBest = last ? bestOf(ex, last.sets, last.date) : null;
  if (best && (!last || (best.sid !== last.sid && (!lastBest || best.e > lastBest.e + 0.05)))) {
    el.append(h('div', { class: 'chips' }, h('span', { class: 'chip best', text: 'Record ' + fmtSet(ex, best.c, best.r, best.t) + ' · 1RM est. ' + fmtN(best.e) + ' kg' })));
  }
  if (ex.principal === 'oui') {
    const o = (S.data.config.objectifs || []).find(function (x) { return x.type === '1RM' && x.exercice === exId; });
    if (o) el.append(h('div', { class: 'small', text: 'Objectif 1RM : ' + fmtN(num(o.cible)) + ' kg' + (best ? ' · actuel ~' + fmtN(best.e) + ' kg' : '') }));
  }

  sets.forEach(function (s) {
    el.append(h('div', { class: 'setline' + (s.ordre > 1 ? ' drop' : '') },
      h('span', { class: 'small muted', text: s.ordre > 1 ? '↳' : '#' + s.numero }),
      h('span', { class: 'grow', text: fmtSet(ex, s.charge, s.reps, s.type) + (s.note ? ' 💬' : '') }),
      h('button', { class: 'x', title: 'Note', text: '✎', onclick: function () { editSetNote(s); } }),
      h('button', { class: 'x', title: 'Supprimer', text: '✕', onclick: function () { deleteSet(s); } })));
  });

  if (d.hint) el.append(h('div', { class: 'hint', text: d.hint }));
  const isTest = d.type === 'test_1RM', isDrop = d.ordre > 1;
  const cIn = h('input', { type: 'text', inputmode: 'decimal', value: d.charge, oninput: function (e) { d.charge = e.target.value; } });
  const rIn = h('input', { type: 'text', inputmode: 'numeric', value: d.reps, disabled: isTest, oninput: function (e) { d.reps = e.target.value; } });
  const lbl = isTest ? 'Test 1RM' : isDrop ? 'Drop ' + (d.ordre - 1) : 'Série ' + d.numero;
  const entry = h('div', { class: 'entry' },
    h('div', {}, h('label', { text: bw ? 'Charge ajoutée (kg)' : 'Charge (kg)' }), cIn),
    bw ? h('button', { class: 'btn small ghost', text: '±', onclick: function () { const v = num(cIn.value) || 0; d.charge = fmtN(-v); cIn.value = d.charge; } }) : null,
    h('div', {}, h('label', { text: 'Reps' }), rIn),
    h('button', { class: 'btn primary ok', text: 'Valider · ' + lbl, onclick: function () { validateSet(exId); } }));
  el.append(entry);

  const sub = h('div', { class: 'sub' });
  if (sets.length && !isTest && !isDrop) sub.append(h('button', { class: 'btn small ghost', text: '↧ Drop', onclick: function () { startDrop(exId); } }));
  if (isDrop || isTest) sub.append(h('button', { class: 'btn small ghost', text: 'Annuler', onclick: function () { delete S.drafts[exId]; replaceCard(exId); } }));
  if (!isTest) sub.append(h('button', { class: 'btn small ghost', text: '1RM', onclick: function () { startTest(exId); } }));
  el.append(sub);
  return el;
}

function validateSet(exId) {
  const A = S.active, ex = EX(exId) || { type: 'charge' }, bw = ex.type === 'poids_du_corps', d = S.drafts[exId];
  if (!d) return;
  const c = num(d.charge), r = d.type === 'test_1RM' ? 1 : num(d.reps);
  if (c === null || r === null || r <= 0 || (!bw && !(c > 0))) { toast('Charge et reps requises'); return; }
  const id = uid();
  const set = { id: id, ex: exId, numero: d.numero, type: d.type, groupe: d.groupe || id, ordre: d.ordre, charge: c, reps: Math.round(r), ts: new Date().toISOString(), note: '' };
  A.sets.push(set);
  const secs = num(ex.repos) || setting('repos_defaut', 90);
  A.restEnd = Date.now() + secs * 1000; A.restTotal = secs; A.vibrated = false;
  persistActive();
  enqueue({ action: 'addSets', sets: [setRow(set)] });
  delete S.drafts[exId];
  replaceCard(exId);
  tick();
}
function setRow(s) {
  return { id: s.id, seance: S.active ? S.active.id : s.seance, exercice: s.ex, numero: s.numero, type: s.type, groupe: s.groupe, ordre: s.ordre, charge: s.charge, reps: s.reps, ts: s.ts, note: s.note || '' };
}
function startDrop(exId) {
  const A = S.active, ex = EX(exId) || { type: 'charge' };
  const sets = A.sets.filter(function (s) { return s.ex === exId; });
  const l = sets[sets.length - 1];
  if (!l) return;
  A.restEnd = null; persistActive();
  const pct = setting('drop_pct', 20) / 100;
  let target;
  if (ex.type === 'poids_du_corps') target = l.charge > 0 ? stepRound(ex, l.charge * (1 - pct)) : l.charge;
  else target = stepRound(ex, l.charge * (1 - pct));
  S.drafts[exId] = { charge: fmtN(target), reps: '', numero: l.numero, ordre: l.ordre + 1, groupe: l.groupe, type: 'travail', hint: 'Drop : charge réduite d\'environ ' + Math.round(pct * 100) + ' %' };
  replaceCard(exId); tick();
}
function startTest(exId) {
  const b = S.data.history.best[exId];
  S.drafts[exId] = { charge: b ? fmtN(Math.round(b.e)) : '', reps: 1, numero: nextNumero(exId), ordre: 1, groupe: null, type: 'test_1RM', hint: 'Test 1RM : saisis la charge réellement soulevée' };
  replaceCard(exId);
}
function deleteSet(s) {
  if (!confirm('Supprimer cette série ?')) return;
  const A = S.active;
  A.sets = A.sets.filter(function (x) { return x.id !== s.id; });
  persistActive();
  enqueue({ action: 'deleteSet', id: s.id });
  delete S.drafts[s.ex];
  replaceCard(s.ex);
}
function editSetNote(s) {
  const v = prompt('Note sur cette série (laisser vide pour effacer)', s.note || '');
  if (v === null) return;
  s.note = v.trim();
  persistActive();
  enqueue({ action: 'addSets', sets: [setRow(s)] });
  replaceCard(s.ex);
}
function addExercisePicker() {
  const A = S.active;
  const search = h('input', { type: 'text', placeholder: 'Rechercher un exercice' });
  const list = h('div', { class: 'list' });
  function fill() {
    list.innerHTML = '';
    const q = norm(search.value);
    (S.data.config.exercices || []).filter(function (e) { return A.exercises.indexOf(e.id) < 0 && (!q || norm(e.nom).indexOf(q) >= 0); })
      .forEach(function (e) {
        list.append(h('div', { class: 'item', onclick: function () {
          A.exercises.push(e.id); persistActive(); closeModal();
          $('cards').append(card(e.id)); toast(e.nom + ' ajouté');
        } }, h('span', { text: e.nom }), h('span', { class: 'small muted', text: e.groupe })));
      });
    if (!list.children.length) list.append(h('p', { class: 'muted', text: 'Aucun exercice. Crée-en dans ⚙ › Exercices.' }));
  }
  search.addEventListener('input', fill); fill();
  openModal(h('div', {}, h('h2', { text: 'Ajouter un exercice' }), search, list));
}

/* ------------------------------------------------------------------ */
/* Chronos                                                             */
/* ------------------------------------------------------------------ */
function tick() {
  if (S.view !== 'session' || !S.active) return;
  const A = S.active, g = $('t-global'), r = $('t-rest');
  if (g) g.textContent = mmss(Date.now() - Date.parse(A.start));
  if (r) {
    if (A.restEnd) {
      const rem = A.restEnd - Date.now();
      r.textContent = (rem >= 0 ? 'Repos ' : 'Repos +') + mmss(Math.abs(rem));
      r.classList.toggle('over', rem < 0);
      if (rem < 0 && !A.vibrated) {
        A.vibrated = true;
        if (setting('vibration', 0) && !document.hidden && navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    } else { r.textContent = ''; r.classList.remove('over'); }
  }
}

/* ------------------------------------------------------------------ */
/* Fin de seance                                                       */
/* ------------------------------------------------------------------ */
function openFinish() {
  const A = S.active, sets = A.sets;
  if (!sets.length) {
    openModal(h('div', {},
      h('h2', { text: 'Aucune série enregistrée' }),
      h('p', { text: 'Annuler cette séance ?' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost grow', text: 'Continuer', onclick: closeModal }),
        h('button', { class: 'btn danger grow', text: 'Annuler la séance', onclick: function () { closeModal(); cancelSession(); } }))));
    return;
  }
  const now = Date.now(), start = Date.parse(A.start), lastTs = Date.parse(sets[sets.length - 1].ts);
  const durNow = Math.max(1, Math.round((now - start) / 60000)), durLast = Math.max(1, Math.round((lastTs - start) / 60000));
  const thr = setting('seuil_oubli_h', 4) * 60;
  const prev = (S.data.sessions || []).filter(function (s) { return s.modele === A.modele && s.duree > 0; }).slice(-8).map(function (s) { return s.duree; });
  const avg = prev.length ? prev.reduce(function (a, b) { return a + b; }, 0) / prev.length : null;
  const suspicious = (durNow > thr || (avg && durNow > 1.5 * avg)) && durNow - durLast >= 10;
  let useLast = suspicious;
  const note = h('textarea', { placeholder: 'Commentaire (optionnel)' });
  const box = h('div', {}, h('h2', { text: 'Terminer la séance' }));
  if (suspicious) {
    const rNow = h('input', { type: 'radio', name: 'dur', onchange: function () { useLast = false; } });
    const rLast = h('input', { type: 'radio', name: 'dur', checked: true, onchange: function () { useLast = true; } });
    box.append(h('div', { class: 'warnbox' },
      h('div', { text: 'Cette séance semble longue (' + durNow + ' min' + (avg ? ', ta moyenne : ' + Math.round(avg) + ' min' : '') + '). Chrono oublié ?' }),
      h('label', { class: 'field inline', style: 'margin-top:8px' }, rLast, h('span', { text: 'Terminer à ' + hhmm(lastTs) + ' (dernière série) · ' + durLast + ' min' })),
      h('label', { class: 'field inline' }, rNow, h('span', { text: 'Garder ' + durNow + ' min' }))));
  } else {
    box.append(h('p', { class: 'muted', text: 'Durée : ' + durNow + ' min · ' + sets.length + ' séries enregistrées' }));
  }
  box.append(note, h('div', { class: 'row' },
    h('button', { class: 'btn ghost grow', text: 'Continuer', onclick: closeModal }),
    h('button', { class: 'btn primary grow', text: 'Terminer', onclick: function () {
      closeModal();
      finishSession(new Date(useLast ? lastTs : now).toISOString(), note.value.trim());
    } })));
  openModal(box);
}
function finishSession(endIso, note) {
  const A = S.active;
  const dur = Math.max(1, Math.round((Date.parse(endIso) - Date.parse(A.start)) / 60000));
  S.data.sessions.push({ id: A.id, modele: A.modele, debut: A.start, fin: endIso, duree: dur });
  applyToHistory(A);
  enqueue({ action: 'upsertSession', session: { id: A.id, modele: A.modele, debut: A.start, fin: endIso, duree: dur, statut: 'terminée', note: note || '' } });
  S.active = null; LS.set('active', null); S.drafts = {};
  S.view = 'home'; render(); toast('Séance terminée · ' + dur + ' min');
  setTimeout(refresh, 1500);
}
function cancelSession() {
  const A = S.active;
  enqueue({ action: 'upsertSession', session: { id: A.id, modele: A.modele, debut: A.start, fin: new Date().toISOString(), duree: '', statut: 'annulée', note: '' } });
  S.active = null; LS.set('active', null); S.drafts = {};
  S.view = 'home'; render(); toast('Séance annulée');
}
function checkStale() {
  const A = S.active;
  if (!A) return;
  const lastTs = A.sets.length ? Date.parse(A.sets[A.sets.length - 1].ts) : Date.parse(A.start);
  const thr = setting('seuil_oubli_h', 4) * 3600e3;
  if (Date.now() - lastTs <= thr) return;
  openModal(h('div', {},
    h('h2', { text: 'Séance restée ouverte' }),
    h('p', { text: '« ' + A.nom + ' » est ouverte depuis ' + hhmm(Date.parse(A.start)) + '. Dernière série à ' + hhmm(lastTs) + '.' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Reprendre', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Terminer à ' + hhmm(lastTs), onclick: function () {
        closeModal();
        if (A.sets.length) finishSession(new Date(lastTs).toISOString(), ''); else cancelSession();
      } }))));
}

/* ================================================================== */
/* Pesee, autre sport, evenement                                       */
/* ================================================================== */
function openWeigh() {
  const date = h('input', { type: 'date', value: todayStr() });
  const w = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'ex. 78,4' });
  const mg = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'optionnel' });
  openModal(h('div', {}, h('h2', { text: 'Pesée' }),
    field('Date', date), field('Poids (kg)', w), field('Masse grasse (%)', mg),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () {
        const p = num(w.value);
        if (p === null || p <= 0) { toast('Poids requis'); return; }
        const row = { id: uid(), date: date.value || todayStr(), poids: p, mg: num(mg.value) === null ? '' : num(mg.value) };
        S.data.measures.push({ date: row.date, poids: p, mg: num(mg.value) });
        S.data.measures.sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });
        LS.set('data', S.data);
        enqueue({ action: 'append', table: 'mesures', rows: [row] });
        closeModal(); if (S.view === 'home') render(); toast('Pesée enregistrée');
      } }))));
}
function openSport() {
  const sports = LS.get('sports', ['Course', 'Vélo', 'Natation', 'Football', 'Marche']);
  const date = h('input', { type: 'date', value: todayStr() });
  const sp = h('input', { type: 'text', list: 'sports-list', placeholder: 'ex. Course' });
  const dur = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'minutes' });
  const note = h('textarea', { placeholder: 'Commentaire (optionnel)' });
  openModal(h('div', {}, h('h2', { text: 'Autre sport' }),
    h('datalist', { id: 'sports-list' }, sports.map(function (s) { return h('option', { value: s }); })),
    field('Date', date), field('Sport', sp), field('Durée (min)', dur), field('Commentaire', note),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () {
        const name = sp.value.trim();
        if (!name) { toast('Sport requis'); return; }
        if (sports.indexOf(name) < 0) { sports.push(name); LS.set('sports', sports); }
        enqueue({ action: 'append', table: 'activites', rows: [{ id: uid(), date: date.value || todayStr(), sport: name, duree: num(dur.value) === null ? '' : num(dur.value), note: note.value.trim() }] });
        closeModal(); toast('Activité enregistrée');
      } }))));
}
function openEvent() {
  const type = h('select', {}, opts(EVENTS, 'Malade'));
  const d1 = h('input', { type: 'date', value: todayStr() });
  const d2 = h('input', { type: 'date', value: '' });
  const note = h('textarea', { placeholder: 'Note (optionnel)' });
  openModal(h('div', {}, h('h2', { text: 'Événement' }),
    h('p', { class: 'small muted', text: 'Malade ou blessure : ces semaines ne comptent pas dans les alertes de stagnation.' }),
    field('Type', type), field('Du', d1), field('Au (optionnel)', d2), field('Note', note),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () {
        const a = d1.value || todayStr();
        enqueue({ action: 'append', table: 'journal', rows: [{ id: uid(), debut: a, fin: d2.value || a, type: type.value, note: note.value.trim() }] });
        closeModal(); toast('Événement enregistré');
      } }))));
}

/* ================================================================== */
/* Gestion : exercices, seances, objectifs, reglages                   */
/* ================================================================== */
function renderManage() {
  const root = h('div', { class: 'screen' });
  root.append(topbar('Gérer', h('button', { class: 'btn small ghost', text: '‹', onclick: function () { go(S.active ? 'session' : 'home'); } })));
  const tabs = [['ex', 'Exercices'], ['seances', 'Séances'], ['obj', 'Objectifs'], ['reg', 'Réglages']];
  root.append(h('div', { class: 'tabs' }, tabs.map(function (t) {
    return h('button', { class: 'btn' + (S.tab === t[0] ? ' on' : ''), text: t[1], onclick: function () { S.tab = t[0]; render(); } });
  })));
  if (S.tab === 'ex') root.append(tabExercises());
  else if (S.tab === 'seances') root.append(tabSessions());
  else if (S.tab === 'obj') root.append(tabGoals());
  else root.append(tabSettings());
  return root;
}

/* --- Exercices --- */
function tabExercises() {
  const wrap = h('div', {});
  const search = h('input', { type: 'text', placeholder: 'Rechercher' });
  const list = h('div', { class: 'list card' });
  function fill() {
    list.innerHTML = '';
    const q = norm(search.value);
    const rows = (S.data.config.exercices || []).filter(function (e) { return !q || norm(e.nom).indexOf(q) >= 0; })
      .sort(function (a, b) { return String(a.groupe).localeCompare(String(b.groupe)) || String(a.nom).localeCompare(String(b.nom)); });
    rows.forEach(function (e) {
      list.append(h('div', { class: 'item', onclick: function () { exerciseForm(e); } },
        h('span', {}, e.nom, e.principal === 'oui' ? ' ★' : ''),
        h('span', { class: 'small muted', text: e.groupe + (e.type === 'poids_du_corps' ? ' · PdC' : '') })));
    });
    if (!rows.length) list.append(h('p', { class: 'muted', text: 'Aucun exercice.' }));
  }
  search.addEventListener('input', fill); fill();
  wrap.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, h('div', { class: 'grow' }, search),
    h('button', { class: 'btn primary', text: '+ Exercice', onclick: function () { exerciseForm(null); } })), list);
  return wrap;
}
function exerciseForm(ex) {
  const isNew = !ex;
  ex = ex || { id: '', nom: '', groupe: 'Pectoraux', type: 'charge', principal: 'non', repos: '', pas: '', pile: '' };
  const nom = h('input', { type: 'text', value: ex.nom });
  const gr = h('select', {}, opts(GROUPES, ex.groupe));
  const ty = h('select', {}, opts([['charge', 'Avec charge'], ['poids_du_corps', 'Poids du corps']], ex.type));
  const pr = h('input', { type: 'checkbox', checked: ex.principal === 'oui' });
  const rep = h('input', { type: 'text', inputmode: 'numeric', value: ex.repos === '' ? '' : ex.repos, placeholder: 'ex. 90' });
  const pas = h('input', { type: 'text', inputmode: 'decimal', value: ex.pas === '' ? '' : fmtN(num(ex.pas)), placeholder: 'ex. 2,5' });
  const pile = h('input', { type: 'text', value: ex.pile || '', placeholder: 'poulie/machine, ex. 5; 10; 15; 20' });
  openModal(h('div', {}, h('h2', { text: isNew ? 'Nouvel exercice' : 'Modifier l\'exercice' }),
    field('Nom', nom), field('Groupe musculaire', gr), field('Type', ty),
    field('Exercice principal (objectif 1RM)', pr, 'inline'),
    field('Repos par défaut (s)', rep), field('Pas de charge (kg)', pas), field('Valeurs de la pile (optionnel)', pile),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () {
        if (!nom.value.trim()) { toast('Nom requis'); return; }
        const row = { id: ex.id || slug(nom.value) + '-' + uid().slice(-3), nom: nom.value.trim(), groupe: gr.value, type: ty.value,
          principal: pr.checked ? 'oui' : 'non', repos: num(rep.value) === null ? '' : num(rep.value), pas: num(pas.value) === null ? '' : num(pas.value), pile: pile.value.trim() };
        const list = S.data.config.exercices;
        const i = list.findIndex(function (x) { return x.id === row.id; });
        if (i >= 0) list[i] = row; else list.push(row);
        saveConfig('exercices'); closeModal(); render();
      } }))));
}

/* --- Seances et programmes --- */
function tabSessions() {
  const wrap = h('div', {});
  const progs = S.data.config.programmes || [];
  wrap.append(h('div', { class: 'row', style: 'margin-bottom:10px' },
    h('button', { class: 'btn primary grow', text: '+ Programme', onclick: programForm })));
  if (!progs.length) wrap.append(h('p', { class: 'muted', text: 'Crée un programme (ex. « Prise de masse »), puis ses séances.' }));
  progs.forEach(function (p) {
    const isAct = String(p.actif).toLowerCase() === 'oui';
    const models = (S.data.config.modeles || []).filter(function (m) { return m.programme === p.id; })
      .sort(function (a, b) { return (num(a.ordre) || 0) - (num(b.ordre) || 0); });
    const c = h('div', { class: 'card' },
      h('h2', {}, h('span', { text: p.nom }), isAct ? h('span', { class: 'small', style: 'color:var(--accent)', text: 'actif' }) : h('button', { class: 'btn small ghost', text: 'Activer', onclick: function () {
        progs.forEach(function (x) { x.actif = x.id === p.id ? 'oui' : 'non'; }); saveConfig('programmes'); render();
      } })));
    const list = h('div', { class: 'list' });
    models.forEach(function (m, i) {
      list.append(h('div', { class: 'item' },
        h('span', { onclick: function () { planEditor(m); } }, m.nom, m.jour ? h('span', { class: 'small muted', text: ' · ' + (DAY_NAMES[dayKey(m.jour)] || m.jour) }) : null),
        h('span', { class: 'row' },
          h('button', { class: 'btn small ghost', text: '↑', onclick: function () { moveModel(models, i, -1); } }),
          h('button', { class: 'btn small ghost', text: '↓', onclick: function () { moveModel(models, i, 1); } }),
          h('button', { class: 'btn small', text: 'Plan', onclick: function () { planEditor(m); } }))));
    });
    c.append(list, h('div', { class: 'row' }, h('button', { class: 'btn small ghost', text: '+ Séance', onclick: function () { modelForm(p, null); } })));
    wrap.append(c);
  });
  return wrap;
}
function programForm() {
  const nom = h('input', { type: 'text', placeholder: 'ex. Prise de masse 2026' });
  openModal(h('div', {}, h('h2', { text: 'Nouveau programme' }), field('Nom', nom),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Créer', onclick: function () {
        if (!nom.value.trim()) { toast('Nom requis'); return; }
        const progs = S.data.config.programmes;
        progs.push({ id: uid(), nom: nom.value.trim(), debut: todayStr(), actif: progs.some(function (x) { return String(x.actif).toLowerCase() === 'oui'; }) ? 'non' : 'oui' });
        saveConfig('programmes'); closeModal(); render();
      } }))));
}
function modelForm(prog, m) {
  const nom = h('input', { type: 'text', value: m ? m.nom : '', placeholder: 'ex. Push' });
  const jour = h('select', {}, opts([['', 'Aucun jour fixe']].concat(Object.keys(DAY_NAMES).map(function (k) { return [k, DAY_NAMES[k]]; })), m ? dayKey(m.jour) : ''));
  openModal(h('div', {}, h('h2', { text: m ? 'Modifier la séance' : 'Nouvelle séance' }),
    field('Nom', nom), field('Jour prévu (optionnel)', jour),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () {
        if (!nom.value.trim()) { toast('Nom requis'); return; }
        const all = S.data.config.modeles;
        if (m) { m.nom = nom.value.trim(); m.jour = jour.value; }
        else {
          const n = all.filter(function (x) { return x.programme === prog.id; }).length;
          all.push({ id: uid(), programme: prog.id, nom: nom.value.trim(), ordre: n + 1, jour: jour.value });
        }
        saveConfig('modeles'); closeModal(); render();
      } }))));
}
function moveModel(models, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= models.length) return;
  const t = models[i]; models[i] = models[j]; models[j] = t;
  models.forEach(function (x, k) { x.ordre = k + 1; });
  saveConfig('modeles'); render();
}
function planEditor(m) {
  function draw() {
    const rows = planRows(m.id);
    const list = h('div', {});
    rows.forEach(function (p, i) {
      const sIn = h('input', { type: 'text', inputmode: 'numeric', value: p.series, style: 'width:60px', onchange: function (e) { p.series = num(e.target.value) || 1; } });
      const aIn = h('input', { type: 'text', inputmode: 'numeric', value: p.rmin, style: 'width:60px', onchange: function (e) { p.rmin = num(e.target.value) || 1; } });
      const bIn = h('input', { type: 'text', inputmode: 'numeric', value: p.rmax, style: 'width:60px', onchange: function (e) { p.rmax = num(e.target.value) || 1; } });
      list.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('b', { class: 'grow', text: exName(p.exercice) }),
          h('button', { class: 'btn small ghost', text: '↑', onclick: function () { movePlan(rows, i, -1); } }),
          h('button', { class: 'btn small ghost', text: '↓', onclick: function () { movePlan(rows, i, 1); } }),
          h('button', { class: 'btn small ghost', text: '✕', onclick: function () {
            S.data.config.plan = S.data.config.plan.filter(function (x) { return x !== p; }); renumber(); draw();
          } })),
        h('div', { class: 'row', style: 'margin-top:8px' }, sIn, h('span', { text: 'séries ×' }), aIn, h('span', { text: 'à' }), bIn, h('span', { text: 'reps' }))));
    });
    if (!rows.length) list.append(h('p', { class: 'muted', text: 'Aucun exercice dans cette séance.' }));
    const box = h('div', {}, h('h2', { text: 'Plan : ' + m.nom }), list,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost grow', text: '+ Exercice', onclick: function () { pickForPlan(m, draw); } }),
        h('button', { class: 'btn ghost grow', text: 'Renommer', onclick: function () { closeModal(); modelForm({ id: m.programme }, m); } })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () { renumber(); saveConfig('plan'); closeModal(); toast('Plan enregistré'); } })));
    openModal(box);
  }
  function renumber() { planRows(m.id).forEach(function (p, k) { p.ordre = k + 1; }); }
  function movePlan(rows, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const t = rows[i].ordre; rows[i].ordre = rows[j].ordre; rows[j].ordre = t;
    if (rows[i].ordre === rows[j].ordre) { rows[i].ordre = j + 1; rows[j].ordre = i + 1; }
    draw();
  }
  draw();
}
function pickForPlan(m, back) {
  const search = h('input', { type: 'text', placeholder: 'Rechercher un exercice' });
  const list = h('div', { class: 'list' });
  function fill() {
    list.innerHTML = '';
    const q = norm(search.value), used = planRows(m.id).map(function (p) { return p.exercice; });
    (S.data.config.exercices || []).filter(function (e) { return used.indexOf(e.id) < 0 && (!q || norm(e.nom).indexOf(q) >= 0); })
      .forEach(function (e) {
        list.append(h('div', { class: 'item', onclick: function () {
          S.data.config.plan.push({ modele: m.id, exercice: e.id, ordre: used.length + 1, series: 3, rmin: 8, rmax: 12 });
          back();
        } }, h('span', { text: e.nom }), h('span', { class: 'small muted', text: e.groupe })));
      });
    if (!list.children.length) list.append(h('p', { class: 'muted', text: 'Aucun exercice disponible. Crée-en dans l\'onglet Exercices.' }));
  }
  search.addEventListener('input', fill); fill();
  openModal(h('div', {}, h('h2', { text: 'Ajouter à ' + m.nom }), search, list, h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', text: 'Retour', onclick: back }))));
}

/* --- Objectifs --- */
function tabGoals() {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, h('button', { class: 'btn primary grow', text: '+ Objectif', onclick: function () { goalForm(); } })));
  const goals = S.data.config.objectifs || [];
  if (!goals.length) wrap.append(h('p', { class: 'muted', text: 'Fixe un objectif de 1RM, de poids ou de masse grasse : sa progression s\'affiche sur l\'accueil.' }));
  goals.forEach(function (o) {
    const v = goalView(o);
    wrap.append(h('div', { class: 'card' }, v || h('div', { text: 'Objectif incomplet' }),
      h('div', { class: 'row' }, h('button', { class: 'btn small ghost', text: 'Supprimer', onclick: function () {
        if (!confirm('Supprimer cet objectif ?')) return;
        S.data.config.objectifs = goals.filter(function (x) { return x !== o; }); saveConfig('objectifs'); render();
      } }))));
  });
  return wrap;
}
function goalForm() {
  const ty = h('select', {}, opts([['1RM', '1RM d\'un exercice'], ['poids', 'Poids'], ['mg', 'Masse grasse']], '1RM'));
  const mains = (S.data.config.exercices || []).filter(function (e) { return e.principal === 'oui'; });
  const exs = h('select', {}, opts(mains.map(function (e) { return [e.id, e.nom]; }), ''));
  const exField = field('Exercice (principaux uniquement)', exs);
  const dep = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'valeur actuelle' });
  const cib = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'objectif' });
  const dt = h('input', { type: 'date', value: '' });
  function sync() {
    exField.hidden = ty.value !== '1RM';
    let cur = null;
    if (ty.value === '1RM') { const b = S.data.history.best[exs.value]; cur = b ? b.e : null; }
    else if (ty.value === 'poids') cur = latestWeight();
    else { const m = (S.data.measures || []).slice().reverse().find(function (x) { return num(x.mg) !== null; }); cur = m ? num(m.mg) : null; }
    dep.value = cur === null ? '' : fmtN(cur);
  }
  ty.addEventListener('change', sync); exs.addEventListener('change', sync); sync();
  openModal(h('div', {}, h('h2', { text: 'Nouvel objectif' }),
    field('Type', ty), exField, field('Valeur de départ', dep), field('Objectif', cib), field('Date cible (optionnel)', dt),
    ty.value === '1RM' && !mains.length ? h('p', { class: 'hint', text: 'Marque d\'abord un exercice comme « principal » dans l\'onglet Exercices.' }) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Créer', onclick: function () {
        if (num(dep.value) === null || num(cib.value) === null) { toast('Départ et objectif requis'); return; }
        if (ty.value === '1RM' && !exs.value) { toast('Choisis un exercice principal'); return; }
        S.data.config.objectifs.push({ id: uid(), type: ty.value, exercice: ty.value === '1RM' ? exs.value : '', depart: num(dep.value), cible: num(cib.value), ddebut: todayStr(), dcible: dt.value || '' });
        saveConfig('objectifs'); closeModal(); render();
      } }))));
}

/* --- Reglages --- */
function tabSettings() {
  const wrap = h('div', {});
  const defs = [
    ['seuil_oubli_h', 'Séance considérée comme oubliée après (h)', 4],
    ['stagnation_semaines', 'Alerte de stagnation après (semaines)', 4],
    ['drop_pct', 'Réduction des dropsets (%)', 20],
    ['repos_defaut', 'Repos par défaut (s)', 90],
    ['cible_seances_semaine', 'Objectif de séances par semaine', '']
  ];
  const inputs = {};
  const card1 = h('div', { class: 'card' }, h('h2', { text: 'Réglages' }));
  defs.forEach(function (d) {
    inputs[d[0]] = h('input', { type: 'text', inputmode: 'decimal', value: fmtN(setting(d[0], d[2] === '' ? null : d[2])), placeholder: d[2] === '' ? 'optionnel' : '' });
    card1.append(field(d[1], inputs[d[0]]));
  });
  const vib = h('input', { type: 'checkbox', checked: setting('vibration', 0) === 1 });
  card1.append(field('Vibration en fin de repos (écran allumé)', vib, 'inline'));
  card1.append(h('button', { class: 'btn primary', text: 'Enregistrer', onclick: function () {
    const rows = [];
    defs.forEach(function (d) { const v = num(inputs[d[0]].value); if (v !== null) rows.push({ cle: d[0], valeur: v }); });
    rows.push({ cle: 'vibration', valeur: vib.checked ? 1 : 0 });
    S.data.config.reglages = rows; saveConfig('reglages'); toast('Réglages enregistrés');
  } }));
  wrap.append(card1);

  const card2 = h('div', { class: 'card' }, h('h2', { text: 'Connexion' }),
    h('p', { class: 'small muted', text: S.cfg.url ? 'Moteur : …' + S.cfg.url.slice(-28) : 'Non connecté' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', text: 'Synchroniser', onclick: async function () { toast('Synchronisation…'); await refresh(); toast(S.syncErr ? 'Échec : ' + S.syncErr.slice(0, 40) : 'À jour'); } }),
      h('button', { class: 'btn ghost', text: 'Modifier', onclick: function () { go('setup'); } })));
  if (!(S.data.config.exercices || []).length) card2.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn ghost', text: 'Charger l\'exemple Push / Pull / Legs', onclick: seedExample })));
  wrap.append(card2);
  return wrap;
}

/* --- Exemple de depart --- */
function seedExample() {
  const E = [
    ['dc-barre', 'Développé couché barre', 'Pectoraux', 'charge', 'oui', 150, 2.5],
    ['dc-incline-halteres', 'Développé incliné haltères', 'Pectoraux', 'charge', 'non', 120, 2],
    ['dev-militaire', 'Développé militaire', 'Épaules', 'charge', 'oui', 150, 2.5],
    ['elevations-laterales', 'Élévations latérales', 'Épaules', 'charge', 'non', 60, 1],
    ['dips', 'Dips', 'Triceps', 'poids_du_corps', 'non', 120, 2.5],
    ['extension-triceps-poulie', 'Extension triceps poulie', 'Triceps', 'charge', 'non', 60, 2.5],
    ['tractions', 'Tractions', 'Dos', 'poids_du_corps', 'non', 120, 2.5],
    ['rowing-barre', 'Rowing barre', 'Dos', 'charge', 'oui', 120, 2.5],
    ['tirage-vertical', 'Tirage vertical', 'Dos', 'charge', 'non', 90, 2.5],
    ['face-pull', 'Face pull', 'Épaules', 'charge', 'non', 60, 2.5],
    ['curl-barre', 'Curl barre', 'Biceps', 'charge', 'non', 75, 2.5],
    ['curl-marteau', 'Curl marteau', 'Biceps', 'charge', 'non', 60, 1],
    ['squat', 'Squat', 'Quadriceps', 'charge', 'oui', 180, 2.5],
    ['presse', 'Presse à cuisses', 'Quadriceps', 'charge', 'oui', 150, 5],
    ['souleve-roumain', 'Soulevé de terre roumain', 'Ischios', 'charge', 'non', 120, 2.5],
    ['leg-curl', 'Leg curl', 'Ischios', 'charge', 'non', 75, 2.5],
    ['mollets-debout', 'Mollets debout', 'Mollets', 'charge', 'non', 60, 5],
    ['crunch', 'Crunch', 'Abdos', 'poids_du_corps', 'non', 60, 2.5]
  ];
  const C = S.data.config;
  C.exercices = E.map(function (x) { return { id: x[0], nom: x[1], groupe: x[2], type: x[3], principal: x[4], repos: x[5], pas: x[6], pile: '' }; });
  const pid = uid();
  C.programmes = [{ id: pid, nom: 'Programme 1', debut: todayStr(), actif: 'oui' }];
  const mk = function (nom, ordre, ids) { const id = uid(); return { m: { id: id, programme: pid, nom: nom, ordre: ordre, jour: '' }, p: ids.map(function (e, i) { return { modele: id, exercice: e[0], ordre: i + 1, series: e[1], rmin: e[2], rmax: e[3] }; }) }; };
  const push = mk('Push', 1, [['dc-barre', 4, 6, 8], ['dev-militaire', 3, 8, 10], ['dc-incline-halteres', 3, 8, 12], ['elevations-laterales', 3, 12, 15], ['extension-triceps-poulie', 3, 10, 12]]);
  const pull = mk('Pull', 2, [['rowing-barre', 4, 6, 8], ['tractions', 3, 6, 10], ['tirage-vertical', 3, 8, 12], ['face-pull', 3, 12, 15], ['curl-barre', 3, 8, 10], ['curl-marteau', 3, 10, 12]]);
  const legs = mk('Legs', 3, [['squat', 4, 6, 8], ['presse', 3, 8, 12], ['souleve-roumain', 3, 8, 10], ['leg-curl', 3, 10, 12], ['mollets-debout', 4, 10, 15], ['crunch', 3, 12, 15]]);
  C.modeles = [push.m, pull.m, legs.m];
  C.plan = push.p.concat(pull.p, legs.p);
  ['exercices', 'programmes', 'modeles', 'plan'].forEach(saveConfig);
  render(); toast('Exemple chargé');
}

/* ================================================================== */
/* Demarrage                                                           */
/* ================================================================== */
function init() {
  render();
  window.addEventListener('online', function () { flush().then(refresh); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { flush(); tick(); } });
  setInterval(tick, 500);
  if (S.cfg.url) { flush().then(refresh); }
  checkStale();
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
}
window.__muscu = { S: S, render: render, flush: flush, refresh: refresh, startSession: startSession, validateSet: validateSet, startDrop: startDrop, startTest: startTest, finishSession: finishSession, openFinish: openFinish, openGo: openGo, seedExample: seedExample, tick: tick, checkStale: checkStale, getDraft: getDraft, activeModels: activeModels, suggestModel: suggestModel };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
