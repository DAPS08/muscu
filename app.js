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
const VERSION = '1.5', VERSION_DATE = '26/11/2026';
const GROUP_COLORS = { 'Pectoraux': '#ef6f6c', 'Dos': '#5b9dff', 'Épaules': '#f5a35b', 'Biceps': '#3ddc97', 'Triceps': '#b18cff', 'Quadriceps': '#4fd1d9', 'Ischios': '#e4c44f', 'Fessiers': '#ff8fc2', 'Mollets': '#8fbf5b', 'Abdos': '#a8b3c7', 'Autre': '#7d8596' };
function gcolor(g) { return GROUP_COLORS[g] || GROUP_COLORS['Autre']; }
const THEMES = [['vert', 'Vert', '#3ddc97'], ['bleu', 'Bleu', '#5b9dff'], ['orange', 'Orange', '#ffa24d'], ['violet', 'Violet', '#b18cff'], ['rose', 'Rose', '#ff7eb6'], ['jaune', 'Jaune', '#f2cf4a']];
function applyTheme(id) {
  const t = THEMES.find(function (x) { return x[0] === id; }) || THEMES[0], hex = t[2];
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const st = document.documentElement.style;
  st.setProperty('--accent', hex);
  st.setProperty('--accent-soft', 'rgba(' + r + ',' + g + ',' + b + ',.14)');
  st.setProperty('--accent-line', 'rgba(' + r + ',' + g + ',' + b + ',.45)');
  st.setProperty('--accent-glow', 'rgba(' + r + ',' + g + ',' + b + ',.28)');
}
const BGS = [['degrade', 'Dégradé + points'], ['points', 'Points'], ['grille', 'Grille'], ['diagonales', 'Diagonales'], ['emojis', 'Emojis'], ['uni', 'Uni']];
function applyBg(id) { document.documentElement.setAttribute('data-bg', BGS.some(function (b) { return b[0] === id; }) ? id : 'degrade'); }
/* Nom d'exercice : le mouvement, puis le materiel entre parentheses en petit */
function exLabel(nom) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(String(nom || ''));
  if (!m) return [String(nom || '')];
  return [h('span', { class: 'exn', text: m[1] }), ' ', h('span', { class: 'eq', text: '(' + m[2] + ')' })];
}
function fmtDateFr(iso) { const d = new Date(iso); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(); }
const EVENTS = ['Malade', 'Blessure', 'Resto', 'Mauvaise nuit', 'Voyage', 'Autre'];

