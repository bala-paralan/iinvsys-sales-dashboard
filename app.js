'use strict';
/* ══════════════════════════════════════════════════════
   IINVSYS Sales OS — app.js v2.0
   Real API integration · Node.js + MongoDB backend
══════════════════════════════════════════════════════ */

/* ═══════════ API LAYER ═══════════ */
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5001/api'
  : '/api';
let _token = localStorage.getItem('ii_token') || null;

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (_token) opts.headers['Authorization'] = `Bearer ${_token}`;
  if (body)   opts.body = JSON.stringify(body);
  const res  = await fetch(API_BASE + path, opts);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message || 'API error'), { status: res.status, data });
  return data;
}

/* ═══════════ NORMALIZERS ═══════════ */
function normalizeLead(l) {
  return {
    id:              l._id,
    name:            l.name,
    phone:           l.phone,
    email:           l.email || '',
    source:          l.source,
    expo:            l.expo ? (l.expo.name || '') : '',
    expoId:          l.expo ? (l.expo._id || l.expo) : null,
    stage:           l.stage,
    agentId:         l.assignedAgent?._id || (typeof l.assignedAgent === 'string' ? l.assignedAgent : null),
    products:        (l.products || []).map(p => p._id || p),
    value:           l.value || 0,
    score:           l.score || 50,
    followUps:       Array.isArray(l.followUps) ? l.followUps.length : (l.followUps || 0),
    notes:           l.notes || '',
    createdAt:       l.createdAt ? l.createdAt.split('T')[0] : null,
    lastContact:     l.lastContact ? l.lastContact.split('T')[0] : null,
    createdById:     l.createdBy?._id || l.createdBy || null,
    createdByName:   l.createdBy?.name  || null,
    createdByRole:   l.createdBy?.role  || null,
  };
}

function normalizeAgent(a) {
  return {
    id:          a._id,
    name:        a.name,
    initials:    a.initials,
    email:       a.email,
    phone:       a.phone,
    territory:   a.territory,
    designation: a.designation || 'Sales Agent',
    status:      a.status,
    target:      a.target || 0,
    color:       a.color || 'var(--gold)',
    joinDate:    a.joinDate,
  };
}

function normalizeProduct(p) {
  return {
    id:       p._id,
    name:     p.name,
    sku:      p.sku,
    category: p.category,
    price:    p.price,
    desc:     p.description || '',
  };
}

function normalizeExpo(e, leadsArr) {
  const id    = e._id;
  const count = leadsArr ? leadsArr.filter(l => l.expoId === id).length : (e.leadCount || 0);
  const start = new Date(e.startDate);
  const end   = new Date(e.endDate);
  const fmt   = d => d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  return {
    id,
    name:        e.name,
    dates:       `${fmt(start)} – ${fmt(end)}`,
    venue:       [e.venue, e.city].filter(Boolean).join(', '),
    venue_raw:   e.venue || '',
    city:        e.city || '',
    startDate:   e.startDate,
    endDate:     e.endDate,
    agents:      (e.agents || []).map(a => a._id || a),
    products:    (e.products || []).map(p => ({
      productId:  (p.product?._id || p.product || '').toString(),
      name:       p.product?.name || '',
      sku:        p.product?.sku  || '',
      price:      p.product?.price || 0,
      presenters: (p.presenters || []).map(pr => (pr._id || pr).toString()),
    })),
    status:      e.status,
    leadCount:   count,
    converted:   e.converted || 0,
    targetLeads: e.targetLeads || 0,
  };
}

/* ═══════════ STATE ═══════════ */
const S = {
  session:   null,
  leads:     [],
  products:  [],
  agents:    [],
  expos:     [],
  csvParsed: [],
};

/* ═══════════ HELPERS ═══════════ */
function uid() { return 'x' + Math.random().toString(36).slice(2,9); }
function isAdmin()      { return S.session?.role === 'superadmin' || S.session?.role === 'manager'; }
function isAgent()      { return S.session?.role === 'agent'; }
function isSuperAdmin() { return S.session?.role === 'superadmin'; }
function isReferrer()   { return S.session?.role === 'referrer'; }
function agentById(id)   { return S.agents.find(a => a.id === id); }
function productById(id) { return S.products.find(p => p.id === id); }
function fmtValue(v) {
  if (!v || v === 0) return '—';
  if (v >= 100000) return '₹' + (v/100000).toFixed(1) + 'L';
  return '₹' + (v/1000).toFixed(0) + 'K';
}
function stageColor(stage) {
  const m = { new:'var(--gold)', contacted:'var(--amber)', interested:'var(--azure)', proposal:'var(--violet)', negotiation:'var(--amber)', won:'var(--emerald)', lost:'var(--coral)' };
  return m[stage] || 'var(--text-3)';
}
function scoreBadgeClass(score) {
  if (score >= 75) return 'hot';
  if (score >= 45) return 'warm';
  return 'cold';
}
function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

/* ═══════════ LOADER HELPERS ═══════════ */
function showLoader(msg = 'Loading…') {
  const el  = document.getElementById('globalLoader');
  const txt = document.getElementById('loaderMsg');
  if (txt) txt.textContent = msg.toUpperCase();
  el?.classList.remove('hidden');
}
function hideLoader() {
  document.getElementById('globalLoader')?.classList.add('hidden');
}
function showRefresh() {
  document.getElementById('refreshBar')?.classList.remove('hidden');
}
function hideRefresh() {
  document.getElementById('refreshBar')?.classList.add('hidden');
}
/** Set a button into loading/idle state. */
function btnLoad(btn, loading, loadLabel) {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.loading = loading ? 'true' : 'false';
  if (loading) {
    btn.dataset.origText = btn.textContent;
    if (loadLabel) btn.textContent = loadLabel;
  } else if (btn.dataset.origText !== undefined) {
    btn.textContent = btn.dataset.origText;
    delete btn.dataset.origText;
  }
}
/** Returns HTML for an inline content spinner. */
function contentSpinner(msg = 'Loading…') {
  return `<div class="content-spinner">
    <div class="content-spinner-ring"></div>
    <div class="content-spinner-text">${msg.toUpperCase()}</div>
  </div>`;
}

/* ═══════════ AUTH ═══════════ */
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email   = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass    = document.getElementById('loginPassword').value;
  const errEl   = document.getElementById('loginError');
  const signBtn = e.target.querySelector('[type=submit]');
  btnLoad(signBtn, true, 'Signing in…');
  showLoader('Signing in…');

  // ── Step 1: authenticate only — catch shows "Invalid credentials"
  let loginRes;
  try {
    loginRes = await api('POST', '/auth/login', { email, password: pass });
  } catch (err) {
    hideLoader();
    btnLoad(signBtn, false);
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 4000);
    return;
  }

  // ── Step 2: session setup + app init — separate from auth catch
  _token = loginRes.data.token;
  localStorage.setItem('ii_token', _token);
  S.session = { ...loginRes.data.user, id: loginRes.data.user._id || loginRes.data.user.id };
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  await initApp();
  btnLoad(signBtn, false); // reset button after app is ready
});


document.getElementById('pwdToggle').addEventListener('click', () => {
  const inp = document.getElementById('loginPassword');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  S.session  = null;
  _token     = null;
  S.leads    = []; S.products = []; S.agents = []; S.expos = [];
  localStorage.removeItem('ii_token');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.add('hidden');
  analyticsInit = false;
  // Reset sign-in button in case user logged out while it was stuck
  const signBtn = document.querySelector('#loginForm [type=submit]');
  if (signBtn) btnLoad(signBtn, false);
});

/* ═══════════ DATA LOADING ═══════════ */
async function loadAllData(refresh = false) {
  if (refresh) showRefresh();
  try {
    const [agentsRes, productsRes, leadsRes, exposRes] = await Promise.all([
      api('GET', '/agents'),
      api('GET', '/products'),
      api('GET', '/leads'),
      api('GET', '/expos'),
    ]);
    S.agents   = agentsRes.data.map(normalizeAgent);
    S.products = productsRes.data.map(normalizeProduct);
    S.leads    = leadsRes.data.map(normalizeLead);
    S.expos    = exposRes.data.map(e => normalizeExpo(e, S.leads));
  } finally {
    if (refresh) hideRefresh();
  }
}

async function loadReferrerData() {
  /* Referrers can only read expos — they cannot list leads/agents */
  try {
    const exposRes = await api('GET', '/expos');
    S.expos = exposRes.data.map(e => normalizeExpo(e));
  } catch(e) { /* non-fatal */ }
}

/* ═══════════ APP INIT ═══════════ */
async function initApp() {
  showLoader('Loading data…');
  try {
    if (isReferrer()) {
      await loadReferrerData();
    } else {
      await loadAllData();
    }
  } catch (err) {
    hideLoader();
    flash('Failed to load data. Check server connection.', 'error');
    return;
  }
  try {
    applyRole();
    updateSidebarUser();
    updateDate();
    if (isReferrer()) {
      renderReferrerView();
      goToPage('referrer');
    } else if (isAdmin()) {
      populateAgentDropdowns();
      renderOverview();
      goToPage('overview');
    } else {
      populateAgentDropdowns();
      renderMyLeads();
      goToPage('myLeads');
    }
    updateNavCounts();
  } catch (err) {
    console.error('[initApp render error]', err);
    flash('Dashboard loaded but a display error occurred. Try refreshing.', 'error');
  } finally {
    hideLoader();
  }
}

function applyRole() {
  const ref = isReferrer();
  const agt = isAgent();
  const adminOnly = document.querySelectorAll('.admin-only, .admin-only-page, .admin-only-field');
  adminOnly.forEach(el => el.classList.toggle('hidden', agt || ref));
  document.getElementById('adminNav').classList.toggle('hidden', agt || ref);
  document.getElementById('agentNav').classList.toggle('hidden', isAdmin() || ref);
  document.getElementById('addLeadBtn').classList.toggle('hidden', ref);
  // Show camera scan button on mobile or any device with camera access
  if ('mediaDevices' in navigator) {
    document.getElementById('cameraScanBtn')?.classList.remove('hidden');
  }
}

function updateSidebarUser() {
  const u = S.session;
  const roleMap = { superadmin:'Super Admin', manager:'Manager', agent:'Sales Agent', referrer:'Referrer', readonly:'Viewer' };
  const roleColors = { superadmin:'var(--gold)', manager:'var(--amber)', agent:'var(--emerald)', referrer:'var(--violet)', readonly:'var(--text-3)' };
  document.getElementById('sidebarAvatar').textContent = u.initials || u.name?.charAt(0) || '?';
  document.getElementById('sidebarName').textContent   = u.name;
  document.getElementById('sidebarRole').textContent   = roleMap[u.role] || u.role;
  document.getElementById('roleLabel').textContent     = roleMap[u.role] || u.role;
  const dot = document.getElementById('roleDot');
  dot.style.background = roleColors[u.role] || 'var(--text-3)';
}

function updateDate() {
  const el = document.getElementById('liveDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

function updateNavCounts() {
  const myLeads = isAgent() ? S.leads.filter(l => l.agentId === S.session.agentId) : S.leads;
  const navLead = document.getElementById('navLeadCount');
  if (navLead) navLead.textContent = S.leads.length;
  const navMy = document.getElementById('navMyLeadCount');
  if (navMy) navMy.textContent = myLeads.length;
  const navProd = document.getElementById('navProductCount');
  if (navProd) navProd.textContent = S.products.length;
}

function populateAgentDropdowns() {
  const sel = document.getElementById('filterAgent');
  if (sel) {
    sel.innerHTML = '<option value="">All Agents</option>';
    S.agents.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      sel.appendChild(opt);
    });
  }
  const leadAgentSel = document.getElementById('leadAgent');
  if (leadAgentSel) {
    leadAgentSel.innerHTML = '<option value="">— Auto-assign —</option>';
    S.agents.filter(a => a.status === 'active').forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      leadAgentSel.appendChild(opt);
    });
  }
  /* Populate the lead-form expo dropdown from live S.expos */
  const leadExpoSel = document.getElementById('leadExpo');
  if (leadExpoSel) {
    leadExpoSel.innerHTML = '<option value="">— Select Expo —</option>';
    S.expos.forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex.id; opt.textContent = ex.name;
      leadExpoSel.appendChild(opt);
    });
  }
}

/* ═══════════ PAGE NAVIGATION ═══════════ */
const PAGE_META = {
  overview:  { eyebrow:'// COMMAND CENTRE',  title:'Sales <em>Overview</em>' },
  leads:     { eyebrow:'// PIPELINE',        title:'Lead <em>Management</em>' },
  agents:    { eyebrow:'// TEAM',            title:'Agent <em>Directory</em>' },
  products:  { eyebrow:'// CATALOGUE',       title:'Product <em>Catalogue</em>' },
  expos:     { eyebrow:'// EVENTS',          title:'Expo <em>Management</em>' },
  analytics: { eyebrow:'// INSIGHTS',        title:'Sales <em>Analytics</em>' },
  myLeads:   { eyebrow:'// MY PIPELINE',     title:'My <em>Leads</em>' },
  myStats:   { eyebrow:'// MY PERFORMANCE',  title:'My <em>Stats</em>' },
  settings:  { eyebrow:'// CONFIGURATION',   title:'System <em>Settings</em>' },
  referrer:  { eyebrow:'// LEAD CAPTURE',    title:'Add <em>Lead</em>' },
};

function goToPage(pageId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === pageId));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${pageId}`));
  const m = PAGE_META[pageId] || PAGE_META.overview;
  document.getElementById('pageEyebrow').textContent = m.eyebrow;
  document.getElementById('pageTitle').innerHTML = m.title;
  closeMobileNav();
  // Lazy renders
  if (pageId === 'leads')     renderKanban(getFilters());
  if (pageId === 'agents')    renderAgentsGrid();
  if (pageId === 'products')  renderProductsTable();
  if (pageId === 'expos')     renderExpos();
  if (pageId === 'analytics') initAnalyticsCharts();
  if (pageId === 'myLeads')   renderMyLeads();
  if (pageId === 'myStats')   renderMyStats();
  if (pageId === 'settings')  renderSettings();
  if (pageId === 'referrer')  renderReferrerView();
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', e => { e.preventDefault(); goToPage(item.dataset.page); });
});
document.querySelectorAll('[data-page]:not(.nav-item)').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); goToPage(el.dataset.page); });
});

/* ── Mobile nav ── */
const sidebarEl  = document.getElementById('sidebar');
document.getElementById('mobileToggle')?.addEventListener('click', () => sidebarEl.classList.toggle('open'));
function closeMobileNav() { sidebarEl?.classList.remove('open'); }

/* ═══════════ OVERVIEW RENDERING ═══════════ */
function renderOverview() {
  renderKPIs();
  renderFunnel('all');
  renderLeaderboard('month');
  renderSourceChart();
  renderTrendChart();
  renderActivityStream();
  renderExpoMini();
}

/* ── KPIs ── */
function renderKPIs() {
  const total   = S.leads.length;
  const won     = S.leads.filter(l => l.stage === 'won').length;
  const convPct = total ? Math.round((won/total)*100) : 0;
  const pipeline = S.leads.filter(l => !['won','lost'].includes(l.stage)).reduce((s,l) => s + (l.value||0), 0);
  const withFU   = S.leads.filter(l => l.followUps > 0).length;
  const fuPct    = total ? Math.round((withFU/total)*100) : 0;
  const wonLeads = S.leads.filter(l => l.stage === 'won');
  const avgDeal  = wonLeads.length ? wonLeads.reduce((s,l)=>s+(l.value||0),0)/wonLeads.length : 0;
  const overdue  = S.leads.filter(l => !['won','lost'].includes(l.stage) && daysSince(l.lastContact) > 7).length;

  animateCounter('kpiTotalLeads', total,   '',   '');
  animateCounter('kpiConvRate',   convPct, '',   '%');
  animateCounter('kpiFollowup',   fuPct,   '',   '%');
  animateCounter('kpiOverdue',    overdue, '',   '');
  const sub = document.getElementById('kpiLeadsSub');
  if (sub) sub.textContent = total === 0 ? 'No leads yet' : `${S.leads.filter(l => !['won','lost'].includes(l.stage)).length} active`;
  const pip = document.getElementById('kpiPipeline');
  const avg = document.getElementById('kpiAvgDeal');
  if (pip) { setTimeout(() => { pip.textContent = fmtValue(pipeline); }, 200); }
  if (avg) { setTimeout(() => { avg.textContent = fmtValue(avgDeal);  }, 300); }
}

function animateCounter(elId, target, prefix, suffix) {
  const el = document.getElementById(elId);
  if (!el) return;
  const dur  = 1200;
  const isFloat = !Number.isInteger(target);
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start)/dur, 1);
    const e = 1 - Math.pow(1-p, 3);
    const v = target * e;
    el.textContent = prefix + (isFloat ? v.toFixed(1) : Math.floor(v)) + suffix;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = prefix + target + suffix;
  }
  requestAnimationFrame(tick);
}

/* ── FUNNEL ── */
const STAGES = ['new','contacted','interested','proposal','negotiation','won','lost'];
const STAGE_LABELS = { new:'NEW', contacted:'CONTACTED', interested:'INTERESTED', proposal:'PROPOSAL', negotiation:'NEGOTIATION', won:'CLOSED WON', lost:'CLOSED LOST' };
const STAGE_COLORS = { new:'var(--gold)', contacted:'var(--amber)', interested:'var(--azure)', proposal:'var(--violet)', negotiation:'var(--amber)', won:'var(--emerald)', lost:'var(--coral)' };

function renderFunnel(filter) {
  const body = document.getElementById('funnelBody');
  if (!body) return;
  let leads = S.leads;
  if (filter === 'expo')   leads = leads.filter(l => l.source === 'expo');
  if (filter === 'direct') leads = leads.filter(l => l.source === 'direct');
  const total = leads.length || 1;
  body.innerHTML = STAGES.map(stage => {
    const count = leads.filter(l => l.stage === stage).length;
    const pct   = Math.round((count/total)*100);
    const w     = Math.max(pct, 4);
    return `<div class="funnel-stage" style="--w:${w}%;--color:${STAGE_COLORS[stage]}">
      <div class="funnel-bar"><div class="funnel-fill"></div></div>
      <div class="funnel-info">
        <span class="funnel-label">${STAGE_LABELS[stage]}</span>
        <span class="funnel-num">${count}</span>
        <span class="funnel-pct">${pct}%</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('funnelTabs')?.addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('#funnelTabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFunnel(btn.dataset.filter);
});

/* ── LEADERBOARD ── */
function renderLeaderboard(period) {
  const list = document.getElementById('leaderboardList');
  if (!list) return;
  const ranked = S.agents.filter(a => a.status === 'active').map(a => {
    const aLeads = S.leads.filter(l => l.agentId === a.id);
    const won    = aLeads.filter(l => l.stage === 'won');
    const pipeline = aLeads.reduce((s,l) => s+(l.value||0),0);
    return { ...a, totalLeads:aLeads.length, won:won.length, pipeline };
  }).sort((a,b) => b.won - a.won || b.pipeline - a.pipeline);

  list.innerHTML = ranked.map((a, i) => {
    const rank = i+1;
    const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
    const pct  = ranked[0].pipeline ? Math.round((a.pipeline/ranked[0].pipeline)*100) : 0;
    return `<div class="lb-item ${rankClass}">
      <div class="lb-rank">0${rank}</div>
      <div class="lb-avatar" style="--ac:${a.color}">${a.initials}</div>
      <div class="lb-info">
        <span class="lb-name">${a.name}</span>
        <span class="lb-territory">${a.territory || ''}</span>
      </div>
      <div class="lb-stats">
        <div class="lb-stat"><span class="lb-stat-val green-text">${a.won}</span><span class="lb-stat-label">Won</span></div>
        <div class="lb-stat"><span class="lb-stat-val">${a.totalLeads}</span><span class="lb-stat-label">Leads</span></div>
        <div class="lb-stat"><span class="lb-stat-val">${fmtValue(a.pipeline)}</span><span class="lb-stat-label">Value</span></div>
      </div>
      <div class="lb-bar-wrap"><div class="lb-bar" style="--pct:${pct}%"></div></div>
    </div>`;
  }).join('');
}

document.getElementById('lbTabs')?.addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('#lbTabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLeaderboard(btn.dataset.period);
});

/* ── SOURCE CHART ── */
let sourceChartInst = null;
function renderSourceChart() {
  const ctx = document.getElementById('sourceChart');
  if (!ctx) return;
  const sources = { expo:0, referral:0, direct:0, digital:0 };
  S.leads.forEach(l => { if (sources[l.source] !== undefined) sources[l.source]++; });
  const total = S.leads.length || 1;
  const data  = Object.values(sources);
  const labels = Object.keys(sources).map(s => s.charAt(0).toUpperCase()+s.slice(1));
  if (sourceChartInst) { sourceChartInst.destroy(); }
  sourceChartInst = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:['#F0BE18','#2979FF','#00DFA2','#FF8C00'], borderColor:'#0f0f0f', borderWidth:3, hoverOffset:8 }] },
    options:{ cutout:'68%', plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:'#161616', borderColor:'#333', borderWidth:1, callbacks:{ label: c => ` ${c.label}: ${c.raw} (${Math.round(c.raw/total*100)}%)` } } }, animation:{ animateScale:true, duration:1200 } }
  });
  const leg = document.getElementById('sourceLegend');
  if (leg) {
    const cols = ['var(--gold)','var(--azure)','var(--emerald)','var(--amber)'];
    leg.innerHTML = labels.map((l,i) => `<div class="source-leg-item"><span class="leg-dot" style="background:${cols[i]}"></span>${l} <strong>${Math.round(data[i]/total*100)}%</strong></div>`).join('');
  }
}

/* ── TREND CHART ── */
let trendChartInst = null;
function renderTrendChart() {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;
  if (trendChartInst) trendChartInst.destroy();
  const months = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
  const leads  = [84,92,78,110,124,98,140,132,158,146,172,S.leads.length];
  const won    = [14,18,12,24,28,22,34,30,38,32,41,S.leads.filter(l=>l.stage==='won').length];
  trendChartInst = new Chart(ctx, {
    type:'line',
    data:{ labels:months, datasets:[
      { label:'Total Leads', data:leads, borderColor:'#2979FF', backgroundColor:'rgba(41,121,255,0.06)', fill:true, tension:0.4, borderWidth:2, pointBackgroundColor:'#2979FF', pointRadius:3 },
      { label:'Conversions', data:won,   borderColor:'#00DFA2', backgroundColor:'rgba(0,223,162,0.06)',  fill:true, tension:0.4, borderWidth:2, pointBackgroundColor:'#00DFA2', pointRadius:3 }
    ]},
    options:{ responsive:true, interaction:{mode:'index',intersect:false}, plugins:{ legend:{display:true,labels:{color:'#666',boxWidth:10,font:{size:10}}}, tooltip:{backgroundColor:'#161616',borderColor:'#333',borderWidth:1} }, scales:{ x:{grid:{color:'#1a1a1a'},ticks:{color:'#444',font:{size:10}}}, y:{grid:{color:'#1a1a1a'},ticks:{color:'#444',font:{size:10}}} }, animation:{duration:1400} }
  });
}

