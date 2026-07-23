'use strict';

const $ = (s) => document.querySelector(s);
let token = localStorage.getItem('naxi_token') || '';

// ---------- helpers ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (opts.json) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body });
  if (res.status === 401) { logout(); throw new Error('AUTH'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { data });
  return data;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- auth ----------
function showLogin() {
  $('#loginMask').classList.remove('hide');
  $('#adminShell').classList.remove('show');
}
function showShell() {
  $('#loginMask').classList.add('hide');
  $('#adminShell').classList.add('show');
  $('#uname').textContent = '管理员';
  loadCases();
  loadSettingsToForm();
}
function logout() {
  token = '';
  localStorage.removeItem('naxi_token');
  try { fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }); } catch (e) {}
  showLogin();
}

async function doLogin() {
  const username = $('#loginUser').value.trim();
  const password = $('#loginPass').value;
  $('#loginErr').textContent = '';
  if (!username || !password) { $('#loginErr').textContent = '请输入账号和密码'; return; }
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) { $('#loginErr').textContent = data.error || '登录失败'; return; }
    token = data.token;
    localStorage.setItem('naxi_token', token);
    $('#loginPass').value = '';
    showShell();
  } catch (e) { $('#loginErr').textContent = '网络错误'; }
}

async function checkAuth() {
  if (!token) return showLogin();
  try {
    await api('/api/admin/me');
    showShell();
  } catch (e) {
    token = ''; localStorage.removeItem('naxi_token'); showLogin();
  }
}

// ---------- cases ----------
async function loadCases() {
  const list = $('#caseList');
  list.innerHTML = '<div class="stats">加载中…</div>';
  try {
    const data = await api('/api/cases?limit=200');
    const items = data.items || [];
    if (!items.length) {
      list.innerHTML = '<div class="stats">暂无案例，点击右上角“新建案例”开始添加。</div>';
      return;
    }
    list.innerHTML = '';
    for (const it of items) {
      const cover = it.coverUrl
        ? `<img src="${it.coverUrl}" alt="" loading="lazy" />`
        : '';
      const el = document.createElement('div');
      el.className = 'case-item';
      el.innerHTML = `
        <div class="ci-thumb">${cover}</div>
        <div class="ci-body">
          <div class="ci-title">${escapeHtml(it.title)}</div>
          <div class="ci-cat">${escapeHtml(it.category)} · ${it.imageCount} 图 · ${fmtDate(it.createdAt)}</div>
          <div class="ci-ops">
            <button class="btn btn-sm" data-edit="${it.id}">编辑</button>
            <button class="btn btn-sm" data-pin="${it.id}" data-pinned="${it.pinned ? 1 : 0}">${it.pinned ? '取消置顶' : '置顶'}</button>
            <button class="btn btn-sm" data-up="${it.id}" title="上移">↑</button>
            <button class="btn btn-sm" data-down="${it.id}" title="下移">↓</button>
            <button class="btn btn-sm btn-danger" data-del="${it.id}">删除</button>
          </div>
        </div>`;
      list.appendChild(el);
    }
    list.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openEditCase(b.dataset.edit)));
    list.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => deleteCase(b.dataset.del)));
    list.querySelectorAll('[data-pin]').forEach((b) =>
      b.addEventListener('click', () => togglePin(b.dataset.pin, b.dataset.pinned === '1')));
    list.querySelectorAll('[data-up]').forEach((b) =>
      b.addEventListener('click', () => moveCase(b.dataset.up, 'up')));
    list.querySelectorAll('[data-down]').forEach((b) =>
      b.addEventListener('click', () => moveCase(b.dataset.down, 'down')));
  } catch (e) {
    if (e.message !== 'AUTH') list.innerHTML = '<div class="stats">加载失败</div>';
  }
}