/* Catalogue de base : charge automatiquement une fois, sans doublons. [id, nom, groupe, type, principal, repos (s), pas (kg)] */
const CATALOG = [
  ['dc-barre', 'DC (Barre libre)', 'Pectoraux', 'charge', 'oui', 150, 2.5],
  ['dc-halteres', 'DC (Haltères)', 'Pectoraux', 'charge', 'non', 120, 2],
  ['dc-smith-machine', 'DC (Smith machine)', 'Pectoraux', 'charge', 'non', 120, 2.5],
  ['dc-machine', 'DC (Machine convergente)', 'Pectoraux', 'charge', 'non', 90, 5],
  ['dc-incline-barre', 'DC incliné (Barre libre)', 'Pectoraux', 'charge', 'non', 120, 2.5],
  ['dc-incline-halteres', 'DC incliné (Haltères)', 'Pectoraux', 'charge', 'non', 120, 2],
  ['dc-incline-smith-machine', 'DC incliné (Smith machine)', 'Pectoraux', 'charge', 'non', 120, 2.5],
  ['dc-incline-machine', 'DC incliné (Machine)', 'Pectoraux', 'charge', 'non', 90, 5],
  ['dc-decline', 'DC décliné (Barre libre)', 'Pectoraux', 'charge', 'non', 120, 2.5],
  ['dc-decline-halteres', 'DC décliné (Haltères)', 'Pectoraux', 'charge', 'non', 120, 2],
  ['dc-decline-smith-machine', 'DC décliné (Smith machine)', 'Pectoraux', 'charge', 'non', 120, 2.5],
  ['ecarte-halteres', 'Écarté (Haltères)', 'Pectoraux', 'charge', 'non', 75, 1],
  ['ecarte-incline-halteres', 'Écarté incliné (Haltères)', 'Pectoraux', 'charge', 'non', 75, 1],
  ['ecarte-poulie', 'Écarté (Poulie vis-à-vis)', 'Pectoraux', 'charge', 'non', 75, 2.5],
  ['pec-deck', 'Pec deck (Machine)', 'Pectoraux', 'charge', 'non', 75, 5],
  ['pompes', 'Pompes (Poids du corps)', 'Pectoraux', 'poids_du_corps', 'non', 75, 2.5],
  ['pompes-lestees-poids-du-corps', 'Pompes lestées (Poids du corps)', 'Pectoraux', 'poids_du_corps', 'non', 90, 2.5],
  ['tractions', 'Tractions (Poids du corps)', 'Dos', 'poids_du_corps', 'non', 120, 2.5],
  ['tractions-neutre', 'Tractions prise neutre (Poids du corps)', 'Dos', 'poids_du_corps', 'non', 120, 2.5],
  ['tractions-assistees-machine', 'Tractions assistées (Machine)', 'Dos', 'charge', 'non', 90, 5],
  ['tirage-vertical', 'Tirage vertical (Poulie)', 'Dos', 'charge', 'non', 90, 5],
  ['tirage-vertical-serre', 'Tirage vertical prise serrée (Poulie)', 'Dos', 'charge', 'non', 90, 5],
  ['tirage-vertical-prise-neutre-poulie', 'Tirage vertical prise neutre (Poulie)', 'Dos', 'charge', 'non', 90, 5],
  ['tirage-vertical-machine', 'Tirage vertical (Machine)', 'Dos', 'charge', 'non', 90, 5],
  ['rowing-barre', 'Rowing (Barre libre)', 'Dos', 'charge', 'oui', 120, 2.5],
  ['rowing-smith-machine', 'Rowing (Smith machine)', 'Dos', 'charge', 'non', 120, 2.5],
  ['rowing-halteres', 'Rowing (Haltères)', 'Dos', 'charge', 'non', 90, 2],
  ['rowing-haltere', 'Rowing unilatéral (Haltère)', 'Dos', 'charge', 'non', 90, 2],
  ['rowing-buste-appuye-halteres', 'Rowing buste appuyé (Haltères)', 'Dos', 'charge', 'non', 90, 2],
  ['rowing-poulie', 'Rowing (Poulie basse)', 'Dos', 'charge', 'non', 90, 5],
  ['rowing-machine', 'Rowing (Machine)', 'Dos', 'charge', 'non', 90, 5],
  ['rowing-t-bar', 'Rowing T-bar (Machine)', 'Dos', 'charge', 'non', 90, 2.5],
  ['souleve-de-terre', 'Soulevé de terre (Barre libre)', 'Dos', 'charge', 'oui', 180, 2.5],
  ['pull-over-poulie', 'Pull-over (Poulie)', 'Dos', 'charge', 'non', 75, 2.5],
  ['pull-over-haltere', 'Pull-over (Haltère)', 'Dos', 'charge', 'non', 75, 1],
  ['shrugs', 'Shrugs (Barre libre)', 'Dos', 'charge', 'non', 75, 2.5],
  ['shrugs-halteres', 'Shrugs (Haltères)', 'Dos', 'charge', 'non', 75, 2],
  ['shrugs-smith-machine', 'Shrugs (Smith machine)', 'Dos', 'charge', 'non', 75, 2.5],
  ['lombaires', 'Extensions lombaires (Banc à lombaires)', 'Dos', 'poids_du_corps', 'non', 75, 2.5],
  ['dev-militaire', 'Militaire (Barre libre)', 'Épaules', 'charge', 'oui', 150, 2.5],
  ['dev-epaules-halteres', 'Militaire (Haltères)', 'Épaules', 'charge', 'non', 120, 2],
  ['militaire-smith-machine', 'Militaire (Smith machine)', 'Épaules', 'charge', 'non', 120, 2.5],
  ['dev-epaules-machine', 'Militaire (Machine)', 'Épaules', 'charge', 'non', 90, 5],
  ['arnold-press', 'Arnold press (Haltères)', 'Épaules', 'charge', 'non', 90, 2],
  ['elevations-laterales', 'Élévations latérales (Haltères)', 'Épaules', 'charge', 'non', 60, 1],
  ['elevations-laterales-poulie', 'Élévations latérales (Poulie)', 'Épaules', 'charge', 'non', 60, 2.5],
  ['elevations-laterales-machine', 'Élévations latérales (Machine)', 'Épaules', 'charge', 'non', 60, 5],
  ['elevations-frontales', 'Élévations frontales (Haltères)', 'Épaules', 'charge', 'non', 60, 1],
  ['elevations-frontales-barre-libre', 'Élévations frontales (Barre libre)', 'Épaules', 'charge', 'non', 60, 2.5],
  ['elevations-frontales-poulie', 'Élévations frontales (Poulie)', 'Épaules', 'charge', 'non', 60, 2.5],
  ['oiseau-halteres', 'Oiseau (Haltères)', 'Épaules', 'charge', 'non', 60, 1],
  ['oiseau-machine', 'Oiseau (Machine)', 'Épaules', 'charge', 'non', 60, 5],
  ['oiseau-poulie-vis-a-vis', 'Oiseau (Poulie vis-à-vis)', 'Épaules', 'charge', 'non', 60, 2.5],
  ['face-pull', 'Face pull (Poulie)', 'Épaules', 'charge', 'non', 60, 2.5],
  ['tirage-menton-barre-libre', 'Tirage menton (Barre libre)', 'Épaules', 'charge', 'non', 75, 2.5],
  ['curl-barre', 'Curl (Barre libre)', 'Biceps', 'charge', 'non', 75, 2.5],
  ['curl-barre-ez', 'Curl (Barre EZ)', 'Biceps', 'charge', 'non', 75, 2.5],
  ['curl-halteres', 'Curl (Haltères)', 'Biceps', 'charge', 'non', 60, 1],
  ['curl-marteau', 'Curl marteau (Haltères)', 'Biceps', 'charge', 'non', 60, 1],
  ['curl-marteau-poulie-corde', 'Curl marteau (Poulie corde)', 'Biceps', 'charge', 'non', 60, 2.5],
  ['curl-pupitre', 'Curl pupitre (Barre EZ)', 'Biceps', 'charge', 'non', 60, 2.5],
  ['curl-pupitre-machine', 'Curl pupitre (Machine)', 'Biceps', 'charge', 'non', 60, 5],
  ['curl-pupitre-haltere', 'Curl pupitre (Haltère)', 'Biceps', 'charge', 'non', 60, 1],
  ['curl-incline', 'Curl incliné (Haltères)', 'Biceps', 'charge', 'non', 60, 1],
  ['curl-poulie-basse', 'Curl (Poulie basse)', 'Biceps', 'charge', 'non', 60, 2.5],
  ['curl-concentre', 'Curl concentré (Haltère)', 'Biceps', 'charge', 'non', 60, 1],
  ['dips', 'Dips (Poids du corps)', 'Triceps', 'poids_du_corps', 'non', 120, 2.5],
  ['dips-machine', 'Dips (Machine)', 'Triceps', 'charge', 'non', 90, 5],
  ['extension-triceps-poulie', 'Extension triceps (Poulie barre)', 'Triceps', 'charge', 'non', 60, 2.5],
  ['extension-triceps-corde', 'Extension triceps (Poulie corde)', 'Triceps', 'charge', 'non', 60, 2.5],
  ['extension-triceps-machine', 'Extension triceps (Machine)', 'Triceps', 'charge', 'non', 60, 5],
  ['barre-au-front', 'Barre au front (Barre EZ)', 'Triceps', 'charge', 'non', 90, 2.5],
  ['barre-au-front-halteres', 'Barre au front (Haltères)', 'Triceps', 'charge', 'non', 90, 1],
  ['extension-nuque', 'Extension nuque (Haltère)', 'Triceps', 'charge', 'non', 60, 1],
  ['extension-nuque-poulie-corde', 'Extension nuque (Poulie corde)', 'Triceps', 'charge', 'non', 60, 2.5],
  ['kickback-triceps', 'Kickback triceps (Haltère)', 'Triceps', 'charge', 'non', 60, 1],
  ['kickback-triceps-poulie', 'Kickback triceps (Poulie)', 'Triceps', 'charge', 'non', 60, 2.5],
  ['dc-serre', 'DC prise serrée (Barre libre)', 'Triceps', 'charge', 'non', 120, 2.5],
  ['dc-prise-serree-smith-machine', 'DC prise serrée (Smith machine)', 'Triceps', 'charge', 'non', 120, 2.5],
  ['squat', 'Squat (Barre libre)', 'Quadriceps', 'charge', 'oui', 180, 2.5],
  ['squat-smith-machine', 'Squat (Smith machine)', 'Quadriceps', 'charge', 'non', 150, 2.5],
  ['squat-avant', 'Squat avant (Barre libre)', 'Quadriceps', 'charge', 'non', 150, 2.5],
  ['presse', 'Presse à cuisses (Machine)', 'Quadriceps', 'charge', 'oui', 150, 5],
  ['hack-squat', 'Hack squat (Machine)', 'Quadriceps', 'charge', 'non', 120, 5],
  ['leg-extension', 'Leg extension (Machine)', 'Quadriceps', 'charge', 'non', 75, 5],
  ['fentes-marchees', 'Fentes marchées (Haltères)', 'Quadriceps', 'charge', 'non', 90, 2],
  ['fentes-barre-libre', 'Fentes (Barre libre)', 'Quadriceps', 'charge', 'non', 90, 2.5],
  ['fentes-smith-machine', 'Fentes (Smith machine)', 'Quadriceps', 'charge', 'non', 90, 2.5],
  ['fentes-bulgares', 'Fentes bulgares (Haltères)', 'Quadriceps', 'charge', 'non', 90, 2],
  ['fentes-bulgares-smith-machine', 'Fentes bulgares (Smith machine)', 'Quadriceps', 'charge', 'non', 90, 2.5],
  ['goblet-squat', 'Goblet squat (Haltère)', 'Quadriceps', 'charge', 'non', 90, 2],
  ['step-up-halteres', 'Step-up (Haltères)', 'Quadriceps', 'charge', 'non', 90, 2],
  ['souleve-roumain', 'Soulevé de terre roumain (Barre libre)', 'Ischios', 'charge', 'non', 120, 2.5],
  ['souleve-de-terre-roumain-halteres', 'Soulevé de terre roumain (Haltères)', 'Ischios', 'charge', 'non', 120, 2],
  ['souleve-de-terre-roumain-smith-machine', 'Soulevé de terre roumain (Smith machine)', 'Ischios', 'charge', 'non', 120, 2.5],
  ['leg-curl', 'Leg curl assis (Machine)', 'Ischios', 'charge', 'non', 75, 5],
  ['leg-curl-allonge', 'Leg curl allongé (Machine)', 'Ischios', 'charge', 'non', 75, 5],
  ['good-morning', 'Good morning (Barre libre)', 'Ischios', 'charge', 'non', 90, 2.5],
  ['hip-thrust', 'Hip thrust (Barre libre)', 'Fessiers', 'charge', 'non', 120, 5],
  ['hip-thrust-smith-machine', 'Hip thrust (Smith machine)', 'Fessiers', 'charge', 'non', 120, 5],
  ['hip-thrust-machine', 'Hip thrust (Machine)', 'Fessiers', 'charge', 'non', 120, 5],
  ['abduction-machine', 'Abduction (Machine)', 'Fessiers', 'charge', 'non', 60, 5],
  ['adduction-machine', 'Adduction (Machine)', 'Fessiers', 'charge', 'non', 60, 5],
  ['kickback-poulie', 'Kickback fessiers (Poulie)', 'Fessiers', 'charge', 'non', 60, 2.5],
  ['kickback-fessiers-machine', 'Kickback fessiers (Machine)', 'Fessiers', 'charge', 'non', 60, 5],
  ['mollets-debout', 'Mollets debout (Machine)', 'Mollets', 'charge', 'non', 60, 5],
  ['mollets-debout-smith-machine', 'Mollets debout (Smith machine)', 'Mollets', 'charge', 'non', 60, 5],
  ['mollets-assis', 'Mollets assis (Machine)', 'Mollets', 'charge', 'non', 60, 5],
  ['mollets-presse', 'Mollets (Presse)', 'Mollets', 'charge', 'non', 60, 5],
  ['mollets-unilateral-haltere', 'Mollets unilatéral (Haltère)', 'Mollets', 'charge', 'non', 60, 2],
  ['crunch', 'Crunch (Poids du corps)', 'Abdos', 'poids_du_corps', 'non', 60, 2.5],
  ['crunch-poulie', 'Crunch (Poulie)', 'Abdos', 'charge', 'non', 60, 2.5],
  ['crunch-machine', 'Crunch (Machine)', 'Abdos', 'charge', 'non', 60, 5],
  ['crunch-decline-banc-decline', 'Crunch décliné (Banc décliné)', 'Abdos', 'poids_du_corps', 'non', 60, 2.5],
  ['releve-jambes', 'Relevé de jambes (Chaise romaine)', 'Abdos', 'poids_du_corps', 'non', 60, 2.5],
  ['roue-abdominale', 'Roue abdominale (Poids du corps)', 'Abdos', 'poids_du_corps', 'non', 60, 2.5]
];