/* ── ACTIVITY STREAM ── */
const ACTIVITIES_SEED = [
  { dot:'emerald', msg:'<strong>System</strong> ready',                                  meta:'IINVSYS Sales OS · <span class="act-time">Online</span>',                tag:'new',      tagLabel:'LIVE' },
  { dot:'gold',    msg:'<strong>Database</strong> connected successfully',               meta:'MongoDB · <span class="act-time">On startup</span>',                    tag:'won',      tagLabel:'LIVE' },
  { dot:'violet',  msg:'<strong>JWT auth</strong> protecting all routes',               meta:'Role-based: superadmin, manager, agent · <span class="act-time">Secured</span>', tag:'won', tagLabel:'AUTH' },
  { dot:'azure',   msg:'<strong>API server</strong> running',                            meta:'Node.js + Express · <span class="act-time">Active</span>',              tag:'follow',   tagLabel:'API' },
  { dot:'coral',   msg:'<strong>Bulk CSV import</strong> available',                    meta:'POST /api/leads/bulk-import · dedup by phone · <span class="act-time">Ready</span>', tag:'overdue', tagLabel:'IMPORT' },
];

function renderActivityStream() {
  const list = document.getElementById('activityList');
  if (!list) return;
  list.innerHTML = ACTIVITIES_SEED.map(a => `
    <div class="act-item">
      <div class="act-dot ${a.dot}"></div>
      <div class="act-body">
        <span class="act-msg">${a.msg}</span>
        <span class="act-meta">${a.meta}</span>
      </div>
      <span class="act-tag ${a.tag}">${a.tagLabel}</span>
    </div>`).join('');
}

/* ── EXPO MINI ── */
function renderExpoMini() {
  const list = document.getElementById('expoMiniList');
  if (!list) return;
  list.innerHTML = S.expos.map(e => {
    const dot   = e.status === 'live' ? 'live' : e.status === 'upcoming' ? 'upcoming' : 'past';
    const badge = e.status === 'live' ? '<span class="expo-status live-badge-sm">LIVE</span>' : e.status === 'upcoming' ? '<span class="expo-status upcoming-badge">UPCOMING</span>' : '<span class="expo-status past-badge">DONE</span>';
    return `<div class="expo-mini">
      <div class="expo-mini-dot ${dot}"></div>
      <div class="expo-mini-info">
        <span class="expo-mini-name">${e.name}</span>
        <span class="expo-mini-sub">${e.dates || ''} · ${(e.agents||[]).length} agents</span>
      </div>
      <div class="expo-mini-stats">
        <span class="expo-mini-count">${e.leadCount || '—'} <small>leads</small></span>
        ${badge}
      </div>
    </div>`;
  }).join('');
}

/* ═══════════ LEAD KANBAN ═══════════ */
function getFilters() {
  return {
    search:  (document.getElementById('leadSearch')?.value || '').toLowerCase(),
    stage:   document.getElementById('filterStage')?.value  || '',
    source:  document.getElementById('filterSource')?.value || '',
    agentId: document.getElementById('filterAgent')?.value  || '',
  };
}

function filteredLeads(leads, f) {
  return leads.filter(l => {
    if (f.search  && !l.name.toLowerCase().includes(f.search) && !l.phone.includes(f.search) && !(l.source||'').includes(f.search)) return false;
    if (f.stage   && l.stage   !== f.stage)   return false;
    if (f.source  && l.source  !== f.source)  return false;
    if (f.agentId && l.agentId !== f.agentId) return false;
    return true;
  });
}

function renderKanban(filters = {}, boardId = 'kanbanBoard', leadsPool = null) {
  const board = document.getElementById(boardId);
  if (!board) return;
  const pool = leadsPool || S.leads;
  const fl   = filteredLeads(pool, filters);
  const activeStages = filters.stage ? [filters.stage] : STAGES;

  board.innerHTML = activeStages.map(stage => {
    const stageLeads = fl.filter(l => l.stage === stage);
    const stageColor = STAGE_COLORS[stage];
    return `
    <div class="kanban-col" data-stage="${stage}">
      <div class="kanban-col-header">
        <span class="kanban-stage-dot" style="background:${stageColor}"></span>
        <span class="kanban-stage-name">${STAGE_LABELS[stage]}</span>
        <span class="kanban-stage-count">${stageLeads.length}</span>
      </div>
      <div class="kanban-cards">
        ${stageLeads.length === 0 ? `<div class="kanban-empty"><span>No leads</span></div>` : stageLeads.map(l => leadCardHTML(l)).join('')}
      </div>
    </div>`;
  }).join('');

  board.querySelectorAll('.lead-card').forEach(card => {
    card.addEventListener('click', () => openLeadModal(card.dataset.id));
  });
}

function leadCardHTML(l) {
  const agent   = agentById(l.agentId);
  const overdue = !['won','lost'].includes(l.stage) && daysSince(l.lastContact) > 7;
  const bClass  = overdue ? 'overdue-flag' : '';
  const borderMap = { new:'gold-border', contacted:'amber-border', interested:'blue-border', proposal:'blue-border', negotiation:'amber-border', won:'green-border', lost:'red-border' };
  const prodTags  = (l.products||[]).slice(0,2).map(pid => {
    const p = productById(pid);
    return p ? `<span class="ltag amber">${p.name}</span>` : '';
  }).join('');

  return `<div class="lead-card ${borderMap[l.stage]||''} ${bClass}" data-id="${l.id}">
    <div class="lead-card-top">
      <span class="lead-name">${l.name}</span>
      <span class="lead-score ${l.stage==='won'?'won-score':scoreBadgeClass(l.score)}">${l.stage==='won'?'✓':l.score}</span>
    </div>
    <div class="lead-detail">📞 ${l.phone}</div>
    <div class="lead-detail">◇ ${l.source.charAt(0).toUpperCase()+l.source.slice(1)}${l.expo ? ' — ' + l.expo : ''}</div>
    ${l.createdByRole === 'referrer' ? `<div class="lead-detail" style="color:var(--violet);font-size:10px">↳ via ${l.createdByName || 'Referrer'}</div>` : ''}
    ${prodTags ? `<div class="lead-tags">${prodTags}</div>` : ''}
    <div class="lead-footer">
      <div class="lead-agent" style="background:${agent?.color||'var(--text-3)'}">${agent?.initials||'?'}</div>
      <span class="lead-time ${overdue?'overdue-text':''}">${overdue ? '⚠ Overdue' : l.lastContact ? relTime(l.lastContact) : 'Just added'}</span>
      <span class="lead-fu">${l.followUps > 0 ? '↩ '+l.followUps+' FU' : 'No FU yet'}</span>
    </div>
  </div>`;
}

function relTime(dateStr) {
  const d = daysSince(dateStr);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return d + ' days ago';
}

// Kanban empty style
const kanbanEmptyStyle = document.createElement('style');
kanbanEmptyStyle.textContent = `.kanban-empty { padding:20px; text-align:center; font-family:var(--font-mono); font-size:10px; color:var(--text-4); letter-spacing:1px; }`;
document.head.appendChild(kanbanEmptyStyle);

/* ── FILTER EVENTS ── */
['leadSearch','filterStage','filterSource','filterAgent'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => renderKanban(getFilters()));
});
['myLeadSearch','myFilterStage'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const myLeads = S.leads.filter(l => l.agentId === S.session?.agentId);
    const f = {
      search: (document.getElementById('myLeadSearch')?.value||'').toLowerCase(),
      stage:  document.getElementById('myFilterStage')?.value||'',
    };
    renderKanban(f, 'myKanbanBoard', myLeads);
  });
});

/* ═══════════ LEAD CRUD MODAL ═══════════ */
function openLeadModal(leadId) {
  const modal = document.getElementById('leadModal');
  const form  = document.getElementById('leadForm');
  const isNew = !leadId;

  /* PRD 1/4 — reset transient scan + dupe state on every open */
  ['leadName','leadPhone','leadEmail','leadCompany'].forEach(clearConfidence);
  const banner = document.getElementById('scanRescanBanner'); if (banner) banner.hidden = true;
  const dupePanel = document.getElementById('dupeMatchPanel'); if (dupePanel) { dupePanel.hidden = true; dupePanel.innerHTML = ''; }
  _dupeState.matches = []; _dupeState.pendingPayload = null; _dupeState.pendingBtn = null;

  document.getElementById('leadModalEyebrow').textContent = isNew ? '// QUICK CAPTURE' : '// EDIT LEAD';
  document.getElementById('leadModalTitle').innerHTML     = isNew ? 'New <em>Lead</em>' : 'Edit <em>Lead</em>';
  document.getElementById('leadSubmitBtn').textContent    = isNew ? 'Capture Lead →' : 'Save Changes →';
  const delBtn = document.getElementById('deleteLeadBtn');
  delBtn.classList.toggle('hidden', isNew || !isAdmin());

  // Always refresh expo dropdown with latest S.expos
  const leadExpoSel = document.getElementById('leadExpo');
  if (leadExpoSel) {
    leadExpoSel.innerHTML = '<option value="">— Select Expo —</option>';
    S.expos.forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex.id; opt.textContent = ex.name;
      leadExpoSel.appendChild(opt);
    });
  }

  // Populate product checkboxes
  const tagWrap = document.getElementById('leadProductTags');
  if (S.products.length === 0) {
    tagWrap.innerHTML = '<span style="font-size:12px;color:var(--text-3);opacity:0.7">No products configured yet</span>';
  } else {
    tagWrap.innerHTML = S.products.map(p =>
      `<label class="ptag-check" data-pid="${p.id}"><input type="checkbox" value="${p.id}"/><span>${p.name}</span></label>`
    ).join('');
  }

  if (isNew) {
    form.reset();
    document.getElementById('leadIdInput').value = '';
    if (isAgent()) document.getElementById('leadAgent').value = S.session.agentId;
  } else {
    const l = S.leads.find(x => x.id === leadId);
    if (!l) return;
    document.getElementById('leadIdInput').value  = l.id;
    document.getElementById('leadName').value     = l.name;
    document.getElementById('leadPhone').value    = l.phone;
    document.getElementById('leadEmail').value    = l.email;
    document.getElementById('leadStage').value    = l.stage;
    document.getElementById('leadSource').value   = l.source;
    document.getElementById('leadExpo').value     = l.expoId || '';
    document.getElementById('leadAgent').value    = l.agentId || '';
    document.getElementById('leadValue').value    = l.value   || '';
    document.getElementById('leadNotes').value    = l.notes   || '';
    tagWrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = (l.products||[]).includes(cb.value);
    });
    if (isAgent()) {
      ['leadName','leadPhone','leadEmail','leadSource','leadExpo','leadValue','leadNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.setAttribute('readonly',''); el.style.opacity='0.5'; }
      });
      tagWrap.querySelectorAll('input').forEach(cb => { cb.disabled = true; });
    }
  }

  if (!isAgent() || isNew) {
    ['leadName','leadPhone','leadEmail','leadSource','leadExpo','leadValue','leadNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.removeAttribute('readonly'); el.style.opacity=''; }
    });
    tagWrap.querySelectorAll('input').forEach(cb => { cb.disabled = false; });
  }

  delBtn.onclick = () => confirmDelete('lead', leadId, () => {
    modal.classList.remove('open');
  });

  /* PRD 5 — render enrichment section for existing leads */
  const existingEnrichSection = modal.querySelector('.enrichment-section');
  if (existingEnrichSection) existingEnrichSection.remove();
  if (!isNew) {
    const l = S.leads.find(x => x.id === leadId);
    if (l && l.enrichment && Object.keys(l.enrichment).length) {
      const form = document.getElementById('leadForm');
      renderEnrichmentSection(l, form);
    }
  }

  modal.classList.add('open');
}

document.getElementById('leadModalClose').addEventListener('click',  () => document.getElementById('leadModal').classList.remove('open'));
document.getElementById('leadModalCancel').addEventListener('click', () => document.getElementById('leadModal').classList.remove('open'));
document.getElementById('leadModal').addEventListener('click', e => { if (e.target === document.getElementById('leadModal')) document.getElementById('leadModal').classList.remove('open'); });

/* PRD 1 AC4 — gather OCR provenance from input dataset attrs into a Map-shaped object.
   Accepts an optional fieldMap of { name, phone, email, company } input IDs so the
   referrer view can reuse the same provenance pipeline against its own inputs. */
const _MAIN_FIELDMAP = { name:'leadName', phone:'leadPhone', email:'leadEmail', company:'leadCompany' };
function collectOcrCapture(fieldMap) {
  const map    = fieldMap || _MAIN_FIELDMAP;
  const fields = {};
  for (const logical of ['name','phone','email','company']) {
    const inputId = map[logical];
    if (!inputId) continue;
    const el = document.getElementById(inputId);
    if (!el || !el.dataset.cband) continue;
    const conf = parseFloat(el.dataset.ocrConfidence);
    fields[logical] = {
      band:          el.dataset.cband,
      originalValue: el.dataset.ocrOriginal || '',
      rawConfidence: isNaN(conf) ? undefined : conf,
      corrected:     el.dataset.corrected === 'true',
    };
  }
  if (!Object.keys(fields).length) return undefined;
  return { scannedAt: new Date().toISOString(), ocrEngine: 'tesseract.js@5', fields };
}

/* PRD 1 AC3 — confirm dialog when saving with any unedited Low-band field */
function lowConfidenceFieldsRemaining() {
  const out = [];
  for (const inputId of ['leadName','leadPhone','leadEmail','leadCompany']) {
    const el = document.getElementById(inputId);
    if (el?.dataset.cband === 'low' && el.dataset.corrected !== 'true' && el.value.trim()) {
      out.push(inputId);
    }
  }
  return out;
}

async function _persistLead({ id, payload, btn }) {
  if (id) {
    await api('PUT', `/leads/${id}`, payload);
    flash('Lead updated successfully');
  } else {
    const res = await api('POST', '/leads', payload);
    const newId = res.data?._id || res._id;
    logTelemetry('scan_saved', {}, newId);
    flash('Lead captured!');
  }
  await loadAllData(true);
  updateNavCounts();
  document.getElementById('leadModal').classList.remove('open');
  renderKanban(getFilters());
  if (isAgent()) renderMyLeads();
  if (document.getElementById('page-overview').classList.contains('active')) renderKPIs();
}

document.getElementById('leadForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id    = document.getElementById('leadIdInput').value;
  const name  = document.getElementById('leadName').value.trim();
  const phone = document.getElementById('leadPhone').value.trim();
  if (!name || !phone) { flash('Name and Phone are required', 'error'); return; }

  const products = Array.from(document.querySelectorAll('#leadProductTags input:checked')).map(c => c.value);
  const expoVal  = document.getElementById('leadExpo').value;
  const ocrCapture = collectOcrCapture();
  const payload  = {
    name, phone,
    email:         document.getElementById('leadEmail').value.trim(),
    company:       document.getElementById('leadCompany')?.value?.trim() || '',
    stage:         document.getElementById('leadStage').value,
    source:        document.getElementById('leadSource').value  || 'direct',
    expo:          expoVal || undefined,
    assignedAgent: document.getElementById('leadAgent').value   || S.agents.find(a=>a.status==='active')?.id,
    value:         parseInt(document.getElementById('leadValue').value) || 0,
    notes:         document.getElementById('leadNotes').value.trim(),
    products,
    ocrCapture,
  };

  const btn = document.getElementById('leadSubmitBtn');

  /* PRD 1 AC3 — confirm if low-confidence fields remain */
  const lowFields = lowConfidenceFieldsRemaining();
  if (!id && lowFields.length) {
    const proceed = window.confirm(`${lowFields.length} field${lowFields.length > 1 ? 's look' : ' looks'} uncertain — save anyway?`);
    logTelemetry('scan_save_with_low_confidence', { lowFields, accepted: proceed });
    if (!proceed) return;
  }

  /* PRD 4 — final dupe check before save (only on new leads) */
  if (!id) {
    const matches = await runDuplicateCheck();
    if (matches?.length) {
      /* Stop — user must explicitly choose Open / Merge / Save as new from the panel.
         Add a one-shot "Save as new" button if not already present. */
      ensureSaveAsNewAffordance(payload, btn);
      btnLoad(btn, false);
      return;
    }
  }

  btnLoad(btn, true, id ? 'Saving…' : 'Capturing…');
  try {
    await _persistLead({ id, payload, btn });
  } catch (err) {
    flash(err.message || 'Failed to save lead', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

/* PRD 4 AC6 — when a duplicate match is shown, add a "Save as new" affordance
   to the dupe panel that triggers the reason modal. */
function ensureSaveAsNewAffordance(payload, originalBtn) {
  const panel = document.getElementById('dupeMatchPanel');
  if (!panel || panel.hidden) return;
  if (panel.querySelector('[data-dmp-action="save-anyway"]')) return; // already added
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--surface-3);text-align:right';
  wrap.innerHTML = `<button type="button" class="neo-btn outline" data-dmp-action="save-anyway">Save as new lead anyway</button>`;
  panel.appendChild(wrap);
  wrap.querySelector('button').addEventListener('click', () => {
    _dupeState.pendingPayload = payload;
    _dupeState.pendingBtn = originalBtn;
    document.getElementById('dupeReasonModal').classList.add('open');
  });
}

/* Wire reason modal */
document.addEventListener('DOMContentLoaded', () => {
  const close = () => document.getElementById('dupeReasonModal')?.classList.remove('open');
  document.getElementById('dupeReasonClose')?.addEventListener('click', close);
  document.getElementById('dupeReasonCancel')?.addEventListener('click', close);
  document.getElementById('dupeReasonConfirm')?.addEventListener('click', async () => {
    const reason = document.getElementById('dupeReasonSelect').value;
    if (!reason) { flash('Please pick a reason', 'error'); return; }
    const detail = document.getElementById('dupeReasonDetail').value.trim();
    const payload = _dupeState.pendingPayload;
    if (!payload) { close(); return; }
    payload.dupeOverride = {
      matchedLeadId: _dupeState.matches[0]?.lead?.id,
      reason, reasonDetail: detail,
    };
    const btn = _dupeState.pendingBtn;
    btnLoad(btn, true, 'Capturing…');
    try {
      await _persistLead({ id: '', payload, btn });
      logTelemetry('scan_dedupe_save_anyway', { reason, matchedLeadId: payload.dupeOverride.matchedLeadId });
      close();
    } catch (err) {
      flash(err.message || 'Failed to save lead', 'error');
    } finally {
      btnLoad(btn, false);
    }
  });
});

/* ── New lead buttons ── */
document.getElementById('addLeadBtn')?.addEventListener('click',   () => openLeadModal(null));
document.getElementById('newLeadBtn')?.addEventListener('click',   () => openLeadModal(null));
document.getElementById('agentNewLeadBtn')?.addEventListener('click', () => openLeadModal(null));

/* ═══════════ CONFIRM / DELETE ═══════════ */
function confirmDelete(type, id, cb) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = type === 'lead' ? 'Delete this lead?' : 'Delete this product?';
  document.getElementById('confirmSub').textContent   = type === 'lead' ? 'Lead data and all follow-ups will be permanently removed.' : 'This product will be removed from all lead tags.';
  modal.classList.add('open');

  const okBtn = document.getElementById('confirmOk');
  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);

  newOk.addEventListener('click', async () => {
    btnLoad(newOk, true, 'Deleting…');
    try {
      if (type === 'lead') {
        await api('DELETE', `/leads/${id}`);
      } else {
        await api('DELETE', `/products/${id}`);
      }
      await loadAllData(true);
      updateNavCounts();
      modal.classList.remove('open');
      document.getElementById('leadModal').classList.remove('open');
      renderKanban(getFilters());
      renderProductsTable();
      if (cb) cb();
      flash(type === 'lead' ? 'Lead deleted' : 'Product deleted', 'warn');
    } catch (err) {
      flash(err.message || 'Delete failed', 'error');
      btnLoad(newOk, false);
    }
  });
}

document.getElementById('confirmCancel').addEventListener('click', () => document.getElementById('confirmModal').classList.remove('open'));
document.getElementById('confirmModal').addEventListener('click', e => { if (e.target === document.getElementById('confirmModal')) document.getElementById('confirmModal').classList.remove('open'); });
document.getElementById('infoModalClose')?.addEventListener('click', () => document.getElementById('infoModal').classList.remove('open'));
document.getElementById('infoModal')?.addEventListener('click', e => { if (e.target === document.getElementById('infoModal')) document.getElementById('infoModal').classList.remove('open'); });

