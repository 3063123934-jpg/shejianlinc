'use strict';

const state = {
  q: '',
  category: '全部',
  page: 1,
  limit: 12,
  loading: false,
  hasMore: true,
  items: [],
};

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const emptyState = $('#emptyState');
const loadMoreBtn = $('#loadMore');
const searchInput = $('#searchInput');
const filtersEl = $('#filters');
const searchDescEl = $('#searchDesc');
const modal = $('#modal');

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

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    const data = await r.json();
    if (data.searchDescription && data.searchDescription.trim()) {
      searchDescEl.textContent = data.searchDescription;
      searchDescEl.classList.remove('empty');
    }
  } catch (e) {}
}

async function loadCases(reset) {
  if (state.loading) return;
  if (reset) {
    state.page = 1;
    state.items = [];
    state.hasMore = true;
    grid.innerHTML = '';
  }
  state.loading = true;
  loadMoreBtn.style.display = 'none';
  try {
    const params = new URLSearchParams({
      q: state.q,
      category: state.category,
      page: state.page,
      limit: state.limit,
    });
    const r = await fetch('/api/cases?' + params.toString());
    const data = await r.json();
    state.hasMore = data.hasMore;
    renderItems(data.items || []);
    emptyState.style.display = state.items.length ? 'none' : 'block';
    loadMoreBtn.style.display = state.hasMore ? 'block' : 'none';
  } catch (e) {
    toast('加载失败，请重试');
  } finally {
    state.loading = false;
  }
}

function renderItems(items) {
  for (const it of items) {
    state.items.push(it);
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = it.id;
    const pin = it.pinned ? `<span class="pin-badge">置顶</span>` : '';
    const cover = it.coverUrl
      ? `<img src="${it.coverUrl}" alt="${escapeHtml(it.title)}" loading="lazy" decoding="async" />`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:12px">无图</div>`;
    const tags = (it.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    card.innerHTML = `
      <div class="thumb">
        ${pin}
        ${cover}
        ${it.imageCount > 1 ? `<span class="count">${it.imageCount} 图</span>` : ''}
      </div>
      <div class="meta">
        <div class="title">${escapeHtml(it.title)}</div>
        <div class="cat">${escapeHtml(it.category)}</div>
        <div class="tags">${tags}</div>
      </div>`;
    card.addEventListener('click', () => openDetail(it.id));
    grid.appendChild(card);
  }
}

// ---------- detail lightbox ----------
let lbImages = [];
let lbIndex = 0;
function renderLightbox() {
  const img = lbImages[lbIndex];
  if (!img) return;
  const el = $('#lbImg');
  if (el.getAttribute('src') !== img.url) el.src = img.url;
  el.alt = img.name || '';
  $('#lbCounter').textContent = (lbIndex + 1) + ' / ' + lbImages.length;
  const thumbs = $('#lbThumbs');
  thumbs.innerHTML = '';
  lbImages.forEach((im, i) => {
    const t = document.createElement('img');
    t.src = im.url; t.alt = im.name || ''; t.loading = 'lazy'; t.decoding = 'async';
    if (i === lbIndex) t.classList.add('active');
    t.addEventListener('click', () => lbShow(i));
    thumbs.appendChild(t);
  });
  const active = thumbs.querySelector('.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function lbShow(i) {
  if (!lbImages.length) return;
  lbIndex = (i + lbImages.length) % lbImages.length;
  renderLightbox();
}
function lbNext() { lbShow(lbIndex + 1); }
function lbPrev() { lbShow(lbIndex - 1); }

async function openDetail(id) {
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  $('#mTitle').textContent = '加载中…';
  $('#mCat').textContent = '';
  $('#mTags').innerHTML = '';
  $('#mDesc').textContent = '';
  $('#lbThumbs').innerHTML = '';
  $('#lbImg').removeAttribute('src');
  lbImages = [];
  try {
    const r = await fetch('/api/cases/' + id);
    const c = await r.json();
    $('#mTitle').textContent = c.title || '';
    $('#mCat').textContent = c.category || '';
    $('#mTags').innerHTML = (c.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    $('#mDesc').textContent = c.description || '';
    lbImages = c.images || [];
    lbIndex = 0;
    renderLightbox();
  } catch (e) {
    $('#mTitle').textContent = '加载失败';
  }
}

function closeModal() {
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// events
filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  [...filtersEl.children].forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  state.category = btn.dataset.cat;
  loadCases(true);
});

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchInput.value.trim();
    loadCases(true);
  }, 300);
});
$('#searchBtn').addEventListener('click', () => {
  state.q = searchInput.value.trim();
  loadCases(true);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { state.q = searchInput.value.trim(); loadCases(true); }
});

loadMoreBtn.addEventListener('click', () => {
  if (state.loading || !state.hasMore) return;
  state.page += 1;
  loadCases(false);
});

$('#modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
$('#lbPrev').addEventListener('click', (e) => { e.stopPropagation(); lbPrev(); });
$('#lbNext').addEventListener('click', (e) => { e.stopPropagation(); lbNext(); });
document.addEventListener('keydown', (e) => {
  if (!modal.classList.contains('open')) return;
  if (e.key === 'Escape') closeModal();
  else if (e.key === 'ArrowLeft') lbPrev();
  else if (e.key === 'ArrowRight') lbNext();
});

// init
loadSettings();
loadCases(true);
