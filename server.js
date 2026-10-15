// Dihmon List - a small demon list website.
// No dependencies: run `node server.js`. Data is kept in data.json next to this file.
// Set ADMIN_PASSWORD (required for the admin page) and optionally PORT and DATA_FILE.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAIN = 75, EXTENDED = 150;

// ------------------------------------------------------------------ data
function emptyData() { return { levels: [], records: [], submissions: [], players: {}, nextId: 1 }; }
let db;
try { db = Object.assign(emptyData(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
catch (e) { db = emptyData(); }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DATA_FILE);
  }, 50);
}
const newId = () => String(db.nextId++);
const now = () => new Date().toISOString();

// ------------------------------------------------------------------ scoring
// Full score by position (350 at #1, falling off; nothing past #150). A progress record (between the level's
// minimum percent and 100) is worth a tenth of the full score at the minimum, rising to the full score at 100.
function fullScore(pos) { return pos > EXTENDED ? 0 : Math.round(350 * Math.exp(-(pos - 1) * 0.0437) * 100) / 100; }
function recordScore(pos, min, pct) {
  const full = fullScore(pos);
  if (pct >= 100) return full;
  if (pos > MAIN || !min || pct < min) return 0;
  return Math.round(full * Math.pow(10, (pct - min) / (100 - min)) / 10 * 100) / 100;
}
function sorted() { return db.levels.slice().sort((a, b) => a.position - b.position); }
function renumber(reason, mover) {
  sorted().forEach((lv, i) => {
    const pos = i + 1;
    lv.history = lv.history || [];
    const was = lv.history.length ? lv.history[lv.history.length - 1].position : null;
    if (was !== pos) lv.history.push({ date: now(), position: pos, change: was == null ? null : was - pos, reason: lv === mover || !mover ? reason : mover.name + ': ' + reason.toLowerCase() });
    lv.position = pos;
  });
}
function placeLevel(lv, pos, reason) {
  const L = sorted().filter(x => x !== lv);
  pos = Math.max(1, Math.min(pos || L.length + 1, L.length + 1));
  L.splice(pos - 1, 0, lv);
  if (!db.levels.includes(lv)) db.levels.push(lv);
  L.forEach((x, i) => { x.position = i + 1; });
  renumber(reason, lv);
}
function players() {
  const map = {};
  for (const r of db.records) {
    if (r.status !== 'approved') continue;
    const key = r.player.toLowerCase();
    if (db.players[key] && db.players[key].banned) continue;
    const lv = db.levels.find(l => l.id === r.levelId);
    if (!lv) continue;
    const p = map[key] || (map[key] = { name: r.player, score: 0, completions: [], progress: [] });
    const s = recordScore(lv.position, lv.minPercent, r.percent);
    p.score += s;
    (r.percent >= 100 ? p.completions : p.progress).push({ levelId: lv.id, name: lv.name, position: lv.position, percent: r.percent, score: s });
  }
  return Object.values(map).map(p => (p.score = Math.round(p.score * 100) / 100, p)).sort((a, b) => b.score - a.score)
    .map((p, i) => Object.assign(p, { rank: i + 1 }));
}
function publicLevel(lv, full) {
  const out = {
    id: lv.id, position: lv.position, name: lv.name, creators: lv.creators, publisher: lv.publisher, verifier: lv.verifier,
    video: lv.video, thumbnail: lv.thumbnail, minPercent: lv.minPercent, score: fullScore(lv.position),
    minScore: lv.minPercent && lv.position <= MAIN ? recordScore(lv.position, lv.minPercent, lv.minPercent) : null,
  };
  if (full) Object.assign(out, {
    quote: lv.quote, levelId: lv.levelId, password: lv.password, length: lv.length, objects: lv.objects, difficulty: lv.difficulty,
    createdIn: lv.createdIn, song: lv.song, history: lv.history || [],
    records: db.records.filter(r => r.levelId === lv.id && r.status === 'approved' && !(db.players[r.player.toLowerCase()] || {}).banned)
      .sort((a, b) => b.percent - a.percent || a.date.localeCompare(b.date)).map(r => ({ player: r.player, percent: r.percent, video: r.video, date: r.date })),
  });
  return out;
}