/* ═══════════ AGENTS ═══════════ */
function renderAgentsGrid() {
  const grid = document.getElementById('agentsGrid');
  if (!grid) return;
  grid.innerHTML = S.agents.map(a => {
    const aLeads   = S.leads.filter(l => l.agentId === a.id);
    const won      = aLeads.filter(l => l.stage === 'won');
    const pipeline = aLeads.reduce((s,l) => s+(l.value||0),0);
    const convRate = aLeads.length ? ((won.length/aLeads.length)*100).toFixed(1) : '0.0';
    const tgtPct   = a.target ? Math.min(Math.round((pipeline/a.target)*100), 100) : 0;
    const inactive = a.status === 'inactive';
    return `
    <div class="agent-card ${inactive?'inactive-card':''}" style="--ac:${a.color}">
      <div class="agent-card-top">
        <div class="agent-avatar large" style="--ac:${a.color}">${a.initials}</div>
        <div class="agent-meta">
          <span class="agent-full-name">${a.name}</span>
          <span class="agent-designation">${a.designation}</span>
          ${a.territory ? `<span class="agent-territory">📍 ${a.territory}</span>` : ''}
        </div>
        <div class="agent-status-pill ${a.status === 'active'?'active':'inactive'}">${(a.status||'inactive').toUpperCase()}</div>
      </div>
      <div class="agent-kpis">
        <div class="ak"><span class="ak-val ${inactive?'dim':''}">${aLeads.length}</span><span class="ak-label">Total Leads</span></div>
        <div class="ak"><span class="ak-val green-text ${inactive?'dim':''}">${won.length}</span><span class="ak-label">Won</span></div>
        <div class="ak"><span class="ak-val ${inactive?'dim':''}">${convRate}%</span><span class="ak-label">Conv. Rate</span></div>
        <div class="ak"><span class="ak-val ${inactive?'dim':''}">${fmtValue(pipeline)}</span><span class="ak-label">Pipeline</span></div>
      </div>
      ${!inactive ? `
      <div class="agent-progress">
        <div class="ap-label"><span>Monthly Target</span><span>${fmtValue(pipeline)} / ${fmtValue(a.target)}</span></div>
        <div class="ap-bar"><div class="ap-fill" style="--pct:${tgtPct}%;--ac:${a.color}"></div></div>
      </div>` : ''}
      <div class="agent-card-actions">
        <button class="agent-btn" onclick="filterToAgent('${a.id}')">View Leads</button>
        ${a.status === 'active'
          ? `<button class="agent-btn danger" onclick="toggleAgent('${a.id}','inactive')">Deactivate</button>`
          : `<button class="agent-btn success" onclick="toggleAgent('${a.id}','active')">Reactivate</button>`}
        <button class="agent-btn" onclick="resetCreds('${a.id}')">Reset Creds</button>
        ${isSuperAdmin() ? `<button class="agent-btn danger hard-del-btn" onclick="hardDeleteAgent('${a.id}','${a.name.replace(/'/g,"\\'")}')">⚠ Hard Delete</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

window.filterToAgent = function(agentId) {
  goToPage('leads');
  setTimeout(() => {
    document.getElementById('filterAgent').value = agentId;
    renderKanban(getFilters());
  }, 50);
};

window.toggleAgent = async function(agentId, newStatus) {
  /* Find the clicked button by its onclick attribute context */
  showRefresh();
  try {
    await api('PUT', `/agents/${agentId}`, { status: newStatus });
    await loadAllData(true);
    renderAgentsGrid();
    flash(`Agent ${newStatus === 'active' ? 'reactivated' : 'deactivated'}`);
  } catch (err) {
    flash(err.message || 'Failed to update agent', 'error');
  } finally {
    hideRefresh();
  }
};

window.resetCreds = function(agentId) {
  const a = S.agents.find(x => x.id === agentId);
  if (a) flash(`Password reset link sent to: ${a.name}`);
};

/* ── Agent modal open/close ── */
function openAgentModal(agentId) {
  const modal = document.getElementById('agentModal');
  const isNew = !agentId;
  document.getElementById('agentModalEyebrow').textContent = isNew ? '// ADD' : '// EDIT';
  document.getElementById('agentModalTitle').innerHTML = isNew ? 'New <em>Agent</em>' : 'Edit <em>Agent</em>';
  document.getElementById('agentSubmitBtn').textContent = isNew ? 'Save Agent →' : 'Update Agent →';
  document.getElementById('agentIdInput').value = agentId || '';
  if (isNew) {
    document.getElementById('agentForm').reset();
  } else {
    const a = S.agents.find(x => x.id === agentId);
    if (!a) return;
    document.getElementById('agentName').value        = a.name;
    document.getElementById('agentEmail').value       = a.email;
    document.getElementById('agentPhone').value       = a.phone || '';
    document.getElementById('agentTerritory').value   = a.territory || '';
    document.getElementById('agentDesignation').value = a.designation || '';
    document.getElementById('agentTarget').value      = a.target || '';
    document.getElementById('agentColor').value       = a.color || '#00DFA2';
  }
  modal.classList.add('open');
}
document.getElementById('addAgentBtn')?.addEventListener('click', () => openAgentModal(null));
document.getElementById('agentModalClose')?.addEventListener('click',  () => document.getElementById('agentModal').classList.remove('open'));
document.getElementById('agentModalCancel')?.addEventListener('click', () => document.getElementById('agentModal').classList.remove('open'));
document.getElementById('agentModal')?.addEventListener('click', e => { if (e.target === document.getElementById('agentModal')) document.getElementById('agentModal').classList.remove('open'); });

document.getElementById('agentForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id   = document.getElementById('agentIdInput').value;
  const name = document.getElementById('agentName').value.trim();
  const email = document.getElementById('agentEmail').value.trim();
  const phone = document.getElementById('agentPhone').value.trim();
  const territory = document.getElementById('agentTerritory').value.trim();
  if (!name || !email || !phone || !territory) { flash('Name, email, phone and territory are required', 'error'); return; }
  const initials = name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3) || name.charAt(0).toUpperCase();
  const payload = {
    name, email, phone, territory, initials,
    designation: document.getElementById('agentDesignation').value.trim() || 'Sales Agent',
    target:      parseInt(document.getElementById('agentTarget').value) || 0,
    color:       document.getElementById('agentColor').value,
  };
  const btn = document.getElementById('agentSubmitBtn');
  btnLoad(btn, true, id ? 'Updating…' : 'Creating…');
  try {
    if (id) {
      await api('PUT', `/agents/${id}`, payload);
      flash('Agent updated');
    } else {
      await api('POST', '/agents', payload);
      flash('Agent created — credentials sent to their email');
    }
    await loadAllData(true);
    renderAgentsGrid();
    populateAgentDropdowns();
    document.getElementById('agentModal').classList.remove('open');
  } catch (err) {
    flash(err.message || 'Failed to save agent', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

/* ═══════════ PRODUCTS ═══════════ */
function renderProductsTable() {
  const tbody   = document.getElementById('productsTableBody');
  const empty   = document.getElementById('productsEmpty');
  const tbl     = document.getElementById('productsTable');
  if (!tbody) return;

  const search  = (document.getElementById('productSearch')?.value||'').toLowerCase();
  const catFilt = document.getElementById('filterProductCat')?.value||'';
  let prods = S.products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search) && !p.sku.toLowerCase().includes(search)) return false;
    if (catFilt && p.category !== catFilt) return false;
    return true;
  });

  if (S.products.length === 0) {
    empty?.classList.remove('hidden');
    tbl?.classList.add('hidden');
    return;
  }
  empty?.classList.add('hidden');
  tbl?.classList.remove('hidden');

  prods = prods.map(p => ({
    ...p,
    interested: S.leads.filter(l => (l.products||[]).includes(p.id)).length
  }));

  tbody.innerHTML = prods.map(p => `
    <tr>
      <td><span class="product-sku">${p.sku}</span></td>
      <td>
        <div class="product-name">${p.name}</div>
        ${p.desc ? `<div style="font-size:10px;color:var(--text-4);font-family:var(--font-mono);margin-top:2px">${p.desc}</div>` : ''}
      </td>
      <td><span class="product-cat-badge ${p.category}">${p.category}</span></td>
      <td style="font-family:var(--font-display);font-weight:800;color:var(--text-1)">${fmtValue(p.price)}</td>
      <td>
        <span style="font-family:var(--font-display);font-weight:800;color:${p.interested>0?'var(--gold)':'var(--text-4)'}">${p.interested}</span>
        <span style="font-size:10px;color:var(--text-3);font-family:var(--font-mono)"> leads</span>
      </td>
      <td>
        <div class="table-actions">
          <button class="tbl-btn" onclick="openProductModal('${p.id}')">✎ Edit</button>
          <button class="tbl-btn del" onclick="confirmDelete('product','${p.id}')">🗑 Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('productSearch')?.addEventListener('input', renderProductsTable);
document.getElementById('filterProductCat')?.addEventListener('change', renderProductsTable);

/* ── Product Modal ── */
window.openProductModal = function(productId) {
  const modal  = document.getElementById('productModal');
  const isEdit = !!productId;
  document.getElementById('productModalEyebrow').textContent = isEdit ? '// EDIT PRODUCT' : '// ADD PRODUCT';
  document.getElementById('productModalTitle').innerHTML     = isEdit ? 'Edit <em>Product</em>' : 'New <em>Product</em>';
  document.getElementById('productSubmitBtn').textContent    = isEdit ? 'Save Changes →' : 'Add Product →';
  document.getElementById('productIdInput').value = productId || '';

  if (isEdit) {
    const p = S.products.find(x => x.id === productId);
    if (!p) return;
    document.getElementById('productName').value     = p.name;
    document.getElementById('productSKU').value      = p.sku;
    document.getElementById('productCategory').value = p.category;
    document.getElementById('productPrice').value    = p.price;
    document.getElementById('productDesc').value     = p.desc || '';
  } else {
    document.getElementById('productForm').reset();
  }
  modal.classList.add('open');
};

document.getElementById('addProductBtn')?.addEventListener('click', () => openProductModal(null));
document.getElementById('productModalClose').addEventListener('click',  () => document.getElementById('productModal').classList.remove('open'));
document.getElementById('productModalCancel').addEventListener('click', () => document.getElementById('productModal').classList.remove('open'));
document.getElementById('productModal').addEventListener('click', e => { if (e.target === document.getElementById('productModal')) document.getElementById('productModal').classList.remove('open'); });

document.getElementById('productForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id    = document.getElementById('productIdInput').value;
  const name  = document.getElementById('productName').value.trim();
  const sku   = document.getElementById('productSKU').value.trim();
  const cat   = document.getElementById('productCategory').value;
  const price = parseInt(document.getElementById('productPrice').value) || 0;
  const desc  = document.getElementById('productDesc').value.trim();
  if (!name || !sku || !cat) { flash('Name, SKU, and Category are required', 'error'); return; }
  const payload = { name, sku, category: cat, price, description: desc };
  const btn = document.getElementById('productSubmitBtn');
  btnLoad(btn, true, id ? 'Saving…' : 'Adding…');
  try {
    if (id) {
      await api('PUT', `/products/${id}`, payload);
      flash('Product updated');
    } else {
      await api('POST', '/products', payload);
      flash('Product added');
    }
    await loadAllData(true);
    updateNavCounts();
    document.getElementById('productModal').classList.remove('open');
    renderProductsTable();
    // Refresh lead product tags if lead modal is open
    const leadTagWrap = document.getElementById('leadProductTags');
    if (leadTagWrap && document.getElementById('leadModal').classList.contains('open')) {
      leadTagWrap.innerHTML = S.products.map(p =>
        `<label class="ptag-check" data-pid="${p.id}"><input type="checkbox" value="${p.id}"/><span>${p.name}</span></label>`
      ).join('');
    }
  } catch (err) {
    flash(err.message || 'Failed to save product', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

/* ═══════════ EXPOS ═══════════ */
function renderExpos() {
  const grid = document.getElementById('expoGrid');
  if (!grid) return;
  grid.innerHTML = S.expos.map(e => {
    const cls  = e.status === 'live' ? 'live-expo' : e.status === 'upcoming' ? 'upcoming-expo' : 'past-expo';
    const chip = e.status === 'live'
      ? `<div class="expo-status-chip live-chip">● LIVE NOW</div>`
      : e.status === 'upcoming'
        ? `<div class="expo-status-chip upcoming-chip">◌ UPCOMING</div>`
        : `<div class="expo-status-chip past-chip">✓ COMPLETED</div>`;

    const agentList  = e.agents || [];
    const agentChips = agentList.slice(0,4).map(aid => {
      const a = agentById(aid);
      return a ? `<span class="expo-agent-chip" style="--ac:${a.color}">${a.initials}</span>` : '';
    }).join('') + (agentList.length > 4 ? `<span class="expo-agent-chip" style="--ac:#888">+${agentList.length-4}</span>` : '');

    const liveChart = e.status === 'live'
      ? `<div class="expo-hourly-label">Leads captured per hour (Today)</div><div class="expo-hourly-chart"><canvas id="expo_${e.id}_chart" height="80"></canvas></div>`
      : '';

    /* Products with presenters */
    const productsHtml = (e.products || []).length
      ? `<div class="expo-products-section">
          <div class="expo-products-label">// PRODUCTS AT THIS EXPO</div>
          ${(e.products || []).map(p => {
            const presenterChips = (p.presenters || []).slice(0,3).map(aid => {
              const a = agentById(aid);
              return a ? `<span class="expo-presenter-chip" style="--ac:${a.color}" title="${a.name}">${a.initials}</span>` : '';
            }).join('');
            return `<div class="expo-product-row">
              <div class="expo-product-row-info">
                <span class="expo-product-sku">${p.sku || ''}</span>
                <span class="expo-product-name">${p.name}</span>
              </div>
              <div class="expo-product-row-right">
                <div class="expo-product-presenters">${presenterChips}</div>
                <button class="neo-btn yellow xs" onclick="openExpoLeadModal('${e.id}','${p.productId}')">+ Lead</button>
              </div>
            </div>`;
          }).join('')}
        </div>`
      : '';

    const eid = e.id;
    const ename = e.name.replace(/'/g,"\\'");
    return `
    <div class="expo-card ${cls}">
      <div class="expo-card-header">${chip}
        <div class="expo-card-menu-actions">
          <button class="expo-edit-btn neo-btn outline xs" onclick="openEditExpoModal('${eid}')">✏ Edit</button>
          <button class="expo-delete-btn neo-btn outline xs danger-btn" onclick="deleteExpo('${eid}')">🗑</button>
        </div>
      </div>
      <div class="expo-name">${e.name}</div>
      <div class="expo-sub-info">${e.dates} · ${e.venue}</div>
      <div class="expo-kpi-row">
        <div class="exp-kpi"><span class="exp-kpi-val" style="color:var(--gold)">${e.leadCount||'—'}</span><span class="exp-kpi-lbl">Leads</span></div>
        <div class="exp-kpi"><span class="exp-kpi-val" style="color:var(--emerald)">${e.converted||'—'}</span><span class="exp-kpi-lbl">Converted</span></div>
        <div class="exp-kpi"><span class="exp-kpi-val" style="color:var(--azure)">${agentList.length}</span><span class="exp-kpi-lbl">Agents</span></div>
        ${e.targetLeads > 0 ? `<div class="exp-kpi"><span class="exp-kpi-val" style="color:var(--amber)">${e.targetLeads}</span><span class="exp-kpi-lbl">Target</span></div>` : ''}
      </div>
      ${liveChart}
      ${productsHtml}
      <div class="expo-agents-row">${agentChips}</div>
      <div class="expo-card-actions">
        <button class="neo-btn yellow sm" onclick="openExpoLeadModal('${eid}')">📋 Add Lead</button>
        <button class="neo-btn outline sm" onclick="openReferrerModal('${eid}','${ename}')">👥 Referrers</button>
        <button class="neo-btn outline sm" onclick="downloadReferrerSheet('${eid}','${ename}')">📥 Sheet</button>
        ${e.status === 'past' ? `<button class="neo-btn outline sm">📄 Report</button>` : ''}
      </div>
    </div>`;
  }).join('');

  /* If no expos */
  if (!S.expos.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div style="font-size:48px;margin-bottom:16px">◇</div>
      <div class="empty-title">No Expos Yet</div>
      <div class="empty-sub">Create your first expo to start capturing leads at events.</div>
      <button class="neo-btn yellow" style="margin-top:20px" onclick="document.getElementById('createExpoBtn').click()">+ Create First Expo</button>
    </div>`;
  }

  S.expos.filter(e => e.status === 'live').forEach(e => {
    const ctx = document.getElementById(`expo_${e.id}_chart`);
    if (!ctx) return;
    new Chart(ctx, {
      type:'bar',
      data:{ labels:['9AM','10AM','11AM','12PM','1PM','2PM','3PM','4PM','5PM','6PM'], datasets:[{ data:[12,28,34,24,18,42,38,30,26,14], backgroundColor: ctx => { const v=ctx.raw; if(v>=40) return '#F0BE18'; if(v>=25) return '#00DFA2'; return '#2a2a2a'; }, borderColor:'transparent', borderRadius:0 }] },
      options:{ responsive:true, plugins:{ legend:{display:false}, tooltip:{backgroundColor:'#161616',borderColor:'#333',borderWidth:1,callbacks:{label:c=>` ${c.raw} leads`}} }, scales:{ x:{grid:{display:false},ticks:{color:'#444',font:{size:9}}}, y:{grid:{color:'#1a1a1a'},ticks:{color:'#444',font:{size:9}}} }, animation:{duration:1000} }
    });
  });
}

/* ─── Expo CRUD helpers ─── */

/* Open create modal */
document.getElementById('createExpoBtn')?.addEventListener('click', () => {
  document.getElementById('expoIdInput').value = '';
  document.getElementById('expoModalTitle').innerHTML = 'Create <em>Expo</em>';
  document.getElementById('expoSubmitBtn').textContent = 'Create Expo';
  document.getElementById('expoForm').reset();
  renderExpoAgentCheckboxes([]);
  renderExpoProductRows([]);
  document.getElementById('expoModal').classList.add('open');
});

document.getElementById('expoModalClose')?.addEventListener('click', () => document.getElementById('expoModal').classList.remove('open'));
document.getElementById('expoModalCancel')?.addEventListener('click', () => document.getElementById('expoModal').classList.remove('open'));

/* Open edit modal */
window.openEditExpoModal = async function(expoId) {
  const e = S.expos.find(x => x.id === expoId);
  if (!e) return;
  document.getElementById('expoIdInput').value = expoId;
  document.getElementById('expoModalTitle').innerHTML = 'Edit <em>Expo</em>';
  document.getElementById('expoSubmitBtn').textContent = 'Save Changes';
  document.getElementById('expoName').value        = e.name;
  document.getElementById('expoCity').value        = e.city;
  document.getElementById('expoVenue').value       = e.venue_raw;
  document.getElementById('expoTargetLeads').value = e.targetLeads || '';
  if (e.startDate) document.getElementById('expoStartDate').value = e.startDate.toString().slice(0,10);
  if (e.endDate)   document.getElementById('expoEndDate').value   = e.endDate.toString().slice(0,10);
  renderExpoAgentCheckboxes(e.agents || []);
  renderExpoProductRows(e.products || []);
  document.getElementById('expoModal').classList.add('open');
};

function renderExpoAgentCheckboxes(selectedIds) {
  const container = document.getElementById('expoAgentCheckboxes');
  if (!container) return;
  if (!S.agents.length) { container.innerHTML = '<span style="color:var(--text-3);font-size:12px">No agents found. Add agents first.</span>'; return; }
  container.innerHTML = S.agents.map(a => {
    const checked = selectedIds.includes(a.id) ? 'checked' : '';
    return `<label class="expo-checkbox-label">
      <input type="checkbox" class="expo-agent-cb" value="${a.id}" ${checked}>
      <span class="expo-agent-chip" style="--ac:${a.color}">${a.initials}</span>
      <span>${a.name}</span>
    </label>`;
  }).join('');
}

/* Product rows in the expo form */
let _expoProductRows = []; // [{productId, presenters:[agentId]}]

function renderExpoProductRows(existingProducts) {
  _expoProductRows = existingProducts.map(p => ({
    productId:  p.productId || (p.product?._id || p.product || '').toString(),
    presenters: (p.presenters || []).map(x => (x._id || x).toString()),
  }));
  _redrawExpoProductRows();
}

function _redrawExpoProductRows() {
  const container = document.getElementById('expoProductRows');
  if (!container) return;
  if (!_expoProductRows.length) {
    container.innerHTML = `<div style="color:var(--text-3);font-size:12px;padding:8px 0">No products added yet. Click "+ Add Product" to add.</div>`;
    return;
  }
  container.innerHTML = _expoProductRows.map((row, idx) => {
    const productOpts = S.products.map(p =>
      `<option value="${p.id}" ${p.id === row.productId ? 'selected' : ''}>${p.name} (${p.sku || ''})</option>`
    ).join('');
    const agentCheckboxes = S.agents.map(a => {
      const checked = (row.presenters || []).includes(a.id) ? 'checked' : '';
      return `<label class="expo-presenter-cb-label">
        <input type="checkbox" class="expo-presenter-cb" data-idx="${idx}" value="${a.id}" ${checked}>
        <span class="expo-presenter-chip-sm" style="--ac:${a.color}">${a.initials}</span>
        <span style="font-size:11px">${a.name}</span>
      </label>`;
    }).join('');
    return `<div class="expo-product-form-row" data-idx="${idx}">
      <div class="expo-product-form-header">
        <select class="form-input expo-product-select" data-idx="${idx}" style="flex:1">
          <option value="">— Select Product —</option>
          ${productOpts}
        </select>
        <button type="button" class="neo-btn outline xs danger-btn expo-remove-product" data-idx="${idx}">✕</button>
      </div>
      <div class="expo-presenter-checkboxes">
        <span class="expo-presenter-label">Presenters:</span>
        ${agentCheckboxes || '<span style="color:var(--text-3);font-size:11px">No agents available</span>'}
      </div>
    </div>`;
  }).join('');

  /* Bind product select changes */
  container.querySelectorAll('.expo-product-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = +e.target.dataset.idx;
      _expoProductRows[idx].productId = e.target.value;
    });
  });
  /* Bind presenter checkbox changes */
  container.querySelectorAll('.expo-presenter-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      const idx = +e.target.dataset.idx;
      const val = e.target.value;
      if (e.target.checked) {
        if (!_expoProductRows[idx].presenters.includes(val)) _expoProductRows[idx].presenters.push(val);
      } else {
        _expoProductRows[idx].presenters = _expoProductRows[idx].presenters.filter(x => x !== val);
      }
    });
  });
  /* Bind remove buttons */
  container.querySelectorAll('.expo-remove-product').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.target.dataset.idx;
      _expoProductRows.splice(idx, 1);
      _redrawExpoProductRows();
    });
  });
}

document.getElementById('addExpoProductRowBtn')?.addEventListener('click', () => {
  _expoProductRows.push({ productId: '', presenters: [] });
  _redrawExpoProductRows();
});

