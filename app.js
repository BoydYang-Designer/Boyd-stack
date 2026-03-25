/* app.js – Taiwan AI Stock Tracker  ·  Watchlist Edition */

let DATA = [];
let SECTORS = [];
let sortCol = null;
let sortDir = 1;
let activeSectors = new Set();
let currentFile = 'data.json';
let showWatchlistOnly = false;

// ══════════════════════════════════════════════════════════════════════════════
//  ★ 自選清單 (Watchlist) – persisted in localStorage
// ══════════════════════════════════════════════════════════════════════════════
const WL_KEY = 'tw_ai_watchlist';

function wlLoad() {
  try { return new Set(JSON.parse(localStorage.getItem(WL_KEY) || '[]')); }
  catch { return new Set(); }
}

function wlSave(set) {
  localStorage.setItem(WL_KEY, JSON.stringify([...set]));
}

let WATCHLIST = wlLoad();

function wlToggle(code) {
  if (WATCHLIST.has(code)) { WATCHLIST.delete(code); }
  else { WATCHLIST.add(code); }
  wlSave(WATCHLIST);
  updateWatchlistFab();
  render();
  buildWatchlistPanel();
}

function wlRemove(code) {
  WATCHLIST.delete(code);
  wlSave(WATCHLIST);
  updateWatchlistFab();
  render();
  buildWatchlistPanel();
}

function updateWatchlistFab() {
  const badge = document.getElementById('wlCountBadge');
  const n = WATCHLIST.size;
  if (badge) {
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }
  // update the watch chip label
  const wChip = document.querySelector('.chip.watch-chip');
  if (wChip) {
    const dotHtml = '<span class="chip-dot"></span>';
    wChip.innerHTML = `${dotHtml}⭐ 自選 (${n})`;
    if (n === 0 && showWatchlistOnly) {
      showWatchlistOnly = false;
      wChip.classList.remove('on');
      render();
    }
  }
}

