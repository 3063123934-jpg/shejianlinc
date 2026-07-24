'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CASES_FILE = path.join(DATA_DIR, 'cases.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const PORT = process.env.PORT || 3000;
const MAX_BODY = 120 * 1024 * 1024; // 120MB (base64 images)
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

// ---------- bootstrap storage ----------
function ensureStorage() {
  for (const d of [DATA_DIR, UPLOAD_DIR, PUBLIC_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  if (!fs.existsSync(CASES_FILE)) fs.writeFileSync(CASES_FILE, '[]');
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ searchDescription: '' }, null, 2));
  }
  if (!fs.existsSync(ADMIN_FILE)) {
    const salt = crypto.randomBytes(16).toString('hex');
    const admin = {
      username: 'naxisheji123',
      salt,
      passwordHash: hashPassword('123456@', salt),
    };
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2));
  }
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
}

function hashPassword(pw, salt) {
  return crypto.createHash('sha256').update(salt + '::' + pw).digest('hex');
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// ---------- sessions (persisted) ----------
let sessions = readJSON(SESSIONS_FILE, {});
function saveSessions() {
  writeJSON(SESSIONS_FILE, sessions);
}
function pruneSessions() {
  const now = Date.now();
  let changed = false;
  for (const t of Object.keys(sessions)) {
    if (!sessions[t] || sessions[t].expires < now) {
      delete sessions[t];
      changed = true;
    }
  }
  if (changed) saveSessions();
}
pruneSessions();

// ---------- helpers ----------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJSONBody(req) {
  return readBody(req).then((buf) => {
    if (buf.length === 0) return {};
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error('BAD_JSON');
    }
  });
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function requireAuth(req, res) {
  const token = getToken(req);
  const s = token && sessions[token];
  if (!s || s.expires < Date.now()) {
    sendJSON(res, 401, { error: '未登录或登录已过期' });
    return null;
  }
  return s;
}

// base64 image -> write file, return {id, file, ext, size}
function saveImage(caseId, dataUrl, originalName) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('INVALID_IMAGE');
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, 'base64');
  let ext = 'bin';
  if (mime === 'image/jpeg' || mime === 'image/jpg') ext = 'jpg';
  else if (mime === 'image/png') ext = 'png';
  else if (mime === 'image/webp') ext = 'webp';
  else if (mime === 'image/gif') ext = 'gif';
  const dir = path.join(UPLOAD_DIR, caseId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomBytes(8).toString('hex');
  const file = id + '.' + ext;
  fs.writeFileSync(path.join(dir, file), buf);
  return { id, name: originalName || file, file, ext, size: buf.length };
}