/* Submit expo form */
document.getElementById('expoForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('expoSubmitBtn');
  btnLoad(btn, true);

  const id        = document.getElementById('expoIdInput').value;
  const agents    = Array.from(document.querySelectorAll('.expo-agent-cb:checked')).map(cb => cb.value);
  const products  = _expoProductRows
    .filter(r => r.productId)
    .map(r => ({ product: r.productId, presenters: r.presenters }));

  const payload = {
    name:        document.getElementById('expoName').value.trim(),
    city:        document.getElementById('expoCity').value.trim(),
    venue:       document.getElementById('expoVenue').value.trim(),
    startDate:   document.getElementById('expoStartDate').value,
    endDate:     document.getElementById('expoEndDate').value,
    targetLeads: parseInt(document.getElementById('expoTargetLeads').value) || 0,
    agents,
    products,
  };

  if (!payload.name || !payload.city || !payload.venue || !payload.startDate || !payload.endDate) {
    flash('Please fill in all required fields.', 'error');
    btnLoad(btn, false);
    return;
  }

  try {
    let res;
    if (id) {
      res = await api('PUT', `/expos/${id}`, payload);
      const idx = S.expos.findIndex(x => x.id === id);
      if (idx >= 0) S.expos[idx] = normalizeExpo(res.data, S.leads);
    } else {
      res = await api('POST', '/expos', payload);
      S.expos.unshift(normalizeExpo(res.data, S.leads));
    }
    document.getElementById('expoModal').classList.remove('open');
    renderExpos();
    updateNavCounts();
    flash(id ? 'Expo updated.' : 'Expo created!', 'success');
  } catch (err) {
    flash(err.message || 'Failed to save expo.', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

/* Delete expo */
window.deleteExpo = async function(expoId) {
  if (!confirm('Delete this expo? This cannot be undone.')) return;
  try {
    await api('DELETE', `/expos/${expoId}`);
    S.expos = S.expos.filter(e => e.id !== expoId);
    renderExpos();
    updateNavCounts();
    flash('Expo deleted.', 'success');
  } catch (err) {
    flash(err.message || 'Failed to delete expo.', 'error');
  }
};

/* ─── Expo Lead Capture Modal ─── */

window.openExpoLeadModal = function(expoId, prefillProductId = null) {
  const expo = S.expos.find(e => e.id === expoId);
  if (!expo) return;

  document.getElementById('expoLeadExpoId').value    = expoId;
  document.getElementById('expoLeadModalTitle').innerHTML = `<em>${expo.name}</em> — New Lead`;
  document.getElementById('expoLeadModalEyebrow').textContent = '// ' + expo.venue.toUpperCase();
  document.getElementById('expoLeadForm').reset();
  document.getElementById('expoLeadExpoId').value = expoId;

  /* Prefill banner */
  document.getElementById('expoLeadBanner').innerHTML = `
    <span class="expo-lead-banner-chip">📍 ${expo.venue}</span>
    <span class="expo-lead-banner-chip">📅 ${expo.dates}</span>`;

  /* Products multi-select */
  const prodContainer = document.getElementById('expoLeadProductSelect');
  const prods = expo.products || [];

  let prodHtml = '';
  /* All option */
  prodHtml += `<label class="expo-product-cb-label all-option">
    <input type="checkbox" id="expoLeadAllProd" class="expo-lead-prod-cb special">
    <span>✦ All Products</span>
  </label>`;
  /* Individual products */
  prods.forEach(p => {
    const checked = prefillProductId && prefillProductId === p.productId ? 'checked' : '';
    prodHtml += `<label class="expo-product-cb-label">
      <input type="checkbox" class="expo-lead-prod-cb" value="${p.productId}" ${checked}>
      <span><strong>${p.sku || ''}</strong> ${p.name}</span>
    </label>`;
  });
  /* Others option */
  prodHtml += `<label class="expo-product-cb-label others-option">
    <input type="checkbox" id="expoLeadOtherProd" class="expo-lead-prod-cb special">
    <span>◇ Others (not listed)</span>
  </label>`;
  prodContainer.innerHTML = prodHtml || '<span style="color:var(--text-3);font-size:12px">No products configured for this expo.</span>';

  /* All checkbox logic */
  const allCb = document.getElementById('expoLeadAllProd');
  const productCbs = () => prodContainer.querySelectorAll('.expo-lead-prod-cb:not(.special)');
  if (allCb) {
    allCb.addEventListener('change', () => {
      productCbs().forEach(cb => cb.checked = allCb.checked);
      const otherCb = document.getElementById('expoLeadOtherProd');
      if (otherCb && allCb.checked) otherCb.checked = false;
    });
    productCbs().forEach(cb => cb.addEventListener('change', () => {
      allCb.checked = Array.from(productCbs()).every(c => c.checked);
    }));
  }

  /* Presenter dropdown — union of all presenters across expo products + expo agents */
  const presenterIds = new Set();
  expo.agents.forEach(id => presenterIds.add(id));
  (expo.products || []).forEach(p => (p.presenters || []).forEach(id => presenterIds.add(id)));

  const presenterSel = document.getElementById('expoLeadPresenter');
  presenterSel.innerHTML = '<option value="">— Select Presenter —</option>';
  [...presenterIds].forEach(aid => {
    const a = agentById(aid);
    if (a) presenterSel.innerHTML += `<option value="${a.id}">${a.name}</option>`;
  });
  /* If no presenters, show all agents */
  if (presenterIds.size === 0) {
    S.agents.forEach(a => {
      presenterSel.innerHTML += `<option value="${a.id}">${a.name}</option>`;
    });
  }

  document.getElementById('expoLeadModal').classList.add('open');
};

document.getElementById('expoLeadModalClose')?.addEventListener('click', () => document.getElementById('expoLeadModal').classList.remove('open'));
document.getElementById('expoLeadModalCancel')?.addEventListener('click', () => document.getElementById('expoLeadModal').classList.remove('open'));

/* Submit expo lead */
document.getElementById('expoLeadForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('expoLeadSubmitBtn');
  btnLoad(btn, true);

  const expoId    = document.getElementById('expoLeadExpoId').value;
  const name      = document.getElementById('expoLeadName').value.trim();
  const phone     = document.getElementById('expoLeadPhone').value.trim();
  const email     = document.getElementById('expoLeadEmail').value.trim();
  const presenter = document.getElementById('expoLeadPresenter').value;
  const notes     = document.getElementById('expoLeadNotes').value.trim();

  if (!name || !phone) { flash('Name and phone are required.', 'error'); btnLoad(btn, false); return; }
  if (!presenter)       { flash('Please select a presenter.', 'error');  btnLoad(btn, false); return; }

  /* Collect selected products */
  const allCb   = document.getElementById('expoLeadAllProd');
  const otherCb = document.getElementById('expoLeadOtherProd');
  const prodCbs = document.querySelectorAll('#expoLeadProductSelect .expo-lead-prod-cb:not(.special):checked');
  const selectedProductIds = Array.from(prodCbs).map(cb => cb.value);

  let finalNotes = notes;
  if (otherCb?.checked) {
    finalNotes = finalNotes ? finalNotes + '\nProducts: Others (not listed)' : 'Products: Others (not listed)';
  }
  if (allCb?.checked && !selectedProductIds.length) {
    /* "All" but expo has no products */
    finalNotes = finalNotes ? finalNotes + '\nInterested in: All products' : 'Interested in: All products';
  }

  const payload = {
    name,
    phone,
    email,
    source:        'expo',
    expo:          expoId,
    products:      selectedProductIds,
    assignedAgent: presenter,
    notes:         finalNotes,
  };

  try {
    const res = await api('POST', '/leads', payload);
    S.leads.unshift(normalizeLead(res.data));
    /* Update expo lead count */
    const expo = S.expos.find(x => x.id === expoId);
    if (expo) expo.leadCount = (expo.leadCount || 0) + 1;
    document.getElementById('expoLeadModal').classList.remove('open');
    renderExpos();
    updateNavCounts();
    flash(`Lead captured: ${name}`, 'success');
  } catch (err) {
    flash(err.message || 'Failed to capture lead.', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

/* ═══════════ AGENT VIEW: MY LEADS & STATS ═══════════ */
function renderMyLeads() {
  if (!S.session?.agentId) return;
  const myLeads = S.leads.filter(l => l.agentId === S.session.agentId);
  renderKanban({}, 'myKanbanBoard', myLeads);
}

function renderMyStats() {
  const grid = document.getElementById('myStatsGrid');
  if (!grid || !S.session?.agentId) return;
  const me = agentById(S.session.agentId);
  const myLeads = S.leads.filter(l => l.agentId === S.session.agentId);
  const won = myLeads.filter(l => l.stage === 'won');
  const pipeline = myLeads.reduce((s,l)=>s+(l.value||0),0);
  const convRate = myLeads.length ? ((won.length/myLeads.length)*100).toFixed(1) : '0.0';
  const overdue  = myLeads.filter(l => !['won','lost'].includes(l.stage) && daysSince(l.lastContact)>7);
  grid.innerHTML = `
    <div class="my-stat-big highlight">
      <div class="kpi-label">MY TOTAL LEADS</div>
      <div class="kpi-value" style="font-size:clamp(28px,3vw,40px)">${myLeads.length}</div>
      <div class="kpi-sub">Assigned to you</div>
    </div>
    <div class="my-stat-big" style="border-color:var(--emerald)">
      <div class="kpi-label">CONVERSION RATE</div>
      <div class="kpi-value" style="font-size:clamp(28px,3vw,40px);color:var(--emerald)">${convRate}%</div>
      <div class="kpi-sub">${won.length} won of ${myLeads.length}</div>
    </div>
    <div class="my-stat-big" style="border-color:var(--azure)">
      <div class="kpi-label">PIPELINE VALUE</div>
      <div class="kpi-value" style="font-size:clamp(28px,3vw,40px);color:var(--azure)">${fmtValue(pipeline)}</div>
      <div class="kpi-sub">Active deals</div>
    </div>
    <div class="my-stat-big" style="border-color:var(--coral)">
      <div class="kpi-label">OVERDUE FOLLOW-UPS</div>
      <div class="kpi-value" style="font-size:clamp(28px,3vw,40px);color:var(--coral)">${overdue.length}</div>
      <div class="kpi-sub">⚠ Needs attention</div>
    </div>
    <div class="card span-2" style="border-color:var(--amber);grid-column:span 2">
      <div class="card-title-group" style="margin-bottom:16px">
        <span class="card-eyebrow">// MONTHLY TARGET</span>
        <h2 class="card-title">${me ? 'Progress vs Target' : ''}</h2>
      </div>
      ${me ? `
      <div class="ap-label" style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);display:flex;justify-content:space-between;margin-bottom:8px">
        <span>${fmtValue(pipeline)}</span><span>Target: ${fmtValue(me.target)}</span>
      </div>
      <div class="ap-bar" style="height:8px">
        <div class="ap-fill" style="--pct:${Math.min(Math.round((pipeline/me.target)*100),100)}%;--ac:var(--amber)"></div>
      </div>
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);margin-top:6px">${Math.min(Math.round((pipeline/me.target)*100),100)}% of monthly target achieved</div>
      ` : ''}
    </div>`;
}

/* ═══════════ BULK IMPORT ═══════════ */
let wizardStep = 1;
function goWizardStep(step) {
  for (let i=1;i<=4;i++) {
    document.getElementById(`wzPanel${i}`)?.classList.toggle('hidden', i!==step);
    const wz = document.getElementById(`wz${i}`);
    if (wz) {
      wz.classList.toggle('active', i===step);
      wz.classList.toggle('done', i<step);
    }
  }
  wizardStep = step;
}
window.goWizardStep = goWizardStep;

document.getElementById('bulkImportBtn')?.addEventListener('click', () => {
  goWizardStep(1);
  S.csvParsed = [];
  document.getElementById('csvPasteArea').value = '';
  document.getElementById('csvUploadError').classList.add('hidden');
  document.getElementById('bulkImportModal').classList.add('open');
});
document.getElementById('bulkImportClose')?.addEventListener('click', () => document.getElementById('bulkImportModal').classList.remove('open'));

document.getElementById('downloadTemplateBtn')?.addEventListener('click', () => {
  const header  = 'name,phone,email,source,expo,products,value,notes';
  const example = 'Rajesh Sharma,+91 98200 00000,raj@example.com,expo,Pune Realty Expo 2025,PRD-001|PRD-002,250000,Met at booth 14';
  const blob = new Blob([header+'\n'+example], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'iinvsys_leads_template.csv';
  a.click();
});

const dropZone = document.getElementById('csvDropZone');
dropZone?.addEventListener('click', () => document.getElementById('csvFileInput').click());
dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readCSVFile(file);
});
document.getElementById('csvFileInput')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) readCSVFile(file);
});
function readCSVFile(file) {
  const reader = new FileReader();
  reader.onload = ev => { document.getElementById('csvPasteArea').value = ev.target.result; };
  reader.readAsText(file);
}

document.getElementById('parseCSVBtn')?.addEventListener('click', () => {
  const raw = document.getElementById('csvPasteArea').value.trim();
  const err = document.getElementById('csvUploadError');
  if (!raw) { err.textContent = 'Please upload a file or paste CSV text'; err.classList.remove('hidden'); return; }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) { err.textContent = 'CSV must have at least a header row and one data row'; err.classList.remove('hidden'); return; }

  const header   = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g,''));
  const REQ_COLS = ['name','phone','source'];
  const missing  = REQ_COLS.filter(c => !header.includes(c));
  if (missing.length) { err.textContent = `Missing required columns: ${missing.join(', ')}`; err.classList.remove('hidden'); return; }
  err.classList.add('hidden');

  const rows = [];
  const errors = [];
  lines.slice(1).forEach((line, i) => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g,''));
    const row  = {};
    header.forEach((h,j) => { row[h] = vals[j]||''; });
    if (!row.name)   { errors.push(`Row ${i+2}: Missing name`);   return; }
    if (!row.phone)  { errors.push(`Row ${i+2}: Missing phone`);  return; }
    if (!row.source) { errors.push(`Row ${i+2}: Missing source`); return; }
    row._dup = !!S.leads.find(l => l.phone === row.phone);
    rows.push(row);
  });

  S.csvParsed = rows;
  const good = rows.filter(r => !r._dup).length;
  const dups  = rows.filter(r => r._dup).length;
  document.getElementById('previewSummary').innerHTML =
    `<strong style="color:var(--gold)">${rows.length}</strong> rows parsed &nbsp;|&nbsp; `+
    `<strong style="color:var(--emerald)">${good}</strong> new &nbsp;|&nbsp; `+
    `<strong style="color:var(--coral)">${dups}</strong> duplicates (will be skipped) `+
    (errors.length ? `&nbsp;|&nbsp; <strong style="color:var(--coral)">${errors.length}</strong> errors` : '');

  const previewHead = document.getElementById('csvPreviewHead');
  const previewBody = document.getElementById('csvPreviewBody');
  const dispCols    = header.slice(0,5);
  previewHead.innerHTML = `<tr>${dispCols.map(c=>`<th>${c}</th>`).join('')}<th>Status</th></tr>`;
  previewBody.innerHTML = rows.slice(0,8).map(r =>
    `<tr>${dispCols.map(c=>`<td style="font-size:11px;padding:8px 14px;border-bottom:1px solid var(--surface-3);color:var(--text-2)">${r[c]||'—'}</td>`).join('')}
     <td style="padding:8px 14px"><span class="act-tag ${r._dup?'overdue':'won'}">${r._dup?'DUP':'NEW'}</span></td></tr>`
  ).join('');
  goWizardStep(3);
});

document.getElementById('confirmImportBtn')?.addEventListener('click', async () => {
  const toImport = S.csvParsed.filter(r => !r._dup);
  const isRef = (typeof isReferrer === 'function') && isReferrer();

  /* Referrer cap: 100 rows per request — surface before hitting the API */
  if (isRef && toImport.length > 100) {
    flash(`Referrer accounts can import at most 100 rows per request — got ${toImport.length}. Split into multiple files.`, 'error');
    return;
  }

  const leads = toImport.map(r => {
    const products = (r.products||'').split('|').map(s=>s.trim()).filter(Boolean)
      .map(sku => S.products.find(p=>p.sku===sku)?.id).filter(Boolean);
    const row = {
      name: r.name, phone: r.phone, email: r.email||'',
      source: r.source||'direct', stage: 'new',
      products, value: parseInt(r.value)||0,
      notes: r.notes||'',
    };
    /* For non-referrers, default to an active agent. Backend force-strips this for referrers. */
    if (!isRef) row.assignedAgent = S.agents.find(a=>a.status==='active')?.id;
    return row;
  });
  const btn = document.getElementById('confirmImportBtn');
  btnLoad(btn, true, 'Importing…');
  try {
    const res = await api('POST', '/leads/bulk', { leads });
    if (isRef) {
      /* Referrers don't have access to /agents·/products·/expos for a full reload — refresh their lead list only */
      if (typeof loadRefLeadsList === 'function') await loadRefLeadsList();
    } else {
      await loadAllData(true);
      updateNavCounts();
      renderKanban(getFilters());
      if (document.getElementById('page-overview').classList.contains('active')) renderKPIs();
    }
    const imported = res.data?.imported   ?? toImport.length;
    const skipped  = res.data?.duplicates ?? S.csvParsed.filter(r=>r._dup).length;
    document.getElementById('importResults').innerHTML = `
      <div class="import-result-icon">✅</div>
      <div class="import-result-title">${imported} Leads Imported</div>
      <div class="import-result-sub">${skipped} duplicates skipped${isRef ? ' · All rows tagged to your expo' : ' · All leads assigned to active agents'}</div>`;
    goWizardStep(4);
  } catch(err) {
    flash(err.message || 'Import failed', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

document.getElementById('doneImportBtn')?.addEventListener('click', () => {
  document.getElementById('bulkImportModal').classList.remove('open');
});

/* ═══════════ ANALYTICS CHARTS ═══════════ */
Chart.defaults.color = '#666';
Chart.defaults.borderColor = '#1e1e1e';
let analyticsInit = false;
function initAnalyticsCharts() {
  if (analyticsInit) return;
  analyticsInit = true;
  const CLRS = { gold:'#F0BE18', emerald:'#00DFA2', coral:'#FF3D1F', azure:'#2979FF', amber:'#FF8C00', violet:'#AA00FF' };
  const months = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

  const mainCtx = document.getElementById('analyticsMainChart');
  if (mainCtx) new Chart(mainCtx, {
    type:'bar',
    data:{ labels:months, datasets:[
      { label:'New Leads', data:[84,92,78,110,124,98,140,132,158,146,172,S.leads.length], backgroundColor:'rgba(41,121,255,0.5)', borderColor:CLRS.azure, borderWidth:1, yAxisID:'y' },
      { label:'Revenue (₹L)', data:[4.2,5.1,3.8,6.4,7.2,5.8,8.4,8.1,10.2,9.4,11.8,14.2], type:'line', borderColor:CLRS.gold, backgroundColor:'rgba(240,190,24,0.06)', fill:true, tension:0.4, borderWidth:2, pointBackgroundColor:CLRS.gold, pointRadius:4, yAxisID:'y1' }
    ]},
    options:{ responsive:true, interaction:{mode:'index',intersect:false}, plugins:{ legend:{labels:{color:'#666',boxWidth:10}}, tooltip:{backgroundColor:'#161616',borderColor:'#333',borderWidth:1} }, scales:{ y:{position:'left',grid:{color:'#1a1a1a'},ticks:{color:'#444',font:{size:10}}}, y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'#444',font:{size:10},callback:v=>`₹${v}L`}}, x:{grid:{color:'#1a1a1a'},ticks:{color:'#444',font:{size:10}}} }, animation:{duration:1200} }
  });

  const prodCtx = document.getElementById('productChart');
  if (prodCtx) {
    const prodData   = S.products.slice(0,5).map(p => S.leads.filter(l=>(l.products||[]).includes(p.id)).length);
    const prodLabels = S.products.slice(0,5).map(p => p.name);
    new Chart(prodCtx, {
      type:'bar',
      data:{ labels:prodLabels, datasets:[{ data:prodData, backgroundColor:[CLRS.gold,CLRS.azure,CLRS.emerald,CLRS.amber,CLRS.violet], borderColor:'transparent' }] },
      options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false},tooltip:{backgroundColor:'#161616',borderColor:'#333',borderWidth:1,callbacks:{label:c=>` ${c.raw} leads`}}}, scales:{x:{grid:{color:'#1a1a1a'},ticks:{color:'#444',font:{size:10}}},y:{grid:{display:false},ticks:{color:'#888',font:{size:10}}}}, animation:{duration:1200} }
    });
  }

  const lostCtx = document.getElementById('lostReasonsChart');
  if (lostCtx) new Chart(lostCtx, {
    type:'doughnut',
    data:{ labels:['Budget Constraint','Competition','Not Ready','Bad Timing','No Interest'], datasets:[{ data:[38,24,18,12,8], backgroundColor:[CLRS.coral,CLRS.amber,CLRS.azure,CLRS.violet,'#444'], borderColor:'#0f0f0f', borderWidth:3, hoverOffset:8 }] },
    options:{ cutout:'60%', plugins:{ legend:{display:true,position:'bottom',labels:{color:'#666',boxWidth:10,font:{size:9},padding:10}}, tooltip:{backgroundColor:'#161616',borderColor:'#333',borderWidth:1} }, animation:{animateScale:true,duration:1200} }
  });
}

/* ═══════════ FLASH TOAST ═══════════ */
function flash(msg, type='success') {
  const existing = document.getElementById('flashToast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'flashToast';
  el.textContent = msg;
  const bg = type === 'error' ? 'var(--coral)' : type === 'warn' ? 'var(--amber)' : 'var(--emerald)';
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${bg};color:#000;padding:10px 18px;font-family:var(--font-display);font-size:12px;font-weight:800;letter-spacing:0.5px;border:2px solid #000;box-shadow:4px 4px 0 #000;animation:kpiIn 0.3s ease forwards;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* ═══════════ KEYBOARD SHORTCUTS ═══════════ */
document.addEventListener('keydown', e => {
  if (!S.session) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (isAdmin()) {
    switch(e.key) {
      case '1': goToPage('overview');  break;
      case '2': goToPage('leads');     break;
      case '3': goToPage('agents');    break;
      case '4': goToPage('products');  break;
      case '5': goToPage('expos');     break;
      case '6': goToPage('analytics'); break;
      case 'n': case 'N': openLeadModal(null); break;
      case 'Escape': closeAllModals(); break;
    }
  } else {
    switch(e.key) {
      case '1': goToPage('myLeads'); break;
      case '2': goToPage('myStats'); break;
      case 'n': case 'N': openLeadModal(null); break;
      case 'Escape': closeAllModals(); break;
    }
  }
});

function closeAllModals() {
  ['leadModal','bulkImportModal','productModal','agentModal','confirmModal','referrerModal'].forEach(id => {
    document.getElementById(id)?.classList.remove('open');
  });
}

/* ═══════════ AUTO-LOGIN (session restore on page reload) ═══════════ */
(async function tryAutoLogin() {
  if (!_token) return;
  showLoader('Restoring session…');
  try {
    const res = await api('GET', '/auth/me');
    const u   = res.data.user || res.data;
    S.session = { ...u, id: u._id || u.id };
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    await initApp();
  } catch (err) {
    hideLoader();
    _token = null;
    localStorage.removeItem('ii_token');
  }
})();

/* ═══════════ SETTINGS PAGE ═══════════ */
async function renderSettings() {
  const wrap = document.getElementById('settingsGroups');
  if (!wrap) return;
  wrap.innerHTML = contentSpinner('Loading settings…');
  try {
    const res = await api('GET', '/settings');
    const settings = (res.data && res.data.settings) ? res.data.settings : [];

    const groups = {};
    settings.forEach(s => {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push(s);
    });

    const groupLabels = { general:'General', company:'Company', lead:'Lead Pipeline', product:'Products', agent:'Agents', expo:'Expos', system:'System' };

    wrap.innerHTML = Object.entries(groups).map(([grp, items]) => `
      <section class="settings-group">
        <div class="settings-group-header">// ${(groupLabels[grp] || grp).toUpperCase()}</div>
        ${items.map(s => `
        <div class="settings-row" data-key="${s.key}">
          <div class="settings-label-col">
            <div class="settings-key">${s.label || s.key}</div>
            ${s.description ? `<div class="settings-desc">${s.description}</div>` : ''}
          </div>
          <div class="settings-val-col">
            ${renderSettingInput(s)}
          </div>
          ${isSuperAdmin() ? `<button class="agent-btn" onclick="saveSetting('${s.key}',this)">Save</button>` : ''}
        </div>`).join('')}
      </section>`).join('');
  } catch (err) {
    wrap.innerHTML = `<div style="font-family:var(--font-mono);font-size:11px;color:var(--coral);padding:24px">Failed to load settings: ${err.message}</div>`;
  }

  /* PRD 2 AC5 — OCR language config panel, appended after server settings */
  renderOcrLangSettings(wrap);

  // Email Reports section — superadmin only
  if (isSuperAdmin()) renderEmailReports();
}

/* PRD 2 — OCR Language Settings panel (client-side localStorage, AC5) */
function renderOcrLangSettings(container) {
  const enabled = getEnabledOcrLangs();
  const section = document.createElement('section');
  section.className = 'settings-group';
  section.id = 'ocrLangSettings';
  section.innerHTML = `
    <div class="settings-group-header">// OCR LANGUAGES (PRD 2)</div>
    <div style="font-size:12px;color:var(--text-3);padding:4px 0 12px">
      Select the scripts your team scans. Each additional language adds a second OCR pass (~3–8 s extra).
    </div>
    ${OCR_LANG_DEFS.map(def => `
      <div class="settings-row">
        <div class="settings-label-col">
          <div class="settings-key">${def.label}</div>
          <div class="settings-desc">${def.code}</div>
        </div>
        <div class="settings-val-col">
          <label class="toggle-switch" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" class="ocr-lang-toggle" data-lang="${def.code}"
              ${enabled.includes(def.code) ? 'checked' : ''}
              ${def.code === 'eng' ? 'disabled' : ''} style="accent-color:var(--gold);width:16px;height:16px"/>
            <span style="font-size:12px;color:var(--text-2)">${def.code === 'eng' ? 'Always on' : (enabled.includes(def.code) ? 'Enabled' : 'Disabled')}</span>
          </label>
        </div>
      </div>`).join('')}`;
  container.appendChild(section);

  section.querySelectorAll('.ocr-lang-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(section.querySelectorAll('.ocr-lang-toggle:checked')).map(c => c.dataset.lang);
      setEnabledOcrLangs(allChecked.length ? allChecked : ['eng']);
      flash('OCR language preferences saved', 'success');
    });
  });
}

