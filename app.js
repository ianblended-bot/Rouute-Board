/* =========================================================
   app.js — Route Board application logic
   ========================================================= */

/* ---------------- date helpers ---------------- */
const pad2 = n => String(n).padStart(2,'0');
function toISO(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function fromISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function todayISO(){ return toISO(new Date()); }
function addDays(d, n){ const nd = new Date(d); nd.setDate(nd.getDate()+n); return nd; }
function isoAddDays(iso, n){ return toISO(addDays(fromISO(iso), n)); }
function daysBetween(aISO, bISO){ return Math.round((fromISO(bISO) - fromISO(aISO)) / 86400000); }
function mondayOf(d){ const nd = new Date(d); const day = nd.getDay(); const diff = (day===0? -6 : 1-day); nd.setDate(nd.getDate()+diff); nd.setHours(0,0,0,0); return nd; }
const DOW_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function humanDate(iso){
  const d = fromISO(iso);
  return `${DOW_SHORT[(d.getDay()+6)%7]} ${d.getDate()} ${d.toLocaleString('en-GB',{month:'short'})}`;
}
function humanDateShort(iso){
  const d = fromISO(iso);
  return `${d.getDate()} ${d.toLocaleString('en-GB',{month:'short'})}`;
}
function monthLabel(d){ return d.toLocaleString('en-GB',{month:'long', year:'numeric'}); }

/* ---------------- zone metadata (dynamic — see Settings > Technician zones) ---------------- */
const UNZONED = { key:'', label:'Unzoned', color:'#9A9689', soloRequired:false };
function zoneList(){ return state.cache.zones || []; }
function zoneByKey(key){
  if(!key) return UNZONED;
  return zoneList().find(z=>z.key===key) || UNZONED;
}
function renderZoneKeySidebar(){
  const el = document.getElementById('zoneKeyList');
  if(!el) return;
  el.innerHTML = zoneList().map(z=>`<div class="river-key-row"><span class="dot" style="background:${z.color};"></span>${escapeHTML(z.label)}</div>`).join('')
    || `<div class="river-key-row" style="color:#8A8578;">No zones yet</div>`;
}
/* ---------------- event type metadata (dynamic — see Settings > Event types) ---------------- */
const FALLBACK_EVENT_TYPE = { key:'other', label:'Other / admin', short:'Other', color:'#2C6E8C', isSystem:true };
const EMAIL_STYLES = { formal:'Formal', relaxed:'Relaxed', friendly:'Friendly' };
const EMAIL_AUDIENCES = { slt:'SLT', smt:'SMT', middle_mgmt:'Middle Mgmt', my_team:'My Team', client:'Client', supplier:'Supplier', other:'Other' };
function eventTypeList(){ return state.cache.eventTypes || []; }
function eventTypeByKey(key){
  return eventTypeList().find(t=>t.key===key) || FALLBACK_EVENT_TYPE;
}

/* ---------------- app state ---------------- */
const state = {
  route: 'dashboard',
  weekStart: mondayOf(new Date()),
  techFilter: 'all',
  siteFilter: 'all',
  searchQuery: '',
  searchTypeFilter: 'all',
  searchTimeFilter: 'all',
  fleetCheckTab: 'daily',
  fleetCheckDate: new Date(),
  fleetCheckMonth: new Date(),
  reportsRange: 'month',
  todoFilter: 'open',
  todoViewMode: 'day',
  composeNotes: '',
  composeStep: 'input', // 'input' | 'drafting' | 'result'
  composeView: 'new', // 'new' | 'saved'
  composeDraft: null, // { subject, body }
  composeReplyContext: '', // full context built from the analysis (text + summary + action points), when arriving via "Draft a reply" — deliberately never includes raw attachment/file content
  composeReplyPreview: '', // short human-readable preview shown in the banner
  assistantText: '',
  assistantInstruction: '',
  assistantFiles: [], // [{ name, kind: 'pdf'|'image'|'text', data/mediaType or extractedText }]
  assistantStep: 'input', // 'input' | 'analysing' | 'result'
  assistantResult: null, // { summary, actionPoints }
  assistantView: 'new', // 'new' | 'saved'
  todoViewDate: new Date(),
  cache: { technicians:[], sites:[], events:[], settings:null, recurringBlocks:[], huddleAttendance:[], fleetcheckRecords:[], todos:[], zones:[], eventTypes:[], emailVoiceSamples:[], emailDrafts:[], contentAnalyses:[] },
};

async function refreshCache(){
  const [technicians, sites, events, settings, recurringBlocks, huddleAttendance, fleetcheckRecords, todos, zones, eventTypes, emailVoiceSamples, emailDrafts, contentAnalyses] = await Promise.all([
    DB.getAll('technicians'), DB.getAll('sites'), DB.getAll('events'), DB.get('settings','settings'), DB.getAll('recurring_blocks'), DB.getAll('huddle_attendance'), DB.getAll('fleetcheck_records'), DB.getAll('todos'), DB.getAll('zones'), DB.getAll('event_types'), DB.getAll('email_voice_samples'), DB.getAll('email_drafts'), DB.getAll('content_analyses')
  ]);
  technicians.sort((a,b)=>a.name.localeCompare(b.name));
  sites.sort((a,b)=>a.name.localeCompare(b.name));
  events.sort((a,b)=>a.date.localeCompare(b.date));
  recurringBlocks.sort((a,b)=>a.weekday-b.weekday);
  todos.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt)); // newest first
  zones.sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
  eventTypes.sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
  emailVoiceSamples.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  emailDrafts.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt)); // newest first
  contentAnalyses.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt)); // newest first
  state.cache = { technicians, sites, events, settings, recurringBlocks, huddleAttendance, fleetcheckRecords, todos, zones, eventTypes, emailVoiceSamples, emailDrafts, contentAnalyses };
}

/* ---------------- status / KPI computation ---------------- */
function lastEventFor(events, matcher){
  let best = null;
  for(const e of events){
    if(!matcher(e)) continue;
    if(e.date > todayISO()) continue; // only count events up to today
    if(!e.completed) continue; // only a confirmed-complete visit satisfies the requirement
    if(!best || e.date > best.date) best = e;
  }
  return best;
}
function nextEventFor(events, matcher){
  let best = null;
  for(const e of events){
    if(!matcher(e)) continue;
    if(e.date < todayISO()) continue; // only future/today events count as "scheduled"
    if(!best || e.date < best.date) best = e;
  }
  return best;
}

function statusFor(lastISO, freqDays, createdAtISO, nextScheduledISO){
  const today = todayISO();
  const neverLogged = !lastISO;
  // If never logged, the clock starts from when the record was added (a fair grace period)
  // rather than flagging brand-new technicians/sites as instantly overdue.
  const anchor = lastISO || (createdAtISO ? createdAtISO.slice(0,10) : today);
  const dueISO = isoAddDays(anchor, freqDays);
  const diff = daysBetween(today, dueISO); // days until due (negative = overdue)
  // A visit already on the board (even in the future) means nothing needs chasing right now —
  // surface it as "scheduled" rather than an alarming/uninformative overdue or never-logged badge.
  if(nextScheduledISO && (neverLogged || diff <= 7)){
    return { state:'scheduled', lastISO, dueISO, scheduledISO: nextScheduledISO, overdueBy:0, neverLogged, label:`Scheduled ${humanDateShort(nextScheduledISO)}` };
  }
  const prefix = neverLogged ? 'Never logged — ' : '';
  if(diff < 0) return { state:'overdue', lastISO, dueISO, overdueBy:-diff, neverLogged, label:`${prefix}Overdue by ${-diff}d` };
  if(diff <= 7) return { state:'due', lastISO, dueISO, overdueBy:0, neverLogged, label: `${prefix}${diff===0 ? 'Due today' : `Due in ${diff}d`}` };
  return { state:'ok', lastISO, dueISO, overdueBy:0, neverLogged, label:`${prefix}Due ${humanDateShort(dueISO)}` };
}

function techVisitStatus(tech){
  const last = lastEventFor(state.cache.events, e => e.type==='techVisit' && e.technicianId===tech.id);
  const next = nextEventFor(state.cache.events, e => e.type==='techVisit' && e.technicianId===tech.id);
  return statusFor(last?.date, tech.techFrequencyDays||30, tech.createdAt, next?.date);
}
function oneOnOneStatus(tech){
  const last = lastEventFor(state.cache.events, e => e.type==='oneOnOne' && e.technicianId===tech.id);
  const next = nextEventFor(state.cache.events, e => e.type==='oneOnOne' && e.technicianId===tech.id);
  return statusFor(last?.date, tech.oneOnOneFrequencyDays||30, tech.createdAt, next?.date);
}
function siteQAStatus(site){
  if(!site.qaFrequencyDays) return null; // no fixed schedule
  const last = lastEventFor(state.cache.events, e => e.type==='qaVisit' && e.siteId===site.id);
  const next = nextEventFor(state.cache.events, e => e.type==='qaVisit' && e.siteId===site.id);
  return statusFor(last?.date, site.qaFrequencyDays, site.createdAt, next?.date);
}

function weekEvents(weekStartDate){
  const startISO = toISO(weekStartDate);
  const endISO = toISO(addDays(weekStartDate,6));
  return state.cache.events.filter(e => e.date >= startISO && e.date <= endISO);
}
function weeklyKPI(weekStartDate){
  const evs = weekEvents(weekStartDate);
  const count = t => evs.filter(e=>e.type===t).length;
  return {
    techVisits: count('techVisit'),
    qaVisits: count('qaVisit'),
    oneOnOnes: count('oneOnOne'),
    evs
  };
}

/* ---------------- generic helpers ---------------- */
function techName(id){ const t = state.cache.technicians.find(x=>x.id===id); return t? t.name : null; }
function siteName(id){ const s = state.cache.sites.find(x=>x.id===id); return s? s.name : null; }
function regionBadge(region){
  const z = zoneByKey(region);
  return `<span class="badge" style="background:color-mix(in srgb, ${z.color} 18%, white); color:${z.color};">${escapeHTML(z.label)}</span>`;
}
function escapeHTML(s){ return (s??'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, 2400);
}

/* ---------------- modal ---------------- */
function showModal(titleHTML, bodyHTML, footHTML, opts){
  const backdrop = document.getElementById('modalBackdrop');
  const modal = document.getElementById('modal');
  modal.className = (opts && opts.wide) ? 'modal modal-wide' : 'modal';
  modal.innerHTML = `
    <div class="modal-head"><h3>${titleHTML}</h3><button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button></div>
    <div class="modal-body">${bodyHTML}</div>
    <div class="modal-foot">${footHTML||''}</div>
  `;
  backdrop.hidden = false;
  document.getElementById('modalCloseBtn').onclick = closeModal;
  backdrop.onclick = (e)=>{ if(e.target===backdrop) closeModal(); };
}
function closeModal(){ document.getElementById('modalBackdrop').hidden = true; }

/* ---------------- routing ---------------- */
const ROUTE_TITLES = { dashboard:'Dashboard', todos:'To-Do', compose:'Compose', assistant:'Assistant', schedule:'Weekly board', technicians:'Technicians', sites:'Client sites', fleetcheck:'FleetCheck', reports:'Reports', search:'Search', settings:'Settings' };

function navigate(route){
  state.route = route;
  location.hash = route;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.route===route));
  document.getElementById('topbarTitle').textContent = ROUTE_TITLES[route] || '';
  document.getElementById('app').classList.remove('nav-open');
  document.getElementById('topbarSettings').hidden = !(route === 'todos' || route === 'compose' || route === 'assistant');
  render();
}

async function render(){
  const main = document.getElementById('main');
  await refreshCache();
  renderZoneKeySidebar();
  if(state.route === 'schedule' || state.route === 'dashboard'){
    const created = await materializeRecurringBlocks(toISO(state.weekStart), toISO(addDays(state.weekStart,6)));
    if(created) await refreshCache();
  }
  switch(state.route){
    case 'dashboard': main.innerHTML = renderDashboard(); mountDashboard(); break;
    case 'todos': main.innerHTML = renderTodos(); mountTodos(); break;
    case 'compose': main.innerHTML = renderCompose(); mountCompose(); break;
    case 'assistant': main.innerHTML = renderAssistant(); mountAssistant(); break;
    case 'schedule': main.innerHTML = renderSchedule(); mountSchedule(); break;
    case 'technicians': main.innerHTML = renderTechnicians(); mountTechnicians(); break;
    case 'sites': main.innerHTML = renderSites(); mountSites(); break;
    case 'fleetcheck': main.innerHTML = renderFleetCheck(); mountFleetCheck(); break;
    case 'reports': main.innerHTML = renderReports(); mountReports(); break;
    case 'search': main.innerHTML = renderSearch(); mountSearch(); break;
    case 'settings': main.innerHTML = renderSettings(); mountSettings(); break;
    default: main.innerHTML = renderDashboard(); mountDashboard();
  }
}

/* ================= DASHBOARD ================= */
function renderDashboard(){
  const techs = state.cache.technicians.filter(t=>t.active);
  const sites = state.cache.sites.filter(s=>s.active);
  const kpi = weeklyKPI(state.weekStart);
  const s = state.cache.settings || { techVisitsPerWeekMin:3, qaVisitsPerWeekMin:4 };
  const totalEvents = state.cache.events.length;

  const techStatuses = techs.map(t=>({ t, tv: techVisitStatus(t), oo: oneOnOneStatus(t) }));
  const overdueTech = techStatuses.filter(x=>x.tv.state==='overdue' || x.oo.state==='overdue');
  const dueSoonTech = techStatuses.filter(x=> (x.tv.state==='due' || x.oo.state==='due') && !(x.tv.state==='overdue'||x.oo.state==='overdue'));

  const siteStatuses = sites.map(s=>({ s, qa: siteQAStatus(s) })).filter(x=>x.qa);
  const overdueSite = siteStatuses.filter(x=>x.qa.state==='overdue');
  const dueSoonSite = siteStatuses.filter(x=>x.qa.state==='due');

  const pct = (v,min) => Math.min(100, Math.round((v/Math.max(min,1))*100));

  function watchRow(name, sub, badgeHTML, onDataset){
    return `<div class="watch-row" ${onDataset}>
      <div><div class="watch-name">${escapeHTML(name)}</div><div class="watch-meta">${sub}</div></div>
      <div class="watch-spacer"></div>${badgeHTML}
    </div>`;
  }

  const overdueTechRows = overdueTech.length ? overdueTech.map(x=>{
    const bits = [];
    if(x.tv.state==='overdue') bits.push(`Tech visit ${x.tv.label.toLowerCase()}`);
    if(x.oo.state==='overdue') bits.push(`1-1 ${x.oo.label.toLowerCase()}`);
    return watchRow(x.t.name, bits.join(' · '), `<span class="badge badge-overdue">Overdue</span>`, `data-open-tech="${x.t.id}"`);
  }).join('') : `<div class="empty" style="padding:22px;"><p>Nothing overdue. Nicely kept.</p></div>`;

  const dueSoonTechRows = dueSoonTech.length ? dueSoonTech.map(x=>{
    const bits = [];
    if(x.tv.state==='due') bits.push(`Tech visit ${x.tv.label.toLowerCase()}`);
    if(x.oo.state==='due') bits.push(`1-1 ${x.oo.label.toLowerCase()}`);
    return watchRow(x.t.name, bits.join(' · '), `<span class="badge badge-due">Due soon</span>`, `data-open-tech="${x.t.id}"`);
  }).join('') : `<div class="empty" style="padding:22px;"><p>Nothing due in the next 7 days.</p></div>`;

  const overdueSiteRows = overdueSite.length ? overdueSite.map(x=>
    watchRow(x.s.name, `QA visit ${x.qa.label.toLowerCase()}`, `<span class="badge badge-overdue">Overdue</span>`, `data-open-site="${x.s.id}"`)
  ).join('') : `<div class="empty" style="padding:22px;"><p>No QA sites overdue.</p></div>`;

  const dueSoonSiteRows = dueSoonSite.length ? dueSoonSite.map(x=>
    watchRow(x.s.name, `QA visit ${x.qa.label.toLowerCase()}`, `<span class="badge badge-due">Due soon</span>`, `data-open-site="${x.s.id}"`)
  ).join('') : '';

  const missedEvents = state.cache.events
    .filter(e=> e.date < todayISO() && !e.completed && ['techVisit','qaVisit','oneOnOne'].includes(e.type))
    .sort((a,b)=> a.date.localeCompare(b.date));
  const unreviewedHuddles = state.cache.events
    .filter(e=> e.type==='block' && e.date<=todayISO() && !state.cache.huddleAttendance.some(a=>a.eventId===e.id))
    .sort((a,b)=> a.date.localeCompare(b.date));

  // FleetCheck: nudge about TODAY's daily checks and THIS MONTH's monthly checks only —
  // unlike visits/huddles, these are rolling admin tasks rather than dated occurrences, so we
  // don't want a growing backlog of every missed day piling up here.
  const todayStr = todayISO();
  const monthStr = todayStr.slice(0,7);
  const drivers = state.cache.technicians.filter(t=>t.isDriver && t.active);
  const todayIsoDow = (()=>{ const d = new Date().getDay(); return d===0?7:d; })();
  const driversNeedingDaily = drivers.filter(d=>{
    const workDays = (d.workDays && d.workDays.length) ? d.workDays : [1,2,3,4,5];
    if(!workDays.includes(todayIsoDow)) return false;
    const onLeave = state.cache.events.some(e=>e.type==='techAbsence' && e.technicianId===d.id && e.date===todayStr);
    if(onLeave) return false;
    return !state.cache.fleetcheckRecords.some(r=>r.technicianId===d.id && r.checkType==='daily' && r.period===todayStr);
  });
  const driversNeedingMonthly = drivers.filter(d=>
    !state.cache.fleetcheckRecords.some(r=>r.technicianId===d.id && r.checkType==='monthly' && r.period===monthStr)
  );

  const outstandingCount = missedEvents.length + unreviewedHuddles.length + driversNeedingDaily.length + driversNeedingMonthly.length;
  const outstandingRows = missedEvents.slice(0,8).map(e=>{
    const t = eventTypeByKey(e.type);
    const who = e.technicianId ? techName(e.technicianId) : null;
    const where = e.siteId ? siteName(e.siteId) : null;
    const label = e.title || who || where || t.label;
    return `<div class="watch-row" data-open-event="${e.id}">
      <div><div class="watch-name">${escapeHTML(label)}</div><div class="watch-meta">${t.label} · was due ${humanDate(e.date)}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-toggle-complete="${e.id}">Mark done</button>
    </div>`;
  }).join('') + unreviewedHuddles.slice(0,8).map(e=>{
    return `<div class="watch-row" data-open-event="${e.id}">
      <div><div class="watch-name">${escapeHTML(e.title||'Huddle')}</div><div class="watch-meta">Attendance not recorded · was on ${humanDate(e.date)}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-mark-attendance="${e.id}">Mark attendance</button>
    </div>`;
  }).join('')
    + (driversNeedingDaily.length ? `<div class="watch-row">
      <div><div class="watch-name">Daily FleetCheck</div><div class="watch-meta">${driversNeedingDaily.length} driver${driversNeedingDaily.length===1?'':'s'} still need today's check · ${driversNeedingDaily.map(d=>escapeHTML(d.name)).join(', ')}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-goto-fleetcheck="daily">Go to FleetCheck</button>
    </div>` : '')
    + (driversNeedingMonthly.length ? `<div class="watch-row">
      <div><div class="watch-name">Monthly FleetCheck</div><div class="watch-meta">${driversNeedingMonthly.length} driver${driversNeedingMonthly.length===1?'':'s'} still need this month's check · ${driversNeedingMonthly.map(d=>escapeHTML(d.name)).join(', ')}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-goto-fleetcheck="monthly">Go to FleetCheck</button>
    </div>` : '')
    + (missedEvents.length+unreviewedHuddles.length>8 ? `<div style="padding:10px 12px;"><a href="#search" data-goto-missed="1" style="font-size:12px;color:var(--forest-dim);font-weight:600;">View all ${missedEvents.length+unreviewedHuddles.length} outstanding visits/huddles →</a></div>` : '');
  const outstandingHTML = outstandingCount ? outstandingRows : `<div class="empty" style="padding:22px;"><p>Nothing outstanding — everything logged is confirmed done.</p></div>`;

  const dueTodos = state.cache.todos.filter(t=>!t.completed && (
    (t.dueDate && t.dueDate<=todayISO()) || (t.alertAt && new Date(t.alertAt)<=new Date())
  )).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  const todoRowsHTML = dueTodos.length ? dueTodos.slice(0,6).map(t=>`
    <div class="watch-row">
      <button class="et-check" data-toggle-todo="${t.id}" title="Mark done">✓</button>
      <div><div class="watch-name">${escapeHTML(t.text)}</div><div class="watch-meta">${todoDueBadge(t)||''}${t.alertAt?' ⏰':''}</div></div>
    </div>
  `).join('') + `<div style="padding:8px 12px 4px;"><button class="btn btn-outline btn-small" data-goto-todos="1">Open To-Do${dueTodos.length>6?` (${dueTodos.length})`:''}</button></div>`
    : `<div class="empty" style="padding:22px;"><p>Nothing due — <button class="icon-btn" data-goto-todos="1" style="display:inline;">open To-Do</button> to add a task.</p></div>`;

  return `
  <div class="view-head">
    <div>
      <h1>Dashboard</h1>
      <div class="view-sub">Week of ${humanDate(toISO(state.weekStart))} — overview across ${techs.length} technician${techs.length===1?'':'s'} and ${sites.length} client site${sites.length===1?'':'s'}</div>
    </div>
    <div class="view-actions">
      <button class="btn btn-outline" id="openWeeklyBoardBtn">Open weekly board</button>
      <button class="btn" id="dashAddEvent">+ Log a visit</button>
    </div>
  </div>

  ${totalEvents===0 ? `
  <div class="card card-pad" style="margin-bottom:22px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; border-left:3px solid var(--forest-dim);">
    <div>
      <h3 style="font-size:15px;margin-bottom:4px;">Nothing on the board yet</h3>
      <p style="font-size:12.5px;color:var(--text-dim);max-width:520px;">
        Generate a schedule to fill in tech visits, QA visits and 1-1s against your monthly and weekly targets —
        it groups technicians by zone and puts 1-1s on your WFH day automatically.
      </p>
    </div>
    <button class="btn" id="dashGenerate">✦ Generate schedule</button>
  </div>` : ''}

  <div class="kpi-grid">
    <div class="card kpi-card">
      <div class="kpi-label">Tech visits this week</div>
      <div class="kpi-value">${kpi.techVisits} <span style="font-size:15px;color:var(--text-dim);">/ ${s.techVisitsPerWeekMin} min</span></div>
      <div class="kpi-bar"><div class="kpi-bar-fill ${kpi.techVisits<s.techVisitsPerWeekMin?'short':''}" style="width:${pct(kpi.techVisits,s.techVisitsPerWeekMin)}%"></div></div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">QA visits this week</div>
      <div class="kpi-value">${kpi.qaVisits} <span style="font-size:15px;color:var(--text-dim);">/ ${s.qaVisitsPerWeekMin} min</span></div>
      <div class="kpi-bar"><div class="kpi-bar-fill ${kpi.qaVisits<s.qaVisitsPerWeekMin?'short':''}" style="width:${pct(kpi.qaVisits,s.qaVisitsPerWeekMin)}%"></div></div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">1-1s logged this week</div>
      <div class="kpi-value">${kpi.oneOnOnes}</div>
      <div class="kpi-note">${overdueTech.filter(x=>x.oo.state==='overdue').length} technician(s) overdue a 1-1 overall</div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">To-Do due</div>
      <div class="kpi-value" style="color:${dueTodos.length?'var(--clay)':'var(--ink)'}">${dueTodos.length}</div>
      <div class="kpi-note">Open tasks due today or earlier</div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">Outstanding</div>
      <div class="kpi-value" style="color:${outstandingCount?'var(--clay)':'var(--ink)'}">${outstandingCount}</div>
      <div class="kpi-note">Visits not confirmed done · huddles not reviewed</div>
    </div>
    <div class="card kpi-card">
      <div class="kpi-label">Overdue items</div>
      <div class="kpi-value" style="color:${(overdueTech.length+overdueSite.length)?'var(--clay)':'var(--ink)'}">${overdueTech.length+overdueSite.length}</div>
      <div class="kpi-note">${overdueTech.length} technician · ${overdueSite.length} site</div>
    </div>
  </div>

  <div class="dash-grid">
    <div>
      <div class="card" style="margin-bottom:16px;">
        <div class="panel-title"><h3>To-Do</h3></div>
        <div class="panel-body">${todoRowsHTML}</div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="panel-title"><h3>Outstanding — needs confirming</h3></div>
        <div class="panel-body">${outstandingHTML}</div>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="panel-title"><h3>Overdue — technicians</h3></div>
        <div class="panel-body">${overdueTechRows}</div>
      </div>
      <div class="card">
        <div class="panel-title"><h3>Overdue — QA sites</h3></div>
        <div class="panel-body">${overdueSiteRows}</div>
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:16px;">
        <div class="panel-title"><h3>Due within 7 days</h3></div>
        <div class="panel-body">${dueSoonTechRows}${dueSoonSiteRows}</div>
      </div>
      <div class="card">
        <div class="panel-title"><h3>Zone key</h3></div>
        <div class="panel-body" style="padding:14px 18px;">
          <p style="font-size:12.5px;color:var(--text-dim);line-height:1.7;">
            Technicians are grouped by zone, so you can plan back-to-back visits without crossing town.
            Edit your zones any time in Settings.<br><br>
            ${zoneList().map(z=>{
              const members = state.cache.technicians.filter(t=>t.active && t.region===z.key).map(t=>escapeHTML(t.name.split(' ')[0])).join(' · ');
              return `${regionBadge(z.key)} ${members || '<span style="color:var(--text-faint);">No technicians yet</span>'}<br><br>`;
            }).join('')}
          </p>
        </div>
      </div>
    </div>
  </div>
  `;
}
function mountDashboard(){
  document.getElementById('openWeeklyBoardBtn')?.addEventListener('click', ()=>navigate('schedule'));
  document.getElementById('dashAddEvent')?.addEventListener('click', ()=>openEventForm({ date: todayISO() }));
  document.getElementById('dashGenerate')?.addEventListener('click', ()=>openGenerateModal());
  document.querySelectorAll('[data-open-tech]').forEach(el=>el.addEventListener('click', ()=>openTechnicianForm(Number(el.dataset.openTech))));
  document.querySelectorAll('[data-open-site]').forEach(el=>el.addEventListener('click', ()=>openSiteForm(Number(el.dataset.openSite))));
  document.querySelectorAll('[data-open-event]').forEach(el=>el.addEventListener('click', ()=>openEventForm(null, Number(el.dataset.openEvent))));
  document.querySelectorAll('[data-toggle-complete]').forEach(b=>b.addEventListener('click', (e)=>{
    e.stopPropagation();
    toggleEventComplete(Number(b.dataset.toggleComplete));
  }));
  document.querySelectorAll('[data-mark-attendance]').forEach(b=>b.addEventListener('click', (e)=>{
    e.stopPropagation();
    openEventForm(null, Number(b.dataset.markAttendance));
  }));
  document.querySelectorAll('[data-goto-fleetcheck]').forEach(b=>b.addEventListener('click', ()=>{
    state.fleetCheckTab = b.dataset.gotoFleetcheck;
    state.fleetCheckDate = new Date();
    state.fleetCheckMonth = new Date();
    navigate('fleetcheck');
  }));
  document.querySelectorAll('[data-goto-todos]').forEach(b=>b.addEventListener('click', ()=>navigate('todos')));
  document.querySelectorAll('[data-toggle-todo]').forEach(b=>b.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const t = state.cache.todos.find(x=>x.id===Number(b.dataset.toggleTodo));
    if(!t) return;
    await DB.put('todos', { ...t, completed: !t.completed });
    render();
  }));
  document.querySelector('[data-goto-missed]')?.addEventListener('click', (e)=>{
    e.preventDefault();
    state.searchTimeFilter = 'missed';
    state.searchTypeFilter = 'all';
    state.searchQuery = '';
    navigate('search');
  });
}