// Export watchlist as JSON
function exportWatchlistJSON() {
  const items = DATA.filter(s => WATCHLIST.has(s.code));
  const output = {
    _meta: { exported: new Date().toISOString(), count: items.length },
    stocks: items
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `watchlist-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════════
//  ★ 版本清單
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_VERSION = { file: 'data.json', label: '預設版本', pinned: true };
let VERSIONS = [{ ...DEFAULT_VERSION }];

// ── HELPERS ───────────────────────────────────────────────────────────────────
const upside  = (p, t) => (!p || !t) ? null : Math.round((t - p) / p * 100);
const uClass  = u => u === null ? 'up-none' : u >= 40 ? 'up-hi' : u >= 15 ? 'up-md' : 'up-lo';
const peColor = pe => pe === null ? 'var(--text3)' : pe <= 20 ? 'var(--pe-lo)' : pe <= 35 ? 'var(--pe-md)' : 'var(--pe-hi)';
const peW     = pe => pe === null ? 0 : Math.min(pe, 100);
const rClass  = r => ['首選','買進','加碼'].includes(r) ? 'r-buy' : ['持有','次要','觀察'].includes(r) ? 'r-hold' : 'r-caution';
const fmt     = n => n != null ? n.toLocaleString() : '—';

function fmtDate(d) {
  if (!d) return '';
  try { const p = d.split('-'); return `${p[0]}/${p[1]}/${p[2]}`; }
  catch { return d; }
}

// ── LOAD JSON (URL) ───────────────────────────────────────────────────────────
async function loadJSON(filename) {
  const res = await fetch(filename);
  if (!res.ok) throw new Error(`無法載入 ${filename}（${res.status}）`);
  return res.json();
}

function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch { reject(new Error(`${file.name} 不是有效的 JSON 格式`)); }
    };
    reader.onerror = () => reject(new Error(`讀取 ${file.name} 失敗`));
    reader.readAsText(file, 'UTF-8');
  });
}

async function loadManifest() {
  try {
    const list = await loadJSON('manifest.json');
    const parsed = list
      .map(v => typeof v === 'string'
        ? { file: v, label: v }
        : { file: v.file || v.filename || '', label: v.label || v.name || v.file || '' }
      )
      .filter(v => v.file.endsWith('.json') && v.file !== 'data.json');
    parsed.forEach(v => addVersion(v, false));
  } catch { /* 靜默失敗 */ }
}

// ── VERSION MANAGEMENT ────────────────────────────────────────────────────────
function addVersion(v, rebuild = true) {
  const exists = VERSIONS.some(existing => existing.file === v.file);
  if (!exists) { VERSIONS.push(v); if (rebuild) buildVersionButtons(); }
}

async function loadFileVersion(file) {
  clearDropError();
  try {
    const json = await readFileAsJSON(file);
    if (!json.sectors || !json.stocks) throw new Error('JSON 格式不符：需含 sectors 與 stocks 欄位');
    const label = file.name.replace(/\.json$/i, '');
    const v = { file: file.name, label, _blob: json };
    const idx = VERSIONS.findIndex(x => x.file === file.name);
    if (idx >= 0) { VERSIONS[idx]._blob = json; } else { VERSIONS.push(v); }
    await applyVersion(file.name, json);
  } catch (e) { showDropError(e.message); }
}

async function switchVersion(filename) {
  clearDropError();
  try {
    const v = VERSIONS.find(v => v.file === filename);
    let json;
    if (v && v._blob) { json = v._blob; } else { json = await loadJSON(filename); }
    await applyVersion(filename, json);
  } catch (e) { showDropError(e.message); }
}

async function applyVersion(filename, json) {
  SECTORS = json.sectors;
  DATA    = json.stocks;
  currentFile = filename;

  const v = VERSIONS.find(v => v.file === filename);
  document.getElementById('fabLabel').textContent = v ? v.label : filename.replace(/\.json$/i, '');

  if (json._meta && json._meta.version) {
    const metaDate = document.getElementById('data-version-badge');
    if (metaDate) metaDate.textContent = `資料版本：${json._meta.version}`;
  }

  activeSectors = new Set();
  showWatchlistOnly = false;
  sortCol = null;
  sortDir = 1;
  document.getElementById('q').value = '';
  document.querySelectorAll('thead th').forEach(h => {
    h.classList.remove('sorted');
    const arr = h.querySelector('.sort-arr');
    if (arr) arr.textContent = '↕';
  });

  buildChips();
  render();
  buildVersionButtons();
  closePanel();
}

// ── VERSION SWITCHER UI ───────────────────────────────────────────────────────
function buildVersionButtons() {
  const list = document.getElementById('versionList');
  list.innerHTML = '';
  VERSIONS.forEach(v => {
    const el = document.createElement('button');
    el.className = 'version-item' + (v.file === currentFile ? ' active' : '');
    el.dataset.file = v.file;
    const isPinned = v.pinned ? '<span class="vi-pin">預設</span>' : '';
    el.innerHTML = `<span class="vi-label">${v.label}${isPinned}</span><span class="vi-desc">${v.file}</span>`;
    el.onclick = () => switchVersion(v.file);
    list.appendChild(el);
  });
}

function openPanel() { buildVersionButtons(); document.getElementById('switcherPanel').classList.add('open'); document.getElementById('switcherBackdrop').classList.add('open'); }
function closePanel() { document.getElementById('switcherPanel').classList.remove('open'); document.getElementById('switcherBackdrop').classList.remove('open'); }

// ── DRAG-AND-DROP ─────────────────────────────────────────────────────────────
function initDragDrop() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('dropFileInput');
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const file = input.files[0]; if (file) { loadFileVersion(file); input.value = ''; } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = [...e.dataTransfer.files].find(f => f.name.endsWith('.json'));
    if (file) { loadFileVersion(file); } else { showDropError('請拖入 .json 檔案'); }
  });
}

function showDropError(msg) { document.getElementById('dropError').textContent = msg; }
function clearDropError() { const el = document.getElementById('dropError'); if (el) el.textContent = ''; }

// ── CHIPS ─────────────────────────────────────────────────────────────────────
function buildChips() {
  const row = document.getElementById('chips');
  row.innerHTML = '';

  // ★ 自選 chip（固定第一個）
  const wBtn = document.createElement('button');
  wBtn.className = 'chip watch-chip' + (showWatchlistOnly ? ' on' : '');
  wBtn.innerHTML = `<span class="chip-dot"></span>⭐ 自選 (${WATCHLIST.size})`;
  wBtn.onclick = () => {
    showWatchlistOnly = !showWatchlistOnly;
    wBtn.classList.toggle('on', showWatchlistOnly);
    render();
  };
  row.appendChild(wBtn);

  SECTORS.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'chip'; btn.dataset.id = s.id;
    btn.innerHTML = `<span class="chip-dot"></span>${s.label}`;
    btn.onclick = () => {
      activeSectors.has(s.id) ? activeSectors.delete(s.id) : activeSectors.add(s.id);
      document.querySelectorAll('.chip:not(.watch-chip)').forEach(c => c.classList.toggle('on', activeSectors.has(c.dataset.id)));
      render();
    };
    row.appendChild(btn);
  });
}

// ── WATCHLIST PANEL ────────────────────────────────────────────────────────────
function buildWatchlistPanel() {
  const body = document.getElementById('wlBody');
  if (!body) return;
  const items = DATA.filter(s => WATCHLIST.has(s.code));
  if (items.length === 0) {
    body.innerHTML = `<div class="watchlist-empty">還沒有自選個股<br><span style="font-size:11px;color:var(--text3)">點擊表格中的 ＋ 按鈕加入</span></div>`;
    return;
  }
  body.innerHTML = items.map(s => `
    <div class="watchlist-item">
      <div class="wi-left">
        <div class="wi-name">${s.name}</div>
        <div class="wi-code">${s.code} · <span style="color:var(--text3)">${s.sector}</span></div>
      </div>
      <button class="wi-remove" data-code="${s.code}" title="移除">✕</button>
    </div>
  `).join('');
  body.querySelectorAll('.wi-remove').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); wlRemove(btn.dataset.code); });
  });
}

function openWatchlistPanel() {
  buildWatchlistPanel();
  document.getElementById('watchlistPanel').classList.add('open');
  document.getElementById('switcherBackdrop').classList.add('open');
}

function closeWatchlistPanel() {
  document.getElementById('watchlistPanel').classList.remove('open');
  document.getElementById('switcherBackdrop').classList.remove('open');
}

// ── RENDER ─────────────────────────────────────────────────────────────────────
function render() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  let rows = [...DATA];

  if (showWatchlistOnly) rows = rows.filter(r => WATCHLIST.has(r.code));
  if (activeSectors.size > 0) rows = rows.filter(r => activeSectors.has(r.sc));
  if (q) rows = rows.filter(r => [r.name, r.code, r.sector, r.edge, r.risk, r.rating].some(f => f && f.toLowerCase().includes(q)));

  if (sortCol) {
    rows.sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (sortCol === 'upside') { av = upside(a.price, a.target); bv = upside(b.price, b.target); }
      if (av === null && bv === null) return 0;
      if (av === null) return 1; if (bv === null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv, 'zh-TW') * sortDir;
      return (av - bv) * sortDir;
    });
  }

  const tbody = document.getElementById('tbody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">找不到符合條件的個股</div></div></td></tr>`;
  } else {
    tbody.innerHTML = rows.map((r, i) => {
      const u = upside(r.price, r.target);
      const uHtml = u !== null ? `<span class="upside-pill ${uClass(u)}">+${u}%</span>` : `<span class="up-none">—</span>`;
      const tHtml = r.target != null ? fmt(r.target) : `<span class="up-none">—</span>`;
      const peHtml = r.pe != null
        ? `<div class="pe-wrap"><span class="pe-val" style="color:${peColor(r.pe)}">${r.pe}</span><div class="pe-track"><div class="pe-fill" style="width:${peW(r.pe)}%;background:${peColor(r.pe)}"></div></div></div>`
        : `<span class="up-none" style="display:block;text-align:right">—</span>`;
      const updBadge = r.updatedAt ? `<div class="row-updated">更新 ${fmtDate(r.updatedAt)}</div>` : '';
      const isWatched = WATCHLIST.has(r.code);
      const watchIcon = isWatched ? '⭐' : '＋';
      return `<tr style="animation-delay:${i * 15}ms" data-code="${r.code}" class="clickable-row${isWatched ? ' is-watched' : ''}">
        <td class="td-watch"><button class="watch-btn${isWatched ? ' on' : ''}" data-wcode="${r.code}" title="${isWatched ? '從自選移除' : '加入自選'}">${watchIcon}</button></td>
        <td><span class="sect-badge ${r.sc}">${r.sector}</span></td>
        <td><div class="stock-name">${r.name}</div><div class="stock-code">${r.code}</div>${updBadge}</td>
        <td class="num">${fmt(r.price)}</td>
        <td class="num" style="color:var(--text2)">${tHtml}</td>
        <td class="num">${uHtml}</td>
        <td>${peHtml}</td>
        <td><span class="eps-text">${r.eps}</span></td>
        <td><span class="rating ${rClass(r.rating)}">${r.rating}</span></td>
        <td><div class="edge-text">${r.edge}</div></td>
        <td><div class="risk-text">${r.risk}</div></td>
      </tr>`;
    }).join('');

    // bind watch buttons (stop propagation so row click doesn't fire)
    document.querySelectorAll('.watch-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        wlToggle(btn.dataset.wcode);
      });
    });

    // bind row clicks → detail modal
    document.querySelectorAll('.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        const code = row.dataset.code;
        const stock = DATA.find(s => s.code === code);
        if (stock) openDetailModal(stock);
      });
    });
  }

  document.getElementById('cnt').innerHTML = `顯示 <strong>${rows.length}</strong> / ${DATA.length} 檔個股`;
  document.getElementById('cnt-top').innerHTML = `共 <strong style="color:var(--accent)">${DATA.length}</strong> 檔`;
}