/* ─── Email Reports Config ──────────────────────────────────────── */
async function renderEmailReports() {
  const sec = document.getElementById('emailReportsSection');
  if (!sec) return;
  sec.style.display = 'block';
  sec.innerHTML = contentSpinner('Loading email config…');

  try {
    const res = await api('GET', '/reports/config');
    const cfg = res.data || {};
    const recipients = (cfg.recipients || []).join(', ');
    const lastSent = cfg.lastSentAt
      ? new Date(cfg.lastSentAt).toLocaleString('en-IN')
      : 'Never';

    sec.innerHTML = `
      <section class="settings-group" style="margin-top:24px">
        <div class="settings-group-header">// EMAIL REPORTS</div>

        <div class="settings-row">
          <div class="settings-label-col">
            <div class="settings-key">Recipients</div>
            <div class="settings-desc">Comma-separated email addresses that receive the report</div>
          </div>
          <div class="settings-val-col">
            <input type="text" id="erRecipients" class="form-input settings-input"
              value="${recipients}" placeholder="a@co.com, b@co.com"/>
          </div>
          <button class="agent-btn" onclick="saveEmailRecipients(this)">Save</button>
        </div>

        <div class="settings-row">
          <div class="settings-label-col">
            <div class="settings-key">Periodicity</div>
            <div class="settings-desc">How often should the report be sent automatically</div>
          </div>
          <div class="settings-val-col">
            <select id="erPeriodicity" class="form-input settings-input">
              ${['disabled','daily','weekly','monthly'].map(p =>
                `<option value="${p}" ${cfg.periodicity === p ? 'selected' : ''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <button class="agent-btn" onclick="saveEmailPeriodicity(this)">Save</button>
        </div>

        <div class="settings-row">
          <div class="settings-label-col">
            <div class="settings-key">Send Time (IST)</div>
            <div class="settings-desc">Time of day to send the scheduled report (HH:MM, 24-hour)</div>
          </div>
          <div class="settings-val-col">
            <input type="time" id="erSendTime" class="form-input settings-input"
              value="${cfg.sendTime || '08:00'}"/>
          </div>
          <button class="agent-btn" onclick="saveEmailSendTime(this)">Save</button>
        </div>

        <div class="settings-row">
          <div class="settings-label-col">
            <div class="settings-key">Email Subject Template</div>
            <div class="settings-desc">Use {{date}} and {{period}} as placeholders</div>
          </div>
          <div class="settings-val-col">
            <input type="text" id="erSubject" class="form-input settings-input"
              value="${(cfg.template && cfg.template.subject) || ''}" placeholder="IINVSYS Sales Report – {{date}}"/>
          </div>
          <button class="agent-btn" onclick="saveEmailTemplate(this)">Save</button>
        </div>

        <div class="settings-row" style="align-items:flex-start">
          <div class="settings-label-col">
            <div class="settings-key">Email Body Template</div>
            <div class="settings-desc">Use {{date}} and {{period}} as placeholders</div>
          </div>
          <div class="settings-val-col">
            <textarea id="erBody" class="form-input settings-input" rows="5"
              style="resize:vertical">${(cfg.template && cfg.template.body) || ''}</textarea>
          </div>
          <button class="agent-btn" onclick="saveEmailBodyTemplate(this)">Save</button>
        </div>

        <div class="settings-row" style="background:var(--bg-2);border-radius:6px;padding:12px 16px;gap:12px;flex-wrap:wrap">
          <div class="settings-label-col">
            <div class="settings-key">Last Sent</div>
            <div class="settings-desc" id="erLastSent">${lastSent}</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <button class="neo-btn" onclick="sendReportNow(this)">Send Now</button>
            <button class="neo-btn outline" onclick="previewReport()">Preview Data</button>
          </div>
        </div>
      </section>`;
  } catch (err) {
    sec.innerHTML = `<div style="font-family:var(--font-mono);font-size:11px;color:var(--coral);padding:24px">Failed to load email config: ${err.message}</div>`;
  }
}

window.saveEmailRecipients = async function(btn) {
  const raw = document.getElementById('erRecipients').value;
  const recipients = raw.split(',').map(e => e.trim()).filter(Boolean);
  btnLoad(btn, true, '…');
  try {
    await api('PUT', '/reports/config', { recipients });
    flash('Recipients saved');
  } catch(e) { flash(e.message || 'Failed', 'error'); }
  finally { btnLoad(btn, false); }
};

window.saveEmailPeriodicity = async function(btn) {
  const periodicity = document.getElementById('erPeriodicity').value;
  btnLoad(btn, true, '…');
  try {
    await api('PUT', '/reports/config', { periodicity });
    flash(`Periodicity set to ${periodicity}`);
  } catch(e) { flash(e.message || 'Failed', 'error'); }
  finally { btnLoad(btn, false); }
};

window.saveEmailSendTime = async function(btn) {
  const sendTime = document.getElementById('erSendTime').value;
  btnLoad(btn, true, '…');
  try {
    await api('PUT', '/reports/config', { sendTime });
    flash('Send time saved');
  } catch(e) { flash(e.message || 'Failed', 'error'); }
  finally { btnLoad(btn, false); }
};

window.saveEmailTemplate = async function(btn) {
  const subject = document.getElementById('erSubject').value;
  btnLoad(btn, true, '…');
  try {
    await api('PUT', '/reports/config', { template: { subject } });
    flash('Subject template saved');
  } catch(e) { flash(e.message || 'Failed', 'error'); }
  finally { btnLoad(btn, false); }
};

window.saveEmailBodyTemplate = async function(btn) {
  const body = document.getElementById('erBody').value;
  btnLoad(btn, true, '…');
  try {
    await api('PUT', '/reports/config', { template: { body } });
    flash('Body template saved');
  } catch(e) { flash(e.message || 'Failed', 'error'); }
  finally { btnLoad(btn, false); }
};

window.sendReportNow = async function(btn) {
  btnLoad(btn, true, 'Sending…');
  try {
    const res = await api('POST', '/reports/send');
    flash(`Report sent to ${res.data.recipients} recipient(s)`);
    const el = document.getElementById('erLastSent');
    if (el) el.textContent = new Date(res.data.sentAt).toLocaleString('en-IN');
  } catch(e) { flash(e.message || 'Failed to send', 'error'); }
  finally { btnLoad(btn, false); }
};

window.previewReport = async function() {
  try {
    const res = await api('GET', '/reports/preview');
    const d = res.data;
    const rows = (d.agentStats || []).map(a =>
      `<tr><td>${a.name}</td><td>${a.territory||'—'}</td><td>${a.totalLeads}</td><td>${a.won}</td><td>₹${Number(a.wonValue).toLocaleString('en-IN')}</td><td>${a.convRate}%</td></tr>`
    ).join('');
    const funnelRows = (d.funnel || []).map(f =>
      `<tr><td>${f.stage}</td><td>${f.count}</td><td>₹${Number(f.value).toLocaleString('en-IN')}</td><td>${f.pct}%</td></tr>`
    ).join('');

    const html = `
      <div style="max-height:70vh;overflow-y:auto;font-size:12px">
        <div style="font-weight:700;font-size:13px;margin-bottom:12px;color:var(--gold)">Agent Performance</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead><tr style="background:var(--bg-2)">
            <th style="padding:6px;text-align:left">Agent</th><th>Territory</th><th>Leads</th><th>Won</th><th>Won Value</th><th>Conv%</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="font-weight:700;font-size:13px;margin-bottom:12px;color:var(--gold)">Conversion Funnel</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--bg-2)">
            <th style="padding:6px;text-align:left">Stage</th><th>Count</th><th>Value</th><th>%</th>
          </tr></thead>
          <tbody>${funnelRows}</tbody>
        </table>
        <div style="margin-top:12px;font-size:11px;color:var(--text-3)">Generated: ${new Date(d.generatedAt).toLocaleString('en-IN')} · Total leads: ${d.totalLeads}</div>
      </div>`;
    openInfoModal('Report Preview', html);
  } catch(e) { flash(e.message || 'Failed to load preview', 'error'); }
};

function openInfoModal(title, bodyHtml) {
  document.getElementById('infoModalTitle').textContent = title;
  document.getElementById('infoModalBody').innerHTML = bodyHtml;
  document.getElementById('infoModal').classList.add('open');
}

function renderSettingInput(s) {
  const readonly = !isSuperAdmin() ? 'readonly disabled style="opacity:0.5"' : '';
  const val = Array.isArray(s.value) ? s.value.join(', ') : s.value;
  if (s.type === 'boolean') {
    return `<label class="settings-toggle">
      <input type="checkbox" data-key="${s.key}" ${s.value ? 'checked' : ''} ${readonly ? 'disabled' : ''} onchange="if(!${isSuperAdmin()})return;"/>
      <span class="toggle-track"></span>
    </label>`;
  }
  if (s.type === 'array') {
    return `<input type="text" class="form-input settings-input" data-key="${s.key}" value="${val}" placeholder="Comma-separated values" ${readonly}/>`;
  }
  return `<input type="${s.type === 'number' ? 'number' : 'text'}" class="form-input settings-input" data-key="${s.key}" value="${val}" ${readonly}/>`;
}

window.saveSetting = async function(key, btn) {
  const row   = btn.closest('.settings-row');
  const input = row.querySelector(`[data-key="${key}"]`);
  if (!input) return;
  let value = input.type === 'checkbox' ? input.checked : input.value;
  const originalType = input.dataset.type;
  if (typeof value === 'string' && value.includes(',') && !value.startsWith('{')) {
    value = value.split(',').map(s => s.trim()).filter(Boolean);
  } else if (input.type === 'number') {
    value = Number(value);
  }
  btnLoad(btn, true, '…');
  try {
    await api('PUT', '/settings', { updates: { [key]: value } });
    flash(`Setting saved`);
  } catch(err) {
    flash(err.message || 'Failed to save setting', 'error');
  } finally {
    btnLoad(btn, false);
  }
};

/* ═══════════ REFERRER VIEW ═══════════ */
async function renderReferrerView() {
  const wrap = document.getElementById('referrerView');
  if (!wrap) return;

  const expo     = S.expos.find(e => e.id === S.session?.expoId);
  const expoName = expo?.name || 'Your Expo';

  /* ── Expo details section ── */
  const productsList = (expo?.products || []).map(p =>
    `<span class="ref-expo-product-chip">${p.name || '—'}</span>`
  ).join('') || '<span style="color:var(--text-3);font-size:11px">No products listed</span>';

  wrap.innerHTML = `
    <div class="referrer-hero">
      <div class="referrer-expo-badge">◇ ${expoName}</div>
      <div class="referrer-welcome">Lead Capture & Tracker</div>
    </div>

    <!-- Expo Info Card -->
    <div class="ref-expo-info-card">
      <div class="ref-expo-info-row"><span class="ref-expo-info-label">Venue</span><span>${expo?.venue || '—'}</span></div>
      <div class="ref-expo-info-row"><span class="ref-expo-info-label">Dates</span><span>${expo?.dates || '—'}</span></div>
      <div class="ref-expo-info-row"><span class="ref-expo-info-label">Status</span><span class="ref-expo-status-chip ${expo?.status || ''}">${(expo?.status||'—').toUpperCase()}</span></div>
      <div class="ref-expo-info-row"><span class="ref-expo-info-label">Products</span><div class="ref-expo-products-wrap">${productsList}</div></div>
    </div>

    <!-- Add Lead Form (collapsible) — header includes bulk capture options -->
    <div class="ref-add-lead-header">
      <span>// ADD NEW LEAD</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button class="neo-btn outline xs" id="refBulkScanBtn" type="button" aria-label="Bulk scan business cards"><span aria-hidden="true">📷</span> Bulk Scan</button>
        <button class="neo-btn outline xs" id="refBulkImportBtn" type="button" aria-label="Bulk import leads from CSV"><span aria-hidden="true">⬆</span> Bulk CSV</button>
        <button class="neo-btn yellow xs" id="refToggleFormBtn" type="button" aria-expanded="false" aria-controls="refFormCard">+ New Lead</button>
      </div>
    </div>
    <div class="referrer-form-card" id="refFormCard" style="display:none">
      <form id="referrerLeadForm">
        <div class="referrer-camera-row">
          <button type="button" class="neo-btn outline full-w" id="refCameraBtn" aria-label="Scan business card with camera"><span aria-hidden="true">📷</span> Scan Business Card</button>
          <input type="file" id="refCardInput" accept="image/*" capture="environment" aria-label="Business card image" style="display:none"/>
        </div>

        <!-- Mirrored rescan banner — surfaces when >50% of OCR fields are low confidence -->
        <div class="scan-rescan-banner" id="refScanRescanBanner" role="status" aria-live="polite" hidden style="margin-top:8px">
          <span class="srb-icon" aria-hidden="true">⚠</span>
          <span class="srb-text">Most fields look uncertain. Try re-scanning?</span>
          <button type="button" class="neo-btn outline xs" id="refScanRescanBtn" aria-label="Re-scan business card"><span aria-hidden="true">📷</span> Re-scan</button>
        </div>

        <div class="ref-divider">— or enter manually —</div>
        <div class="form-group">
          <label class="form-label">Full Name <span class="req">*</span></label>
          <input type="text" id="refLeadName" class="form-input" placeholder="e.g. Rajesh Sharma" autocomplete="name" aria-describedby="refLeadName-band"/>
          <span class="confidence-hint" id="refLeadName-band" hidden></span>
        </div>
        <div class="form-group">
          <label class="form-label">Phone <span class="req">*</span></label>
          <input type="tel" id="refLeadPhone" class="form-input" placeholder="+91 98200 00000" autocomplete="tel" aria-describedby="refLeadPhone-band"/>
          <span class="confidence-hint" id="refLeadPhone-band" hidden></span>
        </div>
        <div class="form-group">
          <label class="form-label">Email <span class="opt">(optional)</span></label>
          <input type="email" id="refLeadEmail" class="form-input" placeholder="email@example.com" autocomplete="email" aria-describedby="refLeadEmail-band"/>
          <span class="confidence-hint" id="refLeadEmail-band" hidden></span>
        </div>
        <div class="form-group">
          <label class="form-label">Company <span class="opt">(optional)</span></label>
          <input type="text" id="refLeadCompany" class="form-input" placeholder="Company name" aria-describedby="refLeadCompany-band"/>
          <span class="confidence-hint" id="refLeadCompany-band" hidden></span>
        </div>
        <div class="form-group">
          <label class="form-label">Notes <span class="opt">(optional)</span></label>
          <textarea id="refLeadNotes" class="form-input" rows="2" placeholder="Product interest, booth interaction…"></textarea>
        </div>

        <!-- Voice note (recorded inline; attached to the lead after POST /leads) -->
        <div class="ref-voice-row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px">
          <button type="button" class="neo-btn outline sm" id="refVmRecordBtn" aria-label="Record a voice note for this lead"><span aria-hidden="true">🎙</span> Record Voice Note</button>
          <button type="button" class="neo-btn outline sm" id="refVmStopBtn" hidden aria-label="Stop recording voice note"><span aria-hidden="true">⏹</span> Stop</button>
          <span class="vm-timer" id="refVmTimer" hidden aria-label="Recording duration">0:00</span>
          <span class="vm-status" id="refVmStatus" role="status" aria-live="polite" style="font-size:11px;color:var(--text-3)" hidden></span>
        </div>
        <div class="vm-transcript-wrap" id="refVmTranscriptWrap" hidden style="margin-top:8px">
          <div class="vm-transcript-label" id="refVmTranscriptLabel">Transcript (attached on save)</div>
          <div class="vm-transcript" id="refVmTranscript" contenteditable="false" role="textbox" aria-multiline="true" aria-labelledby="refVmTranscriptLabel"></div>
          <button type="button" class="neo-btn outline xs" id="refVmClearBtn" style="margin-top:6px" aria-label="Discard voice note"><span aria-hidden="true">✕</span> Discard voice note</button>
        </div>

        <button type="submit" class="neo-btn yellow full-w" id="refLeadSubmit" style="padding:16px;font-size:14px;margin-top:12px">
          Capture Lead →
        </button>
      </form>

      <!-- Success card — replaces the form briefly to show captured + auto-enrichment -->
      <div id="refSuccessCard" role="region" aria-live="polite" aria-label="Capture confirmation" hidden style="margin-top:12px;padding:14px;border:1px solid var(--surface-3);border-radius:6px;background:var(--bg-2)"></div>

      <div id="refTodayCount" class="ref-today-count"></div>
    </div>

    <!-- All Expo Leads -->
    <div class="ref-leads-section-label">// ALL LEADS AT THIS EXPO</div>
    <div id="refLeadsList" class="ref-leads-list">${contentSpinner('Loading leads…')}</div>`;

  /* ── Toggle form ── */
  document.getElementById('refToggleFormBtn')?.addEventListener('click', () => {
    const card = document.getElementById('refFormCard');
    const btn  = document.getElementById('refToggleFormBtn');
    const open = card.style.display === 'none';
    card.style.display = open ? '' : 'none';
    btn.textContent    = open ? '✕ Close' : '+ New Lead';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  /* ── Camera / OCR (single card scan) ── */
  const REF_FIELDMAP = {
    name:    'refLeadName',
    phone:   'refLeadPhone',
    email:   'refLeadEmail',
    company: 'refLeadCompany',
    notes:   'refLeadNotes',
    rescanBanner: 'refScanRescanBanner',
  };
  document.getElementById('refCameraBtn')?.addEventListener('click', () => {
    document.getElementById('refCardInput').click();
  });
  document.getElementById('refCardInput')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) processCardImage(file, REF_FIELDMAP);
  });
  document.getElementById('refScanRescanBtn')?.addEventListener('click', () => {
    document.getElementById('refCardInput').click();
  });

  /* ── Bulk Scan / Bulk Import (reuse main-app modals) ── */
  document.getElementById('refBulkScanBtn')?.addEventListener('click', () => {
    if (typeof openBulkScanModal === 'function') openBulkScanModal();
    else document.getElementById('bulkScanModal')?.classList.add('open');
  });
  document.getElementById('refBulkImportBtn')?.addEventListener('click', () => {
    /* Mirror the main app's open-handler, plus a referrer-only cap notice */
    if (typeof goWizardStep === 'function') goWizardStep(1);
    S.csvParsed = [];
    const ta  = document.getElementById('csvPasteArea');         if (ta)  ta.value = '';
    const err = document.getElementById('csvUploadError');       if (err) err.classList.add('hidden');
    /* Annotate the wizard with the 100-row referrer cap (idempotent). */
    const rules = document.querySelector('#wzPanel1 .wz-rules');
    if (rules && !rules.querySelector('[data-ref-cap]')) {
      const r = document.createElement('div');
      r.className = 'wz-rule';
      r.dataset.refCap = '1';
      r.textContent = '⚠ Referrer accounts: max 100 rows per import. All rows auto-tagged to your expo.';
      rules.appendChild(r);
    }
    document.getElementById('bulkImportModal')?.classList.add('open');
  });

  /* ── Voice note recording (referrer-scoped state, see _refVm below) ── */
  document.getElementById('refVmRecordBtn')?.addEventListener('click', refVmStart);
  document.getElementById('refVmStopBtn')?.addEventListener('click',   refVmStop);
  document.getElementById('refVmClearBtn')?.addEventListener('click',  refVmClear);

  /* ── Submit new lead ── */
  document.getElementById('referrerLeadForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const name  = document.getElementById('refLeadName').value.trim();
    const phone = document.getElementById('refLeadPhone').value.trim();
    if (!name || !phone) { flash('Name and phone are required', 'error'); return; }

    const company = document.getElementById('refLeadCompany').value.trim();
    const notes   = document.getElementById('refLeadNotes').value.trim();
    const ocrCapture = collectOcrCapture(REF_FIELDMAP);
    const payload = {
      name, phone,
      email:   document.getElementById('refLeadEmail').value.trim(),
      stage:   'new',
      source:  'expo',
      notes:   company ? `[${company}] ${notes}` : notes,
      ocrCapture,
    };
    const btn = document.getElementById('refLeadSubmit');
    btnLoad(btn, true, 'Capturing…');
    try {
      const res    = await api('POST', '/leads', payload);
      const newId  = res.data?._id || res.data?.id || res._id;

      /* (b) — voice note attaches AFTER the lead is created, in a follow-up call.
         Errors are non-fatal: the lead is already saved, only the memo fails. */
      if (newId && _refVm.transcript && _refVm.transcript.trim()) {
        try {
          const durationSec = _refVm.startTime ? Math.round((Date.now() - _refVm.startTime) / 1000) : null;
          await api('POST', `/leads/${newId}/voice-memos`, {
            transcript:       _refVm.transcript.trim(),
            transcriptLang:   'en',
            audioDurationSec: durationSec,
          });
        } catch (vmErr) {
          flash(`Lead saved, but voice note failed: ${vmErr.message || 'unknown'}`, 'warn');
        }
      }

      S._refCount = (S._refCount || 0) + 1;
      const countEl = document.getElementById('refTodayCount');
      if (countEl) countEl.innerHTML = `<span class="ref-count-badge">${S._refCount} lead${S._refCount > 1 ? 's' : ''} captured today ✓</span>`;

      /* Auto-enrichment is fired server-side on POST /leads (setImmediate).
         Poll briefly so we can render whatever came back in the success card. */
      document.getElementById('referrerLeadForm').reset();
      _refVmReset();
      await renderRefSuccessCard(newId, name);

      await loadRefLeadsList();
    } catch (err) {
      flash(err.message || 'Failed to save lead', 'error');
    } finally {
      btnLoad(btn, false);
    }
  });

  /* ── Load leads list ── */
  await loadRefLeadsList();
}

/* ═══════════ REFERRER VOICE MEMO (inline, capture-time) ═══════════
   Mirrors the main-app PRD 6 recorder but scoped to the referrer form,
   with state held across the form lifecycle and attached to the new
   lead via POST /leads/:id/voice-memos after the lead is created. */
const _refVm = {
  recognition:    null,
  transcript:     '',
  startTime:      null,
  timerInterval:  null,
  transcriptInputHandler: null,
  successCardToken: 0,
};

function _refVmFmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function _refVmReset() {
  if (_refVm.recognition) { try { _refVm.recognition.stop(); } catch {} _refVm.recognition = null; }
  if (_refVm.timerInterval) { clearInterval(_refVm.timerInterval); _refVm.timerInterval = null; }
  _refVm.transcript = '';
  _refVm.startTime  = null;

  const tEl = document.getElementById('refVmTranscript');
  if (tEl) {
    /* Drop any prior input listener so record→stop→record doesn't stack handlers */
    if (_refVm.transcriptInputHandler) tEl.removeEventListener('input', _refVm.transcriptInputHandler);
    _refVm.transcriptInputHandler = null;
    tEl.textContent     = '';
    tEl.contentEditable = 'false';
  }

  const els = ['refVmTimer','refVmStopBtn','refVmStatus','refVmTranscriptWrap'].map(id => document.getElementById(id));
  els.forEach(el => { if (el) el.hidden = true; });
  const recBtn = document.getElementById('refVmRecordBtn'); if (recBtn) recBtn.hidden = false;
}

async function refVmStart() {
  _refVm.transcript = '';
  const transcriptEl   = document.getElementById('refVmTranscript');
  const transcriptWrap = document.getElementById('refVmTranscriptWrap');
  const statusEl       = document.getElementById('refVmStatus');
  const timerEl        = document.getElementById('refVmTimer');
  const recBtn         = document.getElementById('refVmRecordBtn');
  const stopBtn        = document.getElementById('refVmStopBtn');

  if (transcriptEl) { transcriptEl.textContent = ''; transcriptEl.contentEditable = 'false'; }
  if (transcriptWrap) transcriptWrap.hidden = true;

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    if (statusEl) { statusEl.textContent = 'Speech recognition unsupported in this browser.'; statusEl.hidden = false; }
    return;
  }
  _refVm.recognition = new SpeechRec();
  _refVm.recognition.continuous     = true;
  _refVm.recognition.interimResults = true;
  _refVm.recognition.lang           = 'en-IN';
  _refVm.recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) _refVm.transcript += e.results[i][0].transcript + ' ';
      else                       interim          += e.results[i][0].transcript;
    }
    if (transcriptEl) transcriptEl.textContent = _refVm.transcript + (interim ? `[${interim}]` : '');
    if (transcriptWrap) transcriptWrap.hidden  = false;
  };
  _refVm.recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && statusEl) { statusEl.textContent = `Speech error: ${e.error}`; statusEl.hidden = false; }
  };
  _refVm.recognition.start();

  _refVm.startTime = Date.now();
  if (timerEl) {
    timerEl.hidden = false;
    timerEl.textContent = '0:00';
    _refVm.timerInterval = setInterval(() => { timerEl.textContent = _refVmFmt(Date.now() - _refVm.startTime); }, 500);
  }
  if (statusEl) { statusEl.textContent = 'Recording…'; statusEl.hidden = false; }
  if (recBtn)  recBtn.hidden  = true;
  if (stopBtn) stopBtn.hidden = false;
}

async function refVmStop() {
  if (_refVm.recognition) { try { _refVm.recognition.stop(); } catch {} _refVm.recognition = null; }
  if (_refVm.timerInterval) { clearInterval(_refVm.timerInterval); _refVm.timerInterval = null; }

  const recBtn  = document.getElementById('refVmRecordBtn');
  const stopBtn = document.getElementById('refVmStopBtn');
  const timerEl = document.getElementById('refVmTimer');
  const statusEl= document.getElementById('refVmStatus');
  const transcriptEl = document.getElementById('refVmTranscript');

  if (recBtn)  recBtn.hidden  = false;
  if (stopBtn) stopBtn.hidden = true;
  if (timerEl) timerEl.hidden = true;

  /* Tail wait for trailing recognition results, then make transcript editable. */
  await new Promise(r => setTimeout(r, 500));
  const text = _refVm.transcript.trim();
  if (transcriptEl) {
    transcriptEl.textContent     = text;
    transcriptEl.contentEditable = 'true';
    /* Replace any prior listener — addEventListener doesn't dedupe arrow fns */
    if (_refVm.transcriptInputHandler) transcriptEl.removeEventListener('input', _refVm.transcriptInputHandler);
    _refVm.transcriptInputHandler = () => { _refVm.transcript = transcriptEl.textContent || ''; };
    transcriptEl.addEventListener('input', _refVm.transcriptInputHandler);
  }
  if (statusEl) {
    statusEl.textContent = text ? 'Voice note will attach when you save the lead.' : 'No speech detected — try again or save without it.';
    statusEl.hidden = false;
  }
}

function refVmClear() {
  _refVmReset();
}

/* ═══════════ REFERRER SUCCESS CARD WITH AUTO-ENRICHMENT ═══════════
   Polls GET /leads/:id twice (at +1s, +2s) so the mock provider's
   50-300 ms latency is comfortably covered, then renders enriched
   fields if any. Falls back to a plain "captured" card on timeout. */
async function renderRefSuccessCard(leadId, name) {
  const card = document.getElementById('refSuccessCard');
  const form = document.getElementById('referrerLeadForm');
  if (!card) { flash('Lead captured!'); return; }
  if (form) form.style.display = 'none';

  /* Bump a token so any in-flight poll from a previous capture knows it's stale */
  const myToken = ++_refVm.successCardToken;
  const isCurrent = () => _refVm.successCardToken === myToken && !card.hidden;

  card.hidden = false;
  card.innerHTML = `
    <div style="font-weight:700;color:var(--emerald);margin-bottom:6px">✓ ${escapeHtml(name)} captured</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">Looking up company details… <span class="ref-enrich-spinner" aria-hidden="true">⏳</span></div>
    <button type="button" class="neo-btn outline xs" id="refSuccessNextBtn">+ Capture another</button>`;

  const dismiss = () => {
    /* Bump the token on dismiss so the polling loop won't repaint after we close */
    _refVm.successCardToken++;
    card.hidden = true;
    card.innerHTML = '';
    if (form) form.style.display = '';
  };
  document.getElementById('refSuccessNextBtn')?.addEventListener('click', dismiss);

  if (!leadId) return;

  const tryFetch = async () => {
    try {
      const res = await api('GET', `/leads/${leadId}`);
      const lead = res.data || res;
      const enrichment = lead?.enrichment || {};
      return Object.keys(enrichment).length ? lead : null;
    } catch { return null; }
  };

  let lead = null;
  for (const wait of [1000, 1000]) {
    await new Promise(r => setTimeout(r, wait));
    if (!isCurrent()) return; // user dismissed or a newer capture started
    lead = await tryFetch();
    if (lead) break;
  }
  if (!isCurrent()) return;

  if (!lead) {
    const sub = card.querySelector('div:nth-child(2)');
    if (sub) sub.textContent = 'No auto-enrichment data found — you can edit the lead later.';
    return;
  }

  /* Render enrichment grid using the existing PRD-5 helper. */
  card.innerHTML = `
    <div style="font-weight:700;color:var(--emerald);margin-bottom:6px">✓ ${escapeHtml(name)} captured</div>
    <div id="refEnrichmentMount"></div>
    <button type="button" class="neo-btn outline xs" id="refSuccessNextBtn" style="margin-top:8px">+ Capture another</button>`;
  if (typeof renderEnrichmentSection === 'function') {
    renderEnrichmentSection(lead, document.getElementById('refEnrichmentMount'));
  }
  document.getElementById('refSuccessNextBtn')?.addEventListener('click', dismiss);
}

async function loadRefLeadsList() {
  const listEl = document.getElementById('refLeadsList');
  if (!listEl) return;
  listEl.innerHTML = contentSpinner('Loading leads…');
  try {
    const res   = await api('GET', '/leads?limit=500');
    const leads = (res.data || []).map(normalizeLead);
    if (leads.length === 0) {
      listEl.innerHTML = `<div class="referrer-empty">No leads captured at this expo yet.</div>`;
      return;
    }
    const myId = S.session?.id || S.session?._id;
    listEl.innerHTML = leads.map(l => {
      const isMine  = String(l.createdById) === String(myId);
      const stageColors = { new:'var(--text-3)', contacted:'var(--azure)', interested:'var(--amber)', proposal:'var(--gold)', negotiation:'var(--violet)', won:'var(--emerald)', lost:'var(--coral)' };
      const stageColor  = stageColors[l.stage] || 'var(--text-3)';
      return `
      <div class="ref-lead-item ${isMine ? 'ref-lead-mine' : 'ref-lead-other'}">
        <div class="ref-lead-item-top">
          <div>
            <div class="ref-lead-name">${l.name}</div>
            <div class="ref-lead-meta">📞 ${l.phone}${l.email ? ' · ' + l.email : ''}</div>
            ${l.notes ? `<div class="ref-lead-notes">${l.notes}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="ref-lead-stage" style="color:${stageColor}">${l.stage.toUpperCase()}</div>
            ${isMine ? `<div class="ref-lead-mine-badge">My Lead</div>` : `<div class="ref-lead-other-badge">by ${l.createdByName || '—'}</div>`}
          </div>
        </div>
        <div class="ref-lead-item-footer">
          <span class="ref-lead-time">${l.createdAt || ''}</span>
          ${isMine
            ? `<button class="neo-btn outline xs" onclick="openRefEditLead('${l.id}')">✏ Edit</button>`
            : `<span class="ref-read-only-tag">Read Only</span>`
          }
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--coral);padding:12px;font-size:12px">${err.message}</div>`;
  }
}

/* Referrer edit their own lead */
window.openRefEditLead = async function(leadId) {
  const res  = await api('GET', `/leads/${leadId}`);
  const l    = normalizeLead(res.data);

  /* Reuse the standard lead modal, pre-filled, locked to editable fields only */
  const modal = document.getElementById('leadModal');
  document.getElementById('leadModalEyebrow').textContent = '// EDIT MY LEAD';
  document.getElementById('leadModalTitle').innerHTML     = 'Edit <em>My Lead</em>';
  document.getElementById('leadSubmitBtn').textContent    = 'Save Changes →';
  document.getElementById('deleteLeadBtn').classList.add('hidden');

  /* Refresh expo dropdown */
  const leadExpoSel = document.getElementById('leadExpo');
  if (leadExpoSel) {
    leadExpoSel.innerHTML = '<option value="">— Select Expo —</option>';
    S.expos.forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex.id; opt.textContent = ex.name;
      leadExpoSel.appendChild(opt);
    });
  }

  /* Product checkboxes — disabled for referrers */
  const tagWrap = document.getElementById('leadProductTags');
  tagWrap.innerHTML = '<span style="font-size:12px;color:var(--text-3)">Product selection managed by admin</span>';

  document.getElementById('leadIdInput').value = l.id;
  document.getElementById('leadName').value    = l.name;
  document.getElementById('leadPhone').value   = l.phone;
  document.getElementById('leadEmail').value   = l.email;
  document.getElementById('leadStage').value   = l.stage;
  document.getElementById('leadNotes').value   = l.notes;

  /* Lock fields referrers cannot change */
  ['leadSource','leadExpo','leadAgent','leadValue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.setAttribute('readonly', ''); el.setAttribute('disabled', ''); el.style.opacity = '0.4'; }
  });
  /* Unlock editable fields */
  ['leadName','leadPhone','leadEmail','leadStage','leadNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.removeAttribute('readonly'); el.removeAttribute('disabled'); el.style.opacity = ''; }
  });

  modal.classList.add('open');

  /* After modal closes, re-enable disabled fields and refresh list */
  const closeAndRefresh = async () => {
    ['leadSource','leadExpo','leadAgent','leadValue'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.removeAttribute('readonly'); el.removeAttribute('disabled'); el.style.opacity = ''; }
    });
    await loadRefLeadsList();
  };
  document.getElementById('leadModalClose').onclick  = () => { modal.classList.remove('open'); closeAndRefresh(); };
  document.getElementById('leadModalCancel').onclick = () => { modal.classList.remove('open'); closeAndRefresh(); };
};