/* ================= WEEKLY BOARD ================= */
function renderSchedule(){
  const ws = state.weekStart;
  const days = Array.from({length:7}, (_,i)=>addDays(ws,i));
  const todayIso = todayISO();
  const s = state.cache.settings || { wfhWeekday:3 };

  const dayCols = days.map((d,i)=>{
    const iso = toISO(d);
    const isToday = iso === todayIso;
    const isWeekend = i>=5;
    const evs = state.cache.events.filter(e=>e.date===iso && e.type!=='techAbsence').sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const evHTML = evs.map(e=>eventTagHTML(e)).join('');
    return `
    <div class="day-sheet ${isToday?'is-today':''} ${isWeekend?'is-weekend':''}">
      <div class="day-head">
        <div><div class="day-name">${DOW_SHORT[i]}${(i+1)===s.wfhWeekday?' · WFH':''}</div><div class="day-num">${d.getDate()}</div></div>
      </div>
      <div class="day-events">${evHTML}</div>
      <button class="day-add" data-add-day="${iso}">+ Add</button>
    </div>`;
  }).join('');

  return `
  <div class="view-head">
    <div>
      <h1>Weekly board</h1>
      <div class="view-sub">${monthLabel(ws)} — plan tech visits, QA visits and 1-1s across the week</div>
    </div>
    <div class="view-actions">
      <div class="week-nav">
        <button class="btn btn-outline" id="wkPrev">‹ Prev</button>
        <button class="btn btn-outline" id="wkToday">This week</button>
        <button class="btn btn-outline" id="wkNext">Next ›</button>
      </div>
      <button class="btn btn-outline" id="genScheduleBtn">✦ Generate schedule</button>
      <button class="btn btn-outline" id="exportBtn">⬇ Export</button>
      <button class="btn" id="addEventBtn">+ Add event</button>
    </div>
  </div>
  <div class="board">${dayCols}</div>
  `;
}
function eventTagHTML(e){
  const t = eventTypeByKey(e.type);
  const who = e.technicianId ? techName(e.technicianId) : null;
  const where = e.siteId ? siteName(e.siteId) : null;
  const title = e.title || who || where || t.label;
  const metaBits = [who && where ? where : null, e.time || null].filter(Boolean);
  const isMissed = !e.completed && e.date < todayISO();
  return `<div class="event-tag ${e.completed?'is-done':''} ${isMissed?'is-missed':''}" data-open-event="${e.id}" style="border-left-color:${t.color}; background:color-mix(in srgb, ${t.color} 12%, white);">
    <button class="et-check" data-toggle-complete="${e.id}" title="${e.completed?'Mark not done':'Mark done'}" aria-label="Toggle complete">✓</button>
    <div class="et-body">
      <div class="et-type">${t.short}${isMissed?' · Missed':''}</div>
      <div class="et-title">${escapeHTML(title)}</div>
      ${metaBits.length? `<div class="et-meta">${metaBits.map(escapeHTML).join(' · ')}</div>`:''}
    </div>
  </div>`;
}
async function toggleEventComplete(id){
  const ev = state.cache.events.find(e=>e.id===id);
  if(!ev) return;
  await DB.put('events', { ...ev, completed: !ev.completed });
  render();
}
function mountSchedule(){
  document.getElementById('wkPrev').addEventListener('click', ()=>{ state.weekStart = addDays(state.weekStart,-7); render(); });
  document.getElementById('wkNext').addEventListener('click', ()=>{ state.weekStart = addDays(state.weekStart,7); render(); });
  document.getElementById('wkToday').addEventListener('click', ()=>{ state.weekStart = mondayOf(new Date()); render(); });
  document.getElementById('addEventBtn').addEventListener('click', ()=>openEventForm({ date: toISO(state.weekStart) }));
  document.getElementById('genScheduleBtn').addEventListener('click', ()=>openGenerateModal());
  document.getElementById('exportBtn').addEventListener('click', ()=>openExportModal());
  document.querySelectorAll('[data-add-day]').forEach(b=>b.addEventListener('click', ()=>openEventForm({ date:b.dataset.addDay })));
  document.querySelectorAll('[data-open-event]').forEach(b=>b.addEventListener('click', ()=>openEventForm(null, Number(b.dataset.openEvent))));
  document.querySelectorAll('[data-toggle-complete]').forEach(b=>b.addEventListener('click', (e)=>{
    e.stopPropagation();
    toggleEventComplete(Number(b.dataset.toggleComplete));
  }));
  // on the mobile swipeable board, bring today's card into view automatically
  if(window.innerWidth <= 880){
    document.querySelector('.day-sheet.is-today')?.scrollIntoView({ inline:'center', block:'nearest' });
  }
}