async function togglePin(id, isPinned) {
  try {
    await api('/api/cases/' + id, { method: 'PUT', json: { pinned: !isPinned } });
    loadCases();
  } catch (e) { toast(e.message || '操作失败'); }
}
async function moveCase(id, direction) {
  try {
    await api('/api/cases/' + id + '/move', { method: 'POST', json: { direction } });
    loadCases();
  } catch (e) { toast(e.message || '操作失败'); }
}

// ---------- edit modal ----------
let editingId = null;
let newImages = [];        // [{name, data}]
let existingImages = [];   // [{id, url, name}]
let removedExisting = [];  // ids to remove
let currentCoverId = '';   // chosen existing cover id
let coverNewIndex = -1;    // chosen new image index as cover

function resetForm() {
  editingId = null;
  newImages = [];
  existingImages = [];
  removedExisting = [];
  currentCoverId = '';
  coverNewIndex = -1;
  $('#caseModalTitle').textContent = '新建案例';
  $('#fTitle').value = '';
  $('#fCategory').value = '住宅';
  $('#fTags').value = '';
  $('#fDesc').value = '';
  $('#fImages').value = '';
  renderPreviews();
}

function openNewCase() { resetForm(); $('#caseModal').classList.add('open'); }
async function openEditCase(id) {
  resetForm();
  editingId = id;
  $('#caseModalTitle').textContent = '编辑案例';
  try {
    const c = await api('/api/cases/' + id);
    $('#fTitle').value = c.title || '';
    $('#fCategory').value = c.category || '住宅';
    $('#fTags').value = (c.tags || []).join('，');
    $('#fDesc').value = c.description || '';
    existingImages = (c.images || []).map((i) => ({ id: i.id, url: i.url, name: i.name }));
    currentCoverId = c.coverImageId || '';
    coverNewIndex = -1;
    renderPreviews();
    $('#caseModal').classList.add('open');
  } catch (e) { toast(e.message || '加载失败'); }
}
function closeCaseModal() { $('#caseModal').classList.remove('open'); }

function currentImageTotal() {
  return existingImages.filter((i) => !removedExisting.includes(i.id)).length + newImages.length;
}
function renderPreviews() {
  const box = $('#previews');
  box.innerHTML = '';
  const remainExisting = existingImages.filter((i) => !removedExisting.includes(i.id));
  remainExisting.forEach((im) => {
    const isCover = coverNewIndex < 0 && im.id === currentCoverId;
    const d = document.createElement('div');
    d.className = 'preview';
    d.innerHTML = `
      <img src="${im.url}" alt="" />
      ${isCover ? '<span class="cover-badge">封面</span>' : ''}
      <button class="rm" data-rm-existing="${im.id}">&times;</button>
      ${isCover ? '' : `<button class="set-cover" data-set-existing="${im.id}">设为主图</button>`}`;
    box.appendChild(d);
  });
  newImages.forEach((im, idx) => {
    const isCover = coverNewIndex === idx;
    const d = document.createElement('div');
    d.className = 'preview';
    d.innerHTML = `
      <img src="${im.data}" alt="" />
      ${isCover ? '<span class="cover-badge">封面</span>' : ''}
      <button class="rm" data-rm-new="${idx}">&times;</button>
      ${isCover ? '' : `<button class="set-cover" data-set-new="${idx}">设为主图</button>`}`;
    box.appendChild(d);
  });
  $('#upTip').textContent = `已选 ${currentImageTotal()} 张 · 支持 JPG / PNG / WEBP，可拖拽上传，将自动压缩`;
}

function fileToResizedDataUrl(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
    for (const f of files) {
      try {
      const data = await fileToResizedDataUrl(f);
      newImages.push({ name: f.name, data });
    } catch (err) { toast('图片处理失败：' + f.name); }
  }
  renderPreviews();
}

function initDropzone() {
  const zone = document.querySelector('.uploader');
  if (!zone) return;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { stop(e); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { stop(e); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });
}