// ------------------------------------------------------------------ input cleaning
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const url = v => { const s = str(v, 400); return /^https:\/\/[^\s<>"]+$/i.test(s) ? s : ''; };
function levelFields(b) {
  return {
    name: str(b.name, 80), creators: str(b.creators, 200), publisher: str(b.publisher, 80), verifier: str(b.verifier, 80),
    video: url(b.video), thumbnail: url(b.thumbnail), quote: str(b.quote, 200), levelId: str(b.levelId, 20), password: str(b.password, 40),
    length: str(b.length, 20), objects: str(b.objects, 20), difficulty: str(b.difficulty, 40) || 'Extreme Demon', createdIn: str(b.createdIn, 20),
    song: str(b.song, 160), minPercent: num(b.minPercent, 1, 100) || null,
  };
}

// ------------------------------------------------------------------ http
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const want = Buffer.from(ADMIN_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
const hits = new Map();
function limited(req) {
  const ip = req.socket.remoteAddress || '?';
  const t = Date.now(), list = (hits.get(ip) || []).filter(x => t - x < 10 * 60 * 1000);
  list.push(t); hits.set(ip, list);
  return list.length > 15;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, p) {
  const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => { res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] }); res.end(idx || 'Not found'); });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

async function api(req, res, p) {
  const m = req.method;
  const parts = p.split('/').filter(Boolean).slice(1);   // after "api"
  try {
    // ---- public
    if (m === 'GET' && parts[0] === 'list') return send(res, 200, { levels: sorted().map(l => publicLevel(l, false)), main: MAIN, extended: EXTENDED });
    if (m === 'GET' && parts[0] === 'levels' && parts[1]) {
      const lv = db.levels.find(l => l.id === parts[1]);
      return lv ? send(res, 200, publicLevel(lv, true)) : send(res, 404, { error: 'No such level.' });
    }
    if (m === 'GET' && parts[0] === 'players') return send(res, 200, players());
    if (m === 'POST' && parts[0] === 'submit') {
      if (limited(req)) return send(res, 429, { error: 'Too many submissions. Try again in a few minutes.' });
      const b = await readBody(req, 20000);
      const by = str(b.submitter, 40);
      if (parts[1] === 'record') {
        const lv = db.levels.find(l => l.id === str(b.levelId, 20));
        const player = str(b.player, 40), pct = num(b.percent, 1, 100), video = url(b.video);
        if (!lv) return send(res, 400, { error: 'Pick a level from the list.' });
        if (!player) return send(res, 400, { error: 'Enter the player name.' });
        if (!video) return send(res, 400, { error: 'A record needs a video link starting with https://.' });
        if (pct == null || (pct < 100 && (lv.position > MAIN || !lv.minPercent || pct < lv.minPercent)))
          return send(res, 400, { error: lv.position > MAIN ? 'Extended and legacy levels only take 100% records.' : 'That percent is below the level\'s minimum (' + (lv.minPercent || 100) + '%).' });
        db.submissions.push({ id: newId(), type: 'record', date: now(), submitter: by, levelId: lv.id, player, percent: pct, video, note: str(b.note, 300) });
        save(); return send(res, 200, { ok: true });
      }
      if (parts[1] === 'level') {
        const f = levelFields(b);
        if (!f.name) return send(res, 400, { error: 'Enter the level name.' });
        if (!f.video) return send(res, 400, { error: 'Add the verification video (a link starting with https://).' });
        db.submissions.push(Object.assign({ id: newId(), type: 'level', date: now(), submitter: by, suggested: num(b.suggested, 1, 10000), note: str(b.note, 300) }, f));
        save(); return send(res, 200, { ok: true });
      }
    }
    // ---- admin
    if (parts[0] === 'admin') {
      if (!ADMIN_PASSWORD) return send(res, 503, { error: 'Admin is off: set the ADMIN_PASSWORD environment variable and restart.' });
      if (!isAdmin(req)) return send(res, 401, { error: 'Wrong admin password.' });
      const rest = parts.slice(1);
      if (m === 'GET' && rest[0] === 'check') return send(res, 200, { ok: true });
      if (m === 'GET' && rest[0] === 'submissions') return send(res, 200, db.submissions.map(s => Object.assign({}, s, s.type === 'record' ? { levelName: (db.levels.find(l => l.id === s.levelId) || {}).name || '(deleted level)' } : {})));
      if (m === 'POST' && rest[0] === 'submissions' && rest[1]) {
        const i = db.submissions.findIndex(s => s.id === rest[1]);
        if (i < 0) return send(res, 404, { error: 'Already handled.' });
        const s = db.submissions[i];
        if (rest[2] === 'approve') {
          const b = await readBody(req, 5000);
          if (s.type === 'record') {
            if (!db.levels.find(l => l.id === s.levelId)) return send(res, 400, { error: 'That level was deleted.' });
            db.records.push({ id: newId(), levelId: s.levelId, player: s.player, percent: s.percent, video: s.video, date: now(), status: 'approved' });
          } else {
            const lv = Object.assign({ id: newId(), history: [] }, levelFields(s));
            placeLevel(lv, num(b.position, 1, 10000) || s.suggested, 'Added to the list');
          }
        }
        db.submissions.splice(i, 1); save();
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && rest[0] === 'levels' && !rest[1]) {
        const b = await readBody(req, 20000), f = levelFields(b);
        if (!f.name) return send(res, 400, { error: 'Enter the level name.' });
        const lv = Object.assign({ id: newId(), history: [] }, f);
        placeLevel(lv, num(b.position, 1, 10000), 'Added to the list'); save();
        return send(res, 200, publicLevel(lv, true));
      }
      if (rest[0] === 'levels' && rest[1]) {
        const lv = db.levels.find(l => l.id === rest[1]);
        if (!lv) return send(res, 404, { error: 'No such level.' });
        if (m === 'PUT') {
          const b = await readBody(req, 20000), f = levelFields(b);
          if (!f.name) return send(res, 400, { error: 'Enter the level name.' });
          Object.assign(lv, f);
          const pos = num(b.position, 1, 10000);
          if (pos && pos !== lv.position) placeLevel(lv, pos, str(b.reason, 120) || (pos < lv.position ? 'Moved up' : 'Moved down'));
          save(); return send(res, 200, publicLevel(lv, true));
        }
        if (m === 'DELETE') {
          db.levels = db.levels.filter(l => l !== lv);
          db.records = db.records.filter(r => r.levelId !== lv.id);
          renumber(lv.name + ' was removed'); save();
          return send(res, 200, { ok: true });
        }
      }
      if (m === 'GET' && rest[0] === 'records') return send(res, 200, db.records.map(r => Object.assign({}, r, { levelName: (db.levels.find(l => l.id === r.levelId) || {}).name })));
      if (m === 'DELETE' && rest[0] === 'records' && rest[1]) { db.records = db.records.filter(r => r.id !== rest[1]); save(); return send(res, 200, { ok: true }); }
      if (m === 'POST' && rest[0] === 'players' && rest[1]) {
        const b = await readBody(req, 2000), key = decodeURIComponent(rest[1]).toLowerCase();
        db.players[key] = Object.assign(db.players[key] || {}, { banned: !!b.banned }); save();
        return send(res, 200, { ok: true });
      }
      if (m === 'GET' && rest[0] === 'players') return send(res, 200, db.players);
      if (m === 'GET' && rest[0] === 'export') return send(res, 200, db);
      if (m === 'POST' && rest[0] === 'import') {
        const b = await readBody(req, 10 * 1024 * 1024);
        if (!b || !Array.isArray(b.levels)) return send(res, 400, { error: 'That file is not a Dihmon List export.' });
        db = Object.assign(emptyData(), b);
        db.nextId = Math.max(db.nextId || 1, ...[...db.levels, ...db.records, ...db.submissions].map(x => parseInt(x.id, 10) + 1 || 1));
        renumber('Imported'); save();
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'Not found.' });
  } catch (e) {
    send(res, 400, { error: e.message === 'too big' ? 'That is too big.' : 'Bad request.' });
  }
}

http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.startsWith('/api/')) return api(req, res, p);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
}).listen(PORT, () => {
  console.log('Dihmon List on http://localhost:' + PORT + (ADMIN_PASSWORD ? '' : '  (admin is off: set ADMIN_PASSWORD)'));
});