// ── SORTING ───────────────────────────────────────────────────────────────────
function initSorting() {
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', function () {
      const col = this.dataset.col;
      if (sortCol === col) { sortDir *= -1; }
      else {
        document.querySelectorAll('thead th').forEach(h => { h.classList.remove('sorted'); const a = h.querySelector('.sort-arr'); if (a) a.textContent = '↕'; });
        sortCol = col; sortDir = 1;
      }
      this.classList.add('sorted');
      this.querySelector('.sort-arr').textContent = sortDir === 1 ? '↑' : '↓';
      render();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  ★ DETAIL MODAL
// ══════════════════════════════════════════════════════════════════════════════

function openDetailModal(stock) {
  const modal = document.getElementById('detailModal');
  const content = document.getElementById('detailContent');
  const d = stock.detail || {};
  const u = upside(stock.price, stock.target);
  const uText = u !== null ? `+${u}%` : '—';
  const updatedAt = stock.updatedAt ? fmtDate(stock.updatedAt) : '—';

  function row(label, val) {
    if (!val || val === '—' || val === '') return '';
    return `<div class="di-row"><span class="di-label">${label}</span><span class="di-val">${val}</span></div>`;
  }

  function section(title, icon, body, updAt) {
    if (!body.trim()) return '';
    const dateBadge = updAt ? `<span class="section-date">更新 ${fmtDate(updAt)}</span>` : '';
    return `<div class="di-section">
      <div class="di-section-title">${icon} ${title}${dateBadge}</div>
      <div class="di-section-body">${body}</div>
    </div>`;
  }

  const basic = d.basic || {};
  const basicBody = [
    row('全名', basic.fullName), row('上市代號', basic.listed),
    row('市值', basic.marketCap), row('成立年份', basic.founded),
    row('員工人數', basic.employees), row('總部', basic.hq),
    row('會計年度', basic.fiscalYear),
  ].join('');

  const fin = d.financial || {};
  const finBody = [
    row('2025Q4 營收', fin.revenue2025Q4), row('2025Q4 淨利', fin.netIncome2025Q4),
    row('毛利率', fin.grossMargin || fin.grossMargin2026E),
    row('2025 EPS', fin.eps2025), row('2026E EPS', fin.eps2026E),
    row('殖利率 (預估)', fin.dividendYield), row('2026E 資本支出', fin.capex2026E),
    row('AI 營收佔比', fin.aiRevenuePct || fin.aiDataCenterPct),
    row('AI伺服器佔比', fin.aiServerPct || fin.aiServerRevenue2026E),
    row('ASIC 2027E', fin.asicRevenue2027E), row('CPO 佔比', fin.cpo),
    row('備註', fin.note),
  ].join('');

  const val = d.valuation || {};
  const valBody = [
    row('2026E 本益比', val.pe2026E), row('共識目標價', val.targetPriceConsensus),
    row('最高目標價', val.targetHigh), row('潛在漲幅', val.upside || uText),
    row('分析師評級', val.analystRating), row('本淨比', val.pb),
    row('備註', val.note),
  ].join('');

  const tech = d.technical || {};
  const techBody = [
    row('20日均線', tech.ma20), row('60日均線', tech.ma60),
    row('120日均線', tech.ma120), row('RSI(14)', tech.rsi14),
    row('MACD', tech.macdSignal), row('支撐區', tech.support),
    row('壓力區', tech.resistance), row('成交量', tech.volumeTrend),
    row('趨勢研判', tech.trend), row('補充說明', tech.note),
  ].join('');

  const chip = d.chip || {};
  let chipBody = '';
  if (chip.processes && chip.processes.length) chipBody += row('製程技術', chip.processes.join('、'));
  if (chip.products && chip.products.length) chipBody += row('主要產品', chip.products.join('、'));
  if (chip.keyClients && chip.keyClients.length) chipBody += row('主要客戶', chip.keyClients.join('、'));
  if (chip.moat) chipBody += row('護城河', chip.moat);
  if (chip.expansion) chipBody += row('海外擴張', chip.expansion);

  const ratings = d.ratings || [];
  let ratingsBody = '';
  if (ratings.length > 0) {
    ratingsBody = `<div class="ratings-table">
      <div class="rt-head"><span>機構</span><span>評級</span><span>目標價</span><span>日期</span></div>
      ${ratings.map(r => `<div class="rt-row">
        <span class="rt-inst">${r.institution}</span>
        <span class="rt-rating">${r.rating}</span>
        <span class="rt-target">${r.target || '—'}</span>
        <span class="rt-date">${r.date || '—'}</span>
      </div>`).join('')}
    </div>`;
  }

  const cats = d.catalysts || [];
  const risks = d.risks || [];
  let crBody = '';
  if (cats.length) crBody += `<div class="cr-col"><div class="cr-label cr-cat">🚀 催化劑</div><ul class="cr-list">${cats.map(c => `<li>${c}</li>`).join('')}</ul></div>`;
  if (risks.length) crBody += `<div class="cr-col"><div class="cr-label cr-risk">⚠️ 主要風險</div><ul class="cr-list">${risks.map(r => `<li>${r}</li>`).join('')}</ul></div>`;
  const crSection = crBody ? `<div class="di-section"><div class="di-section-title">📋 催化劑與風險</div><div class="cr-grid">${crBody}</div></div>` : '';

  const heroUpClass = u !== null && u >= 15 ? 'hero-up-positive' : u !== null && u < 0 ? 'hero-up-negative' : '';
  const isWatched = WATCHLIST.has(stock.code);

  content.innerHTML = `
    <div class="detail-hero">
      <div class="hero-left">
        <span class="sect-badge ${stock.sc}">${stock.sector}</span>
        <h2 class="hero-name">${stock.name} <span class="hero-code">${stock.code}</span></h2>
        <div class="hero-rating">
          <span class="rating ${rClass(stock.rating)}">${stock.rating}</span>
          <button class="watch-btn${isWatched ? ' on' : ''}" data-wcode="${stock.code}"
            title="${isWatched ? '從自選移除' : '加入自選'}"
            style="display:inline-flex;margin-left:10px;vertical-align:middle">
            ${isWatched ? '⭐ 已在自選' : '＋ 加入自選'}
          </button>
        </div>
        <div class="hero-updated">資料更新日期：<strong>${updatedAt}</strong></div>
      </div>
      <div class="hero-right">
        <div class="hero-price-group"><div class="hero-price-label">現價（元）</div><div class="hero-price">${fmt(stock.price)}</div></div>
        <div class="hero-price-group"><div class="hero-price-label">目標價（元）</div><div class="hero-price hero-target">${stock.target ? fmt(stock.target) : '—'}</div></div>
        <div class="hero-price-group"><div class="hero-price-label">潛在漲幅</div><div class="hero-price ${heroUpClass}">${uText}</div></div>
        <div class="hero-price-group"><div class="hero-price-label">本益比(倍)</div><div class="hero-price" style="color:${peColor(stock.pe)}">${stock.pe || '—'}</div></div>
      </div>
    </div>
    <div class="detail-summary">
      <div class="ds-item"><span class="ds-icon">💡</span><div><div class="ds-title">核心優勢</div><div class="ds-text">${stock.edge}</div></div></div>
      <div class="ds-item"><span class="ds-icon">⚠️</span><div><div class="ds-title">主要風險</div><div class="ds-text">${stock.risk}</div></div></div>
      <div class="ds-item"><span class="ds-icon">📈</span><div><div class="ds-title">2026E EPS</div><div class="ds-text">${stock.eps}</div></div></div>
    </div>
    <div class="detail-sections">
      ${section('公司基本資料', '🏢', basicBody, basic.updatedAt)}
      ${section('財務數據', '💰', finBody, fin.updatedAt)}
      ${section('估值分析', '📊', valBody, val.updatedAt)}
      ${section('技術面分析', '📉', techBody, tech.updatedAt)}
      ${chip.moat || chip.products || chip.keyClients ? section('產品與客戶', '🔧', chipBody, chip.updatedAt) : ''}
      ${ratings.length ? `<div class="di-section"><div class="di-section-title">🏦 法人機構評級${d.updatedAt ? `<span class="section-date">更新 ${fmtDate(d.updatedAt)}</span>` : ''}</div><div class="di-section-body">${ratingsBody}</div></div>` : ''}
      ${crSection}
    </div>
  `;

  // Bind the watch button inside the modal
  const modalWatchBtn = content.querySelector('.watch-btn[data-wcode]');
  if (modalWatchBtn) {
    modalWatchBtn.style.width = 'auto';
    modalWatchBtn.style.padding = '4px 12px';
    modalWatchBtn.style.fontSize = '12px';
    modalWatchBtn.addEventListener('click', e => {
      e.stopPropagation();
      wlToggle(stock.code);
      // update modal button
      const nowWatched = WATCHLIST.has(stock.code);
      modalWatchBtn.classList.toggle('on', nowWatched);
      modalWatchBtn.textContent = nowWatched ? '⭐ 已在自選' : '＋ 加入自選';
      modalWatchBtn.title = nowWatched ? '從自選移除' : '加入自選';
    });
  }

  modal.classList.add('open');
  document.body.classList.add('modal-open');
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.remove('open');
  document.body.classList.remove('modal-open');
}

function initModal() {
  document.getElementById('detailModalClose').addEventListener('click', closeDetailModal);
  document.getElementById('detailModalBackdrop').addEventListener('click', closeDetailModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetailModal(); closeWatchlistPanel(); } });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById('meta-date').textContent =
    new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  // Version switcher
  document.getElementById('switcherBtn').addEventListener('click', openPanel);
  document.getElementById('switcherClose').addEventListener('click', closePanel);
  document.getElementById('switcherBackdrop').addEventListener('click', () => {
    closePanel();
    closeWatchlistPanel();
  });
  document.getElementById('q').addEventListener('input', render);

  // Watchlist FAB
  document.getElementById('watchlistFabBtn').addEventListener('click', openWatchlistPanel);
  document.getElementById('wlClose').addEventListener('click', closeWatchlistPanel);
  document.getElementById('wlExportBtn').addEventListener('click', exportWatchlistJSON);

  // Initial badge
  updateWatchlistFab();

  initSorting();
  initDragDrop();
  initModal();

  await loadManifest();
  await switchVersion('data.json');
}

document.addEventListener('DOMContentLoaded', init);