async function saveCase() {
  const title = $('#fTitle').value.trim();
  if (!title) { toast('请填写案例名称'); return; }
  if (currentImageTotal() === 0) { toast('请至少上传一张图片'); return; }
  const payload = {
    title,
    category: $('#fCategory').value,
    tagsText: $('#fTags').value,
    description: $('#fDesc').value,
  };
  $('#saveCaseBtn').textContent = '保存中…';
  $('#saveCaseBtn').disabled = true;
  try {
    if (editingId) {
      payload.addImages = newImages;
      payload.removeImageIds = removedExisting;
      if (coverNewIndex >= 0) payload.coverNewIndex = coverNewIndex;
      else { payload.coverImageId = currentCoverId; payload.coverNewIndex = -1; }
      await api('/api/cases/' + editingId, { method: 'PUT', json: payload });
    } else {
      payload.images = newImages;
      if (coverNewIndex >= 0) payload.coverNewIndex = coverNewIndex;
      await api('/api/cases', { method: 'POST', json: payload });
    }
    toast('已保存');
    closeCaseModal();
    loadCases();
  } catch (e) {
    toast(e.message || '保存失败');
  } finally {
    $('#saveCaseBtn').textContent = '保存案例';
    $('#saveCaseBtn').disabled = false;
  }
}

async function deleteCase(id) {
  if (!confirm('确定删除该案例？图片将一并删除，且不可恢复。')) return;
  try {
    await api('/api/cases/' + id, { method: 'DELETE' });
    toast('已删除');
    loadCases();
  } catch (e) { toast(e.message || '删除失败'); }
}

// ---------- settings ----------
async function loadSettingsToForm() {
  try {
    const s = await api('/api/settings');
    $('#searchDescInput').value = s.searchDescription || '';
  } catch (e) {}
}
async function saveSettings() {
  try {
    await api('/api/settings', { method: 'PUT', json: { searchDescription: $('#searchDescInput').value } });
    toast('已保存搜索说明');
  } catch (e) { toast(e.message || '保存失败'); }
}

// ---------- password ----------
async function savePassword() {
  const oldPass = $('#oldPass').value;
  const newPass = $('#newPass').value;
  const newPass2 = $('#newPass2').value;
  if (!oldPass || !newPass) { toast('请填写完整'); return; }
  if (newPass.length < 6) { toast('新密码至少 6 位'); return; }
  if (newPass !== newPass2) { toast('两次新密码不一致'); return; }
  try {
    await api('/api/admin/password', { method: 'PUT', json: { oldPassword: oldPass, newPassword: newPass } });
    toast('密码已更新');
    $('#oldPass').value = $('#newPass').value = $('#newPass2').value = '';
  } catch (e) { toast(e.message || '更新失败'); }
}

// ---------- tabs ----------
function initTabs() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((x) => x.classList.remove('show'));
      t.classList.add('active');
      $('#panel-' + t.dataset.tab).classList.add('show');
    });
  });
}

// ---------- events ----------
function initEvents() {
  $('#loginBtn').addEventListener('click', doLogin);
  $('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('#logoutBtn').addEventListener('click', logout);
  $('#newCaseBtn').addEventListener('click', openNewCase);
  $('#caseModalClose').addEventListener('click', closeCaseModal);
  $('#cancelCaseBtn').addEventListener('click', closeCaseModal);
  $('#saveCaseBtn').addEventListener('click', saveCase);
  $('#fImages').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  $('#previews').addEventListener('click', (e) => {
    const rme = e.target.dataset.rmExisting;
    const rmn = e.target.dataset.rmNew;
    const sei = e.target.dataset.setExisting;
    const sni = e.target.dataset.setNew;
    if (rme) { removedExisting.push(rme); renderPreviews(); }
    if (rmn != null) { newImages.splice(Number(rmn), 1); renderPreviews(); }
    if (sei) { currentCoverId = sei; coverNewIndex = -1; renderPreviews(); }
    if (sni != null) { coverNewIndex = Number(sni); currentCoverId = ''; renderPreviews(); }
  });
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#savePassBtn').addEventListener('click', savePassword);
  initDropzone();
  initTabs();
}

initEvents();
checkAuth();