function parseTags(text) {
  if (!text) return [];
  return String(text)
    .split(/[，,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function caseImageUrl(c, img) {
  return `/uploads/${c.id}/${img.file}`;
}

// sort: pinned first, then displayOrder asc, then createdAt desc
function sortCases(arr) {
  return arr.slice().sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const oa = a.displayOrder || 0;
    const ob = b.displayOrder || 0;
    if (oa !== ob) return oa - ob;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function getCover(c) {
  const imgs = c.images || [];
  if (c.coverImageId) {
    const f = imgs.find((i) => i.id === c.coverImageId);
    if (f) return f;
  }
  return imgs[0];
}

function publicSummary(c) {
  const cover = getCover(c);
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    tags: c.tags || [],
    coverUrl: cover ? caseImageUrl(c, cover) : null,
    imageCount: (c.images || []).length,
    pinned: !!c.pinned,
    createdAt: c.createdAt,
  };
}

function publicDetail(c) {
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    tags: c.tags || [],
    description: c.description || '',
    pinned: !!c.pinned,
    coverImageId: c.coverImageId || null,
    images: (c.images || []).map((img) => ({
      id: img.id,
      url: caseImageUrl(c, img),
      name: img.name,
    })),
    createdAt: c.createdAt,
  };
}

// ---------- static ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function serveStatic(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method.toUpperCase();

    // uploads (static, protected by being non-guessable ids but public for gallery)
    if (pathname.startsWith('/uploads/')) {
      const rel = path.normalize(pathname.replace(/^\/uploads\//, ''));
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      return serveStatic(res, path.join(UPLOAD_DIR, rel));
    }

    // public static
    if (method === 'GET') {
      if (pathname === '/' || pathname === '/index.html') {
        return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
      }
      if (pathname === '/admin' || pathname === '/admin.html') {
        return serveStatic(res, path.join(PUBLIC_DIR, 'admin.html'));
      }
      const rel = path.normalize(pathname.replace(/^\//, ''));
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        const target = path.join(PUBLIC_DIR, rel);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          return serveStatic(res, target);
        }
      }
    }

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      // admin login
      if (method === 'POST' && pathname === '/api/admin/login') {
        const body = await parseJSONBody(req);
        const admin = readJSON(ADMIN_FILE, {});
        const ok = body.username === admin.username &&
          admin.passwordHash === hashPassword(body.password || '', admin.salt);
        if (!ok) return sendJSON(res, 401, { error: '用户名或密码错误' });
        const token = crypto.randomBytes(24).toString('hex');
        sessions[token] = { username: admin.username, expires: Date.now() + SESSION_TTL };
        saveSessions();
        return sendJSON(res, 200, { token, username: admin.username });
      }

      // admin logout
      if (method === 'POST' && pathname === '/api/admin/logout') {
        const token = getToken(req);
        if (token) { delete sessions[token]; saveSessions(); }
        return sendJSON(res, 200, { ok: true });
      }

      // check auth
      if (method === 'GET' && pathname === '/api/admin/me') {
        const s = requireAuth(req, res); if (!s) return;
        return sendJSON(res, 200, { username: s.username });
      }

      // change password
      if (method === 'PUT' && pathname === '/api/admin/password') {
        const s = requireAuth(req, res); if (!s) return;
        const body = await parseJSONBody(req);
        const admin = readJSON(ADMIN_FILE, {});
        if (admin.passwordHash !== hashPassword(body.oldPassword || '', admin.salt)) {
          return sendJSON(res, 400, { error: '原密码不正确' });
        }
        if (!body.newPassword || String(body.newPassword).length < 6) {
          return sendJSON(res, 400, { error: '新密码至少 6 位' });
        }
        admin.passwordHash = hashPassword(body.newPassword, admin.salt);
        writeJSON(ADMIN_FILE, admin);
        return sendJSON(res, 200, { ok: true });
      }

      // public settings (search description)
      if (method === 'GET' && pathname === '/api/settings') {
        const settings = readJSON(SETTINGS_FILE, { searchDescription: '' });
        return sendJSON(res, 200, settings);
      }
      // admin update settings
      if (method === 'PUT' && pathname === '/api/settings') {
        const auth = requireAuth(req, res); if (!auth) return;
        const body = await parseJSONBody(req);
        const settings = readJSON(SETTINGS_FILE, { searchDescription: '' });
        if (typeof body.searchDescription === 'string') {
          settings.searchDescription = body.searchDescription;
        }
        writeJSON(SETTINGS_FILE, settings);
        return sendJSON(res, 200, settings);
      }

      // public list cases (with search + filter + pagination)
      if (method === 'GET' && pathname === '/api/cases') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const category = url.searchParams.get('category') || '';
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10)));
        let cases = readJSON(CASES_FILE, []);
        cases = sortCases(cases);
        if (category && category !== '全部') {
          cases = cases.filter((c) => c.category === category);
        }
        if (q) {
          cases = cases.filter((c) => {
            const hay = ((c.title || '') + ' ' + (c.tags || []).join(' ') + ' ' + (c.category || '')).toLowerCase();
            return hay.includes(q);
          });
        }
        const total = cases.length;
        const start = (page - 1) * limit;
        const slice = cases.slice(start, start + limit).map(publicSummary);
        return sendJSON(res, 200, { items: slice, total, page, limit, hasMore: start + limit < total });
      }

      // public case detail
      if (method === 'GET' && pathname.startsWith('/api/cases/')) {
        const id = pathname.split('/').pop();
        const cases = readJSON(CASES_FILE, []);
        const c = cases.find((x) => x.id === id);
        if (!c) return sendJSON(res, 404, { error: '案例不存在' });
        return sendJSON(res, 200, publicDetail(c));
      }

      // create case (admin)
      if (method === 'POST' && pathname === '/api/cases') {
        const auth = requireAuth(req, res); if (!auth) return;
        const body = await parseJSONBody(req);
        const cases = readJSON(CASES_FILE, []);
        const title = String(body.title || '').trim();
        if (!title) return sendJSON(res, 400, { error: '请填写案例名称' });
        const category = ['住宅', '工装', '装修灵感库'].includes(body.category) ? body.category : '住宅';
        const id = crypto.randomBytes(8).toString('hex');
        let images = [];
        if (Array.isArray(body.images)) {
          // 图片数量不限，仅受请求体大小上限(MAX_BODY)约束
          for (const im of body.images) {
            try {
              images.push(saveImage(id, im.data, im.name));
            } catch (e) {
              return sendJSON(res, 400, { error: '图片格式不支持' });
            }
          }
        }
        const now = Date.now();
        let coverImageId = null;
        if (typeof body.coverNewIndex === 'number' && body.coverNewIndex >= 0 && body.coverNewIndex < images.length) {
          coverImageId = images[body.coverNewIndex].id;
        } else if (images[0]) {
          coverImageId = images[0].id;
        }
        const c = {
          id,
          title,
          category,
          tags: parseTags(body.tagsText),
          description: String(body.description || ''),
          images,
          coverImageId,
          pinned: false,
          displayOrder: now,
          createdAt: now,
          updatedAt: now,
        };
        cases.push(c);
        writeJSON(CASES_FILE, cases);
        return sendJSON(res, 200, publicDetail(c));
      }

      // update case (admin)
      if (method === 'PUT' && pathname.startsWith('/api/cases/')) {
        const auth = requireAuth(req, res); if (!auth) return;
        const id = pathname.split('/').pop();
        const body = await parseJSONBody(req);
        const cases = readJSON(CASES_FILE, []);
        const c = cases.find((x) => x.id === id);
        if (!c) return sendJSON(res, 404, { error: '案例不存在' });
        if (typeof body.title === 'string') c.title = body.title.trim() || c.title;
        if (['住宅', '工装', '装修灵感库'].includes(body.category)) c.category = body.category;
        if (typeof body.tagsText === 'string') c.tags = parseTags(body.tagsText);
        if (typeof body.description === 'string') c.description = body.description;
        if (typeof body.pinned === 'boolean') c.pinned = body.pinned;
        if (typeof body.displayOrder === 'number') c.displayOrder = body.displayOrder;
        // remove images
        if (Array.isArray(body.removeImageIds) && body.removeImageIds.length) {
          for (const rid of body.removeImageIds) {
            const img = c.images.find((x) => x.id === rid);
            if (img) {
              const fp = path.join(UPLOAD_DIR, c.id, img.file);
              try { fs.unlinkSync(fp); } catch (e) {}
            }
          }
          c.images = c.images.filter((x) => !body.removeImageIds.includes(x.id));
        }
        // add images
        if (Array.isArray(body.addImages) && body.addImages.length) {
          for (const im of body.addImages) {
            try { c.images.push(saveImage(c.id, im.data, im.name)); }
            catch (e) { return sendJSON(res, 400, { error: '图片格式不支持' }); }
          }
        }
        // cover image (new-index wins; else explicit id; else keep)
        if (typeof body.coverNewIndex === 'number' && body.coverNewIndex >= 0 && body.coverNewIndex < c.images.length) {
          c.coverImageId = c.images[body.coverNewIndex].id;
        } else if (typeof body.coverImageId === 'string' && body.coverImageId) {
          if (c.images.some((i) => i.id === body.coverImageId)) c.coverImageId = body.coverImageId;
        }
        c.updatedAt = Date.now();
        writeJSON(CASES_FILE, cases);
        return sendJSON(res, 200, publicDetail(c));
      }

      // delete case (admin)
      if (method === 'DELETE' && pathname.startsWith('/api/cases/')) {
        const auth = requireAuth(req, res); if (!auth) return;
        const id = pathname.split('/').pop();
        const cases = readJSON(CASES_FILE, []);
        const idx = cases.findIndex((x) => x.id === id);
        if (idx === -1) return sendJSON(res, 404, { error: '案例不存在' });
        const dir = path.join(UPLOAD_DIR, id);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
        cases.splice(idx, 1);
        writeJSON(CASES_FILE, cases);
        return sendJSON(res, 200, { ok: true });
      }

      // reorder (move up/down) case (admin)
      if (method === 'POST' && /^\/api\/cases\/[^/]+\/move$/.test(pathname)) {
        const auth = requireAuth(req, res); if (!auth) return;
        const id = pathname.split('/')[3];
        const body = await parseJSONBody(req);
        const dir = body.direction === 'down' ? 'down' : 'up';
        const cases = readJSON(CASES_FILE, []);
        const sorted = sortCases(cases);
        const idx = sorted.findIndex((x) => x.id === id);
        if (idx === -1) return sendJSON(res, 404, { error: '案例不存在' });
        sorted.forEach((c, i) => { c.displayOrder = i; });
        const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) {
          writeJSON(CASES_FILE, cases);
          return sendJSON(res, 200, { ok: true });
        }
        const a = sorted[idx], b = sorted[swapIdx];
        if (!!a.pinned !== !!b.pinned) { // keep pinned / unpinned groups stable
          writeJSON(CASES_FILE, cases);
          return sendJSON(res, 200, { ok: true });
        }
        const t = a.displayOrder; a.displayOrder = b.displayOrder; b.displayOrder = t;
        writeJSON(CASES_FILE, cases);
        return sendJSON(res, 200, { ok: true });
      }

      return sendJSON(res, 404, { error: '接口不存在' });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    if (err && err.message === 'PAYLOAD_TOO_LARGE') {
      return sendJSON(res, 413, { error: '上传内容过大' });
    }
    if (err && err.message === 'BAD_JSON') {
      return sendJSON(res, 400, { error: '请求格式错误' });
    }
    console.error('Server error:', err);
    sendJSON(res, 500, { error: '服务器内部错误' });
  }
});

ensureStorage();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`室内设计案例管理系统已启动: http://localhost:${PORT}`);
  console.log(`  前台: http://localhost:${PORT}/`);
  console.log(`  后台: http://localhost:${PORT}/admin  (账号 naxisheji123 / 123456@)`);
});