/* ═══════════ REFERRER MANAGEMENT MODAL ═══════════ */
let _currentReferrerExpoId = null;

window.openReferrerModal = async function(expoId, expoName) {
  _currentReferrerExpoId = expoId;
  document.getElementById('referrerModalTitle').innerHTML = `<em>${expoName}</em> Referrers`;
  document.getElementById('refName').value     = '';
  document.getElementById('refPassword').value = '';
  document.getElementById('refCredsBanner').classList.add('hidden');
  document.getElementById('referrerModal').classList.add('open');
  await loadReferrerList(expoId);
};

async function loadReferrerList(expoId) {
  const list = document.getElementById('referrerList');
  if (!list) return;
  list.innerHTML = contentSpinner('Loading referrers…');
  try {
    const res = await api('GET', `/expos/${expoId}/referrers`);
    const referrers = res.data || [];
    if (referrers.length === 0) {
      list.innerHTML = `<div class="referrer-empty">No referrers yet. Create one above.</div>`;
      return;
    }
    list.innerHTML = referrers.map(r => {
      return `<div class="referrer-item">
        <div class="referrer-item-info">
          <span class="referrer-item-name">${r.name}</span>
          <span class="referrer-item-meta">${r.email}</span>
          <span class="referrer-item-meta">${r.leadCount || 0} leads captured · <span style="color:var(--emerald)">Active</span></span>
        </div>
        <button class="agent-btn danger" onclick="deleteReferrer('${expoId}','${r._id}')">Delete</button>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="font-family:var(--font-mono);font-size:11px;color:var(--coral);padding:12px">${err.message}</div>`;
  }
}

document.getElementById('createReferrerBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('refName').value.trim();
  const pass = document.getElementById('refPassword').value.trim();
  if (!name || !pass) { flash('Name and password are required', 'error'); return; }
  const btn = document.getElementById('createReferrerBtn');
  btnLoad(btn, true, 'Creating…');
  try {
    const res = await api('POST', `/expos/${_currentReferrerExpoId}/referrers`, { name, password: pass });
    const creds = res.data;
    document.getElementById('refCredsEmail').textContent = creds.email;
    document.getElementById('refCredsPass').textContent  = creds.password;
    document.getElementById('refCredsBanner').classList.remove('hidden');
    document.getElementById('refName').value     = '';
    document.getElementById('refPassword').value = '';
    await loadReferrerList(_currentReferrerExpoId);
    flash('Referrer account created');
  } catch (err) {
    flash(err.message || 'Failed to create referrer', 'error');
  } finally {
    btnLoad(btn, false);
  }
});

document.getElementById('copyEmailBtn')?.addEventListener('click', () => {
  navigator.clipboard?.writeText(document.getElementById('refCredsEmail').textContent).then(() => flash('Email copied'));
});
document.getElementById('copyPassBtn')?.addEventListener('click', () => {
  navigator.clipboard?.writeText(document.getElementById('refCredsPass').textContent).then(() => flash('Password copied'));
});

window.deleteReferrer = async function(expoId, uid) {
  if (!confirm('Delete this referrer account permanently?')) return;
  showRefresh();
  try {
    await api('DELETE', `/expos/${expoId}/referrers/${uid}`);
    await loadReferrerList(expoId);
    flash('Referrer deleted', 'warn');
  } catch (err) {
    flash(err.message || 'Delete failed', 'error');
  } finally {
    hideRefresh();
  }
};

document.getElementById('referrerModalClose')?.addEventListener('click', () => document.getElementById('referrerModal').classList.remove('open'));
document.getElementById('referrerModal')?.addEventListener('click', e => { if (e.target === document.getElementById('referrerModal')) document.getElementById('referrerModal').classList.remove('open'); });

/* Download sheet button inside referrer modal */
document.getElementById('downloadReferrerSheetBtn')?.addEventListener('click', () => {
  if (_currentReferrerExpoId) {
    const expo = S.expos.find(e => e.id === _currentReferrerExpoId);
    downloadReferrerSheet(_currentReferrerExpoId, expo?.name || 'Expo');
  }
});

/* ═══════════ EXPO REFERRER CREDENTIALS SHEET ═══════════ */
window.downloadReferrerSheet = async function(expoId, expoName) {
  if (typeof XLSX === 'undefined') {
    flash('Excel library not loaded yet — try again in a moment', 'error');
    return;
  }

  flash('Generating sheet…');
  let referrers = [];
  try {
    const res = await api('GET', `/expos/${expoId}/referrers`);
    referrers = res.data || [];
  } catch (err) {
    flash(err.message || 'Failed to fetch referrers', 'error');
    return;
  }

  const expo    = S.expos.find(e => e.id === expoId) || {};
  const wb      = XLSX.utils.book_new();
  const now     = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });

  /* ── Sheet 1: Expo Summary ── */
  const summaryRows = [
    ['IINVSYS — Expo Referrer Credentials Sheet'],
    ['Generated:', now],
    [],
    ['Expo Name',   expo.name  || expoName],
    ['Venue',       expo.venue || '—'],
    ['Dates',       expo.dates || '—'],
    ['Status',      (expo.status || '—').toUpperCase()],
    ['Total Leads', expo.leadCount || 0],
    [],
    ['Products Presented'],
    ...(expo.products || []).map(p => ['', p.name || p.productId]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Expo Summary');

  /* ── Sheet 2: Referrer Credentials ── */
  const headers = ['#', 'Name', 'Login Email', 'Temp Password', 'Leads Captured', 'Status'];
  const rows = referrers.map((r, i) => {
    return [
      i + 1,
      r.name,
      r.email,
      '(set at creation — not stored)',
      r.leadCount || 0,
      'Active',
    ];
  });

  if (rows.length === 0) {
    rows.push(['—', 'No referrers created yet', '', '', '', '', '']);
  }

  const wsRefs = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsRefs['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 42 }, { wch: 28 }, { wch: 16 }, { wch: 10 }];

  /* Bold the header row */
  headers.forEach((_, ci) => {
    const cell = wsRefs[XLSX.utils.encode_cell({ r: 0, c: ci })];
    if (cell) cell.s = { font: { bold: true } };
  });

  XLSX.utils.book_append_sheet(wb, wsRefs, 'Referrer Credentials');

  /* ── Download ── */
  const safeName = expoName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  XLSX.writeFile(wb, `${safeName}_referrer_credentials.xlsx`);
  flash('Sheet downloaded!', 'success');
};

/* ═══════════ AGENT HARD DELETE ═══════════ */
window.hardDeleteAgent = function(agentId, agentName) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = `Hard delete "${agentName}"?`;
  document.getElementById('confirmSub').textContent   = 'This permanently removes the agent, their user account, and unassigns all their leads. This CANNOT be undone.';
  modal.classList.add('open');

  const okBtn  = document.getElementById('confirmOk');
  const newOk  = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);

  newOk.addEventListener('click', async () => {
    btnLoad(newOk, true, 'Deleting…');
    try {
      await api('DELETE', `/agents/${agentId}/hard`);
      await loadAllData(true);
      updateNavCounts();
      modal.classList.remove('open');
      renderAgentsGrid();
      flash(`Agent "${agentName}" permanently deleted`, 'warn');
    } catch (err) {
      flash(err.message || 'Delete failed', 'error');
      btnLoad(newOk, false);
    }
  });
};

/* ═══════════ CAMERA / OCR ═══════════ */
/* PRD 1 — confidence bands per field.
   Tesseract returns word-level confidence (0-100). For each extracted
   field we average the confidences of the words it spans, then map to
   a band (configurable thresholds — defaults from the PRD). */
const SCAN_BAND_THRESHOLDS = { high: 0.85, med: 0.60 };

function bandFor(confidence) {
  if (confidence == null || isNaN(confidence)) return 'med'; // AC graceful degradation
  if (confidence >= SCAN_BAND_THRESHOLDS.high) return 'high';
  if (confidence >= SCAN_BAND_THRESHOLDS.med)  return 'med';
  return 'low';
}

/* Average word-confidence (0-1) for words whose text appears in `phrase` */
function confidenceForPhrase(words, phrase) {
  if (!phrase || !words?.length) return null;
  const tokens = String(phrase).toLowerCase().match(/[\w@.+-]+/g) || [];
  if (!tokens.length) return null;
  const scores = [];
  for (const t of tokens) {
    const w = words.find(w => (w.text || '').toLowerCase().includes(t) || t.includes((w.text || '').toLowerCase()));
    if (w && typeof w.confidence === 'number') scores.push(w.confidence / 100);
  }
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/* Apply band to a form input + its hint span; fire telemetry */
function applyConfidence(inputId, value, confidence, leadIdForTelemetry = null) {
  const el = document.getElementById(inputId);
  if (!el) return null;
  const hasValue = value != null && String(value).trim() !== '';
  /* AC edge-case: empty field → low regardless of OCR score */
  const band = !hasValue ? 'low' : bandFor(confidence);

  if (hasValue) el.value = String(value).trim();
  el.classList.remove('cband-low','cband-med','cband-high');
  el.classList.add('cband-' + band);
  el.dataset.cband = band;
  el.dataset.ocrOriginal = hasValue ? String(value).trim() : '';
  el.dataset.ocrConfidence = confidence != null ? String(confidence) : '';

  const hintId = inputId + '-band';
  const hint = document.getElementById(hintId);
  if (hint) {
    hint.hidden = false;
    hint.textContent = band === 'low'  ? '⚠ Low confidence — please verify'
                     : band === 'med'  ? '~ Medium confidence — double-check'
                     : '✓ High confidence';
    hint.className = 'confidence-hint cband-' + band;
    /* AC7 screen-reader: aria-describedby is already wired in the markup,
       so the hint text is announced when the input gains focus. */
  }

  /* AC8 telemetry — fire once per band assignment */
  logTelemetry('scan_field_confidence_band', { field: inputId, band, confidence }, leadIdForTelemetry);

  /* Track edits — promote to "corrected" if user changes the value */
  el.removeEventListener('input', el._cbandEditHandler || (() => {}));
  el._cbandEditHandler = () => {
    if (el.value.trim() !== el.dataset.ocrOriginal) {
      el.dataset.corrected = 'true';
      logTelemetry('scan_field_corrected', { field: inputId, fromBand: band });
    } else {
      delete el.dataset.corrected;
    }
  };
  el.addEventListener('input', el._cbandEditHandler);

  return band;
}

function clearConfidence(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.classList.remove('cband-low','cband-med','cband-high');
  delete el.dataset.cband;
  delete el.dataset.ocrOriginal;
  delete el.dataset.ocrConfidence;
  delete el.dataset.corrected;
  const hint = document.getElementById(inputId + '-band');
  if (hint) { hint.hidden = true; hint.textContent = ''; }
}

/* Telemetry helper — fire-and-forget, non-blocking, swallows errors. */
function logTelemetry(eventName, metadata = {}, leadId = null) {
  try {
    if (!_token) return; // not signed in
    api('POST', '/leads/telemetry', { eventName, metadata, leadId }).catch(() => {});
  } catch (e) { /* never let telemetry break the flow */ }
}

/* ═══════════ PRD 2: MULTILINGUAL OCR ═══════════ */

/* Language config — stored in localStorage so admin can toggle via Settings.
   AC2: initial supported set.  AC5: per-tenant via config flag. */
const OCR_LANG_DEFS = [
  { code:'eng',      label:'English',             tesseract:'eng',                script:/[A-z]/  },
  { code:'hin',      label:'Hindi (Devanagari)',   tesseract:'hin',                script:/[ऀ-ॿ]/  },
  { code:'tam',      label:'Tamil',                tesseract:'tam',                script:/[஀-௿]/  },
  { code:'ara',      label:'Arabic',               tesseract:'ara',                script:/[؀-ۿ]/  },
  { code:'chi_sim',  label:'Chinese (Simplified)', tesseract:'chi_sim',            script:/[一-鿿]/  },
  { code:'chi_tra',  label:'Chinese (Traditional)',tesseract:'chi_tra',            script:/[一-鿿]/  },
  { code:'jpn',      label:'Japanese',             tesseract:'jpn',                script:/[぀-ヿ]/  },
  { code:'kor',      label:'Korean',               tesseract:'kor',                script:/[가-힯]/  },
];

/* AC5 — enabled languages (persisted per user in localStorage) */
function getEnabledOcrLangs() {
  try {
    const stored = JSON.parse(localStorage.getItem('ii_ocr_langs') || 'null');
    if (Array.isArray(stored)) return stored;
  } catch (_) {}
  return ['eng']; // default: English only
}
function setEnabledOcrLangs(codes) {
  localStorage.setItem('ii_ocr_langs', JSON.stringify(codes));
}

/* AC1 — detect non-Latin scripts in a text sample (<500 ms, pure JS) */
function detectScripts(text) {
  if (!text) return ['eng'];
  const detected = [];
  for (const def of OCR_LANG_DEFS) {
    if (def.code !== 'eng' && def.script.test(text)) detected.push(def.code);
  }
  return detected.length ? detected : ['eng'];
}

/* Build Tesseract language string from enabled list + detected scripts */
function buildLangString(detectedScripts) {
  const enabled  = getEnabledOcrLangs();
  const langSet  = new Set(['eng']); // always include English
  for (const code of [...enabled, ...detectedScripts]) langSet.add(code);
  return Array.from(langSet).map(c => OCR_LANG_DEFS.find(d => d.code === c)?.tesseract || c).join('+');
}

/* AC4 — basic transliteration for Devanagari → Latin (name/company display).
   A full library (e.g. libindic) ships as a vendor dep; this covers the
   most-common name characters sufficient for search indexing. */
function transliterateDevanagari(text) {
  const map = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au',
    'क':'k','ख':'kh','ग':'g','घ':'gh','च':'ch','छ':'chh','ज':'j','झ':'jh','ट':'t','ठ':'th',
    'ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n','प':'p','फ':'ph',
    'ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'sh','ष':'sh','स':'s','ह':'h',
    'ा':'a','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','ं':'n','ः':'h','्':'' };
  return text.split('').map(c => map[c] ?? c).join('');
}