/* Anciens identifiants (catalogue v1), pour la mise a jour automatique */
const OLD_CATALOG_IDS = ['dc-barre', 'dc-halteres', 'dc-incline-barre', 'dc-incline-halteres', 'dc-decline', 'dc-machine', 'ecarte-halteres', 'ecarte-poulie', 'pec-deck', 'pompes', 'tractions', 'tractions-neutre', 'tirage-vertical', 'tirage-vertical-serre', 'rowing-barre', 'rowing-haltere', 'rowing-poulie', 'rowing-machine', 'rowing-t-bar', 'souleve-de-terre', 'pull-over-poulie', 'shrugs', 'lombaires', 'dev-militaire', 'dev-epaules-halteres', 'dev-epaules-machine', 'arnold-press', 'elevations-laterales', 'elevations-laterales-poulie', 'elevations-frontales', 'oiseau-halteres', 'oiseau-machine', 'face-pull', 'curl-barre', 'curl-barre-ez', 'curl-halteres', 'curl-marteau', 'curl-pupitre', 'curl-incline', 'curl-poulie-basse', 'curl-concentre', 'dips', 'extension-triceps-poulie', 'extension-triceps-corde', 'barre-au-front', 'extension-nuque', 'kickback-triceps', 'dc-serre', 'squat', 'squat-avant', 'presse', 'hack-squat', 'leg-extension', 'fentes-marchees', 'fentes-bulgares', 'goblet-squat', 'souleve-roumain', 'leg-curl', 'leg-curl-allonge', 'good-morning', 'hip-thrust', 'abduction-machine', 'kickback-poulie', 'mollets-debout', 'mollets-assis', 'mollets-presse', 'crunch', 'crunch-poulie', 'releve-jambes', 'roue-abdominale'];
const CATALOG_VER = 2;

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
    sessions: [], measures: [], activities: [], events: []
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
/* Ancien moteur sans activites/evenements : on garde ce qui a ete saisi sur ce telephone */
function keepLocal(d) {
  if (!d.activities) d.activities = (S.data && S.data.activities) || [];
  if (!d.events) d.events = (S.data && S.data.events) || [];
}
async function refresh() {
  if (!S.cfg.url || !S.cfg.key) return;
  await flush();
  if (S.outbox.length) return;
  try {
    const j = await api({ action: 'bootstrap' });
    keepLocal(j.data);
    S.data = j.data;
    LS.set('data', S.data);
    maybeSeedCatalog();
    S.syncErr = '';
    if (S.view === 'home') render();
  } catch (e) {
    S.syncErr = e && e.message ? e.message : 'hors ligne';
  }
  renderBadge();
}
/* Catalogue : ajoute les exercices de base absents (par id), sans toucher aux autres */
function seedCatalog() {
  const C = S.data.config, have = {};
  (C.exercices || []).forEach(function (e) { have[e.id] = true; });
  const add = CATALOG.filter(function (x) { return !have[x[0]]; }).map(function (x) {
    return { id: x[0], nom: x[1], groupe: x[2], type: x[3], principal: x[4], repos: x[5], pas: x[6], pile: '' };
  });
  if (!add.length) return 0;
  C.exercices = (C.exercices || []).concat(add);
  saveConfig('exercices');
  return add.length;
}
/* Premiere connexion : catalogue vide -> charge une fois. Ancien catalogue v1 -> renomme, retire les anciens inutilises, complete. */
function maybeSeedCatalog() {
  if (LS.get('catalogVer', 0) >= CATALOG_VER) return;
  const C = S.data.config, ex = C.exercices || [];
  if (!ex.length) {
    if (LS.get('catalogSeeded', false)) { LS.set('catalogVer', CATALOG_VER); return; }
    if (seedCatalog()) { LS.set('catalogSeeded', true); LS.set('catalogVer', CATALOG_VER); toast('Catalogue d\'exercices ajouté'); }
    return;
  }
  if (!ex.some(function (e) { return OLD_CATALOG_IDS.indexOf(e.id) >= 0; })) { LS.set('catalogVer', CATALOG_VER); return; }
  const byId = {};
  CATALOG.forEach(function (x) { byId[x[0]] = x; });
  const used = JSON.stringify([C.plan || [], C.objectifs || [], S.data.history || {}]);
  C.exercices = ex.filter(function (e) {
    return !(OLD_CATALOG_IDS.indexOf(e.id) >= 0 && !byId[e.id] && used.indexOf('"' + e.id + '"') < 0);
  });
  C.exercices.forEach(function (e) { if (byId[e.id] && OLD_CATALOG_IDS.indexOf(e.id) >= 0) { e.nom = byId[e.id][1]; e.groupe = byId[e.id][2]; } });
  seedCatalog();
  saveConfig('exercices');
  LS.set('catalogSeeded', true); LS.set('catalogVer', CATALOG_VER);
  toast('Catalogue d\'exercices mis à jour');
}
/* Exercices tries par groupe musculaire puis par nom */
function exList() {
  return (S.data.config.exercices || []).slice().sort(function (a, b) {
    const ga = GROUPES.indexOf(a.groupe), gb = GROUPES.indexOf(b.groupe);
    return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || String(a.nom).localeCompare(String(b.nom), 'fr');
  });
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
    const newer = function (cur) { return !cur || Date.parse(cur.date) <= Date.parse(rec.date); };
    if (A.modele) { H.lastByModel[A.modele] = H.lastByModel[A.modele] || {}; if (newer(H.lastByModel[A.modele][exId])) H.lastByModel[A.modele][exId] = rec; }
    if (newer(H.lastAny[exId])) H.lastAny[exId] = rec;
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
          keepLocal(j.data); S.data = j.data; LS.set('data', S.data); LS.set('cfg', S.cfg); maybeSeedCatalog();
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
  root.append(topbar('Outil de suivi', h('button', { class: 'btn small ghost', text: '⚙', onclick: function () { go('manage'); } })));
  const empty = !(S.data.config.modeles || []).length;
  if (S.active) {
    root.append(h('div', { class: 'card' },
      h('h2', { text: 'Séance en cours' }),
      h('p', { class: 'muted', text: S.active.past ? S.active.nom + ' · séance passée du ' + fmtDateFr(S.active.start) : S.active.nom + ' · démarrée à ' + hhmm(Date.parse(S.active.start)) }),
      h('button', { class: 'btn primary', text: 'Reprendre la séance', onclick: function () { go('session'); } })));
  } else if (empty) {
    root.append(h('div', { class: 'card' },
      h('h2', { text: 'Bienvenue' }),
      h('p', { class: 'muted', text: 'Ton catalogue d\'exercices est prêt. Crée ta première séance, ou charge l\'exemple Push / Pull / Legs pour démarrer vite et l\'adapter ensuite.' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', text: 'Charger l\'exemple', onclick: seedExample }),
        h('button', { class: 'btn ghost', text: 'Créer mes séances', onclick: function () { S.tab = 'seances'; go('manage'); } }))));
  } else {
    root.append(h('button', { class: 'go', onclick: openGo }, 'GO!', h('small', { text: 'Lancer une séance' })));
  }
  root.append(h('div', { class: 'grid2 quick' },
    h('button', { class: 'btn ghost', text: '⚖ Poids', onclick: openWeigh }),
    h('button', { class: 'btn ghost', text: '🏃 Autre sport', onclick: openSport }),
    h('button', { class: 'btn ghost', text: '📌 Événement', onclick: openEvent }),
    h('button', { class: 'btn ghost', text: '🕘 Séance passée', onclick: openPast })));
  if (!empty) root.append(renderCalendar());
  root.append(renderKpis());
  return root;
}