/* ---------- event form ---------- */
function openEventForm(defaults, editId){
  const isEdit = !!editId;
  const existing = isEdit ? state.cache.events.find(e=>e.id===editId) : null;
  const v = existing || { date: defaults?.date || todayISO(), type:'techVisit', technicianId:'', siteId:'', title:'', time:'', notes:'', completed: (defaults?.date || todayISO()) <= todayISO() };

  const techOptions = state.cache.technicians.filter(t=>t.active).map(t=>`<option value="${t.id}" ${v.technicianId==t.id?'selected':''}>${escapeHTML(t.name)}</option>`).join('');
  const siteOptions = state.cache.sites.filter(s=>s.active).map(s=>`<option value="${s.id}" ${v.siteId==s.id?'selected':''}>${escapeHTML(s.name)}</option>`).join('');
  const typeOptions = eventTypeList().map(t=>`<option value="${t.key}" ${v.type===t.key?'selected':''}>${t.label}</option>`).join('');

  const activeTechs = state.cache.technicians.filter(t=>t.active);
  const attendedSet = isEdit ? new Set(state.cache.huddleAttendance.filter(a=>a.eventId===editId && a.attended).map(a=>a.technicianId)) : new Set();
  const attendanceRows = activeTechs.map(t=>{
    const onLeave = v.date && state.cache.events.some(e=>e.type==='techAbsence' && e.technicianId===t.id && e.date===v.date);
    const notWorkDay = v.date && !onLeave && !isTechWorkingOn(t, v.date);
    const tag = onLeave ? ' <span class="badge badge-neutral">On leave</span>' : notWorkDay ? ' <span class="badge badge-neutral">Not a work day</span>' : '';
    return `
    <label style="display:flex;align-items:center;gap:8px;font-weight:400;text-transform:none;padding:4px 0;font-size:13px;color:var(--text);">
      <input type="checkbox" class="fAttend" value="${t.id}" ${attendedSet.has(t.id)?'checked':''} style="width:auto;"> ${escapeHTML(t.name)}${tag}
    </label>`;
  }).join('');

  const body = `
    <div class="field-row">
      <div class="field"><label>Date</label><input type="date" id="fDate" value="${v.date}"></div>
      <div class="field"><label>Time (optional)</label><input type="time" id="fTime" value="${v.time||''}"></div>
    </div>
    <div class="field"><label>Type</label><select id="fType">${typeOptions}</select></div>
    <div class="field" id="fTechWrap"><label>Technician</label><select id="fTech"><option value="">—</option>${techOptions}</select></div>
    <div class="field" id="fSiteWrap"><label>Client site <span style="font-weight:400;text-transform:none;color:var(--text-faint);">(optional for QA — leave blank to fill in later)</span></label><select id="fSite"><option value="">—</option>${siteOptions}</select></div>
    <div class="field" id="fTitleWrap"><label>Label</label><input id="fTitle" placeholder="e.g. Site audit, troubleshooting…" value="${escapeHTML(v.title)}"></div>
    <div class="field"><label>Notes</label><textarea id="fNotes" placeholder="Jobs covered, outcomes, follow-ups…">${escapeHTML(v.notes)}</textarea></div>
    <div class="field"><label><input type="checkbox" id="fCompleted" ${v.completed?'checked':''} style="width:auto;"> Completed</label>
      <div class="freq-hint">Unticked visits in the past show up as "missed" and don't count toward monthly/QA cadence tracking.</div>
    </div>
    ${isEdit ? `
    <div class="field" id="fAttendanceWrap" style="display:none;border-top:1px solid var(--line-soft);padding-top:14px;">
      <label>Attendance</label>
      <div id="fAttendanceList" style="max-height:220px;overflow-y:auto;">${attendanceRows}</div>
      <div class="freq-hint">Tick who attended this one. Anyone tagged "On leave" or "Not a work day" isn't counted against them in the attendance report either way.</div>
    </div>` : ''}
  `;
  const foot = `
    ${isEdit ? `<button class="btn btn-danger" id="fDelete">Delete</button>` : `<span></span>`}
    <div class="modal-foot-right">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn" id="fSave">${isEdit?'Save changes':'Add to board'}</button>
    </div>
  `;
  showModal(isEdit ? 'Edit event' : 'Add event', body, foot);

  function syncVisibility(){
    const type = document.getElementById('fType').value;
    document.getElementById('fTechWrap').style.display = (type==='techVisit'||type==='oneOnOne'||type==='qaVisit') ? '' : 'none';
    document.getElementById('fSiteWrap').style.display = (type==='qaVisit'||type==='techVisit') ? '' : 'none';
    const attWrap = document.getElementById('fAttendanceWrap');
    if(attWrap) attWrap.style.display = (type==='block') ? '' : 'none';
  }
  document.getElementById('fType').addEventListener('change', syncVisibility);
  syncVisibility();

  document.getElementById('fCancel').addEventListener('click', closeModal);
  document.getElementById('fDelete')?.addEventListener('click', async ()=>{
    await DB.delete('events', editId);
    closeModal(); toast('Event deleted'); render();
  });
  document.getElementById('fSave').addEventListener('click', async ()=>{
    const type = document.getElementById('fType').value;
    const techId = document.getElementById('fTech').value;
    const siteId = document.getElementById('fSite').value;
    const obj = {
      date: document.getElementById('fDate').value,
      time: document.getElementById('fTime').value,
      type,
      technicianId: techId ? Number(techId) : null,
      siteId: siteId ? Number(siteId) : null,
      title: document.getElementById('fTitle').value.trim(),
      notes: document.getElementById('fNotes').value.trim(),
      completed: document.getElementById('fCompleted').checked,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if(!obj.date){ toast('Pick a date first'); return; }
    if((type==='techVisit'||type==='oneOnOne') && !obj.technicianId){ toast('Pick a technician'); return; }
    if(type==='qaVisit' && !obj.siteId && !obj.title){ obj.title = 'Site TBC'; }
    if(isEdit) obj.id = editId;
    await DB.put('events', obj);
    if(isEdit && type==='block'){
      const allAttendInputs = Array.from(document.querySelectorAll('.fAttend'));
      const existingRows = state.cache.huddleAttendance.filter(a=>a.eventId===editId);
      for(const row of existingRows) await DB.delete('huddle_attendance', row.id);
      // record every technician explicitly (attended true/false), not just the ones ticked —
      // that way "reviewed, nobody attended" is distinguishable from "never reviewed at all"
      for(const el of allAttendInputs){
        await DB.add('huddle_attendance', { eventId: editId, technicianId: Number(el.value), attended: el.checked });
      }
    }
    closeModal(); toast(isEdit? 'Event updated':'Event added'); render();
  });
}

/* ================= RECURRING BLOCKS ================= */
async function materializeRecurringBlocks(startISO, endISO){
  const templates = (state.cache.recurringBlocks || []).filter(b => b.active);
  if(!templates.length) return false;
  const existingKeys = new Set(
    state.cache.events
      .filter(e => e.type==='block' && e.date>=startISO && e.date<=endISO)
      .map(e => `${e.date}|${e.title}`)
  );
  const startD = fromISO(startISO);
  const totalDays = daysBetween(startISO, endISO) + 1;
  let created = false;
  for(let i=0;i<totalDays;i++){
    const d = addDays(startD, i);
    const iso = toISO(d);
    const dow = d.getDay(); const isoDow = dow===0?7:dow;
    for(const tmpl of templates){
      if(tmpl.weekday !== isoDow) continue;
      if(tmpl.startDate && iso < tmpl.startDate) continue;
      if(tmpl.endDate && iso > tmpl.endDate) continue;
      const key = `${iso}|${tmpl.label}`;
      if(existingKeys.has(key)) continue;
      await DB.add('events', { date:iso, type:'block', technicianId:null, siteId:null, time:tmpl.time||'', title:tmpl.label, notes:'', completed: iso<=todayISO(), createdAt:new Date().toISOString() });
      existingKeys.add(key);
      created = true;
    }
  }
  return created;
}

/* ---------- technician absences (holidays, sick days, etc.) ---------- */
function getTechAbsenceRanges(technicianId){
  const events = state.cache.events
    .filter(e => e.type==='techAbsence' && e.technicianId===technicianId)
    .sort((a,b)=>a.date.localeCompare(b.date));
  const ranges = [];
  for(const e of events){
    const category = e.absenceCategory || 'holiday';
    const last = ranges[ranges.length-1];
    if(last && last.category===category && isoAddDays(last.end,1)===e.date) last.end = e.date;
    else ranges.push({ start:e.date, end:e.date, category });
  }
  return ranges;
}
async function removeTechAbsenceRange(technicianId, start, end, category){
  const toDelete = state.cache.events.filter(e => e.type==='techAbsence' && e.technicianId===technicianId && e.date>=start && e.date<=end && (e.absenceCategory||'holiday')===category);
  for(const e of toDelete) await DB.delete('events', e.id);
  await refreshCache();
}
function openAbsenceForm(technicianId){
  const today = todayISO();
  const body = `
    <div class="field-row">
      <div class="field"><label>Start date</label><input type="date" id="absStart" value="${today}"></div>
      <div class="field"><label>End date</label><input type="date" id="absEnd" value="${today}"></div>
    </div>
    <div class="field"><label>Type</label>
      <select id="absCategory">
        <option value="holiday">Holiday / annual leave</option>
        <option value="absence">Absence (sickness, other unplanned)</option>
      </select>
    </div>
    <div class="field"><label>Label (optional)</label><input id="absLabel" placeholder="e.g. Annual leave, sick day…"></div>
    <div class="freq-hint">Only "Absence" counts toward the Bradford Score in Reports — holidays don't.</div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="absCancel">Cancel</button><button class="btn" id="absSave">Add</button></div>`;
  showModal('Add holiday / absence', body, foot);
  document.getElementById('absCancel').addEventListener('click', ()=>openTechnicianForm(technicianId));
  document.getElementById('absSave').addEventListener('click', async ()=>{
    const start = document.getElementById('absStart').value;
    const end = document.getElementById('absEnd').value;
    const label = document.getElementById('absLabel').value.trim();
    const category = document.getElementById('absCategory').value;
    if(!start || !end || start > end){ toast('Pick a valid date range'); return; }
    let d = start, guard = 0;
    while(d <= end && guard < 400){
      guard++;
      await DB.add('events', { date:d, type:'techAbsence', technicianId, siteId:null, time:'', title:label, notes:'', absenceCategory:category, completed: d<=todayISO(), createdAt:new Date().toISOString() });
      d = isoAddDays(d,1);
    }
    toast(category==='holiday' ? 'Holiday added' : 'Absence added');
    await refreshCache();
    openTechnicianForm(technicianId);
  });
}

/* ================= SCHEDULE GENERATOR =================
   Fills a date range with tech visits, QA visits and 1-1s:
   - every active technician gets at least one tech visit and one 1-1
     (using each technician's own frequency, most-overdue first)
   - every active QA site with a cadence gets at least one visit
   - weekly totals are topped up to meet the KPI minimums in Settings
   - technicians are grouped by zone so a day's visits sit close together
   - 1-1s are placed on the WFH day first (they're done over Teams)
   Existing entries are left in place unless "replace" is chosen; annual
   leave is always preserved.
   ========================================================= */
function openGenerateModal(){
  const defaultStart = toISO(mondayOf(state.weekStart));
  const body = `
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px;line-height:1.6;">
      Fills the board to hit your monthly and weekly targets — grouping technicians by zone so you're
      not crossing town, and putting 1-1s on your WFH day since those run over Teams. Existing entries
      are left alone unless you choose to replace them; annual leave is always kept.
    </p>
    <div class="field-row">
      <div class="field"><label>Start week (Monday)</label><input type="date" id="gStart" value="${defaultStart}"></div>
      <div class="field"><label>Number of weeks</label><input type="number" id="gWeeks" value="4" min="1" max="12"></div>
    </div>
    <div class="field"><label><input type="checkbox" id="gOverwrite" style="width:auto;"> Replace existing entries in this range</label></div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="gCancel">Cancel</button><button class="btn" id="gRun">Generate</button></div>`;
  showModal('Generate schedule', body, foot);
  document.getElementById('gCancel').addEventListener('click', closeModal);
  document.getElementById('gRun').addEventListener('click', async ()=>{
    const startVal = document.getElementById('gStart').value;
    if(!startVal){ toast('Pick a start date'); return; }
    const weeks = Math.max(1, Math.min(12, Number(document.getElementById('gWeeks').value)||4));
    const overwrite = document.getElementById('gOverwrite').checked;
    const startISO = toISO(mondayOf(fromISO(startVal)));
    const runBtn = document.getElementById('gRun');
    runBtn.disabled = true; runBtn.textContent = 'Generating…';
    const result = await generateSchedule({ startISO, weeks, overwrite });
    closeModal();
    state.weekStart = fromISO(startISO);
    toast(`Added ${result.techVisits} tech visits, ${result.qaVisits} QA visits, ${result.oneOnOnes} 1-1s`);
    navigate('schedule');
  });
}

async function generateSchedule({ startISO, weeks, overwrite }){
  await refreshCache();
  const settings = state.cache.settings || { wfhWeekday:3, techVisitsPerWeekMin:3, qaVisitsPerWeekMin:4 };
  const startD = fromISO(startISO);
  const totalDays = weeks*7;
  const endISO = toISO(addDays(startD, totalDays-1));

  if(overwrite){
    const toDelete = state.cache.events.filter(e=> e.date>=startISO && e.date<=endISO && e.type!=='leave');
    for(const e of toDelete) await DB.delete('events', e.id);
    await refreshCache();
  }

  const rangeEvents = state.cache.events.filter(e=> e.date>=startISO && e.date<=endISO);
  const leaveDates = new Set(rangeEvents.filter(e=>e.type==='leave').map(e=>e.date));

  // ---- build the working-day calendar for the range ----
  const days = [];
  for(let i=0;i<totalDays;i++){
    const d = addDays(startD,i);
    const dow = d.getDay(); // 0 Sun .. 6 Sat
    if(dow===0||dow===6) continue;
    const iso = toISO(d);
    if(leaveDates.has(iso)) continue;
    const mondayDow = dow===0?7:dow; // 1..7, Mon=1
    days.push({ iso, isWFH: mondayDow===settings.wfhWeekday, weekKey: toISO(mondayOf(d)) });
  }
  if(days.length===0) return { techVisits:0, qaVisits:0, oneOnOnes:0 };
  const workDays = days.filter(d=>!d.isWFH);
  const wfhDays = days.filter(d=>d.isWFH);
  const weekKeys = [...new Set(days.map(d=>d.weekKey))];
  const isoToWeek = {}; days.forEach(d=> isoToWeek[d.iso]=d.weekKey);
  const techById = {}; state.cache.technicians.forEach(t=> techById[t.id]=t);
  const absenceSet = new Set(
    state.cache.events.filter(e=>e.type==='techAbsence').map(e=>`${e.technicianId}|${e.date}`)
  );
  function isTechAvailable(tech, iso){
    if(!tech) return true;
    const d = fromISO(iso);
    const dow = d.getDay(); const isoDow = dow===0?7:dow;
    const workDays = (tech.workDays && tech.workDays.length) ? tech.workDays : [1,2,3,4,5];
    if(!workDays.includes(isoDow)) return false;
    if(absenceSet.has(`${tech.id}|${iso}`)) return false;
    return true;
  }

  const dayMap = {};
  days.forEach(d=> dayMap[d.iso] = { techIds:new Set(), siteIds:new Set(), ooTechIds:new Set(), techCount:0, qaCount:0, ooCount:0, soloLock:false, kind:null });
  const weeklyTechCount = {}; weekKeys.forEach(wk=> weeklyTechCount[wk]=0);
  const weeklyQACount = {}; weekKeys.forEach(wk=> weeklyQACount[wk]=0);
  const weeklyOOCount = {}; weekKeys.forEach(wk=> weeklyOOCount[wk]=0);
  rangeEvents.forEach(e=>{
    const dm = dayMap[e.date]; if(!dm) return;
    if(e.type==='techVisit'){
      dm.techCount++; if(e.technicianId) dm.techIds.add(e.technicianId);
      if(zoneByKey(techById[e.technicianId]?.region).soloRequired) dm.soloLock = true;
      dm.kind = 'tech';
      const wk = isoToWeek[e.date]; if(wk!=null) weeklyTechCount[wk] = (weeklyTechCount[wk]||0)+1;
    }
    if(e.type==='qaVisit'){
      dm.qaCount++; if(e.siteId) dm.siteIds.add(e.siteId);
      if(!dm.kind) dm.kind = 'qa';
      const wk = isoToWeek[e.date]; if(wk!=null) weeklyQACount[wk] = (weeklyQACount[wk]||0)+1;
    }
    if(e.type==='oneOnOne'){
      dm.ooCount++; if(e.technicianId) dm.ooTechIds.add(e.technicianId);
      const wk = isoToWeek[e.date]; if(wk!=null) weeklyOOCount[wk] = (weeklyOOCount[wk]||0)+1;
    }
  });

  // Tech visits and QA visits both cap out at the weekly KPI figure (it's a target, not a floor to
  // exceed); outside-London technicians always get a day to themselves; 1-1s cap at 2/day and at the
  // weekly max in Settings; a working day is either a tech-visit day or a QA-visit day, never both —
  // QA days can still take a 1-1 alongside, tech-visit days can't.
  const MAX_TECH_PER_DAY = 2;
  const MAX_QA_PER_DAY = 2; // soft cap — used when there's room to spread QA visits across days
  const QA_DAY_CAP_HARD = Math.max(MAX_QA_PER_DAY, settings.qaVisitsPerWeekMin); // relaxed cap so the
  // weekly QA target is always reachable even when tech visits (or outside-London solo days) have
  // claimed most of the week's days — matches real practice (e.g. 4 QA visits in a single day).
  const MAX_OO_PER_DAY = 2;
  const MAX_OO_PER_WEEK = settings.oneOnOnesPerWeekMax || 3;
  const OO_TIMES = ['10:00','11:30','13:00','14:30'];
  const generalSite = state.cache.sites.find(s=>s.isGeneral && s.active);

  const newEvents = [];
  function addEvent(iso, type, extra){
    const dm = dayMap[iso];
    if(!dm) return false;
    if(type==='techVisit'){
      const wk = isoToWeek[iso];
      if((weeklyTechCount[wk]||0) >= settings.techVisitsPerWeekMin) return false;
      if(dm.kind==='qa') return false; // keep tech-visit days separate from QA-visit days
      if(dm.soloLock) return false;
      const tech = techById[extra.technicianId];
      const isOutside = zoneByKey(tech?.region).soloRequired;
      if(!isTechAvailable(tech, iso)) return false;
      if(isOutside){ if(dm.techCount>0) return false; }
      else if(dm.techCount>=MAX_TECH_PER_DAY) return false;
      if(extra.technicianId && dm.techIds.has(extra.technicianId)) return false;
    } else if(type==='qaVisit'){
      const wk = isoToWeek[iso];
      if((weeklyQACount[wk]||0) >= settings.qaVisitsPerWeekMin) return false;
      if(dm.kind==='tech') return false; // keep QA-visit days separate from tech-visit days
      if(dm.qaCount>=(extra.relaxedCap?QA_DAY_CAP_HARD:MAX_QA_PER_DAY) || (extra.siteId && !extra.allowDuplicateSite && dm.siteIds.has(extra.siteId))) return false;
    } else if(type==='oneOnOne'){
      const wk = isoToWeek[iso];
      if((weeklyOOCount[wk]||0) >= MAX_OO_PER_WEEK) return false;
      if(dm.kind==='tech') return false; // 1-1s pair with QA days (or WFH), not tech-visit days
      if(!isTechAvailable(techById[extra.technicianId], iso)) return false;
      if(dm.ooCount>=MAX_OO_PER_DAY || (extra.technicianId && dm.ooTechIds.has(extra.technicianId))) return false;
    }
    newEvents.push({ date:iso, type, technicianId:extra.technicianId||null, siteId:extra.siteId||null, time:extra.time||'', title:extra.title||'', notes:'Auto-generated', completed: iso<=todayISO(), createdAt:new Date().toISOString() });
    if(type==='techVisit'){
      dm.techCount++; if(extra.technicianId) dm.techIds.add(extra.technicianId);
      if(zoneByKey(techById[extra.technicianId]?.region).soloRequired) dm.soloLock = true;
      dm.kind = 'tech';
      const wk = isoToWeek[iso]; weeklyTechCount[wk] = (weeklyTechCount[wk]||0)+1;
    }
    if(type==='qaVisit'){
      dm.qaCount++; if(extra.siteId) dm.siteIds.add(extra.siteId);
      if(!dm.kind) dm.kind = 'qa';
      const wk = isoToWeek[iso]; weeklyQACount[wk] = (weeklyQACount[wk]||0)+1;
    }
    if(type==='oneOnOne'){
      dm.ooCount++; if(extra.technicianId) dm.ooTechIds.add(extra.technicianId);
      const wk = isoToWeek[iso]; weeklyOOCount[wk] = (weeklyOOCount[wk]||0)+1;
    }
    return true;
  }

  const techs = state.cache.technicians.filter(t=>t.active);
  const sites = state.cache.sites.filter(s=>s.active && s.qaFrequencyDays && !s.isGeneral);

  /* ---- Tech visits: block-schedule by zone, most-overdue first (first pass = monthly cover) ---- */
  const regionOrder = [...zoneList().map(z=>z.key), '']; // '' = unzoned fallback bucket, processed last
  const tvBuckets = {}; regionOrder.forEach(k=>tvBuckets[k]=[]);
  techs.map(t=>({t, st:techVisitStatus(t)}))
    .sort((a,b)=> a.st.dueISO.localeCompare(b.st.dueISO))
    .forEach(x => { (tvBuckets[x.t.region] || tvBuckets['']).push(x); });

  if(workDays.length){
    let cursor = 0;
    for(const region of regionOrder){
      const bucket = tvBuckets[region];
      let guard = 0;
      while(bucket.length && guard < 5000){
        guard++;
        const day = workDays[cursor % workDays.length];
        const item = bucket[0];
        if(!isTechAvailable(item.t, day.iso)){
          // this person can't work today (contracted days / absence) — see if a regionmate can,
          // without burning the shared day-cursor everyone else relies on
          bucket.push(bucket.shift());
          if(bucket[0] === item) cursor++; // whole bucket tried today, nobody fits — move to next day
          if(cursor > workDays.length*8) break; // safety valve — out of room in this range
          continue;
        }
        if(addEvent(day.iso, 'techVisit', { technicianId:item.t.id })){
          bucket.shift();
          // fill this day up to the cap before moving on (outside-London solo days are full after one)
          if(dayMap[day.iso].techCount>=MAX_TECH_PER_DAY || dayMap[day.iso].soloLock) cursor++;
        } else {
          cursor++;
        }
        if(cursor > workDays.length*8) break; // safety valve — out of room in this range
      }
    }
    // top up weeks that are still under the weekly target (but never over it — addEvent enforces the cap)
    const topup = techs.map(t=>({t, st:techVisitStatus(t)})).sort((a,b)=> a.st.dueISO.localeCompare(b.st.dueISO));
    for(const wk of weekKeys){
      const weekDays = workDays.filter(d=>d.weekKey===wk);
      let qi=0, guard=0;
      while((weeklyTechCount[wk]||0) < settings.techVisitsPerWeekMin && guard<300 && weekDays.length){
        guard++;
        const item = topup[qi % topup.length]; qi++;
        const day = weekDays.find(d=>{
          const dm = dayMap[d.iso];
          if(dm.soloLock || dm.kind==='qa') return false;
          if(zoneByKey(item.t.region).soloRequired) return dm.techCount===0;
          return dm.techCount<MAX_TECH_PER_DAY && !dm.techIds.has(item.t.id);
        });
        if(!day) { if(qi>topup.length*3) break; continue; }
        addEvent(day.iso,'techVisit',{technicianId:item.t.id});
      }
    }
  }

  /* ---- QA visits: same zone block-scheduling, first pass = each due site once ---- */
  const qaBuckets = {}; regionOrder.forEach(k=>qaBuckets[k]=[]);
  sites.map(s=>({s, st:siteQAStatus(s)})).filter(x=>x.st)
    .sort((a,b)=> a.st.dueISO.localeCompare(b.st.dueISO))
    .forEach(x => { (qaBuckets[x.s.region] || qaBuckets['']).push(x); });

  if(workDays.length && sites.length){
    let cursor = 0;
    for(const region of regionOrder){
      const bucket = qaBuckets[region];
      let guard=0;
      while(bucket.length && cursor < workDays.length && guard<5000){
        guard++;
        const day = workDays[cursor % workDays.length];
        const item = bucket[0];
        if(addEvent(day.iso, 'qaVisit', { siteId:item.s.id })){
          bucket.shift();
          if(dayMap[day.iso].qaCount>=MAX_QA_PER_DAY) cursor++;
        } else {
          cursor++;
        }
        if(cursor > workDays.length*6) break;
      }
    }
  }
  // top up weeks under the weekly QA target: cycle real due sites first, then fall back to a
  // placeholder "site TBC" entry so the week still reflects the KPI once real sites are added.
  // Tries to spread across days first (soft cap), then stacks onto whichever day still has room
  // (relaxed cap) so the weekly target is always hit even when few non-tech days are available.
  if(workDays.length){
    const topupSites = sites.map(s=>({s, st:siteQAStatus(s)})).filter(x=>x.st).sort((a,b)=> a.st.dueISO.localeCompare(b.st.dueISO));
    for(const wk of weekKeys){
      const weekDays = workDays.filter(d=>d.weekKey===wk);
      if(!weekDays.length) continue;
      let qi=0, guard=0;
      while((weeklyQACount[wk]||0) < settings.qaVisitsPerWeekMin && guard<200){
        guard++;
        let placed = false;
        if(topupSites.length){
          const item = topupSites[qi % topupSites.length]; qi++;
          let day = weekDays.find(d=> dayMap[d.iso].kind!=='tech' && dayMap[d.iso].qaCount<MAX_QA_PER_DAY && !dayMap[d.iso].siteIds.has(item.s.id));
          let relaxedCap = false;
          if(!day){ day = weekDays.find(d=> dayMap[d.iso].kind!=='tech' && dayMap[d.iso].qaCount<QA_DAY_CAP_HARD && !dayMap[d.iso].siteIds.has(item.s.id)); relaxedCap = true; }
          if(day) placed = addEvent(day.iso,'qaVisit',{siteId:item.s.id, relaxedCap});
        }
        if(!placed){
          let day = weekDays.find(d=> dayMap[d.iso].kind!=='tech' && dayMap[d.iso].qaCount<MAX_QA_PER_DAY);
          let relaxedCap = false;
          if(!day){ day = weekDays.find(d=> dayMap[d.iso].kind!=='tech' && dayMap[d.iso].qaCount<QA_DAY_CAP_HARD); relaxedCap = true; }
          if(!day) break;
          const extra = generalSite
            ? { siteId:generalSite.id, allowDuplicateSite:true, relaxedCap }
            : { siteId:null, title:'Site TBC', relaxedCap };
          if(!addEvent(day.iso,'qaVisit',extra)) break;
        }
      }
    }
  }

  /* ---- 1-1s: WFH day first (Teams call), spill onto working days if needed — capped at 2/day ----
     A technician unavailable that day (contracted days / absence) is skipped in favour of the next
     queued person, rather than stalling the whole slot. */
  const ooQueue = techs.map(t=>({t, st:oneOnOneStatus(t)})).sort((a,b)=> a.st.dueISO.localeCompare(b.st.dueISO));
  for(const wfhDay of wfhDays){
    let timeIdx = 0;
    let attempts = 0;
    while(ooQueue.length && dayMap[wfhDay.iso].ooCount < MAX_OO_PER_DAY && attempts < ooQueue.length){
      const item = ooQueue[attempts];
      if(addEvent(wfhDay.iso, 'oneOnOne', { technicianId:item.t.id, time:OO_TIMES[timeIdx % OO_TIMES.length] })){
        ooQueue.splice(attempts, 1);
        timeIdx++;
        attempts = 0; // queue shifted — restart the scan from the front
      } else {
        attempts++;
      }
    }
  }
  if(ooQueue.length && workDays.length){
    // prefer days that already have a QA visit (they pair well); then any day that isn't a tech-visit day
    const qaKindDays = workDays.filter(d=>dayMap[d.iso].kind==='qa');
    const freeDays = workDays.filter(d=>!dayMap[d.iso].kind);
    const spillOrder = [...qaKindDays, ...freeDays];
    if(spillOrder.length){
      let stuck = 0;
      while(ooQueue.length && stuck < ooQueue.length){
        const item = ooQueue[0];
        let placed = false;
        for(const day of spillOrder){
          if(addEvent(day.iso, 'oneOnOne', { technicianId:item.t.id })){ placed = true; break; }
        }
        if(placed){ ooQueue.shift(); stuck = 0; }
        else { ooQueue.push(ooQueue.shift()); stuck++; } // can't fit this one anywhere — try the next person
      }
    }
  }

  for(const ev of newEvents) await DB.add('events', ev);

  return {
    techVisits: newEvents.filter(e=>e.type==='techVisit').length,
    qaVisits: newEvents.filter(e=>e.type==='qaVisit').length,
    oneOnOnes: newEvents.filter(e=>e.type==='oneOnOne').length,
  };
}

/* ================= EXPORT ================= */
const EXPORT_LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  jspdfAutotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
};
const _loadedScripts = {};
function loadScriptOnce(src){
  return new Promise((resolve, reject)=>{
    if(_loadedScripts[src]){ resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = ()=>{ _loadedScripts[src] = true; resolve(); };
    s.onerror = ()=>reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function buildExportRows(startISO, endISO){
  return state.cache.events
    .filter(e => e.date >= startISO && e.date <= endISO)
    .sort((a,b)=> a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||''))
    .map(e=>{
      const t = eventTypeByKey(e.type);
      const who = e.technicianId ? techName(e.technicianId) : '';
      const where = e.siteId ? siteName(e.siteId) : '';
      const status = e.completed ? 'Done' : (e.date < todayISO() ? 'Missed' : 'Scheduled');
      return {
        Date: e.date,
        Day: DOW_SHORT[(fromISO(e.date).getDay()+6)%7],
        Type: t.label,
        Technician: who,
        Site: where,
        Time: e.time || '',
        Status: status,
        Notes: e.notes || '',
      };
    });
}

function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

function exportCSV(rows, filename){
  const headers = Object.keys(rows[0]);
  const escape = (v)=>{
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h=>escape(r[h])).join(','))];
  downloadBlob(new Blob([lines.join('\r\n')], { type:'text/csv;charset=utf-8;' }), filename + '.csv');
  toast('CSV exported');
}

async function exportXLSX(rows, filename){
  try{ await loadScriptOnce(EXPORT_LIBS.xlsx); }
  catch(e){ toast('Could not load the Excel export library — check your connection'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:11},{wch:5},{wch:12},{wch:20},{wch:20},{wch:7},{wch:10},{wch:44}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
  XLSX.writeFile(wb, filename + '.xlsx');
  toast('Excel file exported');
}

async function exportPDF(rows, filename, startISO, endISO, opts){
  try{
    await loadScriptOnce(EXPORT_LIBS.jspdf);
    await loadScriptOnce(EXPORT_LIBS.jspdfAutotable);
  } catch(e){ toast('Could not load the PDF export library — check your connection'); return; }
  const title = opts?.title || 'Route Board — Schedule Export';
  const subtitle = opts?.subtitle || `${humanDate(startISO)} to ${humanDate(endISO)}`;
  const headers = opts?.headers || ['Date','Day','Type','Technician','Site','Time','Status','Notes'];
  const bodyRows = opts?.bodyRows || rows.map(r => [r.Date, r.Day, r.Type, r.Technician, r.Site, r.Time, r.Status, r.Notes]);
  const doc = new jspdf.jsPDF({ orientation: opts?.orientation || 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(10);
  doc.setTextColor(110,110,100);
  doc.text(subtitle, 14, 21);
  doc.autoTable({
    startY: 26,
    head: [headers],
    body: bodyRows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [31,75,63] },
    alternateRowStyles: { fillColor: [246,244,237] },
  });
  doc.save(filename + '.pdf');
  toast('PDF exported');
}

function openExportModal(){
  const wkStartISO = toISO(mondayOf(state.weekStart));
  const wkEndISO = toISO(addDays(fromISO(wkStartISO), 6));
  const now = new Date();
  const moStartISO = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const moEndISO = toISO(new Date(now.getFullYear(), now.getMonth()+1, 0));

  const body = `
    <div class="field"><label>Range</label>
      <select id="exRange">
        <option value="week">This week (${humanDateShort(wkStartISO)} – ${humanDateShort(wkEndISO)})</option>
        <option value="month">This month (${humanDateShort(moStartISO)} – ${humanDateShort(moEndISO)})</option>
        <option value="custom">Custom range</option>
      </select>
    </div>
    <div class="field-row" id="exCustomRange" style="display:none;">
      <div class="field"><label>Start</label><input type="date" id="exStart" value="${wkStartISO}"></div>
      <div class="field"><label>End</label><input type="date" id="exEnd" value="${wkEndISO}"></div>
    </div>
    <div class="field"><label>Format</label>
      <select id="exFormat">
        <option value="csv">CSV (.csv)</option>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="pdf">PDF (.pdf)</option>
      </select>
    </div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="exCancel">Cancel</button><button class="btn" id="exRun">Export</button></div>`;
  showModal('Export schedule', body, foot);

  document.getElementById('exCancel').addEventListener('click', closeModal);
  document.getElementById('exRange').addEventListener('change', (e)=>{
    document.getElementById('exCustomRange').style.display = e.target.value==='custom' ? 'flex' : 'none';
  });
  document.getElementById('exRun').addEventListener('click', async ()=>{
    const range = document.getElementById('exRange').value;
    const format = document.getElementById('exFormat').value;
    let startISO, endISO;
    if(range==='week'){ startISO = wkStartISO; endISO = wkEndISO; }
    else if(range==='month'){ startISO = moStartISO; endISO = moEndISO; }
    else { startISO = document.getElementById('exStart').value; endISO = document.getElementById('exEnd').value; }
    if(!startISO || !endISO || startISO > endISO){ toast('Pick a valid date range'); return; }

    const rows = buildExportRows(startISO, endISO);
    if(rows.length === 0){ toast('No visits logged in that range'); return; }

    const runBtn = document.getElementById('exRun');
    runBtn.disabled = true;
    const original = runBtn.textContent;
    runBtn.textContent = 'Exporting…';
    const filename = `route-board_${startISO}_to_${endISO}`;
    try{
      if(format==='csv') exportCSV(rows, filename);
      else if(format==='xlsx') await exportXLSX(rows, filename);
      else await exportPDF(rows, filename, startISO, endISO);
      closeModal();
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = original;
    }
  });
}

/* ================= TECHNICIANS ================= */
function renderTechnicians(){
  const filter = state.techFilter;
  let list = state.cache.technicians;
  if(filter!=='all') list = list.filter(t=>t.region===filter);

  const rows = list.map(t=>{
    const tv = techVisitStatus(t);
    const oo = oneOnOneStatus(t);
    const badge = st => st.state==='overdue' ? `<span class="badge badge-overdue">${st.label}</span>` : st.state==='due' ? `<span class="badge badge-due">${st.label}</span>` : st.state==='scheduled' ? `<span class="badge badge-scheduled">${st.label}</span>` : `<span class="badge badge-ok">${st.label}</span>`;
    return `<tr data-tech-row="${t.id}">
      <td><div class="row-name">${escapeHTML(t.name)}${t.isDriver?' <span class="badge badge-neutral" style="margin-left:4px;">Driver</span>':''}</div>${t.area?`<div class="row-sub">${escapeHTML(t.area)}</div>`:''}${(t.workDays&&t.workDays.length&&t.workDays.length<5)?`<div class="row-sub">Contracted: ${t.workDays.map(d=>DOW_SHORT[d-1]).join(', ')}</div>`:''}</td>
      <td data-label="Zone">${regionBadge(t.region)}</td>
      <td data-label="Tech visit">${badge(tv)}</td>
      <td data-label="1-1">${badge(oo)}</td>
      <td ${t.active?'':'data-label="Status"'}>${t.active? '' : '<span class="badge badge-neutral">Inactive</span>'}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit-tech="${t.id}">Edit</button>
        <button class="icon-btn" data-del-tech="${t.id}">Remove</button>
      </div></td>
    </tr>`;
  }).join('');

  const filters = ['all', ...zoneList().map(z=>z.key)].map(f=>{
    const label = f==='all' ? 'All' : zoneByKey(f).label;
    return `<button class="chip ${state.techFilter===f?'active':''}" data-tf="${f}">${label}</button>`;
  }).join('');

  return `
  <div class="view-head">
    <div><h1>Technicians</h1><div class="view-sub">${state.cache.technicians.filter(t=>t.active).length} active · at least one visit and one 1-1 per month each</div></div>
    <div class="view-actions"><button class="btn" id="addTechBtn">+ Add technician</button></div>
  </div>
  <div class="toolbar"><div class="chip-filter">${filters}</div></div>
  ${list.length ? `<div class="card table-wrap"><table class="responsive-table">
    <thead><tr><th>Name</th><th>Zone</th><th>Tech visit</th><th>1-1</th><th></th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>` : `<div class="card empty"><h3>No technicians in this zone</h3><p>Add one, or clear the filter above.</p></div>`}
  `;
}
function mountTechnicians(){
  document.getElementById('addTechBtn').addEventListener('click', ()=>openTechnicianForm());
  document.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click', ()=>{ state.techFilter=b.dataset.tf; render(); }));
  document.querySelectorAll('[data-edit-tech]').forEach(b=>b.addEventListener('click', ()=>openTechnicianForm(Number(b.dataset.editTech))));
  document.querySelectorAll('[data-del-tech]').forEach(b=>b.addEventListener('click', ()=>confirmDeleteTechnician(Number(b.dataset.delTech))));
}
function openTechnicianForm(editId){
  const existing = editId ? state.cache.technicians.find(t=>t.id===editId) : null;
  const v = existing || { name:'', region:'east', area:'', techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true, workDays:[1,2,3,4,5] };
  const regionOptions = zoneList().map(z=>`<option value="${z.key}" ${v.region===z.key?'selected':''}>${z.label}</option>`).join('');
  const workDays = (v.workDays && v.workDays.length) ? v.workDays : [1,2,3,4,5];
  const dayChecks = DOW_SHORT.map((d,i)=>{
    const dayNum = i+1;
    return `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12.5px;font-weight:600;color:var(--text-dim);text-transform:none;">
      <input type="checkbox" class="tWorkDay" value="${dayNum}" ${workDays.includes(dayNum)?'checked':''} style="width:auto;"> ${d}
    </label>`;
  }).join('');

  const absenceRanges = existing ? getTechAbsenceRanges(existing.id) : [];
  const absenceRows = absenceRanges.length ? absenceRanges.map(r=>{
    const catLabel = r.category==='absence' ? 'Absence' : 'Holiday';
    const catBadge = r.category==='absence' ? 'badge-overdue' : 'badge-ok';
    return `
    <div class="watch-row" style="padding:7px 0;">
      <div><span class="badge ${catBadge}" style="margin-right:8px;">${catLabel}</span><span class="watch-name" style="font-size:12.5px;font-weight:600;">${r.start===r.end ? humanDate(r.start) : `${humanDateShort(r.start)} – ${humanDate(r.end)}`}</span></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-remove-absence="${r.start}|${r.end}|${r.category}">Remove</button>
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No holidays/absences logged.</p>`;

  const body = `
    <div class="field"><label>Name</label><input id="tName" value="${escapeHTML(v.name)}" placeholder="Full name"></div>
    <div class="field"><label>Zone (Thames key)</label><select id="tRegion">${regionOptions}</select></div>
    <div class="field"><label>Area notes</label><input id="tArea" value="${escapeHTML(v.area)}" placeholder="e.g. Essex sites, exterior only…"></div>
    <div class="field-row">
      <div class="field"><label>Tech visit every (days)</label><input type="number" id="tFreqVisit" value="${v.techFrequencyDays}" min="7"></div>
      <div class="field"><label>1-1 every (days)</label><input type="number" id="tFreqOO" value="${v.oneOnOneFrequencyDays}" min="7"></div>
    </div>
    <div class="field">
      <label>Contracted days</label>
      <div>${dayChecks}</div>
      <div class="freq-hint">The schedule generator will only book this person's tech visits and 1-1s on these days.</div>
    </div>
    <div class="field"><label><input type="checkbox" id="tActive" ${v.active?'checked':''} style="width:auto;"> Active</label></div>
    <div class="field"><label><input type="checkbox" id="tDriver" ${v.isDriver?'checked':''} style="width:auto;"> Driver <span style="font-weight:400;text-transform:none;color:var(--text-faint);">(subject to FleetCheck safety checks)</span></label></div>
    ${existing ? `
    <div class="field" style="border-top:1px solid var(--line-soft);padding-top:14px;">
      <label>Holidays / absences</label>
      <div id="tAbsenceList">${absenceRows}</div>
      <button class="btn btn-outline btn-small" id="tAddAbsence" type="button" style="margin-top:6px;">+ Add holiday/absence</button>
      <div class="freq-hint">Days marked here are skipped entirely when generating this technician's schedule.</div>
    </div>` : `<p class="freq-hint">Save this technician first to add holidays/absences.</p>`}
  `;
  const foot = `
    ${existing ? `<button class="btn btn-danger" id="tDelete">Remove</button>` : `<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="tCancel">Cancel</button><button class="btn" id="tSave">${existing?'Save':'Add'}</button></div>
  `;
  showModal(existing?'Edit technician':'Add technician', body, foot);
  document.getElementById('tCancel').addEventListener('click', closeModal);
  document.getElementById('tDelete')?.addEventListener('click', ()=>{ closeModal(); confirmDeleteTechnician(editId); });
  document.getElementById('tAddAbsence')?.addEventListener('click', ()=>openAbsenceForm(existing.id));
  document.querySelectorAll('[data-remove-absence]').forEach(b=>b.addEventListener('click', async ()=>{
    const [start,end,category] = b.dataset.removeAbsence.split('|');
    await removeTechAbsenceRange(existing.id, start, end, category);
    toast('Removed');
    openTechnicianForm(existing.id);
  }));
  document.getElementById('tSave').addEventListener('click', async ()=>{
    const name = document.getElementById('tName').value.trim();
    if(!name){ toast('Name is required'); return; }
    const workDaysChecked = Array.from(document.querySelectorAll('.tWorkDay:checked')).map(el=>Number(el.value)).sort((a,b)=>a-b);
    if(workDaysChecked.length===0){ toast('Pick at least one contracted day'); return; }
    const obj = {
      name,
      region: document.getElementById('tRegion').value,
      area: document.getElementById('tArea').value.trim(),
      techFrequencyDays: Number(document.getElementById('tFreqVisit').value)||30,
      oneOnOneFrequencyDays: Number(document.getElementById('tFreqOO').value)||30,
      workDays: workDaysChecked,
      active: document.getElementById('tActive').checked,
      isDriver: document.getElementById('tDriver').checked,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if(existing) obj.id = existing.id;
    await DB.put('technicians', obj);
    closeModal(); toast(existing?'Technician updated':'Technician added'); render();
  });
}
function confirmDeleteTechnician(id){
  const t = state.cache.technicians.find(x=>x.id===id);
  showModal('Remove technician', `<p>Remove <strong>${escapeHTML(t.name)}</strong>? Their logged visits and 1-1s stay in history but will no longer be tracked for due dates.</p>`,
    `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">Remove</button></div>`);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{ await DB.delete('technicians', id); closeModal(); toast('Technician removed'); render(); });
}

/* ================= CLIENT SITES ================= */
function renderSites(){
  const filter = state.siteFilter;
  let list = state.cache.sites;
  if(filter!=='all') list = list.filter(s=>s.type===filter);

  const rows = list.map(s=>{
    const qa = siteQAStatus(s);
    const badge = qa ? (qa.state==='overdue'? `<span class="badge badge-overdue">${qa.label}</span>` : qa.state==='due' ? `<span class="badge badge-due">${qa.label}</span>` : qa.state==='scheduled' ? `<span class="badge badge-scheduled">${qa.label}</span>` : `<span class="badge badge-ok">${qa.label}</span>`) : `<span class="badge badge-neutral">No fixed schedule</span>`;
    return `<tr>
      <td><div class="row-name">${escapeHTML(s.name)}</div>${s.isGeneral?`<div class="row-sub">Placeholder for unassigned QA visits</div>`:s.address?`<div class="row-sub">${escapeHTML(s.address)}</div>`:''}</td>
      <td data-label="Zone">${regionBadge(s.region)}</td>
      <td data-label="Type"><span class="badge badge-neutral">${s.type==='qa'?'QA site':s.type==='tech'?'Tech site':'Other'}</span></td>
      <td data-label="QA status">${badge}</td>
      <td ${s.active?'':'data-label="Status"'}>${s.active? '' : '<span class="badge badge-neutral">Inactive</span>'}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit-site="${s.id}">Edit</button>
        <button class="icon-btn" data-del-site="${s.id}">Remove</button>
      </div></td>
    </tr>`;
  }).join('');

  const filters = [['all','All'],['qa','QA sites'],['tech','Tech sites'],['other','Other']].map(([f,label])=>
    `<button class="chip ${state.siteFilter===f?'active':''}" data-sf="${f}">${label}</button>`).join('');

  return `
  <div class="view-head">
    <div><h1>Client sites</h1><div class="view-sub">${state.cache.sites.length} site${state.cache.sites.length===1?'':'s'} logged · add sites as they come on, set a QA cadence per site</div></div>
    <div class="view-actions">
      <button class="btn btn-outline" id="bulkImportSitesBtn">⇪ Bulk import</button>
      <button class="btn" id="addSiteBtn">+ Add site</button>
    </div>
  </div>
  <div class="toolbar"><div class="chip-filter">${filters}</div></div>
  ${list.length ? `<div class="card table-wrap"><table class="responsive-table">
    <thead><tr><th>Site</th><th>Zone</th><th>Type</th><th>QA status</th><th></th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>` : `<div class="card empty"><h3>No client sites yet</h3><p>You mentioned the site list is still to come — add sites here as and when, each with its own QA cadence, or use Bulk import to bring in a whole list at once.</p></div>`}
  `;
}
function mountSites(){
  document.getElementById('addSiteBtn').addEventListener('click', ()=>openSiteForm());
  document.getElementById('bulkImportSitesBtn').addEventListener('click', ()=>openBulkImportSites());
  document.querySelectorAll('[data-sf]').forEach(b=>b.addEventListener('click', ()=>{ state.siteFilter=b.dataset.sf; render(); }));
  document.querySelectorAll('[data-edit-site]').forEach(b=>b.addEventListener('click', ()=>openSiteForm(Number(b.dataset.editSite))));
  document.querySelectorAll('[data-del-site]').forEach(b=>b.addEventListener('click', ()=>confirmDeleteSite(Number(b.dataset.delSite))));
}

/* ---------- bulk import ---------- */
const REGION_ALIASES = {
  east:'east', 'east/north':'east', north:'east', 'east london':'east', 'east - north bank':'east', 'north bank':'east',
  west:'west', south:'west', 'west london':'west', 'west - south bank':'west', 'south bank':'west',
  outside:'outside', 'outside london':'outside', 'out of london':'outside', 'outside-london':'outside',
  floating:'floating', exterior:'floating', all:'floating', other:'floating', '':'floating',
};
function normalizeRegion(v){
  const key = (v||'').toLowerCase().trim();
  if(!key) return 'floating';
  if(REGION_ALIASES[key]) return REGION_ALIASES[key];
  return ['east','west','outside','floating'].includes(key) ? key : 'floating';
}
function normalizeSiteType(v){
  const key = (v||'').toLowerCase().trim();
  if(key.startsWith('tech')) return 'tech';
  if(key.startsWith('other')) return 'other';
  return 'qa';
}
function parseCsvLine(line){
  const result = [];
  let cur = '', inQuotes = false;
  for(let i=0;i<line.length;i++){
    const c = line[i];
    if(inQuotes){
      if(c === '"'){ if(line[i+1] === '"'){ cur+='"'; i++; } else inQuotes=false; }
      else cur+=c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ result.push(cur.trim()); cur=''; }
      else cur+=c;
    }
  }
  result.push(cur.trim());
  return result;
}
function parseBulkSites(raw){
  const existingNames = new Set(state.cache.sites.map(s=>s.name.toLowerCase().trim()));
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const rows = [];
  const seenThisImport = new Set();
  for(const line of lines){
    const cells = parseCsvLine(line);
    const first = (cells[0]||'').toLowerCase();
    if(rows.length===0 && ['name','site','site name','client site'].includes(first)) continue; // skip a header row
    const name = (cells[0]||'').trim();
    if(!name) continue;
    const region = normalizeRegion(cells[1]);
    const type = normalizeSiteType(cells[2]);
    const freqRaw = (cells[3]||'').trim().toLowerCase();
    const qaFrequencyDays = ['none','no','-','n/a'].includes(freqRaw) ? null : (freqRaw==='' ? 30 : (Number(freqRaw)||30));
    const address = (cells[4]||'').trim();
    const notes = (cells[5]||'').trim();
    const key = name.toLowerCase();
    const dupExisting = existingNames.has(key);
    const dupThisImport = seenThisImport.has(key);
    seenThisImport.add(key);
    rows.push({ name, region, type, qaFrequencyDays, address, notes, skip: dupExisting || dupThisImport, reason: dupExisting ? 'Already exists' : dupThisImport ? 'Duplicate in list' : null });
  }
  return rows;
}
function openBulkImportSites(prefill){
  const body = `
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:12px;line-height:1.7;">
      One site per line. A plain name works for a quick add — or use comma-separated columns for full detail:<br>
      <code style="font-size:11.5px;background:var(--paper-dim);padding:1px 5px;border-radius:4px;">name, zone, type, QA cadence in days, address, notes</code><br>
      Zone: east / west / outside / floating (defaults to Floating if blank or unrecognised) · Type: qa / tech / other (defaults to QA) ·
      QA cadence defaults to 30 days if left blank — type "none" for no fixed schedule.
    </p>
    <div class="field">
      <label>Upload CSV or text file <span style="font-weight:400;text-transform:none;color:var(--text-faint);">(optional)</span></label>
      <input type="file" id="biFile" accept=".csv,.txt">
    </div>
    <div class="field">
      <label>Or paste here</label>
      <textarea id="biText" rows="8" placeholder="LEK Consulting, east, qa, 30, 10 Fenchurch Ave&#10;AFRY Management, east&#10;Prequin, west, qa, 60">${prefill?escapeHTML(prefill):''}</textarea>
    </div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="biCancel">Cancel</button><button class="btn" id="biPreview">Preview import</button></div>`;
  showModal('Bulk import client sites', body, foot, { wide:true });
  document.getElementById('biCancel').addEventListener('click', closeModal);
  document.getElementById('biFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const text = await file.text();
    document.getElementById('biText').value = text;
  });
  document.getElementById('biPreview').addEventListener('click', ()=>{
    const raw = document.getElementById('biText').value;
    if(!raw.trim()){ toast('Paste or upload something first'); return; }
    renderBulkImportPreview(parseBulkSites(raw), raw);
  });
}
function renderBulkImportPreview(rows, raw){
  const importable = rows.filter(r=>!r.skip);
  const skipped = rows.filter(r=>r.skip);
  const tableRows = rows.map(r=>`
    <tr style="${r.skip?'opacity:.45;':''}">
      <td><div class="row-name">${escapeHTML(r.name)}</div></td>
      <td>${zoneByKey(r.region).label}</td>
      <td>${r.type==='qa'?'QA site':r.type==='tech'?'Tech site':'Other'}</td>
      <td>${r.qaFrequencyDays==null?'No fixed schedule':r.qaFrequencyDays+' days'}</td>
      <td>${r.skip ? `<span class="badge badge-neutral">${r.reason}</span>` : `<span class="badge badge-ok">Will import</span>`}</td>
    </tr>
  `).join('');
  const body = `
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px;">
      ${importable.length} site${importable.length===1?'':'s'} ready to import${skipped.length?` · ${skipped.length} skipped (already exist or repeated in your list)`:''}.
    </p>
    <div class="table-wrap" style="max-height:340px;overflow-y:auto;border:1px solid var(--line-soft);border-radius:8px;">
      <table>
        <thead><tr><th>Name</th><th>Zone</th><th>Type</th><th>QA cadence</th><th></th></tr></thead>
        <tbody>${tableRows || `<tr><td colspan="5" style="text-align:center;color:var(--text-faint);padding:24px;">Nothing parsed — check the formatting and try again.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  const foot = `
    <button class="btn btn-outline" id="biBack">Back</button>
    <div class="modal-foot-right">
      <button class="btn btn-outline" id="biCancel2">Cancel</button>
      <button class="btn" id="biConfirm" ${importable.length?'':'disabled'}>Import ${importable.length} site${importable.length===1?'':'s'}</button>
    </div>
  `;
  showModal('Preview import', body, foot, { wide:true });
  document.getElementById('biCancel2').addEventListener('click', closeModal);
  document.getElementById('biBack').addEventListener('click', ()=>openBulkImportSites(raw));
  document.getElementById('biConfirm').addEventListener('click', async ()=>{
    for(const r of importable){
      await DB.add('sites', {
        name: r.name, region: r.region, type: r.type, address: r.address,
        technicianId: null, qaFrequencyDays: r.qaFrequencyDays, notes: r.notes,
        active: true, createdAt: new Date().toISOString(),
      });
    }
    closeModal();
    toast(`Imported ${importable.length} site${importable.length===1?'':'s'}`);
    render();
  });
}
function openSiteForm(editId){
  const existing = editId ? state.cache.sites.find(s=>s.id===editId) : null;
  const v = existing || { name:'', region:'east', address:'', type:'qa', qaFrequencyDays:30, technicianId:'', notes:'', active:true };
  const regionOptions = zoneList().map(z=>`<option value="${z.key}" ${v.region===z.key?'selected':''}>${z.label}</option>`).join('');
  const techOptions = state.cache.technicians.map(t=>`<option value="${t.id}" ${v.technicianId==t.id?'selected':''}>${escapeHTML(t.name)}</option>`).join('');

  const body = `
    <div class="field"><label>Site name</label><input id="sName" value="${escapeHTML(v.name)}" placeholder="e.g. LEK Consulting"></div>
    <div class="field-row">
      <div class="field"><label>Zone</label><select id="sRegion">${regionOptions}</select></div>
      <div class="field"><label>Type</label><select id="sType">
        <option value="qa" ${v.type==='qa'?'selected':''}>QA site</option>
        <option value="tech" ${v.type==='tech'?'selected':''}>Tech site</option>
        <option value="other" ${v.type==='other'?'selected':''}>Other</option>
      </select></div>
    </div>
    <div class="field"><label>Address / area</label><input id="sAddress" value="${escapeHTML(v.address)}"></div>
    <div class="field"><label>Usual technician (optional)</label><select id="sTech"><option value="">—</option>${techOptions}</select></div>
    <div class="field">
      <label><input type="checkbox" id="sHasFreq" ${v.qaFrequencyDays?'checked':''} style="width:auto;"> Track a QA cadence for this site</label>
      <input type="number" id="sFreq" value="${v.qaFrequencyDays||30}" min="7" style="margin-top:8px;" ${v.qaFrequencyDays?'':'disabled'}>
      <div class="freq-hint">Days between QA visits — used to flag when this site is due or overdue.</div>
    </div>
    <div class="field"><label>Notes</label><textarea id="sNotes">${escapeHTML(v.notes||'')}</textarea></div>
    <div class="field"><label><input type="checkbox" id="sActive" ${v.active?'checked':''} style="width:auto;"> Active</label></div>
  `;
  const foot = `
    ${existing ? `<button class="btn btn-danger" id="sDelete">Remove</button>` : `<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="sCancel">Cancel</button><button class="btn" id="sSave">${existing?'Save':'Add'}</button></div>
  `;
  showModal(existing?'Edit client site':'Add client site', body, foot);
  document.getElementById('sHasFreq').addEventListener('change', (e)=>{ document.getElementById('sFreq').disabled = !e.target.checked; });
  document.getElementById('sCancel').addEventListener('click', closeModal);
  document.getElementById('sDelete')?.addEventListener('click', ()=>{ closeModal(); confirmDeleteSite(editId); });
  document.getElementById('sSave').addEventListener('click', async ()=>{
    const name = document.getElementById('sName').value.trim();
    if(!name){ toast('Site name is required'); return; }
    const techId = document.getElementById('sTech').value;
    const obj = {
      name,
      region: document.getElementById('sRegion').value,
      type: document.getElementById('sType').value,
      address: document.getElementById('sAddress').value.trim(),
      technicianId: techId? Number(techId): null,
      qaFrequencyDays: document.getElementById('sHasFreq').checked ? (Number(document.getElementById('sFreq').value)||30) : null,
      notes: document.getElementById('sNotes').value.trim(),
      active: document.getElementById('sActive').checked,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if(existing) obj.id = existing.id;
    await DB.put('sites', obj);
    closeModal(); toast(existing?'Site updated':'Site added'); render();
  });
}
function confirmDeleteSite(id){
  const s = state.cache.sites.find(x=>x.id===id);
  showModal('Remove site', `<p>Remove <strong>${escapeHTML(s.name)}</strong>? Logged QA visits stay in history.</p>`,
    `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">Remove</button></div>`);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{ await DB.delete('sites', id); closeModal(); toast('Site removed'); render(); });
}

/* ================= FLEETCHECK ================= */
function renderFleetCheck(){
  const tab = state.fleetCheckTab;
  const drivers = state.cache.technicians.filter(t=>t.isDriver && t.active);

  let periodLabel, navHTML, doneIds, dateISO=null, isNonWorkingNote='';
  if(tab==='daily'){
    dateISO = toISO(state.fleetCheckDate);
    doneIds = new Set(state.cache.fleetcheckRecords.filter(r=>r.checkType==='daily' && r.period===dateISO).map(r=>r.technicianId));
    periodLabel = humanDate(dateISO);
    navHTML = `<button class="btn btn-outline" id="fcPrev">‹ Prev day</button><button class="btn btn-outline" id="fcToday">Today</button><button class="btn btn-outline" id="fcNext">Next day ›</button>`;
    const dow = fromISO(dateISO).getDay();
    if(dow===0||dow===6) isNonWorkingNote = `<p style="font-size:12px;color:var(--text-faint);margin:-8px 0 14px;">Weekend — not counted as a required day in Reports, but you can still log a check here if someone worked.</p>`;
  } else {
    const monthISO = toISO(state.fleetCheckMonth).slice(0,7);
    doneIds = new Set(state.cache.fleetcheckRecords.filter(r=>r.checkType==='monthly' && r.period===monthISO).map(r=>r.technicianId));
    periodLabel = state.fleetCheckMonth.toLocaleString('en-GB',{month:'long', year:'numeric'});
    navHTML = `<button class="btn btn-outline" id="fcPrev">‹ Prev month</button><button class="btn btn-outline" id="fcToday">This month</button><button class="btn btn-outline" id="fcNext">Next month ›</button>`;
  }

  const rows = drivers.map(d=>{
    let awayTag = '';
    if(tab==='daily' && dateISO){
      const workDays = (d.workDays && d.workDays.length) ? d.workDays : [1,2,3,4,5];
      const isoDow = (fromISO(dateISO).getDay()===0) ? 7 : fromISO(dateISO).getDay();
      const onLeave = state.cache.events.some(e=>e.type==='techAbsence' && e.technicianId===d.id && e.date===dateISO);
      if(onLeave) awayTag = `<span class="badge badge-neutral">On leave</span>`;
      else if(!workDays.includes(isoDow)) awayTag = `<span class="badge badge-neutral">Not a work day</span>`;
    }
    return `
    <div class="watch-row">
      <button class="et-check ${doneIds.has(d.id)?'is-done':''}" data-fc-toggle="${d.id}" title="${doneIds.has(d.id)?'Mark not done':'Mark done'}">✓</button>
      <div class="watch-name">${escapeHTML(d.name)}</div>
      <div class="watch-spacer"></div>
      ${awayTag}
      ${regionBadge(d.region)}
    </div>`;
  }).join('');

  return `
  <div class="view-head">
    <div><h1>FleetCheck</h1><div class="view-sub">Driver safety-check completion — ${periodLabel}</div></div>
    <div class="view-actions">${navHTML}</div>
  </div>
  <div class="toolbar"><div class="chip-filter">
    <button class="chip ${tab==='daily'?'active':''}" data-fc-tab="daily">Daily checks</button>
    <button class="chip ${tab==='monthly'?'active':''}" data-fc-tab="monthly">Monthly checks</button>
  </div></div>
  ${isNonWorkingNote}
  <div class="kpi-grid" style="margin-bottom:18px;">
    <div class="card kpi-card">
      <div class="kpi-label">Completed</div>
      <div class="kpi-value">${doneIds.size} <span style="font-size:15px;color:var(--text-dim);">/ ${drivers.length} drivers</span></div>
    </div>
  </div>
  ${drivers.length ? `<div class="card" style="padding:6px 8px;">${rows}</div>` : `<div class="card empty"><h3>No drivers yet</h3><p>Edit a technician and tick "Driver" to see them here.</p></div>`}
  `;
}
function mountFleetCheck(){
  document.querySelectorAll('[data-fc-tab]').forEach(b=>b.addEventListener('click', ()=>{ state.fleetCheckTab = b.dataset.fcTab; render(); }));
  document.getElementById('fcPrev')?.addEventListener('click', ()=>{
    if(state.fleetCheckTab==='daily') state.fleetCheckDate = addDays(state.fleetCheckDate,-1);
    else state.fleetCheckMonth = new Date(state.fleetCheckMonth.getFullYear(), state.fleetCheckMonth.getMonth()-1, 1);
    render();
  });
  document.getElementById('fcNext')?.addEventListener('click', ()=>{
    if(state.fleetCheckTab==='daily') state.fleetCheckDate = addDays(state.fleetCheckDate,1);
    else state.fleetCheckMonth = new Date(state.fleetCheckMonth.getFullYear(), state.fleetCheckMonth.getMonth()+1, 1);
    render();
  });
  document.getElementById('fcToday')?.addEventListener('click', ()=>{
    state.fleetCheckDate = new Date();
    state.fleetCheckMonth = new Date();
    render();
  });
  document.querySelectorAll('[data-fc-toggle]').forEach(b=>b.addEventListener('click', async ()=>{
    const technicianId = Number(b.dataset.fcToggle);
    const checkType = state.fleetCheckTab;
    const period = checkType==='daily' ? toISO(state.fleetCheckDate) : toISO(state.fleetCheckMonth).slice(0,7);
    const existingRec = state.cache.fleetcheckRecords.find(r=>r.technicianId===technicianId && r.checkType===checkType && r.period===period);
    if(existingRec) await DB.delete('fleetcheck_records', existingRec.id);
    else await DB.add('fleetcheck_records', { technicianId, checkType, period, completed:true, notes:'', createdAt:new Date().toISOString() });
    render();
  }));
}

/* ================= REPORTS ================= */
function isTechWorkingOn(technician, iso){
  // true if this is a day the technician is actually expected to be working:
  // one of their contracted days, and no logged holiday/absence that date.
  const workDays = (technician.workDays && technician.workDays.length) ? technician.workDays : [1,2,3,4,5];
  const dow = fromISO(iso).getDay(); const isoDow = dow===0?7:dow;
  if(!workDays.includes(isoDow)) return false;
  const onLeave = state.cache.events.some(e=>e.type==='techAbsence' && e.technicianId===technician.id && e.date===iso);
  if(onLeave) return false;
  return true;
}
function buildHuddleAttendanceReport(startISO, endISO){
  // Huddles that fall on a technician's holiday or non-work day don't count against
  // them at all — the denominator is "huddles they were actually expected at", not
  // every huddle that happened to occur in the range.
  const huddleEvents = state.cache.events.filter(e=>e.type==='block' && e.date>=startISO && e.date<=endISO);
  const techs = state.cache.technicians.filter(t=>t.active);
  const attendance = state.cache.huddleAttendance;
  return techs.map(t=>{
    const applicableHuddles = huddleEvents.filter(e=>isTechWorkingOn(t, e.date));
    const attended = attendance.filter(a=>a.technicianId===t.id && a.attended && applicableHuddles.some(e=>e.id===a.eventId)).length;
    const total = applicableHuddles.length;
    return { Technician: t.name, 'Huddles in range': total, Attended: attended, 'Attendance %': total ? Math.round(attended/total*100)+'%' : '—' };
  });
}
function requiredWorkingDays(technician, startISO, endISO){
  // days this technician is actually expected to be working: their own contracted
  // days (defaults Mon-Fri, so weekends are excluded automatically), minus any
  // logged holiday/absence — matches the same rules the schedule generator uses.
  const startD = fromISO(startISO);
  const totalDays = daysBetween(startISO, endISO) + 1;
  let count = 0;
  for(let i=0;i<totalDays;i++){
    const iso = toISO(addDays(startD, i));
    if(isTechWorkingOn(technician, iso)) count++;
  }
  return count;
}
function buildFleetCheckDailyReport(startISO, endISO){
  const drivers = state.cache.technicians.filter(t=>t.isDriver && t.active);
  const records = state.cache.fleetcheckRecords.filter(r=>r.checkType==='daily' && r.period>=startISO && r.period<=endISO);
  return drivers.map(d=>{
    const completed = records.filter(r=>r.technicianId===d.id).length;
    const required = requiredWorkingDays(d, startISO, endISO);
    return { Driver: d.name, 'Working days in range': required, Completed: completed, 'Completion %': required ? Math.round(completed/required*100)+'%' : '—' };
  });
}
function buildFleetCheckMonthlyReport(startISO, endISO){
  const drivers = state.cache.technicians.filter(t=>t.isDriver && t.active);
  const months = [];
  let cur = new Date(fromISO(startISO).getFullYear(), fromISO(startISO).getMonth(), 1);
  const endD = fromISO(endISO);
  while(cur <= endD){
    months.push(toISO(cur).slice(0,7));
    cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
  }
  const records = state.cache.fleetcheckRecords.filter(r=>r.checkType==='monthly' && months.includes(r.period));
  return drivers.map(d=>{
    const completed = records.filter(r=>r.technicianId===d.id).length;
    return { Driver: d.name, 'Months in range': months.length, Completed: completed, 'Completion %': months.length ? Math.round(completed/months.length*100)+'%' : '—' };
  });
}
function bradfordBand(score){
  // Common indicative bands used by some UK employers — not a legal standard, and thresholds
  // vary by company policy. Shown for reference only; adjust to your own policy as needed.
  if(score === 0) return 'None';
  if(score <= 50) return 'Low';
  if(score <= 200) return 'Medium';
  return 'High';
}
function countSpells(sortedDates){
  let spells = 0, prev = null;
  for(const d of sortedDates){
    if(!prev || isoAddDays(prev,1) !== d) spells++;
    prev = d;
  }
  return spells;
}
function buildAbsenceReport(startISO, endISO){
  // Bradford Score only reflects unplanned absence (sickness, other) — booked holiday/annual
  // leave is planned and shouldn't count toward it, so the two are tracked separately here.
  const techs = state.cache.technicians.filter(t=>t.active);
  return techs.map(t=>{
    const events = state.cache.events.filter(e=>e.type==='techAbsence' && e.technicianId===t.id && e.date>=startISO && e.date<=endISO);
    const holidayDates = events.filter(e=>(e.absenceCategory||'holiday')!=='absence').map(e=>e.date).sort();
    const absenceDates = events.filter(e=>e.absenceCategory==='absence').map(e=>e.date).sort();
    const absenceSpells = countSpells(absenceDates);
    const absenceDays = absenceDates.length;
    const bradford = absenceSpells*absenceSpells*absenceDays;
    return {
      Technician: t.name,
      'Holiday days': holidayDates.length,
      'Absence spells': absenceSpells,
      'Absence days': absenceDays,
      'Bradford Score': bradford,
      'Indicative band': bradfordBand(bradford),
    };
  }).sort((a,b)=> b['Bradford Score'] - a['Bradford Score']);
}
function reportTableHTML(rows, emptyMsg){
  if(!rows.length) return `<p style="font-size:12.5px;color:var(--text-faint);padding:12px 0;">${emptyMsg}</p>`;
  const headers = Object.keys(rows[0]);
  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${escapeHTML(String(r[h]))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}
function reportsRangeISO(){
  const range = state.reportsRange;
  const now = new Date();
  const wkStartISO = toISO(mondayOf(now));
  const wkEndISO = toISO(addDays(mondayOf(now),6));
  const moStartISO = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const moEndISO = toISO(new Date(now.getFullYear(), now.getMonth()+1, 0));
  if(range==='week') return { startISO:wkStartISO, endISO:wkEndISO };
  if(range==='month') return { startISO:moStartISO, endISO:moEndISO };
  return { startISO: state.reportsCustomStart || moStartISO, endISO: state.reportsCustomEnd || moEndISO };
}
function renderReports(){
  const { startISO, endISO } = reportsRangeISO();
  const range = state.reportsRange;
  const huddleRows = buildHuddleAttendanceReport(startISO, endISO);
  const dailyRows = buildFleetCheckDailyReport(startISO, endISO);
  const monthlyRows = buildFleetCheckMonthlyReport(startISO, endISO);
  const absenceRows = buildAbsenceReport(startISO, endISO);

  return `
  <div class="view-head">
    <div><h1>Reports</h1><div class="view-sub">${humanDate(startISO)} – ${humanDate(endISO)}</div></div>
    <div class="view-actions">
      <select id="repRange" style="width:auto;">
        <option value="week" ${range==='week'?'selected':''}>This week</option>
        <option value="month" ${range==='month'?'selected':''}>This month</option>
        <option value="custom" ${range==='custom'?'selected':''}>Custom range</option>
      </select>
    </div>
  </div>
  <div class="field-row" id="repCustomRange" style="display:${range==='custom'?'flex':'none'};max-width:420px;margin-bottom:18px;">
    <div class="field"><label>Start</label><input type="date" id="repStart" value="${startISO}"></div>
    <div class="field"><label>End</label><input type="date" id="repEnd" value="${endISO}"></div>
  </div>
  <div class="card" style="margin-bottom:18px;">
    <div class="panel-title"><h3>Absences &amp; Bradford Score</h3><button class="icon-btn" id="repExportAbsence">Export CSV</button></div>
    <div class="panel-body" style="padding:6px 14px 14px;">
      <p style="font-size:12px;color:var(--text-faint);margin:6px 0 12px;">Bradford Score = spells² × days, calculated from <strong>Absence</strong> entries only — booked Holiday time is shown for reference but never counted, since Bradford Factor is meant to measure unplanned absence. Usually assessed over a rolling 12 months; pick a custom range to match your own policy. Bands shown are indicative only, not a legal or company standard — adjust to your own policy.</p>
      ${reportTableHTML(absenceRows, 'No active technicians to report on.')}
    </div>
  </div>
  <div class="card" style="margin-bottom:18px;">
    <div class="panel-title"><h3>Huddle attendance</h3><button class="icon-btn" id="repExportHuddle">Export CSV</button></div>
    <div class="panel-body" style="padding:6px 14px 14px;">${reportTableHTML(huddleRows, 'No active technicians to report on.')}</div>
  </div>
  <div class="card" style="margin-bottom:18px;">
    <div class="panel-title"><h3>FleetCheck — daily</h3><button class="icon-btn" id="repExportDaily">Export CSV</button></div>
    <div class="panel-body" style="padding:6px 14px 14px;">${reportTableHTML(dailyRows, 'No drivers flagged yet — edit a technician and tick "Driver" to see them here.')}</div>
  </div>
  <div class="card">
    <div class="panel-title"><h3>FleetCheck — monthly</h3><button class="icon-btn" id="repExportMonthly">Export CSV</button></div>
    <div class="panel-body" style="padding:6px 14px 14px;">${reportTableHTML(monthlyRows, 'No drivers flagged yet — edit a technician and tick "Driver" to see them here.')}</div>
  </div>
  `;
}
function mountReports(){
  document.getElementById('repRange').addEventListener('change', (e)=>{ state.reportsRange = e.target.value; render(); });
  document.getElementById('repStart')?.addEventListener('change', (e)=>{ state.reportsCustomStart = e.target.value; render(); });
  document.getElementById('repEnd')?.addEventListener('change', (e)=>{ state.reportsCustomEnd = e.target.value; render(); });
  const { startISO, endISO } = reportsRangeISO();
  document.getElementById('repExportAbsence')?.addEventListener('click', ()=>{
    const rows = buildAbsenceReport(startISO, endISO);
    if(!rows.length){ toast('Nothing to export'); return; }
    exportCSV(rows, `absences-bradford-score_${startISO}_to_${endISO}`);
  });
  document.getElementById('repExportHuddle')?.addEventListener('click', ()=>{
    const rows = buildHuddleAttendanceReport(startISO, endISO);
    if(!rows.length){ toast('Nothing to export'); return; }
    exportCSV(rows, `huddle-attendance_${startISO}_to_${endISO}`);
  });
  document.getElementById('repExportDaily')?.addEventListener('click', ()=>{
    const rows = buildFleetCheckDailyReport(startISO, endISO);
    if(!rows.length){ toast('Nothing to export'); return; }
    exportCSV(rows, `fleetcheck-daily_${startISO}_to_${endISO}`);
  });
  document.getElementById('repExportMonthly')?.addEventListener('click', ()=>{
    const rows = buildFleetCheckMonthlyReport(startISO, endISO);
    if(!rows.length){ toast('Nothing to export'); return; }
    exportCSV(rows, `fleetcheck-monthly_${startISO}_to_${endISO}`);
  });
}

/* ================= TO-DO LIST ================= */
function getFilteredTodos(filter){
  const f = filter || state.todoFilter;
  let list = state.cache.todos;
  if(f==='open') list = list.filter(t=>!t.completed);
  else if(f==='completed') list = list.filter(t=>t.completed);
  return list; // already sorted newest-first in refreshCache
}
function todoDueBadge(t){
  if(!t.dueDate) return '';
  const today = todayISO();
  if(t.completed) return `<span class="badge badge-neutral">${humanDateShort(t.dueDate)}</span>`;
  if(t.dueDate < today) return `<span class="badge badge-overdue">Overdue · ${humanDateShort(t.dueDate)}</span>`;
  if(t.dueDate === today) return `<span class="badge badge-due">Due today</span>`;
  return `<span class="badge badge-scheduled">Due ${humanDateShort(t.dueDate)}</span>`;
}
function todoAlertBadge(t){
  if(!t.alertAt) return '';
  const alertDate = new Date(t.alertAt);
  const passed = alertDate <= new Date();
  const label = alertDate.toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  if(t.completed) return `<span class="badge badge-neutral">⏰ ${label}</span>`;
  return passed ? `<span class="badge badge-overdue">⏰ Alert passed · ${label}</span>` : `<span class="badge badge-neutral">⏰ ${label}</span>`;
}
function todoSourceBadge(t){
  if(!t.source || t.source==='manual') return '';
  return `<span class="badge badge-scheduled">${escapeHTML(t.source)}</span>`;
}
function renderTodos(){
  const mode = state.todoViewMode || 'day';
  const allTodos = state.cache.todos;

  let dayNav = '', dayRollover = '', list;
  if(mode === 'day'){
    const viewDate = state.todoViewDate || new Date();
    const viewISO = toISO(viewDate);
    const isToday = viewISO === todayISO();
    list = getFilteredTodos().filter(t => t.dueDate === viewISO);
    dayNav = `
    <div class="todo-daynav">
      <button class="btn btn-outline" id="todoDayPrev">‹</button>
      <div class="todo-daynav-label">
        <div class="todo-daynav-date">${humanDate(viewISO)}</div>
        ${isToday ? `<div class="todo-daynav-today">Today</div>` : ''}
      </div>
      <button class="btn btn-outline" id="todoDayNext">›</button>
    </div>`;
    dayRollover = `<button class="btn" id="todoDayRollover" style="width:100%;margin-top:14px;justify-content:center;">Move all to next day</button>`;
  } else {
    list = getFilteredTodos();
  }

  const rows = list.map(t=>`
    <div class="todo-row-min ${t.completed?'is-done':''}">
      <button class="et-check ${t.completed?'is-done':''}" data-toggle-todo="${t.id}" title="${t.completed?'Mark not done':'Mark done'}">✓</button>
      <div class="todo-body">
        <div class="todo-text">${escapeHTML(t.text)}</div>
        ${mode!=='day' ? `<div class="todo-meta">${todoDueBadge(t)}${todoAlertBadge(t)}${todoSourceBadge(t)}</div>` : (todoAlertBadge(t) ? `<div class="todo-meta">${todoAlertBadge(t)}</div>` : '')}
      </div>
      <button class="todo-kebab" data-todo-menu="${t.id}" aria-label="Task options">⋯</button>
    </div>
  `).join('');

  const emptyMsg = mode==='day'
    ? 'Nothing due this day.'
    : (state.todoFilter==='completed' ? 'No completed tasks yet.' : 'Add a task to get started.');

  return `
  <div class="view-head" id="todoViewHead">
    <div></div>
    <div class="view-actions" id="todoViewActions">
      <button class="btn btn-outline" id="todoDesktopSettings">⋯ Settings</button>
      <button class="btn" id="todoDesktopAdd">+ Add task</button>
    </div>
  </div>
  ${dayNav}
  ${list.length ? `<div class="card" style="padding:4px 8px;">${rows}</div>` : `<div class="card empty"><h3>Nothing here</h3><p>${emptyMsg}</p></div>`}
  ${dayRollover}
  `;
}
function openTodoRowMenu(id){
  const t = state.cache.todos.find(x=>x.id===id);
  if(!t) return;
  const body = `<p style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:2px;">${escapeHTML(t.text)}</p>`;
  const foot = `
    <div class="modal-foot-right" style="width:100%;flex-direction:column;gap:8px;">
      ${!t.completed ? `<button class="btn btn-outline" id="rmMove" style="width:100%;justify-content:center;">Move to a date…</button>` : ''}
      <button class="btn btn-outline" id="rmEdit" style="width:100%;justify-content:center;">Edit</button>
      <button class="btn btn-danger" id="rmDelete" style="width:100%;justify-content:center;">Delete</button>
    </div>`;
  showModal('Task options', body, foot);
  document.getElementById('rmMove')?.addEventListener('click', ()=>openRolloverModal([id]));
  document.getElementById('rmEdit').addEventListener('click', ()=>openTodoForm(id));
  document.getElementById('rmDelete').addEventListener('click', async ()=>{
    await DB.delete('todos', id);
    closeModal(); toast('Task deleted'); render();
  });
}
function openTodoSettingsModal(){
  const notifStatus = ('Notification' in window) ? Notification.permission : 'unsupported';
  const notifLabel = notifStatus==='granted' ? '🔔 Alerts on' : notifStatus==='denied' ? 'Alerts blocked' : '🔔 Enable alerts';
  const mode = state.todoViewMode || 'day';
  const body = `
    <div class="field">
      <label>View</label>
      <div class="chip-filter">
        <button class="chip ${mode==='day'?'active':''}" data-todo-mode="day">By day</button>
        <button class="chip ${mode==='list'?'active':''}" data-todo-mode="list">List</button>
      </div>
    </div>
    <div class="field">
      <label>Show</label>
      <div class="chip-filter">
        <button class="chip ${state.todoFilter==='all'?'active':''}" data-todo-filter="all">All</button>
        <button class="chip ${state.todoFilter==='open'?'active':''}" data-todo-filter="open">Open</button>
        <button class="chip ${state.todoFilter==='completed'?'active':''}" data-todo-filter="completed">Completed</button>
      </div>
    </div>
    <div class="field" style="display:flex;gap:8px;">
      <button class="btn btn-outline" id="todoNotifBtn" ${notifStatus==='denied'||notifStatus==='unsupported'?'disabled':''} style="flex:1;justify-content:center;">${notifLabel}</button>
      <button class="btn btn-outline" id="todoExportBtn" style="flex:1;justify-content:center;">⬇ Export</button>
    </div>
  `;
  showModal('To-Do settings', body, `<span></span><div class="modal-foot-right"><button class="btn" id="todoSettingsDone">Done</button></div>`);
  document.getElementById('todoSettingsDone').addEventListener('click', closeModal);
  document.querySelectorAll('[data-todo-mode]').forEach(b=>b.addEventListener('click', ()=>{ state.todoViewMode=b.dataset.todoMode; closeModal(); render(); }));
  document.querySelectorAll('[data-todo-filter]').forEach(b=>b.addEventListener('click', ()=>{ state.todoFilter=b.dataset.todoFilter; closeModal(); render(); }));
  document.getElementById('todoNotifBtn').addEventListener('click', async ()=>{
    const granted = await requestNotificationPermission();
    toast(granted ? 'Browser alerts enabled' : 'Alerts not enabled');
    closeModal(); render();
  });
  document.getElementById('todoExportBtn').addEventListener('click', ()=>{ closeModal(); openTodoExportModal(); });
}
function mountTodos(){
  document.getElementById('todoDayPrev')?.addEventListener('click', ()=>{ state.todoViewDate = addDays(state.todoViewDate||new Date(), -1); render(); });
  document.getElementById('todoDayNext')?.addEventListener('click', ()=>{ state.todoViewDate = addDays(state.todoViewDate||new Date(), 1); render(); });
  document.getElementById('todoDayRollover')?.addEventListener('click', async ()=>{
    const viewISO = toISO(state.todoViewDate||new Date());
    const dayIds = state.cache.todos.filter(t=>!t.completed && t.dueDate===viewISO).map(t=>t.id);
    if(!dayIds.length){ toast('Nothing to move on this day'); return; }
    const nextISO = isoAddDays(viewISO, 1);
    await bulkRolloverTodos(nextISO, dayIds);
    toast(`Moved to ${humanDate(nextISO)}`); render();
  });

  document.querySelectorAll('[data-toggle-todo]').forEach(b=>b.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const t = state.cache.todos.find(x=>x.id===Number(b.dataset.toggleTodo));
    if(!t) return;
    await DB.put('todos', { ...t, completed: !t.completed });
    render();
  }));
  document.querySelectorAll('[data-todo-menu]').forEach(b=>b.addEventListener('click', ()=>openTodoRowMenu(Number(b.dataset.todoMenu))));
  document.getElementById('todoDesktopAdd')?.addEventListener('click', ()=>openTodoForm());
  document.getElementById('todoDesktopSettings')?.addEventListener('click', ()=>openTodoSettingsModal());
}
function openTodoForm(editId){
  const existing = editId ? state.cache.todos.find(t=>t.id===editId) : null;
  const v = existing || { text:'', dueDate: todayISO(), alertAt:null, completed:false };
  const alertLocal = v.alertAt ? new Date(v.alertAt) : null;
  const alertDateVal = alertLocal ? toISO(alertLocal) : '';
  const alertTimeVal = alertLocal ? `${String(alertLocal.getHours()).padStart(2,'0')}:${String(alertLocal.getMinutes()).padStart(2,'0')}` : '';

  const body = `
    <div class="field"><label>Task</label><textarea id="tdText" placeholder="What needs doing?">${escapeHTML(v.text)}</textarea></div>
    <div class="field"><label>Due date (optional)</label><input type="date" id="tdDue" value="${v.dueDate||''}"></div>
    <div class="field-row">
      <div class="field"><label>Alert date (optional)</label><input type="date" id="tdAlertDate" value="${alertDateVal}"></div>
      <div class="field"><label>Alert time</label><input type="time" id="tdAlertTime" value="${alertTimeVal}"></div>
    </div>
    <div class="freq-hint">Alerts highlight the task here, and fire a browser notification if you've enabled them — but only while Route Board is open in a tab.</div>
    ${existing ? `<div class="field"><label><input type="checkbox" id="tdCompleted" ${v.completed?'checked':''} style="width:auto;"> Completed</label></div>` : ''}
  `;
  const foot = `
    ${existing ? `<button class="btn btn-danger" id="tdDelete">Delete</button>` : `<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="tdCancel">Cancel</button><button class="btn" id="tdSave">${existing?'Save':'Add task'}</button></div>
  `;
  showModal(existing?'Edit task':'New task', body, foot);
  document.getElementById('tdCancel').addEventListener('click', closeModal);
  document.getElementById('tdDelete')?.addEventListener('click', async ()=>{
    await DB.delete('todos', editId);
    closeModal(); toast('Task deleted'); render();
  });
  document.getElementById('tdSave').addEventListener('click', async ()=>{
    const text = document.getElementById('tdText').value.trim();
    if(!text){ toast('Enter a task'); return; }
    const dueDate = document.getElementById('tdDue').value || null;
    const alertDate = document.getElementById('tdAlertDate').value;
    const alertTime = document.getElementById('tdAlertTime').value || '09:00';
    const alertAt = alertDate ? new Date(`${alertDate}T${alertTime}:00`).toISOString() : null;
    const obj = {
      text,
      dueDate,
      alertAt,
      alertFired: (existing && existing.alertAt===alertAt) ? existing.alertFired : false, // reset if the alert time changed
      completed: existing ? document.getElementById('tdCompleted').checked : false,
      source: existing?.source || 'manual',
      sourceRef: existing?.sourceRef || null,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if(existing) obj.id = existing.id;
    await DB.put('todos', obj);
    closeModal(); toast(existing?'Task updated':'Task added'); render();
  });
}
function openRolloverModal(todoIds){
  if(!todoIds.length){ toast('Nothing to move'); return; }
  const tomorrow = isoAddDays(todayISO(),1);
  const body = `
    <p style="font-size:13px;margin-bottom:12px;">Move ${todoIds.length} task${todoIds.length===1?'':'s'} to a new date.</p>
    <div class="field"><label>New date</label><input type="date" id="rolloverDate" value="${tomorrow}"></div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="rolloverCancel">Cancel</button><button class="btn" id="rolloverConfirm">Move</button></div>`;
  showModal(todoIds.length>1?'Move tasks':'Move task', body, foot);
  document.getElementById('rolloverCancel').addEventListener('click', closeModal);
  document.getElementById('rolloverConfirm').addEventListener('click', async ()=>{
    const newDate = document.getElementById('rolloverDate').value;
    if(!newDate){ toast('Pick a date'); return; }
    await bulkRolloverTodos(newDate, todoIds);
    closeModal(); toast(`Moved to ${humanDate(newDate)}`); render();
  });
}
async function bulkRolloverTodos(newDate, ids){
  const targets = ids
    ? state.cache.todos.filter(t=>ids.includes(t.id))
    : state.cache.todos.filter(t=>!t.completed && t.dueDate && t.dueDate<todayISO());
  for(const t of targets){
    await DB.put('todos', { ...t, dueDate:newDate });
  }
  await refreshCache();
}
function buildTodoExportRows(){
  return getFilteredTodos().map(t=>({
    Task: t.text,
    Due: t.dueDate || '',
    Alert: t.alertAt ? new Date(t.alertAt).toLocaleString('en-GB') : '',
    Completed: t.completed ? 'Yes' : 'No',
    Created: new Date(t.createdAt).toLocaleString('en-GB'),
  }));
}
function openTodoExportModal(){
  const body = `<div class="field"><label>Format</label><select id="todoExFormat"><option value="csv">CSV (.csv)</option><option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF (.pdf)</option></select></div>`;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="todoExCancel">Cancel</button><button class="btn" id="todoExRun">Export</button></div>`;
  showModal('Export to-do list', body, foot);
  document.getElementById('todoExCancel').addEventListener('click', closeModal);
  document.getElementById('todoExRun').addEventListener('click', async ()=>{
    const format = document.getElementById('todoExFormat').value;
    const rows = buildTodoExportRows();
    if(!rows.length){ toast('Nothing to export'); return; }
    const filename = `todo-list_${todayISO()}`;
    if(format==='csv') exportCSV(rows, filename);
    else if(format==='xlsx') await exportXLSX(rows, filename);
    else await exportPDF(rows, filename, null, null, {
      title: 'Route Board — To-Do List',
      subtitle: `Exported ${humanDate(todayISO())}`,
      headers: ['Task','Due','Alert','Completed','Created'],
      bodyRows: rows.map(r=>[r.Task, r.Due, r.Alert, r.Completed, r.Created]),
      orientation: 'portrait',
    });
    closeModal();
  });
}
/* ---------- alerts (foreground-only; needs the tab open) ---------- */
async function requestNotificationPermission(){
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied') return false;
  try{ return (await Notification.requestPermission())==='granted'; }
  catch(e){ return false; }
}
async function checkTodoAlerts(){
  if(!state.cache.todos || !state.cache.todos.length) return;
  const now = new Date();
  const due = state.cache.todos.filter(t=>!t.completed && t.alertAt && !t.alertFired && new Date(t.alertAt) <= now);
  if(!due.length) return;
  for(const t of due){
    if('Notification' in window && Notification.permission==='granted'){
      try{ new Notification('Route Board reminder', { body: t.text }); } catch(e){}
    }
    await DB.put('todos', { ...t, alertFired:true });
  }
  await refreshCache();
  const modalOpen = !document.getElementById('modalBackdrop')?.hidden;
  if(!modalOpen && (state.route==='dashboard' || state.route==='todos')) render();
}

/* ================= COMPOSE (smart email) ================= */
function emailSettingsSummary(s){
  const style = EMAIL_STYLES[s.emailStyle] || 'Formal';
  const urgency = s.emailUrgency === 'other' ? (s.emailUrgencyCustom || 'Other') : (s.emailUrgency === 'urgent' ? 'Urgent' : 'Not urgent');
  const audience = s.emailAudience === 'other' ? (s.emailAudienceCustom || 'Other') : (EMAIL_AUDIENCES[s.emailAudience] || 'Middle Mgmt');
  return `${style} · ${urgency} · ${audience}`;
}
function composeDesktopHeader(){
  // Desktop has no mobile topbar to hold the + / ⋯ icons, so this gives desktop
  // the same two persistent actions, visible on every Compose screen (input,
  // review, and saved list) — hidden on mobile via CSS, where the topbar covers it.
  return `
  <div class="view-head" id="composeViewHead">
    <div></div>
    <div class="view-actions" id="composeViewActions">
      <button class="btn btn-outline" id="composeDesktopSettings">⋯ Settings</button>
      <button class="btn" id="composeDesktopNew">+ Compose</button>
    </div>
  </div>`;
}
function renderCompose(){
  const s = state.cache.settings || {};
  if(state.composeView === 'saved') return renderComposeSavedList();
  if(state.composeStep === 'result' && state.composeDraft) return renderComposeResult(s);
  const drafting = state.composeStep === 'drafting';
  const replyBanner = state.composeReplyContext ? `
    <div style="display:flex;align-items:flex-start;gap:8px;background:var(--gold-bg);border:1px solid var(--gold);border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--ink);">
      <div style="flex:1;">↩ Replying to: "${escapeHTML((state.composeReplyPreview||'').slice(0,90))}${(state.composeReplyPreview||'').length>90?'…':''}"</div>
      <button id="clearReplyContextBtn" style="background:none;border:none;color:var(--text-dim);font-size:13px;flex-shrink:0;">✕</button>
    </div>` : '';
  return `
  ${composeDesktopHeader()}
  <div class="card card-pad" style="max-width:560px;">
    ${replyBanner}
    <div class="field">
      <label>Rough notes</label>
      <textarea id="composeNotes" placeholder="${state.composeReplyContext ? 'What do you want to say back?' : 'What do you need to say?'}" style="min-height:110px;" ${drafting?'disabled':''}>${escapeHTML(state.composeNotes)}</textarea>
      <div class="freq-hint">Type it, or tap your keyboard's dictation mic — rough is fine.</div>
    </div>
    <button class="btn btn-outline" id="composeSettingsSummary" style="width:100%;justify-content:center;margin-bottom:16px;" ${drafting?'disabled':''}>Email Settings</button>
    <button class="btn" id="composeDraftBtn" style="width:100%;justify-content:center;" ${drafting?'disabled':''}>${drafting?'Drafting…':'Draft email'}</button>
  </div>
  `;
}
function renderComposeResult(s){
  const d = state.composeDraft;
  return `
  ${composeDesktopHeader()}
  <div class="card card-pad" style="max-width:560px;">
    <div class="todo-meta" style="margin-bottom:14px;">
      <span class="badge badge-neutral">${escapeHTML(EMAIL_STYLES[s.emailStyle]||'Formal')}</span>
      <span class="badge ${s.emailUrgency==='urgent'?'badge-overdue':'badge-neutral'}">${s.emailUrgency==='other'?escapeHTML(s.emailUrgencyCustom||'Other'):(s.emailUrgency==='urgent'?'Urgent':'Not urgent')}</span>
      <span class="badge badge-neutral">${escapeHTML(s.emailAudience==='other'?(s.emailAudienceCustom||'Other'):(EMAIL_AUDIENCES[s.emailAudience]||'Middle Mgmt'))}</span>
    </div>
    <div class="field"><label>Subject</label><input id="composeSubject" value="${escapeHTML(d.subject)}"></div>
    <div class="field"><label>Body</label><textarea id="composeBody" style="min-height:220px;">${escapeHTML(d.body)}</textarea></div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button class="btn btn-outline" id="composeRegenerateBtn" style="flex:1;justify-content:center;">↻ Regenerate</button>
      <button class="btn btn-outline" id="composeCopyBtn" style="flex:1;justify-content:center;">Copy</button>
    </div>
    <button class="btn btn-outline" id="composeSaveBtn" style="width:100%;justify-content:center;margin-bottom:10px;">💾 Save draft</button>
    <button class="btn" id="composeMailBtn" style="width:100%;justify-content:center;">✉ Open in Mail</button>
    <button class="btn-link" id="composeBackBtn" style="margin-top:10px;">‹ Back to notes</button>
  </div>
  `;
}
function renderComposeSavedList(){
  const drafts = state.cache.emailDrafts || [];
  const rows = drafts.length ? drafts.map(d=>{
    const snippet = (d.body||'').slice(0,70);
    return `
    <div class="watch-row">
      <div><div class="watch-name">${escapeHTML(d.subject || '(no subject)')}</div><div class="watch-meta">${escapeHTML(snippet)}${(d.body||'').length>70?'…':''} · ${humanDate(toISO(new Date(d.createdAt)))}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-open-draft="${d.id}">Open</button>
      <button class="icon-btn" data-del-draft="${d.id}">Delete</button>
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No saved drafts yet — save one from the review screen after drafting.</p>`;
  return `
  ${composeDesktopHeader()}
  <div class="card" style="padding:4px 8px;max-width:560px;">${rows}</div>
  `;
}
async function runComposeDraft(){
  const notesEl = document.getElementById('composeNotes');
  const notes = (notesEl ? notesEl.value : state.composeNotes).trim();
  if(!notes){ toast('Add some notes first'); return; }
  state.composeNotes = notes;
  state.composeStep = 'drafting';
  render();
  const s = state.cache.settings || {};
  try{
    const examples = (state.cache.emailVoiceSamples||[]).map(e=>e.content);
    const notesForApi = state.composeReplyContext
      ? `Context for this reply, from a prior analysis:\n"""\n${state.composeReplyContext}\n"""\n\nWhat I want to say in my reply:\n${notes}`
      : notes;
    const result = await draftEmail({
      notes: notesForApi,
      style: s.emailStyle || 'formal',
      urgency: s.emailUrgency || 'not_urgent',
      urgencyCustom: s.emailUrgencyCustom || '',
      audience: s.emailAudience || 'middle_mgmt',
      audienceCustom: s.emailAudienceCustom || '',
      examples,
    });
    state.composeDraft = { subject: result.subject || '', body: result.body || '' };
    state.composeStep = 'result';
  } catch(e){
    toast(e?.message || 'Could not draft the email — check your connection and try again');
    state.composeStep = 'input';
  }
  render();
}
function mountCompose(){
  document.getElementById('composeDesktopSettings')?.addEventListener('click', ()=>openEmailSettingsModal());
  document.getElementById('composeDesktopNew')?.addEventListener('click', ()=>{
    state.composeNotes = '';
    state.composeDraft = null;
    state.composeReplyContext = '';
    state.composeReplyPreview = '';
    state.composeStep = 'input';
    state.composeView = 'new';
    render();
  });

  if(state.composeView === 'saved'){
    document.querySelectorAll('[data-open-draft]').forEach(b=>b.addEventListener('click', ()=>{
      const d = (state.cache.emailDrafts||[]).find(x=>x.id===Number(b.dataset.openDraft));
      if(!d) return;
      state.composeDraft = { subject: d.subject, body: d.body };
      state.composeStep = 'result';
      state.composeView = 'new';
      render();
    }));
    document.querySelectorAll('[data-del-draft]').forEach(b=>b.addEventListener('click', async ()=>{
      await DB.delete('email_drafts', Number(b.dataset.delDraft));
      toast('Draft deleted'); render();
    }));
    return;
  }

  if(state.composeStep === 'result'){
    document.getElementById('composeSubject').addEventListener('input', (e)=>{ state.composeDraft.subject = e.target.value; });
    document.getElementById('composeBody').addEventListener('input', (e)=>{ state.composeDraft.body = e.target.value; });
    document.getElementById('composeRegenerateBtn').addEventListener('click', ()=>runComposeDraft());
    document.getElementById('composeCopyBtn').addEventListener('click', async ()=>{
      const text = `Subject: ${state.composeDraft.subject}\n\n${state.composeDraft.body}`;
      try{ await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
      catch(e){ toast('Could not copy — select the text and copy manually'); }
    });
    document.getElementById('composeSaveBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget;
      const originalLabel = btn.textContent;
      try{
        const s = state.cache.settings || {};
        await DB.add('email_drafts', {
          subject: state.composeDraft.subject,
          body: state.composeDraft.body,
          style: s.emailStyle || 'formal',
          urgency: s.emailUrgency || 'not_urgent',
          urgencyCustom: s.emailUrgencyCustom || '',
          audience: s.emailAudience || 'middle_mgmt',
          audienceCustom: s.emailAudienceCustom || '',
          notes: state.composeNotes,
          createdAt: new Date().toISOString(),
        });
        await refreshCache();
        toast('Draft saved');
        btn.textContent = '✓ Saved';
        setTimeout(()=>{ if(btn.isConnected) btn.textContent = originalLabel; }, 1600);
      } catch(err){
        toast(`Could not save the draft — ${err?.message || 'please try again'}`);
      }
    });
    document.getElementById('composeMailBtn').addEventListener('click', ()=>{
      const subject = encodeURIComponent(state.composeDraft.subject);
      const body = encodeURIComponent(state.composeDraft.body);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    });
    document.getElementById('composeBackBtn').addEventListener('click', ()=>{ state.composeStep = 'input'; render(); });
    return;
  }
  document.getElementById('composeNotes')?.addEventListener('input', (e)=>{ state.composeNotes = e.target.value; });
  document.getElementById('clearReplyContextBtn')?.addEventListener('click', ()=>{ state.composeReplyContext = ''; state.composeReplyPreview = ''; render(); });
  document.getElementById('composeSettingsSummary')?.addEventListener('click', ()=>openEmailSettingsModal());
  document.getElementById('composeDraftBtn')?.addEventListener('click', ()=>runComposeDraft());
}
function openEmailSettingsModal(){
  const s = state.cache.settings || {};
  const draftsCount = (state.cache.emailDrafts||[]).length;
  const body = `
    <div class="field">
      <label>View</label>
      <div class="chip-filter">
        <button class="chip ${state.composeView==='new'?'active':''}" data-compose-view="new">Compose</button>
        <button class="chip ${state.composeView==='saved'?'active':''}" data-compose-view="saved">Saved${draftsCount?` (${draftsCount})`:''}</button>
        <button class="chip" id="emailClearTextBtn">Clear text</button>
      </div>
    </div>
    <div class="field">
      <label>Style</label>
      <div class="chip-filter">
        ${Object.entries(EMAIL_STYLES).map(([k,label])=>`<button class="chip ${s.emailStyle===k?'active':''}" data-email-style="${k}">${label}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Urgency</label>
      <div class="chip-filter">
        <button class="chip ${(!s.emailUrgency||s.emailUrgency==='not_urgent')?'active':''}" data-email-urgency="not_urgent">Not urgent</button>
        <button class="chip ${s.emailUrgency==='urgent'?'active':''}" data-email-urgency="urgent">Urgent</button>
        <button class="chip ${s.emailUrgency==='other'?'active':''}" data-email-urgency="other">Other…</button>
      </div>
      <div id="emailUrgencyCustomWrap" style="display:${s.emailUrgency==='other'?'':'none'};margin-top:8px;">
        <input id="emailUrgencyCustom" value="${escapeHTML(s.emailUrgencyCustom||'')}" placeholder="e.g. Needed by Friday, somewhat time-sensitive…">
      </div>
    </div>
    <div class="field">
      <label>Who's this to</label>
      <div class="chip-filter">
        ${Object.entries(EMAIL_AUDIENCES).map(([k,label])=>`<button class="chip ${s.emailAudience===k?'active':''}" data-email-audience="${k}">${label}${k==='other'?'…':''}</button>`).join('')}
      </div>
      <div id="emailAudienceCustomWrap" style="display:${s.emailAudience==='other'?'':'none'};margin-top:8px;">
        <input id="emailAudienceCustom" value="${escapeHTML(s.emailAudienceCustom||'')}" placeholder="e.g. IT department, Acme Corp…">
      </div>
    </div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn" id="emailSettingsDone">Done</button></div>`;
  showModal('Email settings', body, foot);

  async function updateSetting(patch){
    const current = state.cache.settings || {};
    await DB.put('settings', { id:'settings', ...current, ...patch });
    await refreshCache();
  }
  document.querySelectorAll('[data-email-style]').forEach(b=>b.addEventListener('click', async ()=>{
    document.querySelectorAll('[data-email-style]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    await updateSetting({ emailStyle: b.dataset.emailStyle });
  }));
  document.querySelectorAll('[data-email-urgency]').forEach(b=>b.addEventListener('click', async ()=>{
    document.querySelectorAll('[data-email-urgency]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const key = b.dataset.emailUrgency;
    await updateSetting({ emailUrgency: key });
    const wrap = document.getElementById('emailUrgencyCustomWrap');
    if(wrap) wrap.style.display = key==='other' ? '' : 'none';
  }));
  document.getElementById('emailUrgencyCustom')?.addEventListener('change', async (e)=>{
    await updateSetting({ emailUrgencyCustom: e.target.value });
  });
  document.querySelectorAll('[data-email-audience]').forEach(b=>b.addEventListener('click', async ()=>{
    document.querySelectorAll('[data-email-audience]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const key = b.dataset.emailAudience;
    await updateSetting({ emailAudience: key });
    const wrap = document.getElementById('emailAudienceCustomWrap');
    if(wrap) wrap.style.display = key==='other' ? '' : 'none';
  }));
  document.getElementById('emailAudienceCustom')?.addEventListener('change', async (e)=>{
    await updateSetting({ emailAudienceCustom: e.target.value });
  });
  document.querySelectorAll('[data-compose-view]').forEach(b=>b.addEventListener('click', ()=>{
    state.composeView = b.dataset.composeView;
    closeModal();
    render();
  }));
  document.getElementById('emailClearTextBtn').addEventListener('click', ()=>{
    state.composeNotes = '';
    state.composeDraft = null;
    state.composeReplyContext = '';
    state.composeReplyPreview = '';
    state.composeStep = 'input';
    state.composeView = 'new';
    closeModal();
    render();
  });
  document.getElementById('emailSettingsDone').addEventListener('click', ()=>{ closeModal(); render(); });
}
function openEmailSampleForm(editId){
  const existing = editId ? (state.cache.emailVoiceSamples||[]).find(e=>e.id===editId) : null;
  const v = existing || { label:'', content:'' };
  const body = `
    <div class="field"><label>Label (optional)</label><input id="esLabel" value="${escapeHTML(v.label)}" placeholder="e.g. Update to client, Team announcement…"></div>
    <div class="field"><label>Email text</label><textarea id="esContent" style="min-height:160px;" placeholder="Paste a real email you've sent…">${escapeHTML(v.content)}</textarea></div>
  `;
  const foot = `
    ${existing ? `<button class="btn btn-danger" id="esDelete">Remove</button>` : `<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="esCancel">Cancel</button><button class="btn" id="esSave">${existing?'Save':'Add'}</button></div>
  `;
  showModal(existing?'Edit example email':'Add example email', body, foot);
  document.getElementById('esCancel').addEventListener('click', closeModal);
  document.getElementById('esDelete')?.addEventListener('click', async ()=>{
    await DB.delete('email_voice_samples', editId);
    closeModal(); toast('Example removed'); render();
  });
  document.getElementById('esSave').addEventListener('click', async ()=>{
    const content = document.getElementById('esContent').value.trim();
    if(!content){ toast('Paste an example email first'); return; }
    const label = document.getElementById('esLabel').value.trim();
    if(existing){
      await DB.put('email_voice_samples', { ...existing, label, content });
    } else {
      await DB.add('email_voice_samples', { label, content, createdAt: new Date().toISOString() });
    }
    closeModal(); toast(existing?'Example updated':'Example added'); render();
  });
}

/* ================= ASSISTANT (analyse content) ================= */
function resetAssistant(){
  state.assistantText = '';
  state.assistantInstruction = (state.cache.settings || {}).assistantDefaultInstruction || '';
  state.assistantFiles = [];
  state.assistantStep = 'input';
  state.assistantResult = null;
  state.assistantView = 'new';
}
function arrayBufferToBase64(buf){
  let binary = '';
  const bytes = new Uint8Array(buf);
  for(let i=0;i<bytes.byteLength;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function assistantHandleFiles(fileList){
  for(const file of Array.from(fileList)){
    const ext = (file.name.split('.').pop()||'').toLowerCase();
    try{
      if(ext === 'pdf'){
        const buf = await file.arrayBuffer();
        state.assistantFiles.push({ name:file.name, kind:'pdf', data: arrayBufferToBase64(buf) });
      } else if(['png','jpg','jpeg','gif','webp'].includes(ext)){
        const buf = await file.arrayBuffer();
        const mediaType = file.type || `image/${ext==='jpg'?'jpeg':ext}`;
        state.assistantFiles.push({ name:file.name, kind:'image', data: arrayBufferToBase64(buf), mediaType });
      } else if(['doc','docx'].includes(ext)){
        await loadScriptOnce(EXPORT_LIBS.mammoth);
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        state.assistantFiles.push({ name:file.name, kind:'text', extractedText: result.value });
      } else if(['xls','xlsx','csv'].includes(ext)){
        await loadScriptOnce(EXPORT_LIBS.xlsx);
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type:'array' });
        const parts = wb.SheetNames.map(name => `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`);
        state.assistantFiles.push({ name:file.name, kind:'text', extractedText: parts.join('\n\n') });
      } else {
        toast(`"${file.name}" isn't a supported file type`);
        continue;
      }
    } catch(e){
      toast(`Could not read "${file.name}" — ${e?.message || 'try a different file'}`);
    }
  }
  render();
}
function assistantDesktopHeader(){
  return `
  <div class="view-head" id="assistantViewHead">
    <div></div>
    <div class="view-actions" id="assistantViewActions">
      <button class="btn btn-outline" id="assistantDesktopSettings">⋯ Settings</button>
      <button class="btn" id="assistantDesktopNew">+ Analyse</button>
    </div>
  </div>`;
}
function renderAssistant(){
  if(state.assistantView === 'saved') return renderAssistantSaved();
  if(state.assistantStep === 'result' && state.assistantResult) return renderAssistantResult();
  const analysing = state.assistantStep === 'analysing';
  const fileRows = state.assistantFiles.map((f,i)=>`
    <div class="file-chip">
      <span>${f.kind==='pdf'?'📄':f.kind==='image'?'🖼️':'📝'}</span>
      <span class="name">${escapeHTML(f.name)}</span>
      <button class="remove" data-remove-file="${i}" ${analysing?'disabled':''}>✕</button>
    </div>`).join('');
  return `
  ${assistantDesktopHeader()}
  <div class="card card-pad" style="max-width:560px;">
    <div class="field">
      <label>Paste text</label>
      <textarea id="assistantText" placeholder="Paste an email or any text here…" style="min-height:100px;" ${analysing?'disabled':''}>${escapeHTML(state.assistantText)}</textarea>
    </div>
    <div class="field">
      <label>Anything specific? <span style="text-transform:none;font-weight:400;color:var(--text-faint);">(optional)</span></label>
      <textarea id="assistantInstruction" placeholder='e.g. "just the figures", "does this contradict last week&#39;s email"…' style="min-height:44px;" ${analysing?'disabled':''}>${escapeHTML(state.assistantInstruction)}</textarea>
      <div class="freq-hint">Leave blank for the standard summary + action points.</div>
    </div>
    <div class="field">
      <label>Attachments</label>
      ${fileRows}
      <input type="file" id="assistantFileInput" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp" style="display:none;">
      <button class="btn btn-outline" id="assistantAttachBtn" style="width:100%;justify-content:center;border-style:dashed;" ${analysing?'disabled':''}>+ Attach files (Word, Excel, PDF, images)</button>
    </div>
    <button class="btn" id="assistantAnalyseBtn" style="width:100%;justify-content:center;margin-top:6px;" ${analysing?'disabled':''}>${analysing?'Analysing…':'Analyse'}</button>
  </div>
  `;
}
function renderAssistantResult(){
  const r = state.assistantResult;
  const points = r.actionPoints || [];
  const pointRows = points.length ? points.map((p,i)=>`
    <div class="watch-row">
      <div class="watch-name" style="font-size:12.5px;font-weight:600;flex:1;">${escapeHTML(p)}</div>
      <button class="icon-btn" data-add-todo="${i}" ${r.addedFlags?.[i]?'disabled':''}>${r.addedFlags?.[i]?'✓ Added':'+ To-Do'}</button>
    </div>`).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:8px 12px;">No action points found.</p>`;
  return `
  ${assistantDesktopHeader()}
  <div class="card card-pad" style="max-width:560px;">
    <div class="field">
      <label>Summary</label>
      <div class="box" style="background:#fff;border:1px solid var(--line-soft);border-radius:9px;padding:13px;font-size:13px;color:var(--ink);line-height:1.6;">${escapeHTML(r.summary || 'No summary available.')}</div>
    </div>
    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <label style="margin:0;">Action points</label>
        ${points.length ? `<button class="icon-btn" id="assistantAddAllBtn">Add all to To-Do</button>` : ''}
      </div>
      <div class="card" style="padding:2px 8px;">${pointRows}</div>
    </div>
    <button class="btn" id="assistantDraftReplyBtn" style="width:100%;justify-content:center;margin-bottom:10px;">✉ Draft a reply</button>
    <button class="btn btn-outline" id="assistantSaveBtn" style="width:100%;justify-content:center;margin-bottom:10px;">💾 Save this analysis</button>
    <button class="btn-link" id="assistantBackBtn">‹ Back to input</button>
  </div>
  `;
}
function renderAssistantSaved(){
  const items = state.cache.contentAnalyses || [];
  const rows = items.length ? items.map(a=>{
    const points = Array.isArray(a.actionPoints) ? a.actionPoints : [];
    const fileCount = (a.fileNames||[]).length;
    return `
    <div class="watch-row">
      <div><div class="watch-name">${escapeHTML((a.summary||'').slice(0,60) || 'Untitled analysis')}${(a.summary||'').length>60?'…':''}</div><div class="watch-meta">${fileCount} attachment${fileCount===1?'':'s'} · ${points.length} action point${points.length===1?'':'s'} · ${humanDate(toISO(new Date(a.createdAt)))}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-open-analysis="${a.id}">Open</button>
      <button class="icon-btn" data-del-analysis="${a.id}">Delete</button>
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No saved analyses yet — save one from the result screen.</p>`;
  return `
  ${assistantDesktopHeader()}
  <div class="card" style="padding:4px 8px;max-width:560px;">${rows}</div>
  `;
}
async function runAssistantAnalysis(){
  const textEl = document.getElementById('assistantText');
  const instrEl = document.getElementById('assistantInstruction');
  const text = (textEl ? textEl.value : state.assistantText).trim();
  const instruction = (instrEl ? instrEl.value : state.assistantInstruction).trim();
  if(!text && state.assistantFiles.length === 0){ toast('Paste some text or attach a file first'); return; }
  state.assistantText = text;
  state.assistantInstruction = instruction;
  state.assistantStep = 'analysing';
  render();
  try{
    const result = await analyseContent({
      text,
      instruction,
      attachments: state.assistantFiles.map(f => f.kind==='text'
        ? { name:f.name, kind:'text', extractedText:f.extractedText }
        : { name:f.name, kind:f.kind, data:f.data, mediaType:f.mediaType }),
    });
    state.assistantResult = { summary: result.summary, actionPoints: result.actionPoints || [], addedFlags: (result.actionPoints||[]).map(()=>false) };
    state.assistantStep = 'result';
  } catch(e){
    toast(e?.message || 'Could not analyse this — check your connection and try again');
    state.assistantStep = 'input';
  }
  render();
}
async function saveActionPointAsTodo(text){
  await DB.add('todos', {
    text, completed:false, dueDate: todayISO(), alertAt:null, alertFired:false,
    source:'email', sourceRef: (state.assistantText||'').slice(0,80) || null,
    createdAt: new Date().toISOString(),
  });
}
function mountAssistant(){
  document.getElementById('assistantDesktopSettings')?.addEventListener('click', ()=>openAssistantSettingsModal());
  document.getElementById('assistantDesktopNew')?.addEventListener('click', ()=>{ resetAssistant(); render(); });

  if(state.assistantView === 'saved'){
    document.querySelectorAll('[data-open-analysis]').forEach(b=>b.addEventListener('click', ()=>{
      const a = (state.cache.contentAnalyses||[]).find(x=>x.id===Number(b.dataset.openAnalysis));
      if(!a) return;
      state.assistantText = a.pastedText || '';
      state.assistantInstruction = a.instruction || '';
      state.assistantResult = { summary: a.summary, actionPoints: a.actionPoints||[], addedFlags: (a.actionPoints||[]).map(()=>false) };
      state.assistantStep = 'result';
      state.assistantView = 'new';
      render();
    }));
    document.querySelectorAll('[data-del-analysis]').forEach(b=>b.addEventListener('click', async ()=>{
      await DB.delete('content_analyses', Number(b.dataset.delAnalysis));
      toast('Analysis deleted'); render();
    }));
    return;
  }

  if(state.assistantStep === 'result'){
    document.querySelectorAll('[data-add-todo]').forEach(b=>b.addEventListener('click', async ()=>{
      const idx = Number(b.dataset.addTodo);
      await saveActionPointAsTodo(state.assistantResult.actionPoints[idx]);
      await refreshCache();
      state.assistantResult.addedFlags[idx] = true;
      toast('Added to To-Do');
      render();
    }));
    document.getElementById('assistantAddAllBtn')?.addEventListener('click', async ()=>{
      const points = state.assistantResult.actionPoints || [];
      for(let i=0;i<points.length;i++){
        if(!state.assistantResult.addedFlags[i]){ await saveActionPointAsTodo(points[i]); state.assistantResult.addedFlags[i] = true; }
      }
      await refreshCache();
      toast(`${points.length} added to To-Do`);
      render();
    });
    document.getElementById('assistantDraftReplyBtn')?.addEventListener('click', ()=>{
      // Deliberately built from the pasted text + the distilled summary/action points
      // only — never from raw attachment/file content, which stays out of Compose
      // entirely so replies don't end up quoting raw data dumps.
      const r = state.assistantResult;
      const parts = [];
      if(state.assistantText && state.assistantText.trim()) parts.push(`Original message:\n"""\n${state.assistantText.trim()}\n"""`);
      if(r?.summary) parts.push(`Summary: ${r.summary}`);
      if(r?.actionPoints?.length) parts.push(`Key points from this analysis:\n${r.actionPoints.map(p=>`- ${p}`).join('\n')}`);
      state.composeReplyContext = parts.join('\n\n') || '(analysis had no text captured)';
      state.composeReplyPreview = r?.summary || state.assistantText || 'Previous analysis';
      state.composeNotes = '';
      state.composeDraft = null;
      state.composeStep = 'input';
      state.composeView = 'new';
      navigate('compose');
    });
    document.getElementById('assistantSaveBtn')?.addEventListener('click', async (e)=>{
      const btn = e.currentTarget;
      const originalLabel = btn.textContent;
      try{
        await DB.add('content_analyses', {
          pastedText: state.assistantText,
          instruction: state.assistantInstruction,
          fileNames: state.assistantFiles.map(f=>f.name),
          summary: state.assistantResult.summary,
          actionPoints: state.assistantResult.actionPoints,
          createdAt: new Date().toISOString(),
        });
        await refreshCache();
        toast('Analysis saved');
        btn.textContent = '✓ Saved';
        setTimeout(()=>{ if(btn.isConnected) btn.textContent = originalLabel; }, 1600);
      } catch(err){
        toast(`Could not save — ${err?.message || 'please try again'}`);
      }
    });
    document.getElementById('assistantBackBtn')?.addEventListener('click', ()=>{
      state.assistantStep = 'input';
      state.assistantFiles = [];
      render();
    });
    return;
  }

  document.getElementById('assistantText')?.addEventListener('input', (e)=>{ state.assistantText = e.target.value; });
  document.getElementById('assistantInstruction')?.addEventListener('input', (e)=>{ state.assistantInstruction = e.target.value; });
  document.getElementById('assistantAttachBtn')?.addEventListener('click', ()=>document.getElementById('assistantFileInput').click());
  document.getElementById('assistantFileInput')?.addEventListener('change', (e)=>{
    if(e.target.files.length) assistantHandleFiles(e.target.files);
    e.target.value = '';
  });
  document.querySelectorAll('[data-remove-file]').forEach(b=>b.addEventListener('click', ()=>{
    state.assistantFiles.splice(Number(b.dataset.removeFile), 1);
    render();
  }));
  document.getElementById('assistantAnalyseBtn')?.addEventListener('click', ()=>runAssistantAnalysis());
}
function openAssistantSettingsModal(){
  const s = state.cache.settings || {};
  const savedCount = (state.cache.contentAnalyses||[]).length;
  const body = `
    <div class="field">
      <label>View</label>
      <div class="chip-filter">
        <button class="chip ${state.assistantView==='new'?'active':''}" data-assistant-view="new">Analyse</button>
        <button class="chip ${state.assistantView==='saved'?'active':''}" data-assistant-view="saved">Saved${savedCount?` (${savedCount})`:''}</button>
        <button class="chip" id="assistantClearBtn">Clear text &amp; files</button>
      </div>
    </div>
    <div class="field">
      <label>Default instruction <span style="text-transform:none;font-weight:400;color:var(--text-faint);">(optional)</span></label>
      <input id="assistantDefaultInstruction" value="${escapeHTML(s.assistantDefaultInstruction||'')}" placeholder="e.g. always flag anything Health &amp; Safety related">
      <div class="freq-hint">Pre-fills "Anything specific?" every time — still editable per analysis.</div>
    </div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn" id="assistantSettingsDone">Done</button></div>`;
  showModal('Assistant settings', body, foot);

  document.querySelectorAll('[data-assistant-view]').forEach(b=>b.addEventListener('click', ()=>{
    state.assistantView = b.dataset.assistantView;
    closeModal();
    render();
  }));
  document.getElementById('assistantClearBtn').addEventListener('click', ()=>{
    resetAssistant();
    closeModal();
    render();
  });
  document.getElementById('assistantDefaultInstruction').addEventListener('change', async (e)=>{
    const current = state.cache.settings || {};
    await DB.put('settings', { id:'settings', ...current, assistantDefaultInstruction: e.target.value });
    await refreshCache();
  });
  document.getElementById('assistantSettingsDone').addEventListener('click', ()=>{ closeModal(); render(); });
}

/* ================= SEARCH ================= */
const EVENT_TYPE_FILTERS = [['all','All types'],['techVisit','Tech visits'],['qaVisit','QA visits'],['oneOnOne','1-1s'],['wfh','WFH'],['leave','Leave'],['other','Other']];
const TIME_FILTERS = [['all','All time'],['week','This week'],['month','This month'],['missed','Missed / unconfirmed'],['upcoming','Upcoming']];

function renderSearch(){
  const typeChips = EVENT_TYPE_FILTERS.map(([k,label])=>
    `<button class="chip ${state.searchTypeFilter===k?'active':''}" data-search-type="${k}">${label}</button>`).join('');
  const timeChips = TIME_FILTERS.map(([k,label])=>
    `<button class="chip ${state.searchTimeFilter===k?'active':''}" data-search-time="${k}">${label}</button>`).join('');
  return `
  <div class="view-head"><div><h1>Search</h1><div class="view-sub">Find a technician, client site, or logged visit — or just filter by type and time</div></div></div>
  <div class="search-hero"><input type="search" id="searchInput" placeholder="Try “Larisa”, “LEK Consulting”, “overdue”…" value="${escapeHTML(state.searchQuery)}"></div>
  <div class="toolbar" style="margin-bottom:6px;"><div class="chip-filter">${typeChips}</div></div>
  <div class="toolbar" style="margin-bottom:16px;"><div class="chip-filter">${timeChips}</div></div>
  <div id="searchResults"></div>
  `;
}
function mountSearch(){
  const input = document.getElementById('searchInput');
  input.addEventListener('input', ()=>{ state.searchQuery = input.value; renderSearchResults(); });
  input.focus();
  document.querySelectorAll('[data-search-type]').forEach(b=>b.addEventListener('click', ()=>{
    state.searchTypeFilter = b.dataset.searchType; render();
  }));
  document.querySelectorAll('[data-search-time]').forEach(b=>b.addEventListener('click', ()=>{
    state.searchTimeFilter = b.dataset.searchTime; render();
  }));
  renderSearchResults();
}
function renderSearchResults(){
  const q = state.searchQuery.trim().toLowerCase();
  const typeFilter = state.searchTypeFilter || 'all';
  const timeFilter = state.searchTimeFilter || 'all';
  const box = document.getElementById('searchResults');
  const hasFilter = typeFilter!=='all' || timeFilter!=='all';
  if(!q && !hasFilter){ box.innerHTML = `<div class="empty"><p>Start typing, or pick a filter above, to browse technicians, sites and logged visits.</p></div>`; return; }

  const today = todayISO();
  const wkStart = toISO(mondayOf(new Date()));
  const wkEnd = toISO(addDays(mondayOf(new Date()),6));
  const now = new Date();
  const moStart = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const moEnd = toISO(new Date(now.getFullYear(), now.getMonth()+1, 0));

  function inTimeframe(e){
    if(timeFilter==='week') return e.date>=wkStart && e.date<=wkEnd;
    if(timeFilter==='month') return e.date>=moStart && e.date<=moEnd;
    if(timeFilter==='missed') return e.date<today && !e.completed;
    if(timeFilter==='upcoming') return e.date>=today;
    return true;
  }

  // the legacy "overdue" free-text keyword (technician/site recurring status) only applies
  // when browsing with no chip filters active, to keep plain typing behaviour familiar
  const wantsOverdueKeyword = q.includes('overdue') && !hasFilter;

  let techMatches = [], siteMatches = [];
  if(typeFilter==='all'){
    techMatches = state.cache.technicians.filter(t=>{
      if(wantsOverdueKeyword){ const tv=techVisitStatus(t), oo=oneOnOneStatus(t); return tv.state==='overdue'||oo.state==='overdue'; }
      if(!q) return false;
      return t.name.toLowerCase().includes(q) || (t.area||'').toLowerCase().includes(q);
    });
    siteMatches = state.cache.sites.filter(s=>{
      if(wantsOverdueKeyword){ const qa = siteQAStatus(s); return qa && qa.state==='overdue'; }
      if(!q) return false;
      return s.name.toLowerCase().includes(q) || (s.address||'').toLowerCase().includes(q) || (s.notes||'').toLowerCase().includes(q);
    });
  }

  const eventMatches = wantsOverdueKeyword ? [] : state.cache.events.filter(e=>{
    if(typeFilter!=='all' && e.type!==typeFilter) return false;
    if(!inTimeframe(e)) return false;
    if(q){
      const who = e.technicianId? techName(e.technicianId): '';
      const where = e.siteId? siteName(e.siteId): '';
      const matches = (e.title||'').toLowerCase().includes(q) || (e.notes||'').toLowerCase().includes(q) || who.toLowerCase().includes(q) || where.toLowerCase().includes(q);
      if(!matches) return false;
    }
    return true;
  }).sort((a,b)=> a.date.localeCompare(b.date)).slice(0,80);

  function group(title, items){
    if(!items.length) return '';
    return `<div class="result-group"><div class="result-group-title">${title} (${items.length})</div><div class="card">${items.join('')}</div></div>`;
  }

  const techHTML = techMatches.map(t=>{
    const tv=techVisitStatus(t), oo=oneOnOneStatus(t);
    return `<div class="result-item" data-open-tech="${t.id}">
      <div class="row-name">${escapeHTML(t.name)}</div>
      <div class="row-sub">${zoneByKey(t.region).label} · Tech visit: ${tv.label} · 1-1: ${oo.label}</div>
    </div>`;
  });
  const siteHTML = siteMatches.map(s=>{
    const qa = siteQAStatus(s);
    return `<div class="result-item" data-open-site="${s.id}">
      <div class="row-name">${escapeHTML(s.name)}</div>
      <div class="row-sub">${zoneByKey(s.region).label}${qa? ' · QA: '+qa.label : ''}</div>
    </div>`;
  });
  const eventHTML = eventMatches.map(e=>{
    const who = e.technicianId? techName(e.technicianId): null;
    const where = e.siteId? siteName(e.siteId): null;
    const isMissed = !e.completed && e.date < today;
    const statusBadge = isMissed ? `<span class="badge badge-overdue">Missed</span>` : e.completed ? `<span class="badge badge-ok">Done</span>` : `<span class="badge badge-scheduled">Scheduled</span>`;
    return `<div class="result-item" data-open-event="${e.id}" data-event-date="${e.date}" style="display:flex;align-items:center;gap:12px;">
      <div style="flex:1;min-width:0;">
        <div class="row-name">${eventTypeByKey(e.type).label}${who? ' — '+escapeHTML(who):''}${where? ' — '+escapeHTML(where):''}</div>
        <div class="row-sub">${humanDate(e.date)}${e.notes? ' · '+escapeHTML(e.notes).slice(0,80):''}</div>
      </div>
      ${statusBadge}
    </div>`;
  });

  const html = group('Technicians', techHTML) + group('Client sites', siteHTML) + group(timeFilter==='missed'?'Outstanding visits':'Logged visits', eventHTML);
  box.innerHTML = html || `<div class="empty"><h3>No matches</h3><p>Try a different name, site, filter, or type “overdue”.</p></div>`;

  box.querySelectorAll('[data-open-tech]').forEach(el=>el.addEventListener('click', ()=>openTechnicianForm(Number(el.dataset.openTech))));
  box.querySelectorAll('[data-open-site]').forEach(el=>el.addEventListener('click', ()=>openSiteForm(Number(el.dataset.openSite))));
  box.querySelectorAll('[data-open-event]').forEach(el=>el.addEventListener('click', ()=>{
    state.weekStart = mondayOf(fromISO(el.dataset.eventDate));
    navigate('schedule');
    setTimeout(()=>openEventForm(null, Number(el.dataset.openEvent)), 50);
  }));
}

/* ================= SETTINGS ================= */
function renderSettings(){
  const s = state.cache.settings || { techVisitsPerWeekMin:3, qaVisitsPerWeekMin:4, oneOnOnesPerWeekMax:3, wfhWeekday:3 };
  const zones = zoneList();
  const zoneRows = zones.length ? zones.map(z=>{
    const memberCount = state.cache.technicians.filter(t=>t.region===z.key).length;
    return `
    <div class="watch-row">
      <span class="dot" style="background:${z.color};margin-right:2px;"></span>
      <div><div class="watch-name">${escapeHTML(z.label)}</div><div class="watch-meta">${memberCount} technician${memberCount===1?'':'s'}${z.soloRequired?' · always visited alone':''}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-edit-zone="${z.id}">Edit</button>
      <button class="icon-btn" data-del-zone="${z.id}">Remove</button>
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No zones yet.</p>`;
  const blocks = state.cache.recurringBlocks || [];
  const blockRows = blocks.length ? blocks.map(b=>{
    const rangeBits = [];
    if(b.startDate) rangeBits.push(`from ${humanDateShort(b.startDate)}`);
    if(b.endDate) rangeBits.push(`until ${humanDateShort(b.endDate)}`);
    const rangeText = rangeBits.length ? ' · '+rangeBits.join(' ') : '';
    return `
    <div class="watch-row">
      <div><div class="watch-name">${escapeHTML(b.label)}</div><div class="watch-meta">Every ${DOW_SHORT[b.weekday-1]}${b.time?' · '+b.time:''}${rangeText}${b.active?'':' · Inactive'}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-clear-block="${b.id}">Clear instances</button>
      <button class="icon-btn" data-edit-block="${b.id}">Edit</button>
      <button class="icon-btn" data-del-block="${b.id}">Remove</button>
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No recurring blocks yet.</p>`;
  const emailSamples = state.cache.emailVoiceSamples || [];
  const emailSampleRows = emailSamples.length ? emailSamples.map(e=>`
    <div class="watch-row">
      <div><div class="watch-name">${escapeHTML(e.label || 'Untitled example')}</div><div class="watch-meta">${escapeHTML(e.content.slice(0,60))}${e.content.length>60?'…':''}</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-edit-sample="${e.id}">Edit</button>
      <button class="icon-btn" data-del-sample="${e.id}">Remove</button>
    </div>`).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No examples yet — add a few real emails you've sent so drafts sound like you.</p>`;
  const eventTypeRows = eventTypeList().length ? eventTypeList().map(t=>{
    const usageCount = state.cache.events.filter(e=>e.type===t.key).length;
    return `
    <div class="watch-row">
      <span class="dot" style="background:${t.color};margin-right:2px;"></span>
      <div><div class="watch-name">${escapeHTML(t.label)}${t.isSystem?' <span class="badge badge-neutral" style="margin-left:4px;">Built-in</span>':''}</div><div class="watch-meta">Shows as "${escapeHTML(t.short)}" on the board · ${usageCount} event${usageCount===1?'':'s'} using it</div></div>
      <div class="watch-spacer"></div>
      <button class="icon-btn" data-edit-etype="${t.id}">Edit</button>
      ${t.isSystem ? '' : `<button class="icon-btn" data-del-etype="${t.id}">Remove</button>`}
    </div>`;
  }).join('') : `<p style="font-size:12px;color:var(--text-faint);margin:4px 0;">No event types yet.</p>`;
  return `
  <div class="view-head"><div><h1>Settings</h1><div class="view-sub">KPI targets and defaults</div></div></div>
  <div class="card card-pad" style="max-width:480px;">
    <div class="field-row">
      <div class="field"><label>Min tech visits / week</label><input type="number" id="setTV" value="${s.techVisitsPerWeekMin}" min="1"></div>
      <div class="field"><label>Min QA visits / week</label><input type="number" id="setQA" value="${s.qaVisitsPerWeekMin}" min="1"></div>
    </div>
    <div class="field"><label>Max 1-1s / week (generator)</label><input type="number" id="setOO" value="${s.oneOnOnesPerWeekMax||3}" min="1"></div>
    <div class="field"><label>Working-from-home day</label>
      <select id="setWFH">
        ${DOW_SHORT.map((d,i)=>`<option value="${i+1}" ${s.wfhWeekday===i+1?'selected':''}>${d}</option>`).join('')}
      </select>
    </div>
    <button class="btn" id="setSave">Save settings</button>
  </div>
  <div class="card card-pad" style="max-width:480px;margin-top:16px;">
    <h3 style="margin-bottom:4px;">Technician zones</h3>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px;">Groups used for batching visits by area (the Thames-divide idea, or whatever suits you). The generator schedules each zone's technicians on the same days where possible.</p>
    <div id="zoneList">${zoneRows}</div>
    <button class="btn btn-outline btn-small" id="addZoneBtn" style="margin-top:8px;">+ Add zone</button>
  </div>
  <div class="card card-pad" style="max-width:480px;margin-top:16px;">
    <h3 style="margin-bottom:4px;">Event types</h3>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px;">The options in the "Type" dropdown when adding an event. Built-in types drive scheduling, cadence tracking, and reports, so they can be renamed and recoloured but not removed. Add your own for anything else — meetings, training, admin days.</p>
    <div id="eventTypeList">${eventTypeRows}</div>
    <button class="btn btn-outline btn-small" id="addEventTypeBtn" style="margin-top:8px;">+ Add event type</button>
  </div>
  <div class="card card-pad" style="max-width:480px;margin-top:16px;">
    <h3 style="margin-bottom:4px;">Recurring blocked events</h3>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px;">Weekly commitments like Teams huddles or an extra WFH day. These appear on the board automatically every week but don't stop tech/QA visits being booked alongside them.</p>
    <div id="blockList">${blockRows}</div>
    <button class="btn btn-outline btn-small" id="addBlockBtn" style="margin-top:8px;">+ Add recurring block</button>
  </div>
  <div class="card card-pad" style="max-width:480px;margin-top:16px;">
    <h3 style="margin-bottom:4px;">Email voice</h3>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:10px;">Paste in a few real emails you've sent — Compose uses these to match your natural tone and phrasing when drafting new ones. Set up once, update occasionally.</p>
    <div id="emailSampleList">${emailSampleRows}</div>
    <button class="btn btn-outline btn-small" id="addEmailSampleBtn" style="margin-top:8px;">+ Add example email</button>
  </div>
  <div class="card card-pad" style="max-width:480px;margin-top:16px;">
    <h3 style="margin-bottom:8px;">Data</h3>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:12px;">Everything is stored locally in this browser (IndexedDB) — nothing is sent to a server.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-outline" id="exportBtn">Export backup (.json)</button>
      <button class="btn btn-outline" id="clearEventsBtn">Clear schedule</button>
      <button class="btn btn-danger" id="resetAllBtn">Reset all data</button>
    </div>
  </div>
  `;
}
function openEventTypeForm(editId){
  const existing = editId ? eventTypeList().find(t=>t.id===editId) : null;
  const v = existing || { label:'', short:'', color:'#8A5A2C' };
  const body = `
    <div class="field"><label>Name</label><input id="etLabel" value="${escapeHTML(v.label)}" placeholder="e.g. Training, Client meeting…"></div>
    <div class="field"><label>Short label (shown on the board tile)</label><input id="etShort" value="${escapeHTML(v.short)}" placeholder="e.g. Training" maxlength="16"></div>
    <div class="field"><label>Colour</label><input type="color" id="etColor" value="${v.color}" style="height:40px;padding:4px;"></div>
    ${existing?.isSystem ? `<p class="freq-hint">This is a built-in type used by scheduling/reports — you can rename or recolour it, but it can't be removed.</p>` : ''}
  `;
  const foot = `
    ${existing && !existing.isSystem ? `<button class="btn btn-danger" id="etDelete">Remove</button>` : `<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="etCancel">Cancel</button><button class="btn" id="etSave">${existing?'Save':'Add'}</button></div>
  `;
  showModal(existing?'Edit event type':'Add event type', body, foot);
  document.getElementById('etCancel').addEventListener('click', closeModal);
  document.getElementById('etDelete')?.addEventListener('click', ()=>{ closeModal(); confirmDeleteEventType(editId); });
  document.getElementById('etSave').addEventListener('click', async ()=>{
    const label = document.getElementById('etLabel').value.trim();
    const short = document.getElementById('etShort').value.trim();
    if(!label){ toast('Name is required'); return; }
    if(!short){ toast('Short label is required'); return; }
    const color = document.getElementById('etColor').value;
    if(existing){
      await DB.put('event_types', { ...existing, label, short, color });
    } else {
      const base = label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'type';
      let key = base, n = 1;
      while(eventTypeList().some(t=>t.key===key)){ key = `${base}-${++n}`; }
      const maxOrder = eventTypeList().reduce((m,t)=>Math.max(m, t.sortOrder||0), 0);
      await DB.add('event_types', { key, label, short, color, isSystem:false, sortOrder: maxOrder+1, createdAt: new Date().toISOString() });
    }
    closeModal(); toast(existing?'Event type updated':'Event type added'); render();
  });
}
function confirmDeleteEventType(id){
  const t = eventTypeList().find(x=>x.id===id);
  if(!t || t.isSystem) return;
  const affected = state.cache.events.filter(e=>e.type===t.key).length;
  const warn = affected
    ? `<p style="font-size:12.5px;color:var(--clay);margin-top:8px;">${affected} existing event${affected===1?'':'s'} using this type will be switched to "Other / admin" — not deleted.</p>`
    : '';
  showModal('Remove event type', `<p>Remove <strong>${escapeHTML(t.label)}</strong>?</p>${warn}`,
    `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">Remove</button></div>`);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{
    for(const e of state.cache.events.filter(e=>e.type===t.key)) await DB.put('events', { ...e, type:'other' });
    await DB.delete('event_types', id);
    closeModal(); toast('Event type removed'); render();
  });
}
function openZoneForm(editId){
  const existing = editId ? zoneList().find(z=>z.id===editId) : null;
  const v = existing || { label:'', color:'#2C6E8C', soloRequired:false };
  const body = `
    <div class="field"><label>Name</label><input id="zLabel" value="${escapeHTML(v.label)}" placeholder="e.g. North East, Overseas, Zone 4…"></div>
    <div class="field"><label>Colour</label><input type="color" id="zColor" value="${v.color}" style="height:40px;padding:4px;"></div>
    <div class="field"><label><input type="checkbox" id="zSolo" ${v.soloRequired?'checked':''} style="width:auto;"> Technicians in this zone are always visited alone</label>
      <div class="freq-hint">Use this for a distant/outlying zone where it doesn't make sense to pair visits with anyone else that day.</div>
    </div>
  `;
  const foot = `
    ${existing ? `<button class="btn btn-danger" id="zDelete">Remove</button>` : `<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="zCancel">Cancel</button><button class="btn" id="zSave">${existing?'Save':'Add'}</button></div>
  `;
  showModal(existing?'Edit zone':'Add zone', body, foot);
  document.getElementById('zCancel').addEventListener('click', closeModal);
  document.getElementById('zDelete')?.addEventListener('click', ()=>{ closeModal(); confirmDeleteZone(editId); });
  document.getElementById('zSave').addEventListener('click', async ()=>{
    const label = document.getElementById('zLabel').value.trim();
    if(!label){ toast('Name is required'); return; }
    const color = document.getElementById('zColor').value;
    const soloRequired = document.getElementById('zSolo').checked;
    if(existing){
      await DB.put('zones', { ...existing, label, color, soloRequired });
    } else {
      // generate a stable, unique-ish key from the label
      const base = label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'zone';
      let key = base, n = 1;
      while(zoneList().some(z=>z.key===key)){ key = `${base}-${++n}`; }
      const maxOrder = zoneList().reduce((m,z)=>Math.max(m, z.sortOrder||0), 0);
      await DB.add('zones', { key, label, color, soloRequired, sortOrder: maxOrder+1, createdAt: new Date().toISOString() });
    }
    closeModal(); toast(existing?'Zone updated':'Zone added'); render();
  });
}
function confirmDeleteZone(id){
  const z = zoneList().find(x=>x.id===id);
  if(!z) return;
  const affectedTechs = state.cache.technicians.filter(t=>t.region===z.key).length;
  const affectedSites = state.cache.sites.filter(s=>s.region===z.key).length;
  const warn = (affectedTechs||affectedSites)
    ? `<p style="font-size:12.5px;color:var(--clay);margin-top:8px;">${affectedTechs} technician${affectedTechs===1?'':'s'} and ${affectedSites} site${affectedSites===1?'':'s'} currently use this zone — they'll be marked as unzoned, not deleted.</p>`
    : '';
  showModal('Remove zone', `<p>Remove <strong>${escapeHTML(z.label)}</strong>?</p>${warn}`,
    `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">Remove</button></div>`);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{
    for(const t of state.cache.technicians.filter(t=>t.region===z.key)) await DB.put('technicians', { ...t, region:'' });
    for(const s of state.cache.sites.filter(s=>s.region===z.key)) await DB.put('sites', { ...s, region:'' });
    await DB.delete('zones', id);
    closeModal(); toast('Zone removed'); render();
  });
}
function openBlockForm(editId){
  const existing = editId ? (state.cache.recurringBlocks||[]).find(b=>b.id===editId) : null;
  const v = existing || { label:'', weekday:1, time:'', active:true, startDate:'', endDate:'' };
  const body = `
    <div class="field"><label>Label</label><input id="bLabel" value="${escapeHTML(v.label)}" placeholder="e.g. Team huddle"></div>
    <div class="field-row">
      <div class="field"><label>Every</label><select id="bWeekday">${DOW_SHORT.map((d,i)=>`<option value="${i+1}" ${v.weekday===i+1?'selected':''}>${d}</option>`).join('')}</select></div>
      <div class="field"><label>Time (optional)</label><input type="time" id="bTime" value="${v.time||''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Starts (optional)</label><input type="date" id="bStart" value="${v.startDate||''}"></div>
      <div class="field"><label>Ends (optional)</label><input type="date" id="bEnd" value="${v.endDate||''}"></div>
    </div>
    <div class="freq-hint" style="margin-top:-8px;margin-bottom:14px;">Leave either blank for no limit — e.g. set only an end date for a huddle series that's wrapping up.</div>
    <div class="field"><label><input type="checkbox" id="bActive" ${v.active?'checked':''} style="width:auto;"> Active</label></div>
  `;
  const foot = `
    ${existing?`<button class="btn btn-danger" id="bDelete">Remove</button>`:`<span></span>`}
    <div class="modal-foot-right"><button class="btn btn-outline" id="bCancel">Cancel</button><button class="btn" id="bSave">${existing?'Save':'Add'}</button></div>
  `;
  showModal(existing?'Edit recurring block':'Add recurring block', body, foot);
  document.getElementById('bCancel').addEventListener('click', closeModal);
  document.getElementById('bDelete')?.addEventListener('click', ()=>{ closeModal(); openBlockCleanup(editId, true); });
  document.getElementById('bSave').addEventListener('click', async ()=>{
    const label = document.getElementById('bLabel').value.trim();
    if(!label){ toast('Label is required'); return; }
    const startDate = document.getElementById('bStart').value || null;
    const endDate = document.getElementById('bEnd').value || null;
    if(startDate && endDate && startDate > endDate){ toast('Start date must be before the end date'); return; }
    const obj = {
      label,
      weekday: Number(document.getElementById('bWeekday').value),
      time: document.getElementById('bTime').value,
      startDate,
      endDate,
      active: document.getElementById('bActive').checked,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if(existing) obj.id = existing.id;
    await DB.put('recurring_blocks', obj);
    closeModal(); toast(existing?'Recurring block updated':'Recurring block added'); render();
  });
}

/* ---------- bulk cleanup of already-materialized recurring block instances ---------- */
async function deleteBlockInstances(label, fromDate){
  const toDelete = state.cache.events.filter(e => e.type==='block' && e.title===label && (!fromDate || e.date>=fromDate));
  for(const e of toDelete) await DB.delete('events', e.id);
  return toDelete.length;
}
function openBlockCleanup(blockId, removeTemplateToo){
  const b = (state.cache.recurringBlocks||[]).find(x=>x.id===blockId);
  if(!b) return;
  const today = todayISO();
  const title = removeTemplateToo ? 'Remove recurring block' : 'Clear instances';
  const intro = removeTemplateToo
    ? `Remove <strong>${escapeHTML(b.label)}</strong> (every ${DOW_SHORT[b.weekday-1]}). What should happen to the entries already on the board?`
    : `Bulk-delete already-created entries for <strong>${escapeHTML(b.label)}</strong>. The recurring rule keeps running afterwards and will keep creating new ones.`;
  const body = `
    <p style="font-size:13px;margin-bottom:12px;line-height:1.5;">${intro}</p>
    <div class="field">
      ${removeTemplateToo ? `
      <label style="display:flex;gap:8px;font-weight:400;text-transform:none;margin-bottom:10px;align-items:flex-start;">
        <input type="radio" name="delMode" value="keep" checked style="width:auto;margin-top:3px;">
        <span><strong>Keep all entries</strong> — just stop creating new ones going forward.</span>
      </label>` : ''}
      <label style="display:flex;gap:8px;font-weight:400;text-transform:none;margin-bottom:10px;align-items:flex-start;">
        <input type="radio" name="delMode" value="future" ${removeTemplateToo?'':'checked'} style="width:auto;margin-top:3px;">
        <span><strong>Delete from a date onward</strong> — keeps history before that date.</span>
      </label>
      <input type="date" id="delFromDate" value="${today}" style="margin-left:24px;margin-bottom:10px;width:calc(100% - 24px);">
      <label style="display:flex;gap:8px;font-weight:400;text-transform:none;align-items:flex-start;">
        <input type="radio" name="delMode" value="all" style="width:auto;margin-top:3px;">
        <span><strong>Delete every instance</strong> — past and future, permanently.</span>
      </label>
    </div>
  `;
  const foot = `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">${removeTemplateToo?'Remove':'Delete'}</button></div>`;
  showModal(title, body, foot);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{
    const mode = document.querySelector('input[name="delMode"]:checked').value;
    let deletedCount = 0;
    if(mode==='all'){
      deletedCount = await deleteBlockInstances(b.label, null);
    } else if(mode==='future'){
      const fromDate = document.getElementById('delFromDate').value || today;
      deletedCount = await deleteBlockInstances(b.label, fromDate);
    }
    if(removeTemplateToo) await DB.delete('recurring_blocks', blockId);
    closeModal();
    const msg = removeTemplateToo
      ? (deletedCount>0 ? `Removed — ${deletedCount} instance${deletedCount===1?'':'s'} also deleted` : 'Recurring block removed')
      : `${deletedCount} instance${deletedCount===1?'':'s'} deleted`;
    toast(msg);
    render();
  });
}
function mountSettings(){
  document.getElementById('setSave').addEventListener('click', async ()=>{
    await DB.put('settings', {
      id:'settings',
      techVisitsPerWeekMin: Number(document.getElementById('setTV').value)||3,
      qaVisitsPerWeekMin: Number(document.getElementById('setQA').value)||4,
      oneOnOnesPerWeekMax: Number(document.getElementById('setOO').value)||3,
      wfhWeekday: Number(document.getElementById('setWFH').value)||3,
    });
    toast('Settings saved'); render();
  });
  document.getElementById('addZoneBtn').addEventListener('click', ()=>openZoneForm());
  document.querySelectorAll('[data-edit-zone]').forEach(b=>b.addEventListener('click', ()=>openZoneForm(Number(b.dataset.editZone))));
  document.querySelectorAll('[data-del-zone]').forEach(b=>b.addEventListener('click', ()=>confirmDeleteZone(Number(b.dataset.delZone))));
  document.getElementById('addEventTypeBtn').addEventListener('click', ()=>openEventTypeForm());
  document.querySelectorAll('[data-edit-etype]').forEach(b=>b.addEventListener('click', ()=>openEventTypeForm(Number(b.dataset.editEtype))));
  document.querySelectorAll('[data-del-etype]').forEach(b=>b.addEventListener('click', ()=>confirmDeleteEventType(Number(b.dataset.delEtype))));
  document.getElementById('addBlockBtn').addEventListener('click', ()=>openBlockForm());
  document.querySelectorAll('[data-edit-block]').forEach(b=>b.addEventListener('click', ()=>openBlockForm(Number(b.dataset.editBlock))));
  document.querySelectorAll('[data-clear-block]').forEach(b=>b.addEventListener('click', ()=>openBlockCleanup(Number(b.dataset.clearBlock), false)));
  document.querySelectorAll('[data-del-block]').forEach(b=>b.addEventListener('click', ()=>openBlockCleanup(Number(b.dataset.delBlock), true)));
  document.getElementById('addEmailSampleBtn').addEventListener('click', ()=>openEmailSampleForm());
  document.querySelectorAll('[data-edit-sample]').forEach(b=>b.addEventListener('click', ()=>openEmailSampleForm(Number(b.dataset.editSample))));
  document.querySelectorAll('[data-del-sample]').forEach(b=>b.addEventListener('click', async ()=>{
    await DB.delete('email_voice_samples', Number(b.dataset.delSample));
    toast('Example removed'); render();
  }));
  document.getElementById('exportBtn').addEventListener('click', async ()=>{
    const data = {
      technicians: await DB.getAll('technicians'),
      sites: await DB.getAll('sites'),
      events: await DB.getAll('events'),
      settings: await DB.get('settings','settings'),
      recurringBlocks: await DB.getAll('recurring_blocks'),
      zones: await DB.getAll('zones'),
      huddleAttendance: await DB.getAll('huddle_attendance'),
      fleetcheckRecords: await DB.getAll('fleetcheck_records'),
      todos: await DB.getAll('todos'),
      eventTypes: await DB.getAll('event_types'),
      emailVoiceSamples: await DB.getAll('email_voice_samples'),
      emailDrafts: await DB.getAll('email_drafts'),
      contentAnalyses: await DB.getAll('content_analyses'),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `routeboard-backup-${todayISO()}.json`;
    a.click();
  });
  document.getElementById('clearEventsBtn').addEventListener('click', confirmClearEvents);
  document.getElementById('resetAllBtn').addEventListener('click', confirmResetAll);
}

function confirmClearEvents(){
  showModal('Clear schedule', `
    <p>Delete every logged and scheduled visit — tech visits, QA visits, 1-1s, WFH and leave entries.
    Technicians, client sites and settings are all kept exactly as they are.</p>
  `, `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">Clear schedule</button></div>`);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{
    await DB.clear('events');
    closeModal(); toast('Schedule cleared');
    state.weekStart = mondayOf(new Date());
    navigate('dashboard');
  });
}

function confirmResetAll(){
  showModal('Reset all data', `
    <p>This deletes <strong>everything</strong> — all technicians, client sites, and logged/scheduled
    visits — and restores the app to its starting state (the original 11 technicians, the
    "General / TBC" placeholder site, and default KPI targets).</p>
    <p style="margin-top:10px;font-size:12.5px;color:var(--clay);font-weight:600;">This can't be undone. Export a backup first if you want to keep a copy.</p>
  `, `<span></span><div class="modal-foot-right"><button class="btn btn-outline" id="cCancel">Cancel</button><button class="btn btn-danger" id="cConfirm">Reset everything</button></div>`);
  document.getElementById('cCancel').addEventListener('click', closeModal);
  document.getElementById('cConfirm').addEventListener('click', async ()=>{
    await DB.clear('technicians');
    await DB.clear('sites');
    await DB.clear('events');
    await DB.clear('settings');
    await DB.clear('recurring_blocks');
    await DB.clear('zones');
    await DB.clear('event_types');
    await DB.clear('todos');
    await DB.clear('huddle_attendance');
    await DB.clear('fleetcheck_records');
    await DB.clear('email_voice_samples');
    await DB.clear('email_drafts');
    await DB.clear('content_analyses');
    await seedIfEmpty();
    closeModal(); toast('All data reset');
    state.weekStart = mondayOf(new Date());
    navigate('dashboard');
  });
}

/* ================= boot ================= */
function initNav(){
  document.querySelectorAll('.nav-item[data-route]').forEach(b=>b.addEventListener('click', ()=>navigate(b.dataset.route)));
  document.getElementById('hamburger').addEventListener('click', ()=>document.getElementById('app').classList.toggle('nav-open'));
  document.getElementById('topbarAdd').addEventListener('click', ()=>{
    if(state.route==='todos') openTodoForm();
    else if(state.route==='compose'){
      state.composeNotes = '';
      state.composeDraft = null;
      state.composeReplyContext = '';
      state.composeReplyPreview = '';
      state.composeStep = 'input';
      state.composeView = 'new';
      render();
    }
    else if(state.route==='assistant'){
      resetAssistant();
      render();
    }
    else openEventForm({ date: todayISO() });
  });
  document.getElementById('topbarSettings').addEventListener('click', ()=>{
    if(state.route==='compose') openEmailSettingsModal();
    else if(state.route==='assistant') openAssistantSettingsModal();
    else openTodoSettingsModal();
  });
  document.getElementById('logoutBtn').addEventListener('click', ()=>Auth.signOut());
  window.addEventListener('hashchange', ()=>{
    const r = location.hash.replace('#','') || 'dashboard';
    if(ROUTE_TITLES[r] && r !== state.route) navigate(r);
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  const hint = document.getElementById('installHint');
  if(hint) hint.hidden = false;
});
document.addEventListener('click', (e)=>{
  if(e.target?.id==='installBtn' && deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
  }
});

/* ---------------- auth screen ---------------- */
let authMode = 'signin';
let appStarted = false;

function showAuthScreen(){
  document.getElementById('authScreen').hidden = false;
  document.getElementById('app').hidden = true;
}
function showAppShell(){
  document.getElementById('authScreen').hidden = true;
  document.getElementById('app').hidden = false;
}

function initAuthForm(){
  const toggle = document.getElementById('authToggle');
  const submit = document.getElementById('authSubmit');
  const title = document.getElementById('authTitle');
  const errBox = document.getElementById('authError');
  const emailInput = document.getElementById('authEmail');
  const passInput = document.getElementById('authPassword');

  function setMode(mode){
    authMode = mode;
    title.textContent = mode==='signin' ? 'Sign in' : 'Create account';
    submit.textContent = mode==='signin' ? 'Sign in' : 'Sign up';
    toggle.textContent = mode==='signin' ? "Need an account? Sign up" : 'Already have an account? Sign in';
    errBox.hidden = true;
  }

  toggle.addEventListener('click', ()=> setMode(authMode==='signin' ? 'signup' : 'signin'));

  async function submitForm(){
    const email = emailInput.value.trim();
    const password = passInput.value;
    errBox.hidden = true;
    if(!email || !password){
      errBox.textContent = 'Enter an email and password.';
      errBox.style.color = 'var(--clay)';
      errBox.hidden = false;
      return;
    }
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Please wait…';
    try{
      const { error } = authMode==='signin' ? await Auth.signIn(email, password) : await Auth.signUp(email, password);
      if(error){
        errBox.textContent = error.message;
        errBox.style.color = 'var(--clay)';
        errBox.hidden = false;
      } else if(authMode==='signup'){
        errBox.textContent = 'Account created — check your email to confirm it, then sign in below.';
        errBox.style.color = 'var(--forest-dim)';
        errBox.hidden = false;
        setMode('signin');
      }
      // successful sign-in is picked up by the onAuthStateChange listener in boot()
    } catch(e){
      errBox.textContent = e?.message || 'Something went wrong — check your connection and try again.';
      errBox.style.color = 'var(--clay)';
      errBox.hidden = false;
    }
    submit.disabled = false;
    submit.textContent = original;
  }

  submit.addEventListener('click', submitForm);
  [emailInput, passInput].forEach(el=>el.addEventListener('keydown', (e)=>{ if(e.key==='Enter') submitForm(); }));
}

/* ---------------- boot ---------------- */
async function startApp(){
  if(appStarted) return; // guard against onAuthStateChange firing more than once
  appStarted = true;
  await seedIfEmpty();
  initNav();
  const startRoute = (location.hash.replace('#','')) || 'dashboard';
  navigate(ROUTE_TITLES[startRoute] ? startRoute : 'dashboard');

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline caching optional */ });
  }

  // to-do alerts: only fire while this tab is open — check now, then every minute
  setTimeout(checkTodoAlerts, 3000);
  setInterval(checkTodoAlerts, 60000);
}

async function boot(){
  initAuthForm();
  const session = await Auth.getSession();
  if(session){
    showAppShell();
    await startApp();
  } else {
    showAuthScreen();
  }
  Auth.onChange(async (session)=>{
    if(session){
      showAppShell();
      await startApp();
    } else {
      appStarted = false;
      showAuthScreen();
    }
  });
}
boot();