function transliterateText(text) {
  if (!text) return '';
  if (/[ऀ-ॿ]/.test(text)) return transliterateDevanagari(text);
  return text; // Tamil, Arabic, CJK: leave as-is (full library needed)
}

async function processCardImage(file, fieldMap) {
  const scanBtns = [
    document.getElementById('cameraScanBtn'),
    document.getElementById('refCameraBtn'),
    document.getElementById('scanRescanBtn'),
    document.getElementById('refScanRescanBtn'),
  ];
  scanBtns.forEach(b => btnLoad(b, true, '🔍 Scanning…'));
  logTelemetry('scan_started', { fieldMap });
  try {
    /* PRD 2 — Phase 1: run English OCR first (fast), detect scripts, then
       re-run with additional languages if non-Latin script found. */
    const engResult = await Tesseract.recognize(file, 'eng', {
      logger: m => {
        if (m.status === 'loading tesseract core')            showLoader('Loading OCR engine…');
        else if (m.status === 'loading language traineddata') showLoader('Downloading language data…');
        else if (m.status === 'initializing api')             showLoader('Initialising OCR…');
        else if (m.status === 'recognizing text')             showLoader('Recognising (pass 1)… ' + Math.round((m.progress || 0) * 100) + '%');
      },
    });

    const engText      = engResult.data.text || '';
    const detected     = detectScripts(engText);
    const enabledLangs = getEnabledOcrLangs();

    /* Check if any detected script is NOT enabled for this tenant (AC edge case) */
    const disabledDetected = detected.filter(d => d !== 'eng' && !enabledLangs.includes(d));
    if (disabledDetected.length) {
      const labels = disabledDetected.map(c => OCR_LANG_DEFS.find(d => d.code === c)?.label || c).join(', ');
      flash(`Card appears to be in ${labels} — enable it in Settings → OCR Languages for better results.`, 'warn');
      logTelemetry('scan_language_mismatch', { detected, enabled: enabledLangs, disabled: disabledDetected });
    }

    /* AC3 — if non-Latin script detected AND the language is enabled, re-run with combined langs */
    const enabledNonLatin = detected.filter(d => d !== 'eng' && enabledLangs.includes(d));
    let result = engResult;
    let detectedLang = 'eng';
    if (enabledNonLatin.length) {
      const langStr = buildLangString(enabledNonLatin);
      showLoader(`Recognising ${langStr.replace(/\+/g, ' + ')}… pass 2`);
      result = await Tesseract.recognize(file, langStr, {
        logger: m => {
          if (m.status === 'recognizing text') showLoader('Recognising (pass 2)… ' + Math.round((m.progress || 0) * 100) + '%');
        },
      });
      detectedLang = enabledNonLatin[0];
      logTelemetry('scan_language_detected', { detected: detectedLang, langStr });
    }

    const text  = result.data.text || '';
    const words = result.data.words || [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    /* ── Field extraction (unchanged heuristics) ── */
    const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);

    let phoneRaw = text.match(/(?:\+91[-\s]?)?[6-9][\d](?:[ \-]?\d){8,9}/);
    if (!phoneRaw) {
      for (const ln of lines) {
        const m = ln.match(/\b\d[\d \-]{8,11}\d\b/);
        if (m) { phoneRaw = m; break; }
      }
    }
    const phoneDigits = phoneRaw ? phoneRaw[0].replace(/[ \-]/g, '') : null;
    const phone = (phoneDigits && phoneDigits.length >= 10 && phoneDigits.length <= 13) ? phoneDigits : null;

    const companyLine = lines.find(l => /\b(ltd|pvt|inc|corp|llp|solutions|technologies|services|group|design|studio|associates|enterprises)\b/i.test(l));

    const allCapsMatch = text.match(/\b([A-Z]{2,20})\s+([A-Z]{2,20})\b/);
    const fallbackName = lines.find(l =>
      l.length > 2 && l.length < 60 &&
      !l.match(/^\//) &&
      !l.match(/[@\\]/) &&
      !l.toLowerCase().includes('www') &&
      !/^\+?[\d\s\-().]+$/.test(l) &&
      l !== companyLine
    );
    const nameLine = allCapsMatch ? (allCapsMatch[1] + ' ' + allCapsMatch[2]) : fallbackName;

    /* PRD 2 AC4 — Latin transliteration for non-Latin name/company.
       Store native script in the field value; append transliteration to notes. */
    const nameTranslit    = detectedLang !== 'eng' ? transliterateText(nameLine    || '') : '';
    const companyTranslit = detectedLang !== 'eng' ? transliterateText(companyLine || '') : '';
    if ((nameTranslit || companyTranslit) && fieldMap.notes) {
      const notesEl = document.getElementById(fieldMap.notes);
      if (notesEl) {
        const translit = [nameTranslit && `Name (en): ${nameTranslit}`, companyTranslit && `Company (en): ${companyTranslit}`].filter(Boolean).join('\n');
        notesEl.value = translit + (notesEl.value ? '\n\n' + notesEl.value : '');
      }
    }

    /* ── Apply per-field confidence (PRD 1) ── */
    const fieldValues = {
      name:    { id: fieldMap.name,    value: nameLine,         conf: confidenceForPhrase(words, nameLine) },
      phone:   { id: fieldMap.phone,   value: phone,            conf: confidenceForPhrase(words, phoneRaw?.[0]) },
      email:   { id: fieldMap.email,   value: emailMatch?.[0],  conf: confidenceForPhrase(words, emailMatch?.[0]) },
      company: { id: fieldMap.company, value: companyLine,      conf: confidenceForPhrase(words, companyLine) },
    };
    const bands = {};
    for (const [key, f] of Object.entries(fieldValues)) {
      if (f.id) bands[key] = applyConfidence(f.id, f.value, f.conf);
    }

    /* Notes always gets the raw text for fallback verification */
    if (fieldMap.notes) {
      const notesEl = document.getElementById(fieldMap.notes);
      if (notesEl) notesEl.value = text.trim().substring(0, 400);
    }

    /* AC5 — re-scan CTA when >50% of fields are Low. fieldMap may supply
       a custom banner ID (the referrer view uses #refScanRescanBanner). */
    const bandValues = Object.values(bands);
    const lowCount   = bandValues.filter(b => b === 'low').length;
    const bannerId   = fieldMap.rescanBanner || 'scanRescanBanner';
    const banner     = document.getElementById(bannerId);
    if (banner) banner.hidden = !(bandValues.length && lowCount / bandValues.length > 0.5);

    const filled = bandValues.filter(b => b !== 'low').length;
    logTelemetry('scan_completed', { bands, lowCount, totalFields: bandValues.length });
    if (filled > 0) {
      flash(`Card scanned — ${filled} field${filled > 1 ? 's' : ''} above low confidence. Review before saving.`);
    } else {
      flash('Card text unclear — please fix the highlighted fields or re-scan.', 'warn');
    }

    /* PRD 4 — fire duplicate check in parallel with the field render */
    runDuplicateCheck();
  } catch (err) {
    flash('Could not read card — please fill in manually', 'error');
    logTelemetry('scan_abandoned', { error: String(err?.message || err) });
  } finally {
    hideLoader();
    scanBtns.forEach(b => btnLoad(b, false));
  }
}

/* ═══════════ PRD 4: DUPLICATE DETECTION ═══════════ */
/* In-flight state for the lead-modal dupe check */
const _dupeState = {
  matches:        [],     // ranked list from the API
  pendingPayload: null,   // payload waiting on save-anyway-with-reason
  pendingBtn:     null,
};

async function runDuplicateCheck() {
  const panel = document.getElementById('dupeMatchPanel');
  if (!panel) return;
  const payload = {
    name:    document.getElementById('leadName')?.value?.trim()    || '',
    phone:   document.getElementById('leadPhone')?.value?.trim()   || '',
    email:   document.getElementById('leadEmail')?.value?.trim()   || '',
    company: document.getElementById('leadCompany')?.value?.trim() || '',
  };
  if (!payload.name && !payload.phone && !payload.email) {
    panel.hidden = true;
    panel.innerHTML = '';
    _dupeState.matches = [];
    return [];
  }
  /* Don't dupe-check edits to existing leads against themselves */
  const editingId = document.getElementById('leadIdInput')?.value || '';
  try {
    const res = await api('POST', '/leads/check-duplicate', payload);
    const matches = (res.data?.matches || res.matches || []).filter(m => m.lead.id !== editingId);
    _dupeState.matches = matches;
    renderDupeMatchPanel(matches);
    if (matches.length) logTelemetry('scan_dedupe_match_found', { count: matches.length, top: matches[0]?.strength });
    return matches;
  } catch (err) {
    panel.hidden = true;
    return [];
  }
}

function renderDupeMatchPanel(matches) {
  const panel = document.getElementById('dupeMatchPanel');
  if (!panel) return;
  if (!matches.length) { panel.hidden = true; panel.innerHTML = ''; return; }

  const strong = matches.find(m => m.strength === 'strong');
  panel.classList.toggle('strong', !!strong);
  panel.hidden = false;
  const headerLabel = strong
    ? `// LIKELY DUPLICATE — matched on ${strong.reason}`
    : `// POSSIBLE MATCH${matches.length > 1 ? `ES — ${matches.length} candidates` : ''}`;

  const rows = matches.slice(0, strong ? 1 : 3).map(m => {
    const l = m.lead;
    const sub = [l.email || null, l.phone || null, l.company || null, l.assignedAgent?.name || null]
                  .filter(Boolean).join(' · ');
    const idAttr = `data-match-id="${l.id}"`;
    return `
      <div class="dmp-match">
        <div class="dmp-match-info">
          <div class="dmp-match-name">${escapeHtml(l.name)} <span style="color:var(--text-3);font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">· ${escapeHtml(l.stage)}</span></div>
          <div class="dmp-match-sub">${escapeHtml(sub)}</div>
        </div>
        <div class="dmp-actions">
          <button type="button" class="neo-btn outline" ${idAttr} data-dmp-action="open">Open</button>
          <button type="button" class="neo-btn yellow"  ${idAttr} data-dmp-action="merge">Merge</button>
        </div>
      </div>`;
  }).join('');

  panel.innerHTML = `<div class="dmp-header">${escapeHtml(headerLabel)}</div>${rows}`;
  panel.querySelectorAll('[data-dmp-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.matchId;
      const action = btn.dataset.dmpAction;
      logTelemetry('scan_dedupe_action', { action, matchId: id });
      if (action === 'open') {
        document.getElementById('leadModal').classList.remove('open');
        openLeadModal(id);
      } else if (action === 'merge') {
        openMergeModal(id);
      }
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

/* Build merge UI: side-by-side per-field winners */
function openMergeModal(existingLeadId) {
  const existing = S.leads.find(l => l.id === existingLeadId);
  if (!existing) { flash('Could not load the existing lead', 'error'); return; }

  const incoming = {
    name:    document.getElementById('leadName')?.value?.trim()    || '',
    phone:   document.getElementById('leadPhone')?.value?.trim()   || '',
    email:   document.getElementById('leadEmail')?.value?.trim()   || '',
    company: document.getElementById('leadCompany')?.value?.trim() || '',
    notes:   document.getElementById('leadNotes')?.value?.trim()   || '',
    value:   document.getElementById('leadValue')?.value           || '',
    stage:   document.getElementById('leadStage')?.value           || '',
  };
  const existingMap = {
    name: existing.name, phone: existing.phone, email: existing.email,
    company: existing.company || '', notes: existing.notes || '',
    value: existing.value || '', stage: existing.stage,
  };

  const grid = document.getElementById('mergeGrid');
  grid.innerHTML = `
    <div class="mg-h"></div>
    <div class="mg-h">Existing</div>
    <div class="mg-h">From scan</div>
    ${['name','phone','email','company','value','stage','notes'].map(f => {
      const a = existingMap[f]; const b = incoming[f];
      /* Default winner: PRD 1 says highest-confidence value, else newest non-empty.
         The scan value is "newest" by definition; pick it when existing is empty
         OR when the scanned input has a high confidence band. */
      const incomingEl = document.getElementById('lead' + (f === 'name' ? 'Name' : f.charAt(0).toUpperCase() + f.slice(1)));
      const incomingBand = incomingEl?.dataset?.cband;
      const defaultPick = (!a && b) ? 'incoming'
                        : (a && !b) ? 'existing'
                        : (incomingBand === 'high') ? 'incoming'
                        : 'existing';
      return `
        <div class="mg-label">${f}</div>
        <div class="mg-cell ${a ? '' : 'empty'} ${defaultPick==='existing' ? 'selected' : ''}" data-mg-field="${f}" data-mg-side="existing">${escapeHtml(a || '— empty —')}</div>
        <div class="mg-cell ${b ? '' : 'empty'} ${defaultPick==='incoming' ? 'selected' : ''}" data-mg-field="${f}" data-mg-side="incoming">${escapeHtml(b || '— empty —')}</div>
      `;
    }).join('')}
  `;

  /* Click toggles per-field winner */
  grid.querySelectorAll('.mg-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const field = cell.dataset.mgField;
      grid.querySelectorAll(`.mg-cell[data-mg-field="${field}"]`).forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
    });
  });

  document.getElementById('mergeModal').classList.add('open');
  document.getElementById('mergeConfirmBtn').onclick = () => confirmMerge(existingLeadId, incoming);
  document.getElementById('mergeCancelBtn').onclick  = () => document.getElementById('mergeModal').classList.remove('open');
  document.getElementById('mergeModalClose').onclick = () => document.getElementById('mergeModal').classList.remove('open');
}

async function confirmMerge(existingLeadId, incoming) {
  const grid = document.getElementById('mergeGrid');
  const fieldChoices = {};
  /* For each field: 'source' means "use the incoming/scan value", which on
     the backend means take from the source row. We're not actually creating
     the source row first — instead, mutate the existing lead in place via
     the merge endpoint by providing a fake "source" payload. To keep the
     backend simple we POST a temp lead first, then merge. */
  grid.querySelectorAll('.mg-cell.selected').forEach(c => {
    const field = c.dataset.mgField;
    const side  = c.dataset.mgSide;
    fieldChoices[field] = (side === 'incoming') ? 'source' : 'target';
  });

  const btn = document.getElementById('mergeConfirmBtn');
  btnLoad(btn, true, 'Merging…');
  try {
    /* Create the source lead first (so its activity history can be migrated
       — currently empty, but the schema requires it). Use minimum required fields. */
    const srcPayload = {
      name:    incoming.name  || 'Scanned',
      phone:   incoming.phone || '0000000000',
      email:   incoming.email,
      company: incoming.company,
      notes:   incoming.notes,
      value:   parseInt(incoming.value) || 0,
      stage:   incoming.stage || 'new',
      source:  document.getElementById('leadSource')?.value || 'direct',
    };
    const srcRes = await api('POST', '/leads', srcPayload);
    const srcId  = srcRes.data?._id || srcRes.data?.id || srcRes._id;
    if (!srcId) throw new Error('Could not stage source lead for merge');

    await api('POST', `/leads/${existingLeadId}/merge`, { sourceId: srcId, fieldChoices });
    logTelemetry('scan_dedupe_action', { action: 'merge_confirmed', existingLeadId });
    flash('Leads merged successfully');

    document.getElementById('mergeModal').classList.remove('open');
    document.getElementById('leadModal').classList.remove('open');
    await loadAllData(true);
    updateNavCounts();
    renderKanban(getFilters());
  } catch (err) {
    flash(err.message || 'Merge failed', 'error');
  } finally {
    btnLoad(btn, false);
  }
}

/* Wire the Re-scan banner button */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scanRescanBtn')?.addEventListener('click', () => {
    document.getElementById('cardCameraInput')?.click();
  });
});

/* Wire up the lead modal camera button */
document.getElementById('cameraScanBtn')?.addEventListener('click', () => {
  document.getElementById('cardCameraInput').click();
});
document.getElementById('cardCameraInput')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) processCardImage(file, { name:'leadName', phone:'leadPhone', email:'leadEmail', notes:'leadNotes' });
  e.target.value = ''; // reset so same file can re-trigger
});

/* ═══════════ PRD 3: BULK SCAN MODAL ═══════════ */
const _bulk = {
  items: [],     // { file, dataUrl, status, fields, bands, skip }
  processing: false,
};

function openBulkScanModal() {
  _bulk.items = [];
  document.getElementById('bulkScanUploadZone').hidden = false;
  document.getElementById('bulkScanQueueWrap').hidden  = true;
  document.getElementById('bulkScanModal').classList.add('open');
}

/* Accept files from input or drop */
function acceptBulkFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/')).slice(0, 50 - _bulk.items.length);
  if (!files.length) return;

  const newItems = files.map(file => ({
    id:     Math.random().toString(36).slice(2),
    file,
    dataUrl: null,
    status: 'queued',
    fields: { name:'', phone:'', email:'', company:'' },
    bands:  {},
    ocrCapture: null,
    skip: false,
  }));
  _bulk.items.push(...newItems);

  /* Generate thumbnails */
  newItems.forEach(item => {
    const reader = new FileReader();
    reader.onload = e => {
      item.dataUrl = e.target.result;
      renderBulkQueueItem(item);
    };
    reader.readAsDataURL(item.file);
  });

  showBulkQueue();
  if (!_bulk.processing) processBulkQueue();
}

function showBulkQueue() {
  document.getElementById('bulkScanUploadZone').hidden = true;
  document.getElementById('bulkScanQueueWrap').hidden  = false;
  refreshBulkSummary();
}

function refreshBulkSummary() {
  const total   = _bulk.items.length;
  const ready   = _bulk.items.filter(i => i.status === 'ready' && !i.skip).length;
  const skipped = _bulk.items.filter(i => i.skip).length;
  const errors  = _bulk.items.filter(i => i.status === 'error').length;
  document.getElementById('bulkQueueSummary').textContent =
    `${total} image${total !== 1 ? 's' : ''} · ${ready} ready · ${skipped} skipped · ${errors} error${errors !== 1 ? 's' : ''}`;
  const saveBtn = document.getElementById('bulkScanSaveAllBtn');
  if (saveBtn) saveBtn.disabled = ready === 0;
}