/* ------------------------------------------------------------------ */
/* Calendrier du mois                                                  */
/* ------------------------------------------------------------------ */
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const EV_COLORS = { 'Malade': '#e4c44f', 'Blessure': '#ff4fa3', 'Resto': '#b18cff', 'Mauvaise nuit': '#7f93b8', 'Voyage': '#4fd1d9', 'Autre': '#a8b3c7' };
function dayOf(iso) { return todayStr(new Date(iso)); }
function addDays(k, n) { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }
function calModel(y, m) {
  const sess = {}, acts = {}, evs = {};
  (S.data.sessions || []).forEach(function (x) { const k = dayOf(x.debut); (sess[k] = sess[k] || []).push(x); });
  (S.data.activities || []).forEach(function (x) { const k = String(x.date).slice(0, 10); (acts[k] = acts[k] || []).push(x); });
  (S.data.events || []).forEach(function (x) {
    let k = String(x.debut).slice(0, 10); const end = String(x.fin || x.debut).slice(0, 10);
    for (let i = 0; i < 90 && k <= end; i++) { (evs[k] = evs[k] || []).push(x); k = addDays(k, 1); }
  });
  const planned = {};
  activeModels().forEach(function (mo) { const dk = dayKey(mo.jour); if (dk) (planned[dk] = planned[dk] || []).push(mo.nom); });
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = addDays(todayStr(first), -offset);
  const total = Math.ceil((offset + last.getDate()) / 7) * 7;
  const today = todayStr();
  const sessKeys = Object.keys(sess).sort();
  const firstDay = sessKeys.length && sessKeys[0] < today ? sessKeys[0] : today;
  const DK = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const days = [];
  for (let i = 0; i < total; i++) {
    const k = addDays(gridStart, i), d = new Date(k + 'T12:00:00');
    days.push({ k: k, num: d.getDate(), inMonth: d.getMonth() === m, sess: sess[k] || [], acts: acts[k] || [], evs: evs[k] || [], plan: k >= firstDay ? (planned[DK[d.getDay()]] || []) : [], cls: '', sportDot: false });
  }
  for (let w = 0; w < total; w += 7) {
    const week = days.slice(w, w + 7), missed = [];
    let extra = 0;
    week.forEach(function (d) {
      const hasS = d.sess.length > 0, hasA = d.acts.length > 0, plan = d.plan.length > 0;
      if (hasS) { d.cls = 'done'; d.sportDot = hasA; if (!plan) extra++; }
      else if (hasA && plan) d.cls = 'stripe';
      else if (hasA) { d.cls = ''; d.sportDot = true; }
      else if (plan) { if (d.k >= today) d.cls = 'ring'; else missed.push(d); }
    });
    missed.forEach(function (d, i) { d.cls = i < extra ? 'moved' : 'missed'; });
  }
  return days;
}
function openDay(d) {
  const dt = new Date(d.k + 'T12:00:00');
  const rows = [];
  d.sess.forEach(function (x) { const mo = MOD(x.modele); rows.push(h('p', {}, h('b', { text: '🏋 ' + (mo ? mo.nom : 'Séance') }), ' · ' + hhmm(Date.parse(x.debut)) + (x.duree ? ' · ' + x.duree + ' min' : ''))); });
  d.acts.forEach(function (x) { rows.push(h('p', {}, h('b', { text: '🏃 ' + x.sport }), x.duree !== '' && x.duree !== undefined && x.duree !== null ? ' · ' + x.duree + ' min' : '')); });
  d.evs.forEach(function (x) { rows.push(h('p', {}, h('b', { text: '📌 ' + x.type }), x.note ? ' · ' + x.note : '')); });
  if (!rows.length) rows.push(h('p', { class: 'muted', text: d.plan.length ? 'Prévu : ' + d.plan.join(', ') + ' · rien enregistré' : 'Rien d\'enregistré.' }));
  else if (d.plan.length && !d.sess.length) rows.push(h('p', { class: 'small muted', text: 'Prévu : ' + d.plan.join(', ') }));
  openModal(h('div', {}, h('h2', { text: dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }),
    h('div', {}, rows), h('div', { class: 'row' }, h('button', { class: 'btn primary grow', text: 'Fermer', onclick: closeModal }))));
}
function renderCalendar() {
  const card = h('div', { class: 'card' });
  const now = new Date();
  S.cal = S.cal || { y: now.getFullYear(), m: now.getMonth() };
  function draw() {
    card.innerHTML = '';
    const y = S.cal.y, m = S.cal.m, days = calModel(y, m), today = todayStr();
    const move = function (n) { const d = new Date(y, m + n, 1); S.cal = { y: d.getFullYear(), m: d.getMonth() }; draw(); };
    card.append(h('div', { class: 'calnav' },
      h('button', { class: 'btn small ghost', text: '‹', onclick: function () { move(-1); } }),
      h('h2', { class: 'grow', text: MONTHS[m] + ' ' + y }),
      h('button', { class: 'btn small ghost', text: '›', onclick: function () { move(1); } })));
    const grid = h('div', { class: 'cal' });
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (l, i) { grid.append(h('span', { class: 'calh' + (i >= 5 ? ' we' : ''), text: l })); });
    days.forEach(function (d) {
      if (!d.inMonth) { grid.append(h('span', { class: 'cday blank' })); return; }
      const evTypes = []; d.evs.forEach(function (e) { if (evTypes.indexOf(e.type) < 0) evTypes.push(e.type); });
      const dots = h('span', { class: 'cdots' });
      if (d.sportDot) dots.append(h('i', { class: 'sd' }));
      evTypes.slice(0, 2).forEach(function (t) { dots.append(h('i', { style: 'background:' + (EV_COLORS[t] || EV_COLORS.Autre) })); });
      grid.append(h('button', { class: 'cday', onclick: function () { openDay(d); } },
        h('span', { class: 'cn ' + d.cls + (d.k === today ? ' today' : ''), text: String(d.num) }), dots));
    });
    card.append(grid);
    const inM = days.filter(function (d) { return d.inMonth; });
    const ns = inM.reduce(function (a, d) { return a + d.sess.length; }, 0), na = inM.reduce(function (a, d) { return a + d.acts.length; }, 0);
    card.append(h('p', { class: 'small muted', style: 'margin:10px 0 6px', text: ns + ' séance' + (ns > 1 ? 's' : '') + (na ? ' · ' + na + ' autre' + (na > 1 ? 's' : '') + ' sport' + (na > 1 ? 's' : '') : '') + ' ce mois-ci' }));
    const lg = h('div', { class: 'legend' });
    [['done', 'Séance'], ['stripe', 'Autre sport à la place'], ['ring', 'Prévue'], ['moved', 'Déplacée'], ['missed', 'Manquée']].forEach(function (x) {
      lg.append(h('span', { class: 'lg' }, h('i', { class: 'cn mini ' + x[0] }), x[1]));
    });
    lg.append(h('span', { class: 'lg' }, h('i', { class: 'sd' }), 'Autre sport'));
    card.append(lg);
    const evl = h('div', { class: 'legend' });
    Object.keys(EV_COLORS).forEach(function (t) { evl.append(h('span', { class: 'lg' }, h('i', { class: 'edot', style: 'background:' + EV_COLORS[t] }), t)); });
    card.append(evl);
  }
  draw();
  return card;
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
/* Saisie d'une seance deja faite : date et heure au choix, series horodatees dans cette seance */
function openPast() {
  if (S.active) { toast('Termine d\'abord la séance en cours'); return; }
  const date = h('input', { type: 'date', value: todayStr(new Date(Date.now() - 86400000)), max: todayStr() });
  const time = h('input', { type: 'time', value: '18:00' });
  const dur = h('input', { type: 'text', inputmode: 'numeric', value: '60' });
  const ms = activeModels();
  const sel = h('select', {}, opts(ms.map(function (m) { return [m.id, m.nom]; }).concat([['', 'Séance libre (sans plan)']]), ms.length ? ms[0].id : ''));
  openModal(h('div', {}, h('h2', { text: 'Séance passée' }),
    h('p', { class: 'small muted', text: 'Pour reprendre une séance notée ailleurs. Elle compte dans l\'historique à la date choisie.' }),
    field('Séance', sel), field('Date', date), field('Heure de début', time), field('Durée estimée (min)', dur),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', text: 'Annuler', onclick: closeModal }),
      h('button', { class: 'btn primary grow', text: 'Saisir les séries', onclick: function () {
        const t = Date.parse(date.value + 'T' + (time.value || '18:00'));
        if (isNaN(t) || t > Date.now()) { toast('Date invalide ou dans le futur'); return; }
        closeModal();
        startSession(MOD(sel.value) || null, { start: new Date(t).toISOString(), dur: Math.max(1, Math.round(num(dur.value) || 60)) });
      } }))));
}
function startSession(m, past) {
  const id = uid(), now = past ? past.start : new Date().toISOString();
  S.active = {
    id: id, modele: m ? m.id : '', nom: m ? m.nom : 'Séance libre', start: now,
    exercises: m ? planRows(m.id).map(function (p) { return p.exercice; }) : [],
    sets: [], restStart: null, restTarget: 0, past: !!past, pastDur: past ? past.dur : 0
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
      h('span', { id: 't-global', class: 'pill', text: '⏱ 0:00' }),
      h('span', { id: 't-rest', class: 'pill rest', title: 'Toucher pour arrêter le repos', onclick: function () { A.restStart = null; persistActive(); tick(); } }))));
  const list = h('div', { id: 'cards' });
  A.exercises.forEach(function (id) { list.append(card(id)); });
  root.append(list);
  root.append(h('div', { class: 'row' },
    h('button', { class: 'btn ghost grow', text: 'Ajouter exos', onclick: addExercisePicker }),
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
  const el = h('div', { class: 'card gc', id: 'card-' + exId, style: '--gc:' + gcolor(ex.groupe) });
  if (ex.groupe) el.append(h('div', { class: 'gtag' }, h('span', { class: 'gdot' }), h('span', { text: ex.groupe })));
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
  if (!S.active.past) sub.append(h('button', { class: 'btn small ghost', text: '⏱ Repos', onclick: function () { startRest(exId); } }));
  el.append(sub);
  return el;
}

/* Chrono de repos manuel : demarre quand on le demande, monte, change de couleur au repos conseille */
function startRest(exId) {
  const A = S.active, ex = EX(exId) || {};
  A.restStart = Date.now(); A.restTarget = num(ex.repos) || setting('repos_defaut', 90); A.vibrated = false;
  persistActive(); tick();
}
function validateSet(exId) {
  const A = S.active, ex = EX(exId) || { type: 'charge' }, bw = ex.type === 'poids_du_corps', d = S.drafts[exId];
  if (!d) return;
  const c = num(d.charge), r = d.type === 'test_1RM' ? 1 : num(d.reps);
  if (c === null || r === null || r <= 0 || (!bw && !(c > 0))) { toast('Charge et reps requises'); return; }
  const id = uid();
  const set = { id: id, ex: exId, numero: d.numero, type: d.type, groupe: d.groupe || id, ordre: d.ordre, charge: c, reps: Math.round(r), ts: A.past ? new Date(Date.parse(A.start) + (A.sets.length + 1) * 180000).toISOString() : new Date().toISOString(), note: '' };
  A.sets.push(set);
  A.restStart = null;
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
  A.restStart = null; persistActive();
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
/* Liste d'exercices avec un titre colore par groupe musculaire (selecteurs) */
function pickerGroups(list, rows, onPick) {
  list.innerHTML = '';
  let last = null;
  rows.forEach(function (e) {
    const g = e.groupe || 'Autre';
    if (g !== last) { last = g; list.append(h('div', { class: 'gtitle', style: '--gc:' + gcolor(g) }, h('span', { class: 'gdot' }), h('span', { text: g }))); }
    list.append(h('div', { class: 'item exi', style: '--gc:' + gcolor(g), onclick: function () { onPick(e); } },
      h('span', {}, exLabel(e.nom)), e.principal === 'oui' ? h('span', { class: 'small', style: 'color:var(--warn)', text: '★' }) : null));
  });
}
function addExercisePicker() {
  const A = S.active;
  const search = h('input', { type: 'text', placeholder: 'Rechercher un exercice' });
  const list = h('div', { class: 'list exl' });
  function fill() {
    list.innerHTML = '';
    const q = norm(search.value);
    pickerGroups(list, exList().filter(function (e) { return A.exercises.indexOf(e.id) < 0 && (!q || norm(e.nom).indexOf(q) >= 0); }), function (e) {
      A.exercises.push(e.id); persistActive(); closeModal();
      $('cards').append(card(e.id)); toast(e.nom + ' ajouté');
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
  if (A.past) { if (g) g.textContent = '🕘 ' + fmtDateFr(A.start); if (r) r.textContent = ''; return; }
  if (g) g.textContent = '⏱ ' + mmss(Date.now() - Date.parse(A.start));
  if (r) {
    if (A.restStart && Date.now() - A.restStart > 30 * 60000) A.restStart = null;
    if (A.restStart) {
      const el = Date.now() - A.restStart, reached = A.restTarget && el >= A.restTarget * 1000;
      r.textContent = 'Repos ' + mmss(el) + (A.restTarget ? ' / ' + mmss(A.restTarget * 1000) : '');
      r.classList.toggle('reached', !!reached);
      if (reached && !A.vibrated) {
        A.vibrated = true;
        if (setting('vibration', 0) && !document.hidden && navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    } else { r.textContent = ''; r.classList.remove('reached'); }
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
  if (A.past) {
    const lt = Date.parse(sets[sets.length - 1].ts);
    const dur = h('input', { type: 'text', inputmode: 'numeric', value: A.pastDur || 60 });
    const pnote = h('textarea', { placeholder: 'Commentaire (optionnel)' });
    openModal(h('div', {}, h('h2', { text: 'Enregistrer la séance passée' }),
      h('p', { class: 'muted', text: 'Du ' + fmtDateFr(A.start) + ' à ' + hhmm(Date.parse(A.start)) + ' · ' + sets.length + ' séries' }),
      field('Durée (min)', dur), pnote,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost grow', text: 'Continuer', onclick: closeModal }),
        h('button', { class: 'btn primary grow', text: 'Enregistrer', onclick: function () {
          closeModal();
          const end = Math.max(Date.parse(A.start) + Math.max(1, num(dur.value) || 60) * 60000, lt + 60000);
          finishSession(new Date(end).toISOString(), pnote.value.trim());
        } }))));
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
  S.data.sessions.sort(function (a, b) { return Date.parse(a.debut) - Date.parse(b.debut); });
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
  if (!A || A.past) return;
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
  openModal(h('div', {}, h('h2', { text: 'Poids' }),
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
        closeModal(); if (S.view === 'home') render(); toast('Poids enregistré');
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
        (S.data.activities = S.data.activities || []).push({ date: date.value || todayStr(), sport: name, duree: num(dur.value) === null ? '' : num(dur.value) }); LS.set('data', S.data);
        closeModal(); toast('Activité enregistrée'); if (S.view === 'home') render();
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
        (S.data.events = S.data.events || []).push({ debut: a, fin: d2.value || a, type: type.value, note: note.value.trim() }); LS.set('data', S.data);
        closeModal(); toast('Événement enregistré'); if (S.view === 'home') render();
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
  const box = h('div', {});
  const openG = LS.get('openGroups', {});
  function fill() {
    box.innerHTML = '';
    const q = norm(search.value);
    const rows = exList().filter(function (e) { return !q || norm(e.nom).indexOf(q) >= 0; });
    const by = {};
    rows.forEach(function (e) { const g = e.groupe || 'Autre'; (by[g] = by[g] || []).push(e); });
    GROUPES.concat(Object.keys(by).filter(function (g) { return GROUPES.indexOf(g) < 0; })).forEach(function (g) {
      if (!by[g]) return;
      const open = q ? true : !!openG[g];
      const gc = h('div', { class: 'gcard' + (open ? ' open' : ''), style: '--gc:' + gcolor(g) });
      gc.append(h('button', { class: 'ghead', onclick: function () { openG[g] = !openG[g]; LS.set('openGroups', openG); fill(); } },
        h('span', { class: 'gdot' }), h('span', { class: 'gname', text: g }), h('span', { class: 'gcount', text: String(by[g].length) }), h('span', { class: 'gchev', text: open ? '▾' : '▸' })));
      if (open) {
        const body = h('div', { class: 'list exl gbody' });
        by[g].forEach(function (e) {
          body.append(h('div', { class: 'item exi', onclick: function () { exerciseForm(e); } },
            h('span', {}, exLabel(e.nom), e.principal === 'oui' ? h('span', { style: 'color:var(--warn)', text: ' ★' }) : null),
            h('span', { class: 'small muted', text: e.type === 'poids_du_corps' ? 'PdC' : '' })));
        });
        gc.append(body);
      }
      box.append(gc);
    });
    if (!rows.length) box.append(h('p', { class: 'muted', text: 'Aucun exercice.' }));
  }
  search.addEventListener('input', fill); fill();
  wrap.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, h('div', { class: 'grow' }, search),
    h('button', { class: 'btn primary', text: 'Nouvel exo', onclick: function () { exerciseForm(null); } })), box);
  wrap.append(h('div', { style: 'margin-top:4px' },
    h('p', { class: 'small muted', text: (S.data.config.exercices || []).length + ' exercices · ★ = principal (objectif 1RM)' }),
    h('button', { class: 'btn small ghost', text: 'Compléter avec le catalogue de base', onclick: function () {
      const n = seedCatalog(); toast(n ? n + ' exercice(s) ajouté(s)' : 'Catalogue déjà complet'); render();
    } })));
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
        if (isNew && (S.data.config.exercices || []).some(function (x) { return norm(x.nom) === norm(nom.value); })) { toast('Cet exercice existe déjà'); return; }
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
        h('button', { class: 'btn ghost grow', text: 'Ajouter exos', onclick: function () { pickForPlan(m, draw); } }),
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
  const list = h('div', { class: 'list exl' });
  function fill() {
    list.innerHTML = '';
    const q = norm(search.value), used = planRows(m.id).map(function (p) { return p.exercice; });
    pickerGroups(list, exList().filter(function (e) { return used.indexOf(e.id) < 0 && (!q || norm(e.nom).indexOf(q) >= 0); }), function (e) {
      S.data.config.plan.push({ modele: m.id, exercice: e.id, ordre: used.length + 1, series: 3, rmin: 8, rmax: 12 });
      back();
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
  const mains = exList().filter(function (e) { return e.principal === 'oui'; });
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
  card1.append(field('Vibration quand le repos conseillé est atteint (écran allumé)', vib, 'inline'));
  card1.append(h('button', { class: 'btn primary', text: 'Enregistrer', onclick: function () {
    const rows = [];
    defs.forEach(function (d) { const v = num(inputs[d[0]].value); if (v !== null) rows.push({ cle: d[0], valeur: v }); });
    rows.push({ cle: 'vibration', valeur: vib.checked ? 1 : 0 });
    S.data.config.reglages = rows; saveConfig('reglages'); toast('Réglages enregistrés');
  } }));
  wrap.append(card1);

  const curTheme = LS.get('theme', 'vert');
  const sw = h('div', { class: 'swatches' });
  THEMES.forEach(function (t) {
    sw.append(h('button', { class: 'swatch' + (curTheme === t[0] ? ' on' : ''), style: 'background:' + t[2], title: t[1], 'aria-label': t[1], onclick: function () { LS.set('theme', t[0]); applyTheme(t[0]); render(); } }));
  });
  const curBg = LS.get('bg', 'degrade');
  const bgs = h('div', { class: 'chips' });
  BGS.forEach(function (b) {
    bgs.append(h('button', { class: 'btn small ' + (curBg === b[0] ? 'primary' : 'ghost'), text: b[1], onclick: function () { LS.set('bg', b[0]); applyBg(b[0]); render(); } }));
  });
  wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Apparence' }),
    h('p', { class: 'small muted', text: 'Couleur principale (réglage propre à ce téléphone).' }), sw,
    h('p', { class: 'small muted', style: 'margin-top:12px', text: 'Fond de l\'écran' }), bgs));
  wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Partager' }),
    h('p', { class: 'small muted', text: 'Envoie le lien de l\'appli (jamais ton moteur, ta clé ni tes données). Un ami aura besoin de son propre Google Sheet : envoie-lui aussi le guide de mise en place.' }),
    h('button', { class: 'btn ghost', text: '↗ Partager l\'appli', onclick: shareApp })));
  const card2 = h('div', { class: 'card' }, h('h2', { text: 'Connexion' }),
    h('p', { class: 'small muted', text: S.cfg.url ? 'Moteur : …' + S.cfg.url.slice(-28) : 'Non connecté' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', text: 'Synchroniser', onclick: async function () { toast('Synchronisation…'); await refresh(); toast(S.syncErr ? 'Échec : ' + S.syncErr.slice(0, 40) : 'À jour'); } }),
      h('button', { class: 'btn ghost', text: 'Modifier', onclick: function () { go('setup'); } })));
  if (!(S.data.config.modeles || []).length) card2.append(h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn ghost', text: 'Charger l\'exemple Push / Pull / Legs', onclick: seedExample })));
  wrap.append(card2);
  wrap.append(h('div', { class: 'card' }, h('h2', { text: 'À propos' }),
    h('p', { class: 'small muted', text: 'Outil de suivi · version ' + VERSION + ' · ' + VERSION_DATE }),
    h('button', { class: 'btn ghost', text: '↻ Rechercher une mise à jour', onclick: updateApp })));
  return wrap;
}

/* Vide le cache de l'appli puis la recharge (les series en attente restent sur le telephone) */
async function updateApp() {
  toast('Recherche de mise à jour…');
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map(function (r) { return r.unregister(); }));
    }
    if (window.caches && caches.keys) {
      const ks = await caches.keys();
      await Promise.all(ks.map(function (k) { return caches.delete(k); }));
    }
    await Promise.all(['./', './index.html', './app.js', './style.css', './sw.js', './manifest.webmanifest'].map(function (u) { return fetch(u, { cache: 'reload' }).catch(function () { return null; }); }));
  } catch (e) { /* on recharge quand meme */ }
  location.reload();
}

async function shareApp() {
  const url = location.href.split('#')[0].split('?')[0].replace(/index\.html$/, '');
  const text = 'Suivi muscu : appli gratuite à installer depuis Chrome (⋮ puis Installer l\'application).';
  if (navigator.share) { try { await navigator.share({ title: 'Suivi muscu', text: text, url: url }); } catch (e) { /* annule */ } return; }
  try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch (e) { prompt('Copie ce lien', url); }
}

/* --- Exemple de depart --- */
function seedExample() {
  const C = S.data.config;
  seedCatalog();
  const pid = uid();
  const hasActive = (C.programmes || []).some(function (x) { return String(x.actif).toLowerCase() === 'oui'; });
  C.programmes = (C.programmes || []).concat([{ id: pid, nom: 'Programme ' + ((C.programmes || []).length + 1), debut: todayStr(), actif: hasActive ? 'non' : 'oui' }]);
  const mk = function (nom, ordre, ids) { const id = uid(); return { m: { id: id, programme: pid, nom: nom, ordre: ordre, jour: '' }, p: ids.map(function (e, i) { return { modele: id, exercice: e[0], ordre: i + 1, series: e[1], rmin: e[2], rmax: e[3] }; }) }; };
  const push = mk('Push', 1, [['dc-barre', 4, 6, 8], ['dev-militaire', 3, 8, 10], ['dc-incline-halteres', 3, 8, 12], ['elevations-laterales', 3, 12, 15], ['extension-triceps-poulie', 3, 10, 12]]);
  const pull = mk('Pull', 2, [['rowing-barre', 4, 6, 8], ['tractions', 3, 6, 10], ['tirage-vertical', 3, 8, 12], ['face-pull', 3, 12, 15], ['curl-barre', 3, 8, 10], ['curl-marteau', 3, 10, 12]]);
  const legs = mk('Legs', 3, [['squat', 4, 6, 8], ['presse', 3, 8, 12], ['souleve-roumain', 3, 8, 10], ['leg-curl', 3, 10, 12], ['mollets-debout', 4, 10, 15], ['crunch', 3, 12, 15]]);
  C.modeles = (C.modeles || []).concat([push.m, pull.m, legs.m]);
  C.plan = (C.plan || []).concat(push.p, pull.p, legs.p);
  ['exercices', 'programmes', 'modeles', 'plan'].forEach(saveConfig);
  render(); toast('Exemple chargé');
}

/* ================================================================== */
/* Demarrage                                                           */
/* ================================================================== */
function init() {
  applyTheme(LS.get('theme', 'vert'));
  applyBg(LS.get('bg', 'degrade'));
  render();
  window.addEventListener('online', function () { flush().then(refresh); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { flush(); tick(); } });
  setInterval(tick, 500);
  if (S.cfg.url) { flush().then(refresh); }
  checkStale();
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
}
window.__muscu = { seedCatalog: seedCatalog, openPast: openPast, applyTheme: applyTheme, calModel: calModel, renderCalendar: renderCalendar, startRest: startRest, updateApp: updateApp, applyBg: applyBg, shareApp: shareApp, exList: exList, S: S, render: render, flush: flush, refresh: refresh, startSession: startSession, validateSet: validateSet, startDrop: startDrop, startTest: startTest, finishSession: finishSession, openFinish: openFinish, openGo: openGo, seedExample: seedExample, tick: tick, checkStale: checkStale, getDraft: getDraft, activeModels: activeModels, suggestModel: suggestModel };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