async function processBulkQueue() {
  _bulk.processing = true;
  for (const item of _bulk.items) {
    if (item.status !== 'queued') continue;
    item.status = 'scanning';
    renderBulkQueueItem(item);
    try {
      /* PRD 2 — two-pass multilingual OCR for bulk items */
      const logStatus = pct => {
        const statusEl = document.querySelector(`[data-bq-id="${item.id}"] .bq-status-badge`);
        if (statusEl) statusEl.textContent = 'scanning ' + pct + '%';
      };
      const engRes = await Tesseract.recognize(item.file, 'eng', {
        logger: m => { if (m.status === 'recognizing text') logStatus(Math.round((m.progress || 0) * 50)); },
      });
      const detectedBulk   = detectScripts(engRes.data.text || '');
      const nonLatinBulk   = detectedBulk.filter(d => d !== 'eng' && getEnabledOcrLangs().includes(d));
      let result = engRes;
      if (nonLatinBulk.length) {
        const langStr = buildLangString(nonLatinBulk);
        result = await Tesseract.recognize(item.file, langStr, {
          logger: m => { if (m.status === 'recognizing text') logStatus(50 + Math.round((m.progress || 0) * 50)); },
        });
      }
      item.detectedLang = nonLatinBulk[0] || 'eng';
      const text  = result.data.text || '';
      const words = result.data.words || [];
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      /* Same extraction heuristics as single scan */
      const emailM = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      let phoneRaw = text.match(/(?:\+91[-\s]?)?[6-9][\d](?:[ \-]?\d){8,9}/);
      if (!phoneRaw) for (const ln of lines) { const m = ln.match(/\b\d[\d \-]{8,11}\d\b/); if (m) { phoneRaw = m; break; } }
      const phoneDigits = phoneRaw ? phoneRaw[0].replace(/[ \-]/g,'') : null;
      const phone = (phoneDigits && phoneDigits.length >= 10 && phoneDigits.length <= 13) ? phoneDigits : null;
      const companyLine = lines.find(l => /\b(ltd|pvt|inc|corp|llp|solutions|technologies|services|group|design|studio|associates|enterprises)\b/i.test(l));
      const allCaps = text.match(/\b([A-Z]{2,20})\s+([A-Z]{2,20})\b/);
      const fallbackName = lines.find(l => l.length > 2 && l.length < 60 && !l.match(/^\//) && !l.match(/[@\\]/) && !l.toLowerCase().includes('www') && !/^\+?[\d\s\-().]+$/.test(l) && l !== companyLine);
      const nameLine = allCaps ? allCaps[1] + ' ' + allCaps[2] : fallbackName;

      item.fields = {
        name:    nameLine    || '',
        phone:   phone       || '',
        email:   emailM?.[0] || '',
        company: companyLine || '',
      };
      item.bands = {
        name:    bandFor(confidenceForPhrase(words, nameLine)),
        phone:   bandFor(confidenceForPhrase(words, phoneRaw?.[0])),
        email:   bandFor(confidenceForPhrase(words, emailM?.[0])),
        company: bandFor(confidenceForPhrase(words, companyLine)),
      };
      item.ocrCapture = {
        scannedAt:  new Date().toISOString(),
        ocrEngine:  'tesseract.js@5',
        detectedLang: item.detectedLang || 'eng',
        fields: Object.fromEntries(
          Object.entries(item.fields).map(([k, v]) => [k, {
            band: item.bands[k] || 'low',
            originalValue: v,
            rawConfidence: null,
            corrected: false,
          }])
        ),
      };
      item.status = 'ready';
    } catch (err) {
      item.status = 'error';
      item.errorMsg = err?.message || 'OCR failed';
    }
    renderBulkQueueItem(item);
    refreshBulkSummary();
  }
  _bulk.processing = false;
}

function renderBulkQueueItem(item) {
  const list = document.getElementById('bulkQueueList');
  let el = list.querySelector(`[data-bq-id="${item.id}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'bq-item';
    el.dataset.bqId = item.id;
    list.appendChild(el);
  }
  el.classList.toggle('skipped', item.skip);

  const thumbHtml = item.dataUrl
    ? `<img class="bq-thumb" src="${item.dataUrl}" alt="Card"/>`
    : `<div class="bq-thumb-placeholder">🪪</div>`;

  const statusColor = { queued:'queued', scanning:'scanning', ready:'ready', error:'error' }[item.status] || 'queued';

  const fieldsHtml = ['name','phone','email','company'].map(f => `
    <div class="bq-field">
      <label>${f}</label>
      <input type="text" data-bq-field="${f}" value="${escapeHtml(item.fields[f] || '')}"
             class="${item.bands[f] ? 'cband-' + item.bands[f] : ''}"
             ${item.skip ? 'disabled' : ''}/>
    </div>`).join('');

  el.innerHTML = `
    ${thumbHtml}
    <div>
      <span class="bq-status-badge ${statusColor}">${item.status === 'error' ? (item.errorMsg || 'error') : item.status}</span>
      <div class="bq-fields">${fieldsHtml}</div>
    </div>
    <div class="bq-actions">
      <button class="bq-skip-btn ${item.skip ? 'skipped-active' : ''}">${item.skip ? 'Undo skip' : 'Skip'}</button>
    </div>`;

  /* Live edits update item.fields */
  el.querySelectorAll('[data-bq-field]').forEach(input => {
    input.addEventListener('input', () => {
      item.fields[input.dataset.bqField] = input.value;
      if (item.ocrCapture?.fields?.[input.dataset.bqField]) {
        item.ocrCapture.fields[input.dataset.bqField].corrected = true;
      }
    });
  });
  el.querySelector('.bq-skip-btn').addEventListener('click', () => {
    item.skip = !item.skip;
    renderBulkQueueItem(item);
    refreshBulkSummary();
  });
}

async function saveBulkLeads() {
  const readyItems = _bulk.items.filter(i => i.status === 'ready' && !i.skip);
  if (!readyItems.length) { flash('No ready leads to save', 'warn'); return; }

  const btn = document.getElementById('bulkScanSaveAllBtn');
  btnLoad(btn, true, 'Saving…');
  logTelemetry('scan_started', { mode: 'bulk', count: readyItems.length });

  try {
    const batchName = document.getElementById('bulkBatchName')?.value?.trim() || '';
    const leads = readyItems.map(item => ({
      name:       item.fields.name    || 'Unknown',
      phone:      item.fields.phone   || '0000000000',
      email:      item.fields.email   || '',
      company:    item.fields.company || '',
      source:     'direct',
      ocrCapture: item.ocrCapture,
    }));

    const res = await api('POST', '/leads/bulk-scan', { leads, batchName });
    const { inserted = 0, duplicates = 0 } = res.data || res;

    logTelemetry('scan_saved', { mode: 'bulk', inserted, duplicates });
    flash(`Saved ${inserted} lead${inserted !== 1 ? 's' : ''}${duplicates ? ` (${duplicates} duplicate${duplicates !== 1 ? 's' : ''} skipped)` : ''}`, 'success');

    if ((typeof isReferrer === 'function') && isReferrer()) {
      if (typeof loadRefLeadsList === 'function') await loadRefLeadsList();
    } else {
      await loadAllData(true);
      updateNavCounts();
      renderKanban(getFilters());
    }
    document.getElementById('bulkScanModal').classList.remove('open');
  } catch (err) {
    flash(err.message || 'Bulk save failed', 'error');
  } finally {
    btnLoad(btn, false);
  }
}

/* Wire bulk scan modal events */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bulkScanBtn')?.addEventListener('click', openBulkScanModal);
  document.getElementById('bulkScanClose')?.addEventListener('click', () => document.getElementById('bulkScanModal').classList.remove('open'));
  document.getElementById('bulkScanCancelBtn')?.addEventListener('click', () => document.getElementById('bulkScanModal').classList.remove('open'));
  document.getElementById('bulkScanModal')?.addEventListener('click', e => { if (e.target === document.getElementById('bulkScanModal')) document.getElementById('bulkScanModal').classList.remove('open'); });

  document.getElementById('bulkScanSelectBtn')?.addEventListener('click', () => document.getElementById('bulkScanFileInput').click());
  document.getElementById('bulkScanFileInput')?.addEventListener('change', e => { acceptBulkFiles(e.target.files); e.target.value=''; });

  document.getElementById('bulkScanAddMoreBtn')?.addEventListener('click', () => document.getElementById('bulkScanAddMoreInput').click());
  document.getElementById('bulkScanAddMoreInput')?.addEventListener('change', e => { acceptBulkFiles(e.target.files); e.target.value=''; });

  document.getElementById('bulkScanSaveAllBtn')?.addEventListener('click', saveBulkLeads);

  /* Drag-and-drop onto upload zone */
  const zone = document.getElementById('bulkScanUploadZone');
  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      acceptBulkFiles(e.dataTransfer.files);
    });
    zone.addEventListener('click', e => { if (e.target !== document.getElementById('bulkScanSelectBtn')) document.getElementById('bulkScanFileInput').click(); });
  }
});

/* ═══════════ PRD 5: ENRICHMENT BADGES ═══════════ */
/* Render enrichment section inside an info modal body or lead detail panel.
   Called with the full lead object (including enrichment Map as an object). */
function renderEnrichmentSection(lead, containerId) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return;

  const enrichment = lead.enrichment || {};
  const enrichedFields = Object.entries(enrichment);
  if (!enrichedFields.length) return;

  const fieldsHtml = enrichedFields.map(([field, info]) => {
    const val = info?.value ?? info;
    const provider = info?.provider || 'auto';
    let displayVal = escapeHtml(String(val || ''));
    if (field === 'logoUrl' && val) {
      displayVal = `<img class="enrichment-logo" src="${escapeHtml(val)}" alt="Logo" onerror="this.style.display='none'"/>`;
    } else if ((field === 'linkedinUrl' || field === 'website') && val) {
      displayVal = `<a href="${escapeHtml(val)}" target="_blank" rel="noopener">${escapeHtml(val)}</a>`;
    }

    const label = {
      website:'Website', industry:'Industry', employeeCount:'Employees',
      hqCountry:'HQ Country', linkedinUrl:'LinkedIn', logoUrl:'Logo',
    }[field] || field;

    return `
      <div class="enrichment-field">
        <div class="enrichment-field-label">${label}</div>
        <div class="enrichment-field-value">${displayVal}</div>
        <button class="auto-badge" title="Auto-filled by ${escapeHtml(provider)} — click to remove"
                data-enrich-field="${field}" data-lead-id="${lead.id || lead._id}">auto</button>
      </div>`;
  }).join('');

  const section = document.createElement('div');
  section.className = 'enrichment-section';
  section.innerHTML = `<div class="enrichment-section-header">// AUTO-ENRICHMENT</div><div class="enrichment-grid">${fieldsHtml}</div>`;
  container.appendChild(section);

  /* Roll-back: click the "auto" badge */
  section.querySelectorAll('.auto-badge').forEach(btn => {
    btn.addEventListener('click', async () => {
      const field  = btn.dataset.enrichField;
      const leadId = btn.dataset.leadId;
      if (!field || !leadId) return;
      const conf = window.confirm(`Remove auto-enriched "${field}" and mark it do-not-enrich?`);
      if (!conf) return;
      try {
        await api('DELETE', `/leads/${leadId}/enrich/${field}`);
        logTelemetry('enrichment_field_overridden', { field });
        btn.closest('.enrichment-field')?.remove();
        flash(`"${field}" cleared`, 'success');
      } catch (err) {
        flash(err.message || 'Rollback failed', 'error');
      }
    });
  });
}

/* Patch normalizeLead to include enrichment data */
const _origNormalizeLead = normalizeLead;
/* eslint-disable-next-line no-global-assign */
normalizeLead = function(l) {
  const base = _origNormalizeLead(l);
  base.enrichment   = l.enrichment   || {};
  base.company      = l.company      || '';
  base.website      = l.website      || '';
  base.industry     = l.industry     || '';
  base.employeeCount= l.employeeCount|| '';
  base.hqCountry    = l.hqCountry    || '';
  base.linkedinUrl  = l.linkedinUrl  || '';
  base.logoUrl      = l.logoUrl      || '';
  base.jobTitle     = l.jobTitle     || '';
  return base;
};

/* ══════════════════════════════════════════════════════════════════
   PRD 6 — Voice Memo (MediaRecorder + Web Speech API)
   ══════════════════════════════════════════════════════════════════ */

const _vm = {
  mediaRecorder:  null,
  audioChunks:    [],
  recognition:    null,
  transcript:     '',
  interimTranscript: '',
  startTime:      null,
  timerInterval:  null,
  currentLeadId:  null,
  blob:           null,
};

function _vmSetStatus(msg) {
  const el = document.getElementById('vmStatus');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function _vmFormatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function _vmStartTimer() {
  _vm.startTime = Date.now();
  const timerEl = document.getElementById('vmTimer');
  if (timerEl) timerEl.hidden = false;
  _vm.timerInterval = setInterval(() => {
    const el = document.getElementById('vmTimer');
    if (el) el.textContent = _vmFormatTime(Date.now() - _vm.startTime);
  }, 500);
}

function _vmStopTimer() {
  clearInterval(_vm.timerInterval);
  _vm.timerInterval = null;
}

/* Rule-based extraction — mirrors backend extractFromTranscript exactly */
function vmExtractFields(transcript) {
  const t = transcript.toLowerCase();

  const PAIN_TRIGGERS = ['problem','issue','challenge','struggle','pain','difficult','frustrat','concern','worry','bottleneck','slow','manual'];
  const sentences = transcript.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const painSentences = sentences.filter(s => PAIN_TRIGGERS.some(kw => s.toLowerCase().includes(kw)));
  const painPoints = painSentences.length
    ? { value: painSentences.join('. '), confidence: painSentences.length >= 2 ? 'high' : 'med' }
    : null;

  let budgetSignal = null;
  const bHigh = /\b(large|big|high|enterprise|unlimited)\s*(budget|spend|invest)/i.test(transcript) || /[$£€₹]\s*[\d,]{5,}/.test(transcript);
  const bMid  = /\b(mid|medium|moderate|reasonable)\s*(budget|spend)/i.test(transcript) || /[$£€₹]\s*[\d,]{3,4}/.test(transcript);
  const bLow  = /\b(small|tight|limited|low|no)\s*(budget|spend)/i.test(transcript) || /\bno\s+budget\b/i.test(transcript);
  if      (bHigh) budgetSignal = { value: 'high',    confidence: 'high' };
  else if (bMid)  budgetSignal = { value: 'mid',     confidence: 'med'  };
  else if (bLow)  budgetSignal = { value: 'low',     confidence: 'med'  };
  else if (/budget|spend|invest/i.test(transcript)) budgetSignal = { value: 'unknown', confidence: 'low' };

  let timeline = null;
  const tmatch = transcript.match(/\b(immediately|asap|urgent|this\s+(week|month|quarter|year)|next\s+(week|month|quarter|year|\d+\s+months?)|\d+\s+(days?|weeks?|months?))\b/i);
  if (tmatch) timeline = { value: tmatch[0], confidence: 'high' };

  let decisionMakers = null;
  const dmMatch = transcript.match(/(?:decision\s*maker|approver|approves|sign off|sign-off|ceo|cfo|cto|vp|director|head of)[^.!?]{0,80}/i);
  if (dmMatch) decisionMakers = { value: dmMatch[0].trim(), confidence: 'med' };

  const NEXT_TRIGGERS = ['follow up','follow-up','send','schedule','call back','demo','proposal','meeting','trial','pilot','next step','action'];
  const nextSentences = sentences.filter(s => NEXT_TRIGGERS.some(kw => s.toLowerCase().includes(kw)));
  const nextStep = nextSentences.length ? { value: nextSentences[0], confidence: 'high' } : null;

  let interestLevel = null;
  const hot  = /\b(very\s+interest|definitely|love\s+(it|this)|ready\s+to\s+buy|want\s+to\s+proceed|sign\s+(up|today)|go\s+ahead)\b/i.test(transcript);
  const cold = /\b(not\s+interest|no\s+thanks|don't\s+need|not\s+now|maybe\s+later|just\s+looking)\b/i.test(transcript);
  const warm = /\b(interest|consider|look\s+into|tell\s+me\s+more|sounds\s+good|makes\s+sense)\b/i.test(transcript);
  if      (hot)  interestLevel = { value: 'hot',  confidence: 'high' };
  else if (cold) interestLevel = { value: 'cold', confidence: 'high' };
  else if (warm) interestLevel = { value: 'warm', confidence: 'med'  };

  return { painPoints, budgetSignal, timeline, decisionMakers, nextStep, interestLevel };
}

const VM_FIELD_LABELS = {
  painPoints:     'Pain Points',
  budgetSignal:   'Budget',
  timeline:       'Timeline',
  decisionMakers: 'Decision Makers',
  nextStep:       'Next Step',
  interestLevel:  'Interest',
};

function vmRenderExtracted(extracted) {
  const grid = document.getElementById('vmExtractedGrid');
  const wrap = document.getElementById('vmExtracted');
  if (!grid || !wrap) return;

  const entries = Object.entries(extracted).filter(([, v]) => v !== null);
  if (!entries.length) { wrap.hidden = true; return; }

  grid.innerHTML = entries.map(([field, info]) => `
    <div class="vm-field-card conf-${info.confidence}">
      <div class="vm-field-label">${VM_FIELD_LABELS[field] || field}</div>
      <div class="vm-field-value">${escapeHtml(String(info.value))}</div>
      <span class="vm-conf-badge ${info.confidence}">${info.confidence}</span>
    </div>
  `).join('');

  wrap.hidden = false;
}

async function vmStartRecording() {
  if (!_vm.currentLeadId) return;
  _vm.transcript = '';
  _vm.interimTranscript = '';
  _vm.audioChunks = [];
  _vm.blob = null;

  const transcriptEl = document.getElementById('vmTranscript');
  const transcriptWrap = document.getElementById('vmTranscriptWrap');
  if (transcriptEl) { transcriptEl.textContent = ''; transcriptEl.contentEditable = 'false'; }
  if (transcriptWrap) transcriptWrap.hidden = true;
  const vmExtracted = document.getElementById('vmExtracted');
  if (vmExtracted) vmExtracted.hidden = true;

  /* SpeechRecognition (Web Speech API) */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    _vm.recognition = new SpeechRec();
    _vm.recognition.continuous = true;
    _vm.recognition.interimResults = true;
    _vm.recognition.lang = 'en-IN';

    _vm.recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          _vm.transcript += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      if (transcriptEl) {
        transcriptEl.textContent = _vm.transcript + (interim ? `[${interim}]` : '');
      }
      if (transcriptWrap) transcriptWrap.hidden = false;
    };

    _vm.recognition.onerror = (e) => {
      if (e.error !== 'no-speech') _vmSetStatus(`Speech error: ${e.error}`);
    };

    _vm.recognition.start();
  }

  /* MediaRecorder for audio capture */
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _vm.mediaRecorder = new MediaRecorder(stream);
    _vm.mediaRecorder.ondataavailable = e => { if (e.data.size) _vm.audioChunks.push(e.data); };
    _vm.mediaRecorder.onstop = () => {
      _vm.blob = new Blob(_vm.audioChunks, { type: 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
    };
    _vm.mediaRecorder.start(250);
  } catch {
    /* Mic permission denied — transcription-only mode */
    _vmSetStatus('Mic unavailable — transcript only mode');
  }

  document.getElementById('vmRecordBtn').hidden = true;
  document.getElementById('vmStopBtn').hidden = false;
  _vmStartTimer();
  _vmSetStatus('Recording…');

  logTelemetry('voice_memo_recorded', { leadId: _vm.currentLeadId });
}

async function vmStopRecording() {
  _vmStopTimer();

  if (_vm.recognition) { try { _vm.recognition.stop(); } catch {} _vm.recognition = null; }
  if (_vm.mediaRecorder && _vm.mediaRecorder.state !== 'inactive') _vm.mediaRecorder.stop();

  document.getElementById('vmRecordBtn').hidden = false;
  document.getElementById('vmStopBtn').hidden = true;
  const timerEl = document.getElementById('vmTimer');
  if (timerEl) timerEl.hidden = true;

  _vmSetStatus('Processing…');

  /* Small delay to let final speech results arrive */
  await new Promise(r => setTimeout(r, 600));

  const finalTranscript = _vm.transcript.trim();
  const transcriptEl = document.getElementById('vmTranscript');
  if (transcriptEl) {
    transcriptEl.textContent = finalTranscript;
    transcriptEl.contentEditable = 'true';
  }
  const transcriptWrap = document.getElementById('vmTranscriptWrap');
  if (transcriptWrap) transcriptWrap.hidden = !finalTranscript;

  if (finalTranscript) {
    const extracted = vmExtractFields(finalTranscript);
    vmRenderExtracted(extracted);
    logTelemetry('voice_memo_transcribed', { leadId: _vm.currentLeadId, charCount: finalTranscript.length });
  }

  _vmSetStatus(finalTranscript ? 'Review transcript and extracted fields below.' : 'No speech detected. Type notes manually above.');
}

async function vmSaveMemo() {
  const leadId = _vm.currentLeadId;
  if (!leadId) return;

  const transcriptEl = document.getElementById('vmTranscript');
  const transcript = (transcriptEl?.textContent || _vm.transcript || '').trim();

  const durationSec = _vm.startTime ? Math.round((Date.now() - _vm.startTime) / 1000) : null;

  const btn = document.getElementById('vmSaveMemoBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    let body;
    if (_vm.blob && _vm.blob.size > 0) {
      const fd = new FormData();
      fd.append('transcript', transcript);
      fd.append('transcriptLang', 'en');
      if (durationSec) fd.append('audioDurationSec', durationSec);
      fd.append('audio', _vm.blob, 'memo.webm');
      await fetch(`${API_BASE}/leads/${leadId}/voice-memos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      }).then(r => r.json());
    } else {
      await api('POST', `/leads/${leadId}/voice-memos`, { transcript, transcriptLang: 'en', audioDurationSec: durationSec });
    }

    flash('Voice note saved', 'success');

    /* Clear UI */
    if (transcriptEl) { transcriptEl.textContent = ''; transcriptEl.contentEditable = 'false'; }
    document.getElementById('vmTranscriptWrap').hidden = true;
    document.getElementById('vmExtracted').hidden = true;
    _vm.transcript = ''; _vm.blob = null;
    _vmSetStatus('');

    vmLoadSavedMemos(leadId);
  } catch (err) {
    flash(err.message || 'Save failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Voice Note →'; }
  }
}

async function vmLoadSavedMemos(leadId) {
  const list = document.getElementById('vmSavedList');
  if (!list) return;
  try {
    const memos = await api('GET', `/leads/${leadId}/voice-memos`);
    if (!memos || !memos.length) { list.innerHTML = ''; return; }

    list.innerHTML = memos.map(m => {
      const date = new Date(m.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const by   = m.recordedBy?.name || 'Unknown';
      const excerpt = m.transcript ? escapeHtml(m.transcript.slice(0, 120)) + (m.transcript.length > 120 ? '…' : '') : '<em style="color:var(--text-3)">No transcript</em>';
      const extractedTags = ['painPoints','budgetSignal','timeline','decisionMakers','nextStep','interestLevel']
        .filter(f => m[f]?.value)
        .map(f => `<span class="vm-tag">${VM_FIELD_LABELS[f]}: ${escapeHtml(String(m[f].value).slice(0,20))}</span>`)
        .join('');

      return `
        <div class="vm-saved-item">
          <div class="vm-saved-meta">${escapeHtml(date)} · ${escapeHtml(by)}${m.audioDurationSec ? ` · ${_vmFormatTime(m.audioDurationSec * 1000)}` : ''}</div>
          <div class="vm-saved-excerpt">${excerpt}</div>
          ${extractedTags ? `<div class="vm-saved-fields">${extractedTags}</div>` : ''}
        </div>`;
    }).join('');
  } catch {
    list.innerHTML = '';
  }
}

/* Wire up Voice Memo button in lead modal header */
document.getElementById('voiceMemoBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('voiceMemoPanel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden && _vm.currentLeadId) vmLoadSavedMemos(_vm.currentLeadId);
});

document.getElementById('vmRecordBtn')?.addEventListener('click', vmStartRecording);
document.getElementById('vmStopBtn')?.addEventListener('click',   vmStopRecording);
document.getElementById('vmSaveMemoBtn')?.addEventListener('click', vmSaveMemo);

/* Patch openLeadModal to wire voice memo panel */
const _origOpenLeadModal = openLeadModal;
openLeadModal = function(leadId) {
  _origOpenLeadModal(leadId);
  _vm.currentLeadId = leadId;

  const vBtn   = document.getElementById('voiceMemoBtn');
  const vPanel = document.getElementById('voiceMemoPanel');
  const isNew  = !leadId;

  if (vBtn)   vBtn.classList.toggle('hidden', isNew);
  if (vPanel) { vPanel.hidden = true; }

  /* Reset recorder state */
  if (_vm.mediaRecorder && _vm.mediaRecorder.state !== 'inactive') { try { _vm.mediaRecorder.stop(); } catch {} }
  if (_vm.recognition) { try { _vm.recognition.stop(); } catch {} _vm.recognition = null; }
  _vmStopTimer();
  document.getElementById('vmRecordBtn').hidden = false;
  document.getElementById('vmStopBtn').hidden   = true;
  const timerEl = document.getElementById('vmTimer'); if (timerEl) timerEl.hidden = true;
  _vmSetStatus('');
  const tw = document.getElementById('vmTranscriptWrap'); if (tw) tw.hidden = true;
  const ex = document.getElementById('vmExtracted');      if (ex) ex.hidden = true;
  const sl = document.getElementById('vmSavedList');      if (sl) sl.innerHTML = '';
};

console.log('%c IINVSYS Sales OS v2.0 ', 'background:#F0BE18;color:#000;font-weight:bold;padding:4px 12px;letter-spacing:2px');
console.log('%c Keyboard: 1-6 navigate · N = new lead · Esc = close modal', 'color:#555;font-size:11px');
