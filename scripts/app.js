/* ============================================================
   Aptronix Service — Executive Dashboard
   Client-side data layer + rendering. No external calls.
   ============================================================ */
(function(){
'use strict';

const RAW = JSON.parse(document.getElementById('data-blob').textContent);
const MONTHS = RAW.months;                  // [{MonthKey,MonthLabel,FY,Quarter,FYQ}]
const CENTRES = RAW.centres;                // [{Centre,State,ARM,LocationType,City}]
const FACT_MONTH = RAW.fact_month;          // [mk,centre,revenue,gp,txns]
const FACT_BU = RAW.fact_bu;                // [mk,centre,bu,revenue,gp,txns]
const FACT_CAT = RAW.fact_cat;              // [mk,centre,category,revenue,gp,txns]
const FACT_PF = RAW.fact_pf;                // [mk,centre,pf,revenue,gp,txns]
const FACT_ITEM = RAW.fact_item;            // [mk,centre,item,revenue,gp,txns]
const FACT_TXNTYPE = RAW.fact_txntype;      // [mk,centre,type,revenue,gp,txns]
const FACT_EXEC = RAW.fact_exec;            // [centre,exec,revenue,gp,txns]
const FACT_DAY = RAW.fact_day;              // [dateStr,centre,revenue,gp,txns] — exact-day precision
const CSAT = RAW.csat;                      // [mk,centre,value]
const TARGET_REVENUE = RAW.target_revenue || []; // [mk,centre,value]
const TARGET_GP = RAW.target_gp || [];
const TARGET_CSAT = RAW.target_csat || [];
const GP_COVERED_MONTHS = new Set(RAW.gpCoveredMonths || []); // months whose GP includes SVC Part Incentive per the GP report

const MONTH_MAP = {}; MONTHS.forEach(m=>MONTH_MAP[m.MonthKey]=m);
const CENTRE_MAP = {}; CENTRES.forEach(c=>CENTRE_MAP[c.Centre]=c);
const MIN_MK = Math.min(...MONTHS.map(m=>m.MonthKey));
const MAX_MK = Math.max(...MONTHS.map(m=>m.MonthKey));
const MIN_DATE = FACT_DAY.reduce((m,r)=>r[0]<m?r[0]:m, FACT_DAY[0][0]);
const MAX_DATE = FACT_DAY.reduce((m,r)=>r[0]>m?r[0]:m, FACT_DAY[0][0]);
const CSAT_MAP = {}; // mk|centre -> value
CSAT.forEach(([mk,c,v])=>{CSAT_MAP[mk+'|'+c]=v;});

const FYS = [...new Set(MONTHS.map(m=>m.FY))].sort();
const STATES = [...new Set(CENTRES.map(c=>c.State))].sort();
const ARMS = [...new Set(CENTRES.map(c=>c.ARM))].sort();
const BUS = [...new Set(FACT_BU.map(r=>r[2]))].sort();
const CATS = [...new Set(FACT_CAT.map(r=>r[2]))].sort();
const LOC_TYPES = [...new Set(CENTRES.map(c=>c.LocationType))].sort();
const TXN_TYPES = [...new Set(FACT_TXNTYPE.map(r=>r[2]))].sort();

const fmtINR = (n)=>{
  const sign = n<0?'-':'';
  n = Math.abs(n);
  if(n>=1e7) return sign+'₹'+(n/1e7).toFixed(2)+'Cr';
  if(n>=1e5) return sign+'₹'+(n/1e5).toFixed(2)+'L';
  if(n>=1e3) return sign+'₹'+(n/1e3).toFixed(1)+'K';
  return sign+'₹'+n.toFixed(0);
};
const fmtNum = (n)=> n.toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtPct = (n)=> (n>=0?'+':'')+n.toFixed(1)+'%';
const monthLabel = (mk)=> MONTH_MAP[mk]?MONTH_MAP[mk].MonthLabel:mk;
const safeDiv = (a,b)=> b===0?0:a/b;
const dateToMonthKey = (dateStr)=>{ const [y,m] = dateStr.split('-'); return parseInt(y)*100+parseInt(m); };

/* ------------------------------------------------------------
   Global filter state + drill path
   ------------------------------------------------------------ */
const state = {
  fy:'All', quarter:'All', dateFrom:MIN_DATE, dateTo:MAX_DATE,
  state:'All', arm:'All', centre:'All', bu:'All', category:'All', locType:'All',
};
let drillPath = [];

function resetFilters(){
  state.fy='All'; state.quarter='All'; state.dateFrom=MIN_DATE; state.dateTo=MAX_DATE;
  state.state='All'; state.arm='All'; state.centre='All'; state.bu='All'; state.category='All'; state.locType='All';
  drillPath=[];
  syncFilterUI();
  renderAll();
}

/* Month bounds derived from the (possibly custom) date range — used to
   filter every month-grain fact table consistently. */
function currentMonthBounds(){
  return {mFrom: dateToMonthKey(state.dateFrom), mTo: dateToMonthKey(state.dateTo)};
}

function monthInRange(mk){
  const {mFrom,mTo} = currentMonthBounds();
  if(mk<mFrom || mk>mTo) return false;
  if(state.fy!=='All' && MONTH_MAP[mk].FY!==state.fy) return false;
  if(state.quarter!=='All' && MONTH_MAP[mk].Quarter!==state.quarter) return false;
  return true;
}
function centreMatches(c){
  const meta = CENTRE_MAP[c];
  if(!meta) return false;
  if(state.state!=='All' && meta.State!==state.state) return false;
  if(state.arm!=='All' && meta.ARM!==state.arm) return false;
  if(state.centre!=='All' && c!==state.centre) return false;
  if(state.locType!=='All' && meta.LocationType!==state.locType) return false;
  return true;
}

/* Filtered centre-month rows, joined with centre meta */
function getFilteredMonthRows(){
  const out=[];
  for(const [mk,c,rev,gp,txns] of FACT_MONTH){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    out.push({mk,centre:c,revenue:rev,gp,txns,meta:CENTRE_MAP[c]});
  }
  return out;
}
function getFilteredBURows(){
  const out=[];
  for(const [mk,c,bu,rev,gp,txns] of FACT_BU){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    if(state.bu!=='All' && bu!==state.bu) continue;
    out.push({mk,centre:c,bu,revenue:rev,gp,txns});
  }
  return out;
}
function getFilteredCatRows(){
  const out=[];
  for(const [mk,c,cat,rev,gp,txns] of FACT_CAT){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    if(state.category!=='All' && cat!==state.category) continue;
    out.push({mk,centre:c,category:cat,revenue:rev,gp,txns});
  }
  return out;
}
function getFilteredPFRows(){
  const out=[];
  for(const [mk,c,pf,rev,gp,txns] of FACT_PF){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    out.push({mk,centre:c,pf,revenue:rev,gp,txns});
  }
  return out;
}
function getFilteredItemRows(){
  const out=[];
  for(const [mk,c,item,rev,gp,txns] of FACT_ITEM){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    out.push({mk,centre:c,item,revenue:rev,gp,txns});
  }
  return out;
}
function getFilteredTxnTypeRows(){
  const out=[];
  for(const [mk,c,tt,rev,gp,txns] of FACT_TXNTYPE){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    out.push({mk,centre:c,type:tt,revenue:rev,gp,txns});
  }
  return out;
}
function getFilteredExecRows(){
  // exec table is all-time (no month) — approximate by scaling not needed; just filter by centre match
  const out=[];
  for(const [c,ex,rev,gp,txns] of FACT_EXEC){
    if(!centreMatches(c)) continue;
    out.push({centre:c,exec:ex,revenue:rev,gp,txns});
  }
  return out;
}
function getFilteredCSAT(){
  const out=[];
  for(const [mk,c,v] of CSAT){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    out.push({mk,centre:c,value:v});
  }
  return out;
}
function getFilteredTarget(arr){
  const out=[];
  for(const [mk,c,v] of arr){
    if(!monthInRange(mk)) continue;
    if(!centreMatches(c)) continue;
    out.push({mk,centre:c,value:v});
  }
  return out;
}
function hasAnyTargets(){ return TARGET_REVENUE.length>0 || TARGET_GP.length>0 || TARGET_CSAT.length>0; }

/* Exact-day-precision totals for the selected custom date range (used for
   headline KPI cards — precise even when the range doesn't align to full
   months). Trend charts and dimensional breakdowns remain month-grain. */
function getExactRangeTotals(){
  let revenue=0, gp=0, txns=0;
  for(const [d,c,rev,gp_,tx] of FACT_DAY){
    if(d<state.dateFrom || d>state.dateTo) continue;
    if(!centreMatches(c)) continue;
    revenue+=rev; gp+=gp_; txns+=tx;
  }
  return {revenue, gp, txns, gpPct:safeDiv(gp,revenue)*100, ats:safeDiv(revenue,txns)};
}
function getExactPreviousRangeTotals(){
  const from = new Date(state.dateFrom), to = new Date(state.dateTo);
  const spanDays = Math.round((to-from)/86400000)+1;
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate()-1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate()-(spanDays-1));
  const toStr = (d)=>d.toISOString().slice(0,10);
  const pf = toStr(prevFrom), pt = toStr(prevTo);
  if(pt < MIN_DATE) return null;
  let revenue=0, gp=0, txns=0;
  for(const [d,c,rev,gp_,tx] of FACT_DAY){
    if(d<pf || d>pt) continue;
    if(!centreMatches(c)) continue;
    revenue+=rev; gp+=gp_; txns+=tx;
  }
  return {revenue, gp, txns, gpPct:safeDiv(gp,revenue)*100, ats:safeDiv(revenue,txns)};
}
/* Whether every month touched by the current filter has GP-report (incl.
   SVC Part Incentive) coverage, partial coverage, or none — drives the
   caveat banner on Executive/GP/Growth views. */
function gpCoverageStatus(){
  const {mFrom,mTo} = currentMonthBounds();
  const touched = MONTHS.filter(m=>m.MonthKey>=mFrom && m.MonthKey<=mTo).map(m=>m.MonthKey);
  if(!touched.length) return 'none';
  const coveredCount = touched.filter(mk=>GP_COVERED_MONTHS.has(mk)).length;
  if(coveredCount===touched.length) return 'full';
  if(coveredCount===0) return 'none';
  return 'partial';
}

function sumRows(rows){
  let revenue=0,gp=0,txns=0;
  for(const r of rows){revenue+=r.revenue;gp+=r.gp;txns+=r.txns;}
  return {revenue,gp,txns,gpPct:safeDiv(gp,revenue)*100,ats:safeDiv(revenue,txns)};
}

function groupSum(rows, keyFn){
  const map = new Map();
  for(const r of rows){
    const k = keyFn(r);
    if(!map.has(k)) map.set(k,{revenue:0,gp:0,txns:0});
    const o = map.get(k);
    o.revenue+=r.revenue; o.gp+=r.gp; o.txns+=r.txns;
  }
  return map;
}

/* time series at monthly grain for currently filtered scope */
function monthlySeries(){
  const rows = getFilteredMonthRows();
  const map = groupSum(rows, r=>r.mk);
  const mks = [...map.keys()].sort((a,b)=>a-b);
  return mks.map(mk=>({mk,label:monthLabel(mk),...map.get(mk),gpPct:safeDiv(map.get(mk).gp,map.get(mk).revenue)*100}));
}

/* growth calcs */
function withMoM(series){
  return series.map((r,i)=>{
    const prev = series[i-1];
    const mom = prev? safeDiv(r.revenue-prev.revenue, prev.revenue)*100 : null;
    return {...r, mom};
  });
}
function withYoY(series){
  const byMk = {}; series.forEach(r=>byMk[r.mk]=r);
  return series.map(r=>{
    const py = r.mk-100;
    const prev = byMk[py];
    const yoy = prev? safeDiv(r.revenue-prev.revenue, prev.revenue)*100 : null;
    return {...r, yoy};
  });
}
function runningTotals(series){
  let rt=0, rgp=0;
  return series.map(r=>{rt+=r.revenue; rgp+=r.gp; return {...r, running:rt, runningGP:rgp};});
}
function rolling3(series){
  return series.map((r,i)=>{
    const win = series.slice(Math.max(0,i-2), i+1);
    const avg = win.reduce((s,x)=>s+x.revenue,0)/win.length;
    return {...r, rolling3:avg};
  });
}
function quarterlySeries(){
  const rows = getFilteredMonthRows();
  const map = new Map();
  for(const r of rows){
    const m = MONTH_MAP[r.mk];
    const key = m.FYQ;
    if(!map.has(key)) map.set(key,{revenue:0,gp:0,txns:0,order:m.FY+'-'+m.Quarter, sortKey: r.mk});
    const o = map.get(key);
    o.revenue+=r.revenue; o.gp+=r.gp; o.txns+=r.txns; o.sortKey=Math.min(o.sortKey,r.mk);
  }
  return [...map.entries()].map(([label,v])=>({label,...v})).sort((a,b)=>a.sortKey-b.sortKey);
}

/* ------------------------------------------------------------
   Rankings
   ------------------------------------------------------------ */
function rankBy(rows, keyFn, metaFn){
  const map = groupSum(rows, keyFn);
  const arr = [...map.entries()].map(([k,v])=>({
    key:k, ...v, gpPct:safeDiv(v.gp,v.revenue)*100, ats:safeDiv(v.revenue,v.txns),
    ...(metaFn?metaFn(k):{})
  }));
  arr.sort((a,b)=>b.revenue-a.revenue);
  arr.forEach((r,i)=>r.rank=i+1);
  return arr;
}
function centreRanking(){
  const rows = getFilteredMonthRows();
  return rankBy(rows, r=>r.centre, k=>({name:k, state:CENTRE_MAP[k]?.State, arm:CENTRE_MAP[k]?.ARM, type:CENTRE_MAP[k]?.LocationType}));
}
function stateRanking(){
  const rows = getFilteredMonthRows();
  return rankBy(rows, r=>r.meta.State, k=>({name:k}));
}
function armRanking(){
  const rows = getFilteredMonthRows();
  return rankBy(rows, r=>r.meta.ARM, k=>({name:k, state:CENTRES.find(c=>c.ARM===k)?.State}));
}

/* previous-period comparison (for MoM-style deltas on KPI cards) */
function previousPeriodRange(){
  const {mFrom,mTo} = currentMonthBounds();
  const monthsInRange = MONTHS.filter(m=>m.MonthKey>=mFrom && m.MonthKey<=mTo).map(m=>m.MonthKey).sort((a,b)=>a-b);
  const n = monthsInRange.length;
  const allMk = MONTHS.map(m=>m.MonthKey).sort((a,b)=>a-b);
  const idxFrom = allMk.indexOf(mFrom);
  const prevEndIdx = idxFrom-1;
  if(prevEndIdx<0) return null;
  const prevStartIdx = Math.max(0, prevEndIdx-n+1);
  return {from:allMk[prevStartIdx], to:allMk[prevEndIdx]};
}
function sumForRange(from,to){
  const rows=[];
  for(const [mk,c,rev,gp,txns] of FACT_MONTH){
    if(mk<from||mk>to) continue;
    if(!centreMatches(c)) continue;
    rows.push({revenue:rev,gp,txns});
  }
  return sumRows(rows);
}

/* ================================================================
   UI: Filter bar, tabs, breadcrumb
   ================================================================ */
const TABS = [
  {id:'exec', label:'Executive Overview', icon:'⌂'},
  {id:'revenue', label:'Revenue', icon:'▤'},
  {id:'gp', label:'Gross Profit', icon:'◈'},
  {id:'csat', label:'CSAT', icon:'☺'},
  {id:'licenses', label:'Licenses', icon:'▣'},
  {id:'targets', label:'Targets', icon:'◉'},
  {id:'centre', label:'Centres', icon:'▦'},
  {id:'centreexplorer', label:'Centre Explorer', icon:'⌕'},
  {id:'stateperf', label:'States', icon:'⌖'},
  {id:'arm', label:'ARM', icon:'◎'},
  {id:'armexplorer', label:'ARM Explorer', icon:'⌕'},
  {id:'bu', label:'Business Units', icon:'▥'},
  {id:'growth', label:'Growth', icon:'↗'},
  {id:'exceptions', label:'Exceptions', icon:'⚠'},
  {id:'rankings', label:'Rankings', icon:'☰'},
  {id:'geo', label:'Geographic', icon:'✦'},
  {id:'ai', label:'AI Insights', icon:'✎'},
];
let activeTab = 'exec';
const charts = {}; // id -> Chart instance, destroyed/recreated on render

function el(tag, attrs={}, children=[]){
  const e = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==='class') e.className=v;
    else if(k==='html') e.innerHTML=v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k,v);
  }
  (Array.isArray(children)?children:[children]).forEach(c=>{
    if(c==null) return;
    e.appendChild((typeof c==='string'||typeof c==='number')?document.createTextNode(String(c)):c);
  });
  return e;
}

function fyDateBounds(fy){
  // FY24-25 -> Apr 1 2024 to Mar 31 2025
  const startYr = 2000 + parseInt(fy.slice(2,4));
  return {from: `${startYr}-04-01`, to: `${startYr+1}-03-31`};
}
function quarterDateBounds(fy, q){
  const startYr = 2000 + parseInt(fy.slice(2,4));
  const ranges = {
    Q1:[`${startYr}-04-01`,`${startYr}-06-30`],
    Q2:[`${startYr}-07-01`,`${startYr}-09-30`],
    Q3:[`${startYr}-10-01`,`${startYr}-12-31`],
    Q4:[`${startYr+1}-01-01`,`${startYr+1}-03-31`],
  };
  return {from:ranges[q][0], to:ranges[q][1]};
}
function clampToDataRange(d){ return d<MIN_DATE?MIN_DATE : d>MAX_DATE?MAX_DATE : d; }

function buildFilterBar(){
  const bar = document.getElementById('filterbar');
  bar.innerHTML='';
  const mkSelect = (label, options, value, onChange, allLabel='All')=>{
    const sel = el('select',{onchange:(e)=>onChange(e.target.value)});
    sel.appendChild(el('option',{value:'All'}, allLabel));
    options.forEach(o=>sel.appendChild(el('option',{value:o},o)));
    sel.value = value;
    return el('div',{class:'fgroup'},[el('label',{},label), sel]);
  };
  bar.appendChild(mkSelect('Financial Year', FYS, state.fy, v=>{
    state.fy=v; state.quarter='All';
    if(v!=='All'){ const b=fyDateBounds(v); state.dateFrom=clampToDataRange(b.from); state.dateTo=clampToDataRange(b.to); }
    else { state.dateFrom=MIN_DATE; state.dateTo=MAX_DATE; }
    onFilterChange();
  }, 'All Years'));
  bar.appendChild(mkSelect('Quarter', ['Q1','Q2','Q3','Q4'], state.quarter, v=>{
    state.quarter=v;
    if(v!=='All' && state.fy!=='All'){ const b=quarterDateBounds(state.fy,v); state.dateFrom=clampToDataRange(b.from); state.dateTo=clampToDataRange(b.to); }
    onFilterChange();
  }, 'All Quarters'));

  // custom date range — exact-day precision, drives KPI cards; also sets month bounds for all breakdowns
  const fromDate = el('input',{type:'date', min:MIN_DATE, max:MAX_DATE, onchange:e=>{
    state.dateFrom = e.target.value || MIN_DATE; state.fy='All'; state.quarter='All'; onFilterChange();
  }});
  fromDate.value = state.dateFrom;
  const toDate = el('input',{type:'date', min:MIN_DATE, max:MAX_DATE, onchange:e=>{
    state.dateTo = e.target.value || MAX_DATE; state.fy='All'; state.quarter='All'; onFilterChange();
  }});
  toDate.value = state.dateTo;
  bar.appendChild(el('div',{class:'fgroup'},[el('label',{},'Custom From'), fromDate]));
  bar.appendChild(el('div',{class:'fgroup'},[el('label',{},'Custom To'), toDate]));

  bar.appendChild(mkSelect('State', STATES, state.state, v=>{state.state=v; state.arm='All'; state.centre='All'; onFilterChange();}));
  bar.appendChild(mkSelect('ARM', ARMS, state.arm, v=>{state.arm=v; state.centre='All'; onFilterChange();}));
  const centreOptions = CENTRES.filter(c=>centreMatches(c.Centre) || true).map(c=>c.Centre).sort();
  bar.appendChild(mkSelect('Centre', centreOptions, state.centre, v=>{state.centre=v; onFilterChange();}));
  bar.appendChild(mkSelect('Business Unit', BUS, state.bu, v=>{state.bu=v; onFilterChange();}));
  bar.appendChild(mkSelect('Location Type', LOC_TYPES, state.locType, v=>{state.locType=v; onFilterChange();}));

  bar.appendChild(el('div',{class:'fspacer'}));
  bar.appendChild(el('button',{id:'resetFilters', onclick:resetFilters}, 'Reset filters'));

  const exportWrap = el('div',{id:'exportMenu'});
  exportWrap.appendChild(el('button',{class:'btn-export', onclick:()=>exportCurrentCSV()}, '⭳ Export CSV'));
  exportWrap.appendChild(el('button',{class:'btn-export', onclick:()=>window.print()}, '⎙ Export PDF'));
  exportWrap.appendChild(el('button',{class:'btn-export', id:'exportPptBtn', onclick:()=>exportCurrentPPT()}, '▤ Export PPT'));
  bar.appendChild(exportWrap);

  bar.appendChild(el('div',{style:'flex-basis:100%;font-size:10px;color:var(--text-faint);margin-top:2px;'},
    'KPI cards reflect the exact selected dates. Trend charts and breakdowns aggregate by full month.'));
}

function onFilterChange(){
  buildBreadcrumb();
  buildFilterBar();
  renderAll();
}

function buildBreadcrumb(){
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML='';
  const parts = [];
  if(state.state!=='All') parts.push({label:'State: '+state.state, clear:()=>{state.state='All';state.arm='All';state.centre='All';}});
  if(state.arm!=='All') parts.push({label:'ARM: '+state.arm, clear:()=>{state.arm='All';state.centre='All';}});
  if(state.centre!=='All') parts.push({label:'Centre: '+state.centre, clear:()=>{state.centre='All';}});
  if(state.bu!=='All') parts.push({label:'BU: '+state.bu, clear:()=>{state.bu='All';}});
  if(state.category!=='All') parts.push({label:'Category: '+state.category, clear:()=>{state.category='All';}});
  if(state.fy!=='All') parts.push({label:state.fy, clear:()=>{state.fy='All';}});
  if(state.quarter!=='All') parts.push({label:state.quarter, clear:()=>{state.quarter='All';}});
  if(parts.length===0){ bc.style.display='none'; return; }
  bc.style.display='flex';
  bc.appendChild(el('span',{style:'color:var(--text-faint);font-size:11px;'},'DRILL:'));
  parts.forEach((p,i)=>{
    bc.appendChild(el('span',{class:'crumb', onclick:()=>{p.clear(); onFilterChange();}}, p.label+' ✕'));
  });
  bc.appendChild(el('span',{class:'clear', onclick:resetFilters},'Clear all'));
}

function buildTabs(){
  const bar = document.getElementById('tabbar');
  bar.innerHTML='';
  TABS.forEach(t=>{
    bar.appendChild(el('div',{class:'tab'+(t.id===activeTab?' active':''), onclick:()=>{activeTab=t.id; buildTabs(); renderAll();}},[
      el('span',{class:'tab-icon'}, t.icon||'•'),
      el('span',{}, t.label),
    ]));
  });
}

function buildViewShells(){
  const views = document.getElementById('views');
  views.innerHTML='';
  TABS.forEach(t=>{
    views.appendChild(el('div',{id:'view-'+t.id, class:'view'+(t.id===activeTab?' active':'')}));
  });
}
function showActiveView(){
  TABS.forEach(t=>{
    document.getElementById('view-'+t.id).classList.toggle('active', t.id===activeTab);
  });
}

function syncFilterUI(){ buildFilterBar(); buildBreadcrumb(); }


/* ================================================================
   Reusable UI components
   ================================================================ */
function kpiCard(label, value, deltaText, deltaDir){
  const dirClass = deltaDir==='up'?'up':deltaDir==='down'?'down':'flat';
  const arrow = deltaDir==='up'?'▲':deltaDir==='down'?'▼':'—';
  return el('div',{class:'kpi'},[
    el('div',{class:'accent-bar'}),
    el('div',{class:'label'}, label),
    el('div',{class:'value'}, value),
    deltaText? el('div',{class:'delta '+dirClass}, arrow+' '+deltaText) : null,
  ]);
}
function sparklineSVG(values, color){
  if(!values || values.length<2) return null;
  const w=100, h=28, pad=2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max-min)||1;
  const pts = values.map((v,i)=>{
    const x = pad + (i/(values.length-1))*(w-2*pad);
    const y = h-pad - ((v-min)/range)*(h-2*pad);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  const lastUp = values[values.length-1] >= values[0];
  const c = color || (lastUp?'#22d3a8':'#f2555a');
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width','100%'); svg.setAttribute('height','28'); svg.style.display='block';
  const poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
  poly.setAttribute('points', pts);
  poly.setAttribute('fill','none'); poly.setAttribute('stroke', c); poly.setAttribute('stroke-width','1.6');
  poly.setAttribute('stroke-linecap','round'); poly.setAttribute('stroke-linejoin','round');
  svg.appendChild(poly);
  return svg;
}
function richKpiCard({label, value, mom, qoq, yoy, spark}){
  const badges = [];
  const mkBadge = (lbl, v)=>{
    if(v===null||v===undefined||isNaN(v)) return null;
    const cls = v>0.05?'pct-up':v<-0.05?'pct-down':'pct-flat';
    return el('span',{class:cls, style:'font-size:10.5px;margin-right:8px;'}, lbl+' '+fmtPct(v));
  };
  [['MoM',mom],['QoQ',qoq],['YoY',yoy]].forEach(([l,v])=>{ const b=mkBadge(l,v); if(b) badges.push(b); });
  const card = el('div',{class:'kpi'},[
    el('div',{class:'accent-bar'}),
    el('div',{class:'label'}, label),
    el('div',{class:'value'}, value),
    badges.length? el('div',{style:'margin-top:6px;'}, badges) : null,
  ]);
  if(spark && spark.length>=2){
    const sparkWrap = el('div',{style:'margin-top:8px;'});
    const s = sparklineSVG(spark);
    if(s) sparkWrap.appendChild(s);
    card.appendChild(sparkWrap);
  }
  return card;
}
function deltaDir(v){ if(v===null||v===undefined||isNaN(v)) return 'flat'; return v>0.05?'up':v<-0.05?'down':'flat'; }

function panel(title, tag, content){
  const h = el('h3',{},[title, tag?el('span',{class:'tag'},tag):null]);
  return el('div',{class:'panel'},[h, content]);
}

function gpCaveatBanner(){
  const status = gpCoverageStatus();
  if(status==='full') return null;
  const msg = status==='none'
    ? 'GP for the selected period uses GP AT Amount only — the GP report (with SVC Part Incentive) does not yet cover these months.'
    : 'GP for part of the selected period includes SVC Part Incentive per the GP report; the remaining months use GP AT Amount only, pending incentive data.';
  return el('div',{class:'insight-card neutral', style:'margin-bottom:16px;padding:10px 14px;'},[
    el('p',{style:'margin:0;font-size:11.5px;'}, '📋 '+msg)
  ]);
}

function destroyChart(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
function chartFallback(id){
  const canvas = document.getElementById(id);
  if(!canvas || !canvas.parentElement) return;
  canvas.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--text-faint);font-size:11.5px;text-align:center;padding:16px;line-height:1.5;">Chart library could not load from any CDN — check your internet connection.<br>The underlying data is still available in the tables and via CSV export.</div>';
}
function lineChart(id, labels, datasets, opts={}){
  if(typeof Chart==='undefined'){ chartFallback(id); return; }
  destroyChart(id);
  const canvas = document.getElementById(id);
  if(!canvas) return;
  charts[id] = new Chart(canvas, {
    type:'line',
    data:{labels, datasets},
    options: Object.assign({
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{labels:{color:'#5b6478', boxWidth:10, font:{size:11}}},
        tooltip:{backgroundColor:'#131b2e', borderColor:'#e2e6ee', borderWidth:1, titleColor:'#ffffff', bodyColor:'#e8ecf5'}
      },
      scales:{
        x:{ticks:{color:'#8991a3', font:{size:10}}, grid:{color:'#edf0f5'}},
        y:{ticks:{color:'#8991a3', font:{size:10}}, grid:{color:'#edf0f5'}}
      }
    }, opts)
  });
}
function barChart(id, labels, datasets, opts={}){
  if(typeof Chart==='undefined'){ chartFallback(id); return; }
  destroyChart(id);
  const canvas = document.getElementById(id);
  if(!canvas) return;
  charts[id] = new Chart(canvas, {
    type:'bar',
    data:{labels, datasets},
    options: Object.assign({
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{labels:{color:'#5b6478', boxWidth:10, font:{size:11}}},
        tooltip:{backgroundColor:'#131b2e', borderColor:'#e2e6ee', borderWidth:1, titleColor:'#ffffff', bodyColor:'#e8ecf5'}
      },
      scales:{
        x:{ticks:{color:'#8991a3', font:{size:10}}, grid:{display:false}},
        y:{ticks:{color:'#8991a3', font:{size:10}}, grid:{color:'#edf0f5'}}
      },
      onClick: opts.onBarClick? (evt, elements)=>{
        if(elements.length){ opts.onBarClick(labels[elements[0].index]); }
      } : undefined
    }, opts)
  });
}
function doughnutChart(id, labels, data, colors){
  if(typeof Chart==='undefined'){ chartFallback(id); return; }
  destroyChart(id);
  const canvas = document.getElementById(id);
  if(!canvas) return;
  charts[id] = new Chart(canvas, {
    type:'doughnut',
    data:{labels, datasets:[{data, backgroundColor:colors, borderColor:'#ffffff', borderWidth:2}]},
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins:{legend:{position:'right', labels:{color:'#5b6478', boxWidth:10, font:{size:10.5}, padding:10}}}
    }
  });
}
const PALETTE = ['#3aa0ff','#22d3a8','#e8b74e','#f2555a','#a78bfa','#f97316','#38bdf8','#4ade80','#fb7185','#94a3b8'];

function dataTable({columns, rows, onRowClick, sortKey, sortDir='desc', id}){
  const wrap = el('div',{class:'table-scroll'});
  const table = el('table',{class:'data-table'});
  const thead = el('thead');
  const trh = el('tr');
  columns.forEach(col=>{
    trh.appendChild(el('th',{onclick:()=>{
      if(id) tableSortState[id] = {key:col.key, dir: (tableSortState[id]&&tableSortState[id].key===col.key&&tableSortState[id].dir==='desc')?'asc':'desc'};
      renderAll();
    }}, col.label));
  });
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach(r=>{
    const tr = el('tr',{onclick: onRowClick? ()=>onRowClick(r) : null});
    columns.forEach(col=>{
      tr.appendChild(col.render? col.render(r) : el('td',{}, String(r[col.key]??'')));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}
const tableSortState = {};
function applySorting(id, rows, defaultKey, defaultDir='desc'){
  const s = tableSortState[id] || {key:defaultKey, dir:defaultDir};
  const arr = [...rows].sort((a,b)=>{
    const va=a[s.key], vb=b[s.key];
    if(typeof va==='string') return s.dir==='asc'? va.localeCompare(vb) : vb.localeCompare(va);
    return s.dir==='asc'? va-vb : vb-va;
  });
  return arr;
}
function numCell(val, fmt=fmtINR){ return el('td',{class:'num'}, fmt(val)); }
function pctCell(val){
  const cls = val>0.05?'pct-up':val<-0.05?'pct-down':'pct-flat';
  const txt = (val===null||val===undefined||isNaN(val))?'—':fmtPct(val);
  return el('td',{class:'num '+cls}, txt);
}
function barCell(val, max){
  const pct = max>0? Math.max(2,(val/max)*100) : 0;
  return el('td',{}, el('div',{class:'bar-cell'},[
    el('div',{class:'bar-track'}, el('div',{class:'bar-fill', style:'width:'+pct+'%'})),
  ]));
}

function exportCSV(filename, columns, rows){
  const header = columns.map(c=>'"'+c.label.replace(/"/g,'""')+'"').join(',');
  const lines = rows.map(r=>columns.map(c=>{
    let v = c.raw? c.raw(r) : (r[c.key]??'');
    if(typeof v==='number') v = v.toFixed(2);
    return '"'+String(v).replace(/"/g,'""')+'"';
  }).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
let currentExporter = null; // set by each view render: {filename, columns, rows}
function exportCurrentCSV(){
  if(!currentExporter){ alert('Nothing to export on this view yet.'); return; }
  exportCSV(currentExporter.filename, currentExporter.columns, currentExporter.rows);
}

/* ---- PPTX export (loaded on demand — not on page load, to avoid adding
   a third external dependency to the critical path) ---- */
function loadPptxLib(){
  return new Promise((resolve, reject)=>{
    if(window.PptxGenJS) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
    s.onload = ()=> window.PptxGenJS ? resolve(true) : reject(new Error('PptxGenJS did not initialize'));
    s.onerror = ()=> reject(new Error('Could not load PPT export library'));
    document.head.appendChild(s);
  });
}
async function exportCurrentPPT(){
  const btn = document.getElementById('exportPptBtn');
  const original = btn ? btn.textContent : null;
  if(btn){ btn.textContent = 'Building…'; btn.disabled = true; }
  try{
    await loadPptxLib();
    const pptx = new window.PptxGenJS();
    pptx.defineLayout({name:'WIDE', width:13.33, height:7.5});
    pptx.layout = 'WIDE';
    const NAVY = '0B1220', PANEL='111A2E', ACCENT='3AA0FF', GOOD='22D3A8', TEXT='E8ECF5', DIM='8D9AB3';

    // Title slide
    let s1 = pptx.addSlide(); s1.background = {color:NAVY};
    s1.addText('Aptronix Service — Executive Summary', {x:0.6,y:2.6,w:12,h:1, fontSize:32, bold:true, color:TEXT, fontFace:'Georgia'});
    const rangeLabel = `${state.dateFrom} to ${state.dateTo}`;
    s1.addText(rangeLabel, {x:0.6,y:3.5,w:12,h:0.5, fontSize:14, color:DIM});
    s1.addText('Apple Premium Partner · Apple Authorised Service Provider', {x:0.6,y:4.0,w:12,h:0.4, fontSize:11, color:DIM});

    // KPI slide
    const totals = getExactRangeTotals();
    const g = kpiGrowthContext();
    const csatRows = getFilteredCSAT();
    const avgCsat = csatRows.length? csatRows.reduce((s,r)=>s+r.value,0)/csatRows.length : null;
    let s2 = pptx.addSlide(); s2.background = {color:NAVY};
    s2.addText('Key Performance Indicators', {x:0.5,y:0.4,w:12,h:0.6, fontSize:22, bold:true, color:TEXT, fontFace:'Georgia'});
    const kpiData = [
      ['Revenue', fmtINR(totals.revenue), g.revMoM!==null?fmtPct(g.revMoM)+' MoM':''],
      ['Gross Profit', fmtINR(totals.gp), g.gpMoM!==null?fmtPct(g.gpMoM)+' MoM':''],
      ['GP %', totals.gpPct.toFixed(1)+'%', ''],
      ['Transactions', fmtNum(totals.txns), ''],
      ['Avg Ticket Size', fmtINR(totals.ats), ''],
      ['Avg CSAT', avgCsat!==null?avgCsat.toFixed(0)+'%':'—', ''],
    ];
    let kx=0.5, ky=1.3;
    kpiData.forEach((k,i)=>{
      const col = i%3, row = Math.floor(i/3);
      const bx = kx + col*4.1, by = ky + row*2.0;
      s2.addShape('roundRect', {x:bx,y:by,w:3.8,h:1.7, fill:{color:PANEL}, line:{color:'22304A'}, rectRadius:0.08});
      s2.addText(k[0].toUpperCase(), {x:bx+0.2,y:by+0.15,w:3.4,h:0.3, fontSize:9, color:DIM, charSpacing:1});
      s2.addText(k[1], {x:bx+0.2,y:by+0.45,w:3.4,h:0.7, fontSize:24, bold:true, color:TEXT, fontFace:'Georgia'});
      if(k[2]) s2.addText(k[2], {x:bx+0.2,y:by+1.15,w:3.4,h:0.35, fontSize:11, color:k[2].startsWith('+')?GOOD:'F2555A'});
    });

    // Top/Bottom centres slide
    const cr = centreRanking();
    let s3 = pptx.addSlide(); s3.background = {color:NAVY};
    s3.addText('Top & Bottom Performing Centres', {x:0.5,y:0.4,w:12,h:0.6, fontSize:22, bold:true, color:TEXT, fontFace:'Georgia'});
    const top5 = cr.slice(0,5), bottom5 = [...cr].sort((a,b)=>a.revenue-b.revenue).slice(0,5);
    const mkRows = (arr)=>[['#','Centre','Revenue','GP%'], ...arr.map((r,i)=>[String(i+1), r.name, fmtINR(r.revenue), r.gpPct.toFixed(1)+'%'])];
    s3.addTable(mkRows(top5), {x:0.5,y:1.3,w:5.9,h:2.8, fontSize:11, color:TEXT, fill:{color:PANEL}, border:{color:'22304A',pt:0.5}, autoPage:false});
    s3.addTable(mkRows(bottom5), {x:6.7,y:1.3,w:5.9,h:2.8, fontSize:11, color:TEXT, fill:{color:PANEL}, border:{color:'22304A',pt:0.5}, autoPage:false});

    // Executive summary slide
    let s4 = pptx.addSlide(); s4.background = {color:NAVY};
    s4.addText('AI Executive Summary', {x:0.5,y:0.4,w:12,h:0.6, fontSize:22, bold:true, color:TEXT, fontFace:'Georgia'});
    s4.addText(buildExecutiveSummary(), {x:0.5,y:1.3,w:12,h:2, fontSize:14, color:DIM, lineSpacing:22});
    const alerts = buildExecutiveAlerts();
    s4.addText('Alerts', {x:0.5,y:3.4,w:12,h:0.4, fontSize:14, bold:true, color:TEXT});
    s4.addText(alerts.slice(0,6).map(a=>'• '+a.text).join('\n'), {x:0.5,y:3.8,w:12,h:3, fontSize:11.5, color:DIM, lineSpacing:18});

    await pptx.writeFile({fileName:'aptronix_service_summary.pptx'});
  }catch(e){
    alert('Could not build the PowerPoint export — check your internet connection (this uses a CDN-hosted library). Try CSV export instead.');
  }finally{
    if(btn){ btn.textContent = original; btn.disabled = false; }
  }
}

/* ================================================================
   VIEW: Executive Overview
   ================================================================ */
/* ================================================================
   Growth helper for KPI cards (MoM/QoQ/YoY + sparkline) — shared
   across Executive/Revenue/GP tabs
   ================================================================ */
function kpiGrowthContext(){
  const series = withYoY(withMoM(monthlySeries()));
  const q = quarterlySeries().map((r,i,arr)=>{
    const prev = arr[i-1];
    return {...r, qoq: prev? safeDiv(r.revenue-prev.revenue, prev.revenue)*100 : null,
                  gpQoq: prev? safeDiv(r.gp-prev.gp, prev.gp)*100 : null};
  });
  const last = series[series.length-1];
  const lastQ = q[q.length-1];
  const spark = series.slice(-6).map(s=>s.revenue);
  const sparkGP = series.slice(-6).map(s=>s.gp);
  return {
    revMoM: last?last.mom:null, revYoY: last?last.yoy:null, revQoQ: lastQ?lastQ.qoq:null,
    gpMoM: (()=>{ if(series.length<2) return null; const p=series[series.length-2]; return safeDiv(last.gp-p.gp,p.gp)*100; })(),
    gpQoQ: lastQ?lastQ.gpQoq:null,
    gpYoY: (()=>{ const byMk={}; series.forEach(r=>byMk[r.mk]=r); const p=byMk[last.mk-100]; return p? safeDiv(last.gp-p.gp,p.gp)*100 : null; })(),
    spark, sparkGP,
  };
}

/* ================================================================
   Executive Alerts — rule-based, evaluated on the current filter
   ================================================================ */
function buildExecutiveAlerts(){
  const alerts = [];
  const g = kpiGrowthContext();
  const cr = centreRanking();
  const csatRows = getFilteredCSAT();

  if(g.revMoM!==null && g.revMoM < -5){
    alerts.push({level:'bad', text:`Revenue declined ${Math.abs(g.revMoM).toFixed(1)}% month-on-month.`});
  }
  if(g.gpMoM!==null && g.gpMoM < -5){
    alerts.push({level:'bad', text:`GP declined ${Math.abs(g.gpMoM).toFixed(1)}% month-on-month.`});
  }
  if(g.revMoM!==null && g.gpMoM!==null && g.revMoM>2 && g.gpMoM<0){
    alerts.push({level:'warn', text:`Revenue is growing (+${g.revMoM.toFixed(1)}%) but GP is falling (${g.gpMoM.toFixed(1)}%) — margin compression risk.`});
  }
  if(g.revMoM!==null && g.gpMoM!==null && g.gpMoM>2 && g.revMoM<0){
    alerts.push({level:'good', text:`GP is growing (+${g.gpMoM.toFixed(1)}%) despite falling revenue (${g.revMoM.toFixed(1)}%) — mix/margin improvement.`});
  }
  // CSAT below threshold
  if(csatRows.length){
    const byCentre = groupSum(csatRows.map(r=>({centre:r.centre, revenue:r.value, gp:0, txns:1})), r=>r.centre);
    const low = [...byCentre.entries()].map(([k,v])=>({name:k, value:v.revenue/v.txns})).filter(c=>c.value<75);
    if(low.length) alerts.push({level:'warn', text:`${low.length} centre${low.length>1?'s':''} below 75% CSAT threshold: ${low.slice(0,4).map(c=>c.name).join(', ')}${low.length>4?'…':''}.`});
  }
  // low GP centres (below 15% GP margin, min revenue floor to avoid noise)
  const lowGP = cr.filter(c=>c.revenue>100000 && c.gpPct<15);
  if(lowGP.length) alerts.push({level:'bad', text:`${lowGP.length} centre${lowGP.length>1?'s':''} running below 15% GP margin: ${lowGP.slice(0,4).map(c=>c.name).join(', ')}${lowGP.length>4?'…':''}.`});

  // top growing / declining centres (last two available months, network-wide)
  const allMk = [...new Set(FACT_MONTH.map(r=>r[0]))].sort((a,b)=>a-b);
  if(allMk.length>=2){
    const mkLast=allMk[allMk.length-1], mkPrev=allMk[allMk.length-2];
    const lastMap={}, prevMap={};
    FACT_MONTH.forEach(([mk,c,rev])=>{ if(!centreMatches(c)) return; if(mk===mkLast) lastMap[c]=rev; if(mk===mkPrev) prevMap[c]=rev; });
    const moms = Object.keys(lastMap).filter(c=>prevMap[c]>0).map(c=>({centre:c, mom:safeDiv(lastMap[c]-prevMap[c],prevMap[c])*100}));
    moms.sort((a,b)=>b.mom-a.mom);
    if(moms.length){
      const topG = moms.slice(0,3).filter(m=>m.mom>10);
      const topD = moms.slice(-3).filter(m=>m.mom<-10).reverse();
      if(topG.length) alerts.push({level:'good', text:`Top growing: ${topG.map(m=>m.centre+' ('+fmtPct(m.mom)+')').join(', ')}.`});
      if(topD.length) alerts.push({level:'bad', text:`Top declining: ${topD.map(m=>m.centre+' ('+fmtPct(m.mom)+')').join(', ')} — flagged for intervention.`});
    }
  }
  if(!alerts.length) alerts.push({level:'good', text:'No critical alerts for the current selection — business is tracking within normal bounds.'});
  return alerts;
}
function renderExecutiveAlerts(){
  const alerts = buildExecutiveAlerts();
  const wrap = el('div',{class:'panel', style:'margin-bottom:20px;'});
  wrap.appendChild(el('h3',{}, 'Executive Alerts'));
  const list = el('div',{style:'display:flex;flex-direction:column;gap:8px;'});
  const iconFor = {bad:'🔴', warn:'🟡', good:'🟢'};
  alerts.forEach(a=>{
    list.appendChild(el('div',{style:'display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--text-dim);line-height:1.5;'},[
      el('span',{}, iconFor[a.level]),
      el('span',{}, a.text),
    ]));
  });
  wrap.appendChild(list);
  return wrap;
}

/* AI Executive Summary — one-paragraph auto narrative from current filters */
function buildExecutiveSummary(){
  const g = kpiGrowthContext();
  const totals = getExactRangeTotals();
  const cr = centreRanking();
  const sr = stateRanking();
  const csatRows = getFilteredCSAT();
  const avgCsat = csatRows.length? csatRows.reduce((s,r)=>s+r.value,0)/csatRows.length : null;

  const parts = [];
  if(g.revMoM!==null){
    parts.push(`Revenue ${g.revMoM>=0?'increased':'decreased'} ${Math.abs(g.revMoM).toFixed(1)}% month-on-month to ${fmtINR(totals.revenue)} for the selected period`);
    if(sr.length>=2) parts.push(`, led by ${sr[0].name}${sr[1]?' and '+sr[1].name:''}`);
    parts.push('. ');
  }
  parts.push(`GP margin stands at ${totals.gpPct.toFixed(1)}%`);
  if(g.gpMoM!==null) parts.push(` (${g.gpMoM>=0?'up':'down'} from last month)`);
  parts.push('. ');
  if(avgCsat!==null) parts.push(`Average CSAT is running at ${avgCsat.toFixed(0)}%. `);
  const lowGP = cr.filter(c=>c.revenue>100000 && c.gpPct<15);
  const lowCsat = csatRows.length? [...groupSum(csatRows.map(r=>({centre:r.centre,revenue:r.value,gp:0,txns:1})), r=>r.centre).entries()].filter(([k,v])=>v.revenue/v.txns<75) : [];
  const flagged = new Set([...lowGP.map(c=>c.name), ...lowCsat.map(([k])=>k)]);
  if(flagged.size) parts.push(`${flagged.size} centre${flagged.size>1?'s':''} require management attention on margin or satisfaction.`);
  else parts.push('No centres are currently flagged for urgent intervention.');
  return parts.join('');
}

/* ================================================================
   Performance Score — weighted 0-100 composite per centre
   Revenue Growth 25% / GP Growth 25% / GP Margin 15% / CSAT 20% / Productivity 15%
   ================================================================ */
function minMaxNorm(values, v){
  const min = Math.min(...values), max = Math.max(...values);
  if(max===min) return 50;
  return ((v-min)/(max-min))*100;
}
function centreGrowthMap(metricIndex){
  // metricIndex: 2=revenue, 3=gp in FACT_MONTH rows [mk,centre,revenue,gp,txns]
  const allMk = [...new Set(FACT_MONTH.map(r=>r[0]))].sort((a,b)=>a-b);
  const out = {};
  if(allMk.length<2) return out;
  const mkLast=allMk[allMk.length-1], mkPrev=allMk[allMk.length-2];
  const lastMap={}, prevMap={};
  FACT_MONTH.forEach(row=>{
    const [mk,c] = row; const val = row[metricIndex];
    if(!centreMatches(c)) return;
    if(mk===mkLast) lastMap[c]=val;
    if(mk===mkPrev) prevMap[c]=val;
  });
  Object.keys(lastMap).forEach(c=>{
    if(prevMap[c]!==undefined && prevMap[c]!==0) out[c] = safeDiv(lastMap[c]-prevMap[c], prevMap[c])*100;
  });
  return out;
}
function computePerformanceScores(){
  const cr = centreRanking();
  if(!cr.length) return [];
  const revGrowth = centreGrowthMap(2);
  const gpGrowth = centreGrowthMap(3);
  const csatRows = getFilteredCSAT();
  const csatByCentre = groupSum(csatRows.map(r=>({centre:r.centre, revenue:r.value, gp:0, txns:1})), r=>r.centre);

  const revGrowthVals = cr.map(c=>revGrowth[c.name]??0);
  const gpGrowthVals = cr.map(c=>gpGrowth[c.name]??0);
  const gpMarginVals = cr.map(c=>c.gpPct);
  const csatVals = cr.map(c=>{ const o=csatByCentre.get(c.name); return o? o.revenue/o.txns : 75; });
  const atsVals = cr.map(c=>c.ats);

  return cr.map(c=>{
    const rg = revGrowth[c.name]??0, gg = gpGrowth[c.name]??0;
    const csatObj = csatByCentre.get(c.name);
    const csatVal = csatObj? csatObj.revenue/csatObj.txns : 75;
    const nRG = minMaxNorm(revGrowthVals, rg);
    const nGG = minMaxNorm(gpGrowthVals, gg);
    const nGM = minMaxNorm(gpMarginVals, c.gpPct);
    const nCS = csatVal; // already 0-100
    const nPR = minMaxNorm(atsVals, c.ats);
    const score = nRG*0.25 + nGG*0.25 + nGM*0.15 + nCS*0.20 + nPR*0.15;
    let bucket, bucketClass;
    if(score>=80){bucket='Excellent';bucketClass='good';}
    else if(score>=65){bucket='Good';bucketClass='good';}
    else if(score>=50){bucket='Average';bucketClass='flat';}
    else if(score>=35){bucket='Needs Attention';bucketClass='warn';}
    else {bucket='Critical';bucketClass='bad';}
    return {name:c.name, state:c.state, arm:c.arm, score:Math.round(score), bucket, bucketClass,
            revGrowth:rg, gpGrowth:gg, gpMargin:c.gpPct, csat:csatVal, revenue:c.revenue, gp:c.gp};
  }).sort((a,b)=>b.score-a.score);
}

/* ================================================================
   Simple Forecast — linear trend extrapolation (no external deps)
   ================================================================ */
function linearForecast(series, periodsAhead){
  const n = series.length;
  if(n<3) return [];
  const xs = series.map((_,i)=>i);
  const ys = series.map(s=>s.revenue);
  const xMean = xs.reduce((a,b)=>a+b,0)/n, yMean = ys.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0;
  for(let i=0;i<n;i++){ num += (xs[i]-xMean)*(ys[i]-yMean); den += (xs[i]-xMean)**2; }
  const slope = den===0?0:num/den;
  const intercept = yMean - slope*xMean;
  // residual std-dev for a rough confidence band
  const resid = ys.map((y,i)=>y-(slope*xs[i]+intercept));
  const rmse = Math.sqrt(resid.reduce((s,r)=>s+r*r,0)/n);
  const out = [];
  const lastMk = series[series.length-1].mk;
  for(let p=1;p<=periodsAhead;p++){
    const x = n-1+p;
    const yhat = slope*x+intercept;
    let mk = lastMk, mm = MONTH_MAP[lastMk].Mon || null;
    // advance mk by p months
    let yy = Math.floor(lastMk/100), mo = lastMk%100;
    mo += p; while(mo>12){mo-=12; yy+=1;}
    const fmk = yy*100+mo;
    out.push({mk:fmk, label:monthLabelSynthetic(fmk), forecast:Math.max(0,yhat), lo:Math.max(0,yhat-1.28*rmse), hi:yhat+1.28*rmse});
  }
  return out;
}
function monthLabelSynthetic(mk){
  const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const yy = Math.floor(mk/100), mo = mk%100;
  return names[mo-1]+' '+String(yy).slice(2);
}

/* ================================================================
   Priority Actions — categorized action tiles (pattern borrowed
   from the Retail Intelligence OS reference)
   ================================================================ */
function buildPriorityActions(){
  const cr = centreRanking();
  const csatRows = getFilteredCSAT();
  const csatByCentre = groupSum(csatRows.map(r=>({centre:r.centre, revenue:r.value, gp:0, txns:1})), r=>r.centre);
  const networkAvgAts = safeDiv(cr.reduce((s,r)=>s+r.ats,0), cr.length||1);
  const revGrowth = centreGrowthMap(2);
  const scores = computePerformanceScores();

  const actions = [];

  const lowGP = cr.filter(c=>c.revenue>50000 && c.gpPct<15);
  actions.push({tag:'MARGIN', title:'Improve GP Margin', stat:`${lowGP.length} centre${lowGP.length===1?'':'s'} below 15% GP`, level: lowGP.length?'bad':'good'});

  const lowCsat = [...csatByCentre.entries()].filter(([k,v])=>v.revenue/v.txns<75);
  actions.push({tag:'SATISFACTION', title:'Lift CSAT', stat:`${lowCsat.length} centre${lowCsat.length===1?'':'s'} below 75% CSAT`, level: lowCsat.length?'warn':'good'});

  const lowProd = cr.filter(c=>c.ats < networkAvgAts*0.6);
  actions.push({tag:'EXECUTION', title:'Improve Productivity', stat:`${lowProd.length} centre${lowProd.length===1?'':'s'} well below network avg ATS`, level: lowProd.length?'warn':'good'});

  const bottom10 = [...cr].sort((a,b)=>a.revenue-b.revenue).slice(0,10);
  const bottom10Rev = bottom10.reduce((s,c)=>s+c.revenue,0);
  actions.push({tag:'RECOVERY', title:'Recover Bottom Centres', stat:`Bottom 10 represent ${fmtINR(bottom10Rev)}`, level:'warn'});

  const declining = cr.filter(c=>revGrowth[c.name]!==undefined && revGrowth[c.name] < -10);
  actions.push({tag:'GROWTH', title:'Address Declining Centres', stat:`${declining.length} centre${declining.length===1?'':'s'} down >10% MoM`, level: declining.length?'bad':'good'});

  const excellent = scores.filter(s=>s.bucket==='Excellent');
  actions.push({tag:'EXCELLENCE', title:'Coach & Replicate', stat:`${excellent.length} Excellent-rated centre${excellent.length===1?'':'s'} to replicate`, level:'good'});

  return actions;
}
function renderPriorityActions(){
  const actions = buildPriorityActions();
  const wrap = el('div',{class:'panel', style:'margin-bottom:20px;'});
  wrap.appendChild(el('h3',{}, 'Priority Actions'));
  const grid = el('div',{style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;'});
  const colorFor = {bad:'var(--bad)', warn:'var(--warn)', good:'var(--good)'};
  actions.forEach(a=>{
    grid.appendChild(el('div',{style:`background:var(--panel-2);border:1px solid var(--border-soft);border-left:3px solid ${colorFor[a.level]};border-radius:8px;padding:12px 14px;`},[
      el('div',{style:'font-size:9.5px;letter-spacing:.6px;color:var(--text-faint);text-transform:uppercase;margin-bottom:4px;'}, a.tag),
      el('div',{style:'font-size:13px;font-weight:600;margin-bottom:4px;'}, a.title),
      el('div',{style:'font-size:11.5px;color:var(--text-dim);'}, a.stat),
    ]));
  });
  wrap.appendChild(grid);
  return wrap;
}

/* Executive Commentary — bulleted narrative with ✓/! icons */
function buildExecutiveCommentary(){
  const g = kpiGrowthContext();
  const totals = getExactRangeTotals();
  const sr = stateRanking();
  const cr = centreRanking();
  const csatRows = getFilteredCSAT();
  const avgCsat = csatRows.length? csatRows.reduce((s,r)=>s+r.value,0)/csatRows.length : null;
  const bullets = [];

  if(g.revMoM!==null){
    bullets.push({bad: g.revMoM<0, text:`Revenue ${g.revMoM>=0?'grew':'declined'} ${fmtPct(g.revMoM)} month-on-month to ${fmtINR(totals.revenue)}.`});
  }
  bullets.push({bad: totals.gpPct<20, text:`GP margin stands at ${totals.gpPct.toFixed(1)}%${g.gpMoM!==null?' ('+fmtPct(g.gpMoM)+' MoM)':''}.`});
  if(avgCsat!==null) bullets.push({bad: avgCsat<80, text:`Average CSAT is ${avgCsat.toFixed(0)}% across reporting centres.`});
  if(sr.length>=2) bullets.push({bad:false, text:`Top region: ${sr[0].name} (${fmtINR(sr[0].revenue)}); weakest: ${sr[sr.length-1].name} (${fmtINR(sr[sr.length-1].revenue)}).`});
  if(cr.length>=5){
    const top5Share = safeDiv(cr.slice(0,5).reduce((s,c)=>s+c.revenue,0), totals.revenue)*100;
    bullets.push({bad:false, text:`Top 5 centres contribute ${top5Share.toFixed(0)}% of revenue.`});
  }
  return bullets;
}
function renderExecutiveCommentary(){
  const bullets = buildExecutiveCommentary();
  const wrap = el('div',{class:'panel', style:'margin-bottom:20px;'});
  wrap.appendChild(el('h3',{}, 'Executive Commentary'));
  const list = el('div',{style:'display:flex;flex-direction:column;gap:7px;'});
  bullets.forEach(b=>{
    list.appendChild(el('div',{style:'display:flex;gap:8px;font-size:12.5px;color:var(--text-dim);line-height:1.5;'},[
      el('span',{style:'color:'+(b.bad?'var(--bad)':'var(--good)')}, b.bad?'!':'✓'),
      el('span',{}, b.text),
    ]));
  });
  wrap.appendChild(list);
  return wrap;
}

/* Source QA — data reconciliation transparency panel */
function renderSourceQA(){
  const totalCentres = CENTRES.length;
  const unmapped = CENTRES.filter(c=>c.State==='Unmapped').length;
  const status = gpCoverageStatus();
  const gpNote = status==='full' ? 'GP report coverage complete for the selected period.'
    : status==='partial' ? 'GP report partially covers the selected period — remaining months use GP AT Amount only.'
    : 'GP report does not cover the selected period — figures use GP AT Amount only.';
  const csatCentreCount = new Set(CSAT.map(r=>r[1])).size;

  const wrap = el('div',{class:'panel', style:'margin-bottom:20px;'});
  wrap.appendChild(el('h3',{}, 'Source QA'));
  const list = el('div',{style:'display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--text-faint);'});
  [
    `${totalCentres} centres loaded from Location Master${unmapped?`; ${unmapped} not mapped to a State (flagged "Unmapped")`:''}.`,
    gpNote,
    `CSAT sourced for ${csatCentreCount} centres from the CSAT sheet.`,
    `Revenue and GP reconcile to the raw transaction sheets (cancelled transactions excluded).`,
  ].forEach(t=>list.appendChild(el('div',{}, '• '+t)));
  wrap.appendChild(list);
  return wrap;
}

function renderExec(){
  const v = document.getElementById('view-exec');
  v.innerHTML='';
  const cav = gpCaveatBanner();
  if(cav) v.appendChild(cav);

  const totals = getExactRangeTotals();
  const g = kpiGrowthContext();
  const csatRows = getFilteredCSAT();
  const avgCsat = csatRows.length? csatRows.reduce((s,r)=>s+r.value,0)/csatRows.length : null;

  const summaryPanel = el('div',{class:'hero-card'},[
    el('div',{class:'eyebrow'}, 'AI Executive Summary'),
    el('p',{}, buildExecutiveSummary()),
  ]);
  v.appendChild(summaryPanel);
  v.appendChild(renderExecutiveCommentary());

  const kpis = el('div',{class:'kpi-grid'},[
    richKpiCard({label:'Revenue', value:fmtINR(totals.revenue), mom:g.revMoM, qoq:g.revQoQ, yoy:g.revYoY, spark:g.spark}),
    richKpiCard({label:'Gross Profit', value:fmtINR(totals.gp), mom:g.gpMoM, qoq:g.gpQoQ, yoy:g.gpYoY, spark:g.sparkGP}),
    richKpiCard({label:'GP %', value:totals.gpPct.toFixed(1)+'%'}),
    richKpiCard({label:'Transactions', value:fmtNum(totals.txns)}),
    richKpiCard({label:'Avg Ticket Size', value:fmtINR(totals.ats)}),
    richKpiCard({label:'Avg CSAT', value:avgCsat!==null? avgCsat.toFixed(0)+'%':'—'}),
  ]);
  v.appendChild(kpis);

  v.appendChild(renderPriorityActions());
  v.appendChild(renderExecutiveAlerts());

  const series = withYoY(withMoM(monthlySeries()));
  const trendPanel = panel('Revenue & GP Trend', MONTHS.length+' months', el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'execTrend'})));
  const mixData = (()=>{
    const bu = getFilteredBURows();
    const map = groupSum(bu, r=>r.bu);
    const arr = [...map.entries()].map(([k,v])=>({name:k,revenue:v.revenue})).sort((a,b)=>b.revenue-a.revenue).slice(0,8);
    return arr;
  })();
  const mixPanel = panel('Revenue Mix by Business Unit', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'execMix'})));

  const g2 = el('div',{class:'grid2'},[trendPanel, mixPanel]);
  v.appendChild(g2);

  // top/bottom centres this period
  const cr = centreRanking();
  const top5 = cr.slice(0,5);
  const bottom5 = [...cr].sort((a,b)=>a.revenue-b.revenue).slice(0,5);
  const maxRev = cr.length? cr[0].revenue : 1;

  const topPanel = panel('Top 5 Centres by Revenue', null, dataTable({
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, el('span',{class:'rank-badge top'}, r.rank))},
      {key:'name', label:'Centre'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
    ],
    rows: top5,
    onRowClick: r=>{state.centre=r.name; onFilterChange();}
  }));
  const bottomPanel = panel('Bottom 5 Centres by Revenue', null, dataTable({
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, el('span',{class:'rank-badge bottom'}, r.rank))},
      {key:'name', label:'Centre'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
    ],
    rows: bottom5,
    onRowClick: r=>{state.centre=r.name; onFilterChange();}
  }));
  v.appendChild(el('div',{class:'grid2'},[topPanel, bottomPanel]));

  v.appendChild(renderSourceQA());

  requestAnimationFrame(()=>{
    lineChart('execTrend', series.map(s=>s.label), [
      {label:'Revenue', data:series.map(s=>s.revenue), borderColor:'#3aa0ff', backgroundColor:'rgba(58,160,255,.08)', fill:true, tension:.3, pointRadius:0, yAxisID:'y'},
      {label:'Gross Profit', data:series.map(s=>s.gp), borderColor:'#22d3a8', backgroundColor:'rgba(34,211,168,.08)', fill:true, tension:.3, pointRadius:0, yAxisID:'y'},
    ]);
    doughnutChart('execMix', mixData.map(d=>d.name), mixData.map(d=>d.revenue), PALETTE);
  });

  currentExporter = {filename:'executive_overview.csv', columns:[
    {key:'name',label:'Centre'},{key:'revenue',label:'Revenue'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'}
  ], rows: cr};
}

/* ================================================================
   VIEW: Revenue Analytics
   ================================================================ */
function renderRevenue(){
  const v = document.getElementById('view-revenue');
  v.innerHTML='';
  const series = monthlySeries();
  const totals = getExactRangeTotals();

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Total Revenue', fmtINR(totals.revenue)),
    kpiCard('Avg Monthly Revenue', fmtINR(safeDiv(totals.revenue, series.length||1))),
    kpiCard('Avg Ticket Size', fmtINR(totals.ats)),
    kpiCard('Transactions', fmtNum(totals.txns)),
  ]));

  const trend = panel('Monthly Revenue Trend', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'revTrend'})));

  // revenue by category (top 10)
  const catRows = getFilteredCatRows();
  const catMap = groupSum(catRows, r=>r.category);
  const catArr = [...catMap.entries()].map(([k,v])=>({name:k,...v})).sort((a,b)=>b.revenue-a.revenue).slice(0,10);
  const catPanel = panel('Revenue by Category (Top 10)', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'revCat'})));

  v.appendChild(el('div',{class:'grid2'},[trend, catPanel]));

  // revenue by item (top 10) + txn type
  const itemRows = getFilteredItemRows();
  const itemMap = groupSum(itemRows, r=>r.item);
  const itemArr = [...itemMap.entries()].map(([k,v])=>({name:k,...v})).sort((a,b)=>b.revenue-a.revenue).slice(0,10);
  const itemPanel = panel('Top Items by Revenue', 'by Item Name', dataTable({
    columns:[
      {key:'name',label:'Item Name'},
      {key:'revenue',label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'txns',label:'Txns', render:r=>numCell(r.txns, fmtNum)},
    ], rows: itemArr
  }));

  const ttRows = getFilteredTxnTypeRows();
  const ttMap = groupSum(ttRows, r=>r.type);
  const ttArr = [...ttMap.entries()].map(([k,v])=>({name:k,...v}));
  const ttPanel = panel('Revenue by Transaction Type', null, el('div',{class:'chart-wrap', style:'height:220px;'}, el('canvas',{id:'revTxnType'})));

  v.appendChild(el('div',{class:'grid2'},[itemPanel, ttPanel]));

  // revenue contribution table by centre
  const cr = centreRanking();
  const totalRev = totals.revenue || 1;
  const crPanel = panel('Revenue Contribution by Centre', cr.length+' centres', dataTable({
    id:'revContrib',
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, r.rank)},
      {key:'name', label:'Centre'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'contrib', label:'Contribution %', render:r=>el('td',{class:'num'}, (safeDiv(r.revenue,totalRev)*100).toFixed(1)+'%')},
    ],
    rows: applySorting('revContrib', cr, 'revenue'),
    onRowClick: r=>{state.centre=r.name; onFilterChange();}
  }));
  v.appendChild(crPanel);

  requestAnimationFrame(()=>{
    lineChart('revTrend', series.map(s=>s.label), [
      {label:'Revenue', data:series.map(s=>s.revenue), borderColor:'#3aa0ff', backgroundColor:'rgba(58,160,255,.1)', fill:true, tension:.3, pointRadius:0},
    ]);
    barChart('revCat', catArr.map(c=>c.name), [{label:'Revenue', data:catArr.map(c=>c.revenue), backgroundColor:'#3aa0ff', borderRadius:4}], {indexAxis:'y'});
    doughnutChart('revTxnType', ttArr.map(t=>t.name), ttArr.map(t=>t.revenue), PALETTE);
  });

  currentExporter = {filename:'revenue_by_centre.csv', columns:[
    {key:'name',label:'Centre'},{key:'revenue',label:'Revenue'}
  ], rows: cr};
}

/* ================================================================
   VIEW: Gross Profit Analytics
   ================================================================ */
function renderGP(){
  const v = document.getElementById('view-gp');
  v.innerHTML='';
  const cav = gpCaveatBanner();
  if(cav) v.appendChild(cav);
  const series = monthlySeries();
  const totals = getExactRangeTotals();

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Total Gross Profit', fmtINR(totals.gp)),
    kpiCard('GP %', totals.gpPct.toFixed(1)+'%'),
    kpiCard('Avg Monthly GP', fmtINR(safeDiv(totals.gp, series.length||1))),
    kpiCard('Revenue (ref)', fmtINR(totals.revenue)),
  ]));

  const trend = panel('Monthly GP & GP% Trend', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'gpTrend'})));

  const catRows = getFilteredCatRows();
  const catMap = groupSum(catRows, r=>r.category);
  const catArr = [...catMap.entries()].map(([k,v])=>({name:k,...v,gpPct:safeDiv(v.gp,v.revenue)*100})).sort((a,b)=>b.gp-a.gp).slice(0,10);
  const catPanel = panel('GP by Category (Top 10)', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'gpCat'})));
  v.appendChild(el('div',{class:'grid2'},[trend, catPanel]));

  const cr = centreRanking();
  const gpSorted = [...cr].sort((a,b)=>b.gpPct-a.gpPct);
  const bestGP = gpSorted.slice(0,5);
  const worstGP = [...gpSorted].reverse().slice(0,5);

  const bestPanel = panel('Highest GP% Centres', null, dataTable({
    columns:[
      {key:'name', label:'Centre'},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num pct-up'}, r.gpPct.toFixed(1)+'%')},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
    ], rows: bestGP, onRowClick:r=>{state.centre=r.name; onFilterChange();}
  }));
  const worstPanel = panel('Lowest GP% Centres', null, dataTable({
    columns:[
      {key:'name', label:'Centre'},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num pct-down'}, r.gpPct.toFixed(1)+'%')},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
    ], rows: worstGP, onRowClick:r=>{state.centre=r.name; onFilterChange();}
  }));
  v.appendChild(el('div',{class:'grid2'},[bestPanel, worstPanel]));

  requestAnimationFrame(()=>{
    lineChart('gpTrend', series.map(s=>s.label), [
      {label:'GP', data:series.map(s=>s.gp), borderColor:'#22d3a8', backgroundColor:'rgba(34,211,168,.1)', fill:true, tension:.3, pointRadius:0, yAxisID:'y'},
      {label:'GP %', data:series.map(s=>s.gpPct), borderColor:'#e8b74e', pointRadius:0, tension:.3, yAxisID:'y1'},
    ], {scales:{y:{position:'left', ticks:{color:'#8991a3'}, grid:{color:'#edf0f5'}}, y1:{position:'right', ticks:{color:'#8991a3'}, grid:{display:false}}}});
    barChart('gpCat', catArr.map(c=>c.name), [{label:'GP', data:catArr.map(c=>c.gp), backgroundColor:'#22d3a8', borderRadius:4}], {indexAxis:'y'});
  });

  currentExporter = {filename:'gp_by_centre.csv', columns:[
    {key:'name',label:'Centre'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'}
  ], rows: cr};
}

/* ================================================================
   VIEW: CSAT Analytics
   ================================================================ */
function renderCSAT(){
  const v = document.getElementById('view-csat');
  v.innerHTML='';
  const rows = getFilteredCSAT();
  if(!rows.length){
    v.appendChild(el('div',{class:'empty-state'}, 'No CSAT data for the current filter selection.'));
    currentExporter = null;
    return;
  }
  const avg = rows.reduce((s,r)=>s+r.value,0)/rows.length;
  const byMonth = groupSum(rows.map(r=>({mk:r.mk, revenue:r.value, gp:0, txns:1})), r=>r.mk);
  const mks = [...byMonth.keys()].sort((a,b)=>a-b);
  const series = mks.map(mk=>({mk, label:monthLabel(mk), value: byMonth.get(mk).revenue/byMonth.get(mk).txns}));

  const byCentre = groupSum(rows.map(r=>({centre:r.centre, revenue:r.value, gp:0, txns:1})), r=>r.centre);
  const centreArr = [...byCentre.entries()].map(([k,v])=>({name:k, value:v.revenue/v.txns})).sort((a,b)=>b.value-a.value);
  const best = centreArr.slice(0,5);
  const worst = [...centreArr].reverse().slice(0,5);

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Average CSAT', avg.toFixed(0)+'%'),
    kpiCard('Centres Reporting', centreArr.length),
    kpiCard('Best Centre', best[0]?best[0].name:'—'),
    kpiCard('Needs Attention', worst[0]?worst[0].name:'—'),
  ]));

  const trend = panel('CSAT Trend', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'csatTrend'})));
  const dist = panel('CSAT by Centre', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'csatCentre'})));
  v.appendChild(el('div',{class:'grid2'},[trend, dist]));

  const bestPanel = panel('Top 5 CSAT Centres', null, dataTable({
    columns:[{key:'name',label:'Centre'},{key:'value',label:'CSAT', render:r=>el('td',{class:'num pct-up'}, r.value.toFixed(0)+'%')}],
    rows: best, onRowClick:r=>{state.centre=r.name; onFilterChange();}
  }));
  const worstPanel = panel('Bottom 5 CSAT Centres', null, dataTable({
    columns:[{key:'name',label:'Centre'},{key:'value',label:'CSAT', render:r=>el('td',{class:'num pct-down'}, r.value.toFixed(0)+'%')}],
    rows: worst, onRowClick:r=>{state.centre=r.name; onFilterChange();}
  }));
  v.appendChild(el('div',{class:'grid2'},[bestPanel, worstPanel]));

  requestAnimationFrame(()=>{
    lineChart('csatTrend', series.map(s=>s.label), [
      {label:'CSAT %', data:series.map(s=>s.value), borderColor:'#e8b74e', backgroundColor:'rgba(232,183,78,.1)', fill:true, tension:.3, pointRadius:0},
    ]);
    barChart('csatCentre', centreArr.slice(0,15).map(c=>c.name), [{label:'CSAT %', data:centreArr.slice(0,15).map(c=>c.value), backgroundColor: centreArr.slice(0,15).map(c=>c.value>=90?'#22d3a8':c.value>=75?'#e8b74e':'#f2555a'), borderRadius:4}], {indexAxis:'y'});
  });

  currentExporter = {filename:'csat_by_centre.csv', columns:[{key:'name',label:'Centre'},{key:'value',label:'CSAT'}], rows: centreArr};
}

/* ================================================================
   VIEW: Centre Performance
   ================================================================ */
/* ================================================================
   VIEW: Targets — Target vs Achievement
   ================================================================ */
function renderTargets(){
  const v = document.getElementById('view-targets');
  v.innerHTML='';

  if(!hasAnyTargets()){
    v.appendChild(el('div',{class:'insight-card neutral'},[
      el('div',{class:'ihead'},[el('span',{class:'icon'},'◉'), el('span',{class:'ititle'},'No targets loaded yet')]),
      el('p',{}, 'Add "Revenue Target", "GP Target", and/or "CSAT Target" sheets to your master workbook (same Branch ID × Month layout as the template) and rebuild the dashboard — Target vs Achievement will appear here automatically.'),
    ]));
    currentExporter = null;
    return;
  }

  const actualRows = getFilteredMonthRows();
  const actualByCM = {}; actualRows.forEach(r=>{ actualByCM[r.mk+'|'+r.centre] = {revenue:r.revenue, gp:r.gp}; });
  const revTargets = getFilteredTarget(TARGET_REVENUE);
  const gpTargets = getFilteredTarget(TARGET_GP);
  const csatTargets = getFilteredTarget(TARGET_CSAT);

  const sumTarget = (arr)=> arr.reduce((s,r)=>s+r.value,0);
  const totalRevTarget = sumTarget(revTargets);
  const totalGpTarget = sumTarget(gpTargets);
  const totals = getExactRangeTotals();
  const csatRows = getFilteredCSAT();
  const avgCsat = csatRows.length? csatRows.reduce((s,r)=>s+r.value,0)/csatRows.length : null;
  const avgCsatTarget = csatTargets.length? csatTargets.reduce((s,r)=>s+r.value,0)/csatTargets.length : null;

  const achPct = (actual,target)=> target>0? safeDiv(actual,target)*100 : null;

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Revenue Actual', fmtINR(totals.revenue)),
    kpiCard('Revenue Target', totalRevTarget>0?fmtINR(totalRevTarget):'—'),
    kpiCard('Revenue Achievement', achPct(totals.revenue,totalRevTarget)!==null? achPct(totals.revenue,totalRevTarget).toFixed(0)+'%':'—', null, deltaDir((achPct(totals.revenue,totalRevTarget)||0)-100)),
    kpiCard('GP Achievement', achPct(totals.gp,totalGpTarget)!==null? achPct(totals.gp,totalGpTarget).toFixed(0)+'%':'—', null, deltaDir((achPct(totals.gp,totalGpTarget)||0)-100)),
    kpiCard('CSAT Actual vs Target', avgCsat!==null? avgCsat.toFixed(0)+'%'+(avgCsatTarget?' / '+avgCsatTarget.toFixed(0)+'%':'') : '—'),
  ]));

  // Monthly actual vs target trend (revenue)
  const revTargetByMk = {};
  revTargets.forEach(r=>{ revTargetByMk[r.mk] = (revTargetByMk[r.mk]||0) + r.value; });
  const series = monthlySeries();
  const trendPanel = panel('Revenue: Actual vs Target', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'targetTrend'})));

  // Centre-level target vs achievement table
  const centreTargetMap = {}; // centre -> {revActual, revTarget, gpActual, gpTarget}
  revTargets.forEach(r=>{
    if(!centreTargetMap[r.centre]) centreTargetMap[r.centre]={revActual:0,revTarget:0,gpActual:0,gpTarget:0};
    centreTargetMap[r.centre].revTarget += r.value;
  });
  gpTargets.forEach(r=>{
    if(!centreTargetMap[r.centre]) centreTargetMap[r.centre]={revActual:0,revTarget:0,gpActual:0,gpTarget:0};
    centreTargetMap[r.centre].gpTarget += r.value;
  });
  actualRows.forEach(r=>{
    if(!centreTargetMap[r.centre]) return; // only show centres that have a target set
    centreTargetMap[r.centre].revActual += r.revenue;
    centreTargetMap[r.centre].gpActual += r.gp;
  });
  const centreRows = Object.entries(centreTargetMap).map(([name,v])=>({
    name, ...v,
    revAch: achPct(v.revActual, v.revTarget),
    gpAch: achPct(v.gpActual, v.gpTarget),
  })).sort((a,b)=>(b.revAch||0)-(a.revAch||0));

  const tablePanel = panel('Centre-Level Target vs Achievement', centreRows.length+' centres with targets set', dataTable({
    columns:[
      {key:'name', label:'Centre'},
      {key:'revActual', label:'Revenue Actual', render:r=>numCell(r.revActual)},
      {key:'revTarget', label:'Revenue Target', render:r=>numCell(r.revTarget)},
      {key:'revAch', label:'Rev Achievement', render:r=>el('td',{class:'num'}, r.revAch!==null? el('span',{class:'pill '+(r.revAch>=100?'good':r.revAch>=80?'warn':'bad')}, r.revAch.toFixed(0)+'%') : '—')},
      {key:'gpActual', label:'GP Actual', render:r=>numCell(r.gpActual)},
      {key:'gpTarget', label:'GP Target', render:r=>numCell(r.gpTarget)},
      {key:'gpAch', label:'GP Achievement', render:r=>el('td',{class:'num'}, r.gpAch!==null? el('span',{class:'pill '+(r.gpAch>=100?'good':r.gpAch>=80?'warn':'bad')}, r.gpAch.toFixed(0)+'%') : '—')},
    ],
    rows: centreRows,
    onRowClick: r=>{state.centre=r.name; onFilterChange();}
  }));

  v.appendChild(trendPanel);
  v.appendChild(tablePanel);

  requestAnimationFrame(()=>{
    lineChart('targetTrend', series.map(s=>s.label), [
      {label:'Actual Revenue', data:series.map(s=>s.revenue), borderColor:'#3aa0ff', pointRadius:0, tension:.2},
      {label:'Target Revenue', data:series.map(s=>revTargetByMk[s.mk]||null), borderColor:'#d97706', borderDash:[5,4], pointRadius:2, tension:.2, spanGaps:false},
    ]);
  });

  currentExporter = {filename:'target_vs_achievement.csv', columns:[
    {key:'name',label:'Centre'},{key:'revActual',label:'Revenue Actual'},{key:'revTarget',label:'Revenue Target'},
    {key:'revAch',label:'Revenue Achievement %'},{key:'gpActual',label:'GP Actual'},{key:'gpTarget',label:'GP Target'},{key:'gpAch',label:'GP Achievement %'}
  ], rows: centreRows};
}

function renderCentre(){
  const v = document.getElementById('view-centre');
  v.innerHTML='';
  const cr = centreRanking();
  const maxRev = cr.length? cr[0].revenue : 1;
  const networkAvgRev = safeDiv(cr.reduce((s,r)=>s+r.revenue,0), cr.length||1);
  const networkAvgGpPct = cr.reduce((s,r)=>s+r.gpPct,0)/(cr.length||1);
  const scores = computePerformanceScores();
  const scoreMap = {}; scores.forEach(s=>scoreMap[s.name]=s);

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Centres Active', cr.length),
    kpiCard('Avg Revenue / Centre', fmtINR(networkAvgRev)),
    kpiCard('Top Centre', cr[0]?cr[0].name:'—'),
    kpiCard('Avg GP%', networkAvgGpPct.toFixed(1)+'%'),
  ]));

  const tableId = 'centrePerf';
  const merged = cr.map(c=>({...c, score:scoreMap[c.name]?scoreMap[c.name].score:null, bucket:scoreMap[c.name]?scoreMap[c.name].bucket:'—', bucketClass:scoreMap[c.name]?scoreMap[c.name].bucketClass:'flat',
    vsNetworkRev: safeDiv(c.revenue-networkAvgRev, networkAvgRev)*100}));
  const sorted = applySorting(tableId, merged, 'revenue');
  const tablePanel = panel('Centre Performance', cr.length+' centres — click a row to drill in', dataTable({
    id: tableId,
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, el('span',{class:'rank-badge '+(r.rank<=3?'top':r.rank>cr.length-3?'bottom':'')}, r.rank))},
      {key:'name', label:'Centre'},
      {key:'state', label:'State'},
      {key:'arm', label:'ARM'},
      {key:'type', label:'Type', render:r=>el('td',{}, el('span',{class:'pill '+(r.type==='Service Centre'?'type-svc':'type-drop')}, r.type||'—'))},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'vsNetworkRev', label:'vs Network Avg', render:r=>pctCell(r.vsNetworkRev)},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
      {key:'ats', label:'ATS', render:r=>numCell(r.ats)},
      {key:'score', label:'Score', render:r=>el('td',{class:'num'}, r.score!==null? el('span',{class:'pill '+r.bucketClass}, r.score+' · '+r.bucket) : '—')},
      {key:'bar', label:'Share', render:r=>barCell(r.revenue, maxRev)},
    ],
    rows: sorted,
    onRowClick: r=>{state.centre=r.name; onFilterChange();}
  }));
  v.appendChild(tablePanel);

  currentExporter = {filename:'centre_performance.csv', columns:[
    {key:'name',label:'Centre'},{key:'state',label:'State'},{key:'arm',label:'ARM'},
    {key:'revenue',label:'Revenue'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'},{key:'txns',label:'Txns'},
    {key:'score',label:'Performance Score'},{key:'bucket',label:'Bucket'}
  ], rows: sorted};
}

/* ================================================================
   VIEW: State Performance
   ================================================================ */
/* ================================================================
   VIEW: Centre Explorer — entity picker + score profile + action
   (pattern borrowed from the Retail Intelligence OS reference)
   ================================================================ */
let explorerState = {centre:null, arm:null};

function renderCentreExplorer(){
  const v = document.getElementById('view-centreexplorer');
  v.innerHTML='';
  const cr = centreRanking();
  if(!cr.length){ v.appendChild(el('div',{class:'empty-state'},'No centre data for the current filter selection.')); currentExporter=null; return; }
  if(!explorerState.centre || !cr.find(c=>c.name===explorerState.centre)) explorerState.centre = cr[0].name;

  const picker = el('select',{onchange:e=>{explorerState.centre=e.target.value; renderAll();}});
  cr.forEach(c=>picker.appendChild(el('option',{value:c.name}, c.name)));
  picker.value = explorerState.centre;
  v.appendChild(el('div',{class:'panel', style:'margin-bottom:16px;'},
    el('div',{style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap;'},[
      el('label',{style:'font-size:11px;color:var(--text-faint);'},'Select Centre:'), picker
    ])
  ));

  const c = cr.find(x=>x.name===explorerState.centre);
  const scores = computePerformanceScores();
  const scoreObj = scores.find(s=>s.name===c.name);

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Revenue', fmtINR(c.revenue)),
    kpiCard('Gross Profit', fmtINR(c.gp)),
    kpiCard('GP %', c.gpPct.toFixed(1)+'%'),
    kpiCard('Transactions', fmtNum(c.txns)),
    kpiCard('Avg Ticket Size', fmtINR(c.ats)),
    kpiCard('Performance Score', scoreObj? scoreObj.score+' · '+scoreObj.bucket : '—'),
  ]));

  if(scoreObj){
    const factors = [
      {label:'Revenue Growth (MoM)', val: scoreObj.revGrowth},
      {label:'GP Growth (MoM)', val: scoreObj.gpGrowth},
      {label:'GP Margin', val: scoreObj.gpMargin},
      {label:'CSAT', val: scoreObj.csat},
    ];
    v.appendChild(panel('Score Profile', 'weighted: Rev Growth 25% · GP Growth 25% · GP Margin 15% · CSAT 20% · Productivity 15%',
      el('div',{style:'display:flex;flex-direction:column;gap:12px;'},
        factors.map(f=>el('div',{},[
          el('div',{style:'display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-dim);margin-bottom:4px;'},[
            el('span',{}, f.label), el('span',{}, f.val.toFixed(1)+'%')
          ]),
          el('div',{class:'bar-track'}, el('div',{class:'bar-fill', style:'width:'+Math.min(100,Math.max(2,f.val))+'%'}))
        ]))
      )
    ));
  }

  const rows = FACT_MONTH.filter(r=>r[1]===c.name && monthInRange(r[0])).map(([mk,cc,rev,gp])=>({mk,label:monthLabel(mk),revenue:rev,gp})).sort((a,b)=>a.mk-b.mk);
  v.appendChild(panel('Revenue & GP Trend — '+c.name, null, el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'explorerCentreTrend'}))));

  let action = 'Performing within normal bounds — maintain current execution.';
  if(scoreObj){
    if(scoreObj.gpMargin<15) action = 'GP margin is critically low — review pricing, parts sourcing, and discount approvals at this centre.';
    else if(scoreObj.csat<75) action = 'CSAT is below threshold — audit recent service quality and turnaround time.';
    else if(scoreObj.revGrowth<-10) action = 'Revenue is declining sharply — investigate footfall, competitive activity, and staffing.';
    else if(scoreObj.bucket==='Excellent') action = "Top-tier performance — document this centre's playbook for replication elsewhere.";
  }
  v.appendChild(el('div',{class:'insight-card neutral'},[
    el('div',{class:'ihead'},[el('span',{class:'icon'},'→'), el('span',{class:'ititle'},'Recommended Action')]),
    el('p',{}, action),
  ]));

  requestAnimationFrame(()=>{
    lineChart('explorerCentreTrend', rows.map(s=>s.label), [
      {label:'Revenue', data:rows.map(s=>s.revenue), borderColor:'#3aa0ff', pointRadius:2, tension:.3},
      {label:'GP', data:rows.map(s=>s.gp), borderColor:'#22d3a8', pointRadius:2, tension:.3},
    ]);
  });

  currentExporter = {filename:'centre_explorer_'+c.name.replace(/\s+/g,'_')+'.csv', columns:[
    {key:'label',label:'Month'},{key:'revenue',label:'Revenue'},{key:'gp',label:'GP'}
  ], rows: rows};
}

/* ================================================================
   VIEW: ARM Explorer
   ================================================================ */
function renderArmExplorer(){
  const v = document.getElementById('view-armexplorer');
  v.innerHTML='';
  const ar = armRanking();
  if(!ar.length){ v.appendChild(el('div',{class:'empty-state'},'No ARM data for the current filter selection.')); currentExporter=null; return; }
  if(!explorerState.arm || !ar.find(a=>a.key===explorerState.arm)) explorerState.arm = ar[0].key;

  const picker = el('select',{onchange:e=>{explorerState.arm=e.target.value; renderAll();}});
  ar.forEach(a=>picker.appendChild(el('option',{value:a.key}, a.key)));
  picker.value = explorerState.arm;
  v.appendChild(el('div',{class:'panel', style:'margin-bottom:16px;'},
    el('div',{style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap;'},[
      el('label',{style:'font-size:11px;color:var(--text-faint);'},'Select ARM:'), picker
    ])
  ));

  const a = ar.find(x=>x.key===explorerState.arm);
  const centresUnderArm = CENTRES.filter(c=>c.ARM===a.key).map(c=>c.Centre);
  const cr = centreRanking().filter(c=>centresUnderArm.includes(c.name)).sort((x,y)=>y.revenue-x.revenue);

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Revenue', fmtINR(a.revenue)),
    kpiCard('Gross Profit', fmtINR(a.gp)),
    kpiCard('GP %', a.gpPct.toFixed(1)+'%'),
    kpiCard('Transactions', fmtNum(a.txns)),
    kpiCard('Centres Under ARM', centresUnderArm.length),
    kpiCard('Avg Revenue / Centre', fmtINR(safeDiv(a.revenue, centresUnderArm.length||1))),
  ]));

  const maxRev = cr.length? cr[0].revenue : 1;
  v.appendChild(panel('Centres Under '+a.key, cr.length+' centres', dataTable({
    columns:[
      {key:'name',label:'Centre'},
      {key:'revenue',label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gpPct',label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'bar',label:'Share', render:r=>barCell(r.revenue,maxRev)},
    ], rows: cr,
    onRowClick: r=>{state.centre=r.name; onFilterChange(); activeTab='exec'; buildTabs(); renderAll();}
  })));

  const rows = FACT_MONTH.filter(r=>centresUnderArm.includes(r[1]) && monthInRange(r[0]));
  const mmap = groupSum(rows.map(([mk,c,rev,gp,tx])=>({mk,revenue:rev,gp,txns:tx})), r=>r.mk);
  const mks=[...mmap.keys()].sort((x,y)=>x-y);
  const series = mks.map(mk=>({mk,label:monthLabel(mk),...mmap.get(mk)}));
  v.appendChild(panel('Revenue & GP Trend — '+a.key, null, el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'explorerArmTrend'}))));

  const avgCentreRev = safeDiv(cr.reduce((s,x)=>s+x.revenue,0), cr.length||1);
  let action = 'Performing within normal bounds.';
  if(a.gpPct<15) action = "GP margin across this ARM's centres is critically low — review pricing and discounting practices network-wide.";
  else if(cr.length && cr.every(c=>c.revenue < avgCentreRev*1.3)) action = 'Revenue is evenly (and modestly) spread — consider whether any centre under this ARM could be a breakout growth focus.';
  v.appendChild(el('div',{class:'insight-card neutral'},[
    el('div',{class:'ihead'},[el('span',{class:'icon'},'→'), el('span',{class:'ititle'},'Recommended Action')]),
    el('p',{}, action),
  ]));

  requestAnimationFrame(()=>{
    lineChart('explorerArmTrend', series.map(s=>s.label), [
      {label:'Revenue', data:series.map(s=>s.revenue), borderColor:'#3aa0ff', pointRadius:2, tension:.3},
      {label:'GP', data:series.map(s=>s.gp), borderColor:'#22d3a8', pointRadius:2, tension:.3},
    ]);
  });

  currentExporter = {filename:'arm_explorer_'+a.key.replace(/\s+/g,'_')+'.csv', columns:[
    {key:'name',label:'Centre'},{key:'revenue',label:'Revenue'},{key:'gpPct',label:'GP%'}
  ], rows: cr};
}

/* ================================================================
   VIEW: State Performance
   ================================================================ */
function renderStatePerf(){
  const v = document.getElementById('view-stateperf');
  v.innerHTML='';
  const sr = stateRanking();
  const maxRev = sr.length? sr[0].revenue : 1;

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('States Active', sr.length),
    kpiCard('Top State', sr[0]?sr[0].name:'—'),
    kpiCard('Avg GP%', (sr.reduce((s,r)=>s+r.gpPct,0)/(sr.length||1)).toFixed(1)+'%'),
  ]));

  const chartPanel = panel('Revenue by State', null, el('div',{class:'chart-wrap', style:'height:320px;'}, el('canvas',{id:'stateChart'})));
  v.appendChild(chartPanel);

  const tableId='statePerf';
  const sorted = applySorting(tableId, sr, 'revenue');
  const tablePanel = panel('State Performance', sr.length+' states — click to drill in', dataTable({
    id: tableId,
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, el('span',{class:'rank-badge top'}, r.rank))},
      {key:'name', label:'State'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
      {key:'bar', label:'Share', render:r=>barCell(r.revenue, maxRev)},
    ],
    rows: sorted,
    onRowClick: r=>{state.state=r.key; onFilterChange();}
  }));
  v.appendChild(tablePanel);

  requestAnimationFrame(()=>{
    barChart('stateChart', sr.map(s=>s.name), [{label:'Revenue', data:sr.map(s=>s.revenue), backgroundColor:'#3aa0ff', borderRadius:4}], {
      onBarClick:(label)=>{state.state=label; onFilterChange();}
    });
  });

  currentExporter = {filename:'state_performance.csv', columns:[
    {key:'name',label:'State'},{key:'revenue',label:'Revenue'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'}
  ], rows: sorted};
}

/* ================================================================
   VIEW: ARM Performance
   ================================================================ */
function renderARM(){
  const v = document.getElementById('view-arm');
  v.innerHTML='';
  const ar = armRanking();
  const maxRev = ar.length? ar[0].revenue : 1;

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('ARMs Active', ar.length),
    kpiCard('Top ARM', ar[0]?ar[0].name:'—'),
    kpiCard('Avg Revenue / ARM', fmtINR(safeDiv(ar.reduce((s,r)=>s+r.revenue,0), ar.length||1))),
  ]));

  const tableId='armPerf';
  const sorted = applySorting(tableId, ar, 'revenue');
  const tablePanel = panel('ARM Performance', ar.length+' ARMs — click to drill in', dataTable({
    id: tableId,
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, el('span',{class:'rank-badge top'}, r.rank))},
      {key:'name', label:'ARM'},
      {key:'state', label:'State'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
      {key:'bar', label:'Share', render:r=>barCell(r.revenue, maxRev)},
    ],
    rows: sorted,
    onRowClick: r=>{state.arm=r.key; onFilterChange();}
  }));
  v.appendChild(tablePanel);

  currentExporter = {filename:'arm_performance.csv', columns:[
    {key:'name',label:'ARM'},{key:'revenue',label:'Revenue'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'}
  ], rows: sorted};
}

/* ================================================================
   VIEW: Business Unit Analytics
   ================================================================ */
function renderBU(){
  const v = document.getElementById('view-bu');
  v.innerHTML='';
  const rows = getFilteredBURows();
  const map = groupSum(rows, r=>r.bu);
  const arr = [...map.entries()].map(([k,v])=>({name:k, ...v, gpPct:safeDiv(v.gp,v.revenue)*100})).sort((a,b)=>b.revenue-a.revenue);
  const totalRev = arr.reduce((s,r)=>s+r.revenue,0) || 1;

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Business Units', arr.length),
    kpiCard('Top BU', arr[0]?arr[0].name:'—'),
    kpiCard('Top BU Share', arr[0]? (safeDiv(arr[0].revenue,totalRev)*100).toFixed(1)+'%':'—'),
  ]));

  const chartPanel = panel('Revenue by Business Unit', null, el('div',{class:'chart-wrap', style:'height:300px;'}, el('canvas',{id:'buChart'})));

  // BU trend over time for top 5 BUs
  const top5BU = arr.slice(0,5).map(a=>a.name);
  const byMonthBU = new Map(); // mk -> {bu:revenue}
  rows.forEach(r=>{
    if(!top5BU.includes(r.bu)) return;
    if(!byMonthBU.has(r.mk)) byMonthBU.set(r.mk, {});
    const o = byMonthBU.get(r.mk);
    o[r.bu] = (o[r.bu]||0) + r.revenue;
  });
  const mks = [...byMonthBU.keys()].sort((a,b)=>a-b);
  const trendPanel = panel('Top 5 BU Trend', null, el('div',{class:'chart-wrap', style:'height:300px;'}, el('canvas',{id:'buTrend'})));

  v.appendChild(el('div',{class:'grid2'},[chartPanel, trendPanel]));

  const tableId='buPerf';
  const sorted = applySorting(tableId, arr, 'revenue');
  const tablePanel = panel('Business Unit Detail', null, dataTable({
    id: tableId,
    columns:[
      {key:'name', label:'Business Unit'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'contrib', label:'Rev Contribution', render:r=>el('td',{class:'num'}, (safeDiv(r.revenue,totalRev)*100).toFixed(1)+'%')},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
    ],
    rows: sorted,
    onRowClick: r=>{state.bu=r.name; onFilterChange();}
  }));
  v.appendChild(tablePanel);

  requestAnimationFrame(()=>{
    barChart('buChart', arr.slice(0,10).map(a=>a.name), [{label:'Revenue', data:arr.slice(0,10).map(a=>a.revenue), backgroundColor:'#3aa0ff', borderRadius:4}], {indexAxis:'y',
      onBarClick:(label)=>{state.bu=label; onFilterChange();}});
    lineChart('buTrend', mks.map(mk=>monthLabel(mk)), top5BU.map((bu,i)=>({
      label:bu, data:mks.map(mk=>(byMonthBU.get(mk)||{})[bu]||0), borderColor:PALETTE[i], pointRadius:0, tension:.3
    })));
  });

  currentExporter = {filename:'business_unit_performance.csv', columns:[
    {key:'name',label:'Business Unit'},{key:'revenue',label:'Revenue'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'}
  ], rows: sorted};
}

/* ================================================================
   VIEW: Licenses (dedicated Business Unit KPI, like CSAT/Revenue)
   ================================================================ */
function renderLicenses(){
  const v = document.getElementById('view-licenses');
  v.innerHTML='';
  const rows = getFilteredBURows().filter(r=>r.bu==='Licenses');
  if(!rows.length){
    v.appendChild(el('div',{class:'empty-state'}, 'No Licenses data for the current filter selection.'));
    currentExporter = null;
    return;
  }
  const totals = sumRows(rows);

  // monthly series for Licenses only
  const byMonth = groupSum(rows, r=>r.mk);
  const mks = [...byMonth.keys()].sort((a,b)=>a-b);
  let series = mks.map(mk=>({mk, label:monthLabel(mk), ...byMonth.get(mk), gpPct:safeDiv(byMonth.get(mk).gp,byMonth.get(mk).revenue)*100}));
  series = withYoY(withMoM(series));
  const last = series[series.length-1];

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('License Revenue', fmtINR(totals.revenue)),
    kpiCard('License GP', fmtINR(totals.gp)),
    kpiCard('License GP %', totals.gpPct.toFixed(1)+'%'),
    kpiCard('License Transactions', fmtNum(totals.txns)),
    kpiCard('Latest MoM Growth', last&&last.mom!==null?fmtPct(last.mom):'—', null, last?deltaDir(last.mom):'flat'),
    kpiCard('Latest YoY Growth', last&&last.yoy!==null?fmtPct(last.yoy):'—', null, last?deltaDir(last.yoy):'flat'),
  ]));

  const trendPanel = panel('License Revenue Trend', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'licTrend'})));
  const centreRows = groupSum(rows, r=>r.centre);
  const centreArr = [...centreRows.entries()].map(([k,v])=>({name:k, ...v, gpPct:safeDiv(v.gp,v.revenue)*100})).sort((a,b)=>b.revenue-a.revenue);
  const centrePanel = panel('License Revenue by Centre', null, el('div',{class:'chart-wrap', style:'height:280px;'}, el('canvas',{id:'licCentre'})));
  v.appendChild(el('div',{class:'grid2'},[trendPanel, centrePanel]));

  const tableId = 'licTable';
  const sorted = applySorting(tableId, centreArr, 'revenue');
  v.appendChild(panel('License Performance by Centre', centreArr.length+' centres', dataTable({
    id: tableId,
    columns:[
      {key:'name', label:'Centre'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
    ],
    rows: sorted,
    onRowClick: r=>{state.centre=r.name; onFilterChange();}
  })));

  const growthTablePanel = panel('Monthly License Growth', null, dataTable({
    columns:[
      {key:'label', label:'Month'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'mom', label:'MoM %', render:r=>pctCell(r.mom)},
      {key:'yoy', label:'YoY %', render:r=>pctCell(r.yoy)},
    ],
    rows: series
  }));
  v.appendChild(growthTablePanel);

  requestAnimationFrame(()=>{
    lineChart('licTrend', series.map(s=>s.label), [
      {label:'License Revenue', data:series.map(s=>s.revenue), borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,.1)', fill:true, tension:.3, pointRadius:0},
    ]);
    barChart('licCentre', centreArr.slice(0,15).map(c=>c.name), [{label:'Revenue', data:centreArr.slice(0,15).map(c=>c.revenue), backgroundColor:'#a78bfa', borderRadius:4}], {indexAxis:'y'});
  });

  currentExporter = {filename:'licenses_by_centre.csv', columns:[
    {key:'name',label:'Centre'},{key:'revenue',label:'Revenue'},{key:'gp',label:'GP'},{key:'gpPct',label:'GP%'}
  ], rows: sorted};
}

/* ================================================================
   VIEW: Growth Dashboard (MoM / QoQ / YoY)
   ================================================================ */
function renderGrowth(){
  const v = document.getElementById('view-growth');
  v.innerHTML='';
  const cav = gpCaveatBanner();
  if(cav) v.appendChild(cav);
  let series = monthlySeries();
  series = rolling3(runningTotals(withYoY(withMoM(series))));
  const q = quarterlySeries().map((r,i,arr)=>{
    const prev = arr[i-1];
    const qoq = prev? safeDiv(r.revenue-prev.revenue, prev.revenue)*100 : null;
    return {...r, qoq};
  });

  const lastMoM = series.length? series[series.length-1].mom : null;
  const lastYoY = series.length? series[series.length-1].yoy : null;
  const lastQoQ = q.length? q[q.length-1].qoq : null;

  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Latest MoM Growth', lastMoM!==null?fmtPct(lastMoM):'—', null, deltaDir(lastMoM)),
    kpiCard('Latest QoQ Growth', lastQoQ!==null?fmtPct(lastQoQ):'—', null, deltaDir(lastQoQ)),
    kpiCard('Latest YoY Growth', lastYoY!==null?fmtPct(lastYoY):'—', null, deltaDir(lastYoY)),
    kpiCard('Running Total Revenue', fmtINR(series.length?series[series.length-1].running:0)),
  ]));

  const momPanel = panel('Month-on-Month Growth %', null, el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'momChart'})));
  const yoyPanel = panel('Year-on-Year Growth %', null, el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'yoyChart'})));
  v.appendChild(el('div',{class:'grid2'},[momPanel, yoyPanel]));

  const qoqPanel = panel('Quarter-on-Quarter Growth %', null, el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'qoqChart'})));
  const rollPanel = panel('Revenue: Actual vs Rolling 3-Month Average', null, el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'rollChart'})));
  v.appendChild(el('div',{class:'grid2'},[qoqPanel, rollPanel]));

  const tableId='growthTable';
  const tRows = applySorting(tableId, series, 'mk');
  const tablePanel = panel('Monthly Growth Detail', null, dataTable({
    id: tableId,
    columns:[
      {key:'label', label:'Month'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'mom', label:'MoM %', render:r=>pctCell(r.mom)},
      {key:'yoy', label:'YoY %', render:r=>pctCell(r.yoy)},
      {key:'running', label:'Running Total', render:r=>numCell(r.running)},
      {key:'rolling3', label:'Rolling 3M Avg', render:r=>numCell(r.rolling3)},
    ],
    rows: tRows
  }));
  v.appendChild(tablePanel);

  // Simple forecast — linear trend extrapolation, next 3 months
  const fc = linearForecast(series, 3);
  if(fc.length){
    const fcPanel = panel('Revenue Forecast (Next 3 Months)', 'Linear trend, ~80% band', el('div',{class:'chart-wrap', style:'height:260px;'}, el('canvas',{id:'forecastChart'})));
    v.appendChild(fcPanel);
    const projQuarter = fc.slice(0,3).reduce((s,f)=>s+f.forecast,0);
    v.appendChild(el('div',{class:'kpi-grid', style:'margin-top:14px;'},[
      kpiCard('Next Month Forecast', fmtINR(fc[0].forecast)),
      kpiCard('Projected Next Quarter', fmtINR(projQuarter)),
      kpiCard('Forecast Range (Next Month)', fmtINR(fc[0].lo)+' – '+fmtINR(fc[0].hi)),
    ]));
    requestAnimationFrame(()=>{
      const allLabels = [...series.map(s=>s.label), ...fc.map(f=>f.label)];
      const actualData = [...series.map(s=>s.revenue), ...fc.map(()=>null)];
      const forecastData = [...series.map(()=>null), ...fc.map(f=>f.forecast)];
      const hiData = [...series.map(()=>null), ...fc.map(f=>f.hi)];
      const loData = [...series.map(()=>null), ...fc.map(f=>f.lo)];
      lineChart('forecastChart', allLabels, [
        {label:'Actual', data:actualData, borderColor:'#3aa0ff', pointRadius:0, tension:.2, spanGaps:false},
        {label:'Forecast', data:forecastData, borderColor:'#e8b74e', borderDash:[5,4], pointRadius:2, tension:.2, spanGaps:false},
        {label:'Upper Band', data:hiData, borderColor:'rgba(232,183,78,.25)', pointRadius:0, tension:.2, spanGaps:false},
        {label:'Lower Band', data:loData, borderColor:'rgba(232,183,78,.25)', pointRadius:0, tension:.2, spanGaps:false},
      ]);
    });
  }

  requestAnimationFrame(()=>{
    barChart('momChart', series.map(s=>s.label), [{label:'MoM %', data:series.map(s=>s.mom), backgroundColor: series.map(s=>s.mom>=0?'#22d3a8':'#f2555a'), borderRadius:4}]);
    barChart('yoyChart', series.map(s=>s.label), [{label:'YoY %', data:series.map(s=>s.yoy), backgroundColor: series.map(s=>(s.yoy||0)>=0?'#22d3a8':'#f2555a'), borderRadius:4}]);
    barChart('qoqChart', q.map(s=>s.label), [{label:'QoQ %', data:q.map(s=>s.qoq), backgroundColor: q.map(s=>(s.qoq||0)>=0?'#22d3a8':'#f2555a'), borderRadius:4}]);
    lineChart('rollChart', series.map(s=>s.label), [
      {label:'Actual Revenue', data:series.map(s=>s.revenue), borderColor:'#3aa0ff', pointRadius:0, tension:.2},
      {label:'Rolling 3M Avg', data:series.map(s=>s.rolling3), borderColor:'#e8b74e', pointRadius:0, borderDash:[5,4], tension:.2},
    ]);
  });

  currentExporter = {filename:'growth_detail.csv', columns:[
    {key:'label',label:'Month'},{key:'revenue',label:'Revenue'},{key:'mom',label:'MoM%'},{key:'yoy',label:'YoY%'},{key:'running',label:'Running Total'}
  ], rows: tRows};
}

/* ================================================================
   VIEW: Exceptions — automatic red/yellow/green flags
   ================================================================ */
function renderExceptions(){
  const v = document.getElementById('view-exceptions');
  v.innerHTML='';
  const cr = centreRanking();
  const revGrowth = centreGrowthMap(2);
  const gpGrowth = centreGrowthMap(3);
  const csatRows = getFilteredCSAT();
  const csatByCentre = groupSum(csatRows.map(r=>({centre:r.centre, revenue:r.value, gp:0, txns:1})), r=>r.centre);
  const networkAvgAts = safeDiv(cr.reduce((s,r)=>s+r.ats,0), cr.length||1);

  const rows = cr.map(c=>{
    const rg = revGrowth[c.name], gg = gpGrowth[c.name];
    const csatObj = csatByCentre.get(c.name);
    const csatVal = csatObj? csatObj.revenue/csatObj.txns : null;
    const flags = [];
    if(rg!==undefined && rg < -10) flags.push({level:'bad', text:`Revenue drop >10% (${fmtPct(rg)})`});
    if(c.gpPct < 15) flags.push({level:'bad', text:`GP margin below 15% (${c.gpPct.toFixed(1)}%)`});
    if(csatVal!==null && csatVal < 75) flags.push({level:'warn', text:`CSAT below target (${csatVal.toFixed(0)}%)`});
    if(rg!==undefined && gg!==undefined && rg>2 && gg<0) flags.push({level:'warn', text:'Revenue growing but GP falling'});
    if(rg!==undefined && gg!==undefined && gg>2 && rg<0) flags.push({level:'good', text:'GP growing despite revenue decline'});
    if(c.ats < networkAvgAts*0.6) flags.push({level:'warn', text:'Low productivity (ATS well below network average)'});
    const worst = flags.some(f=>f.level==='bad') ? 'bad' : flags.some(f=>f.level==='warn') ? 'warn' : 'good';
    return {...c, flags, worst, revGrowth:rg, gpGrowth:gg, csat:csatVal};
  }).filter(r=>r.flags.length>0);
  rows.sort((a,b)=>{ const order={bad:0,warn:1,good:2}; return order[a.worst]-order[b.worst]; });

  const counts = {bad: rows.filter(r=>r.worst==='bad').length, warn: rows.filter(r=>r.worst==='warn').length, good: rows.filter(r=>r.worst==='good').length};
  v.appendChild(el('div',{class:'kpi-grid'},[
    kpiCard('Critical (Red)', counts.bad),
    kpiCard('Caution (Yellow)', counts.warn),
    kpiCard('Positive Flags (Green)', counts.good),
    kpiCard('Centres Flagged', rows.length+' of '+cr.length),
  ]));

  if(!rows.length){
    v.appendChild(el('div',{class:'empty-state'},'No exceptions detected for the current filter selection — all centres within normal bounds.'));
    currentExporter = null;
    return;
  }

  const dotColor = {bad:'var(--bad)', warn:'var(--warn)', good:'var(--good)'};
  rows.forEach(r=>{
    const card = el('div',{class:'insight-card '+(r.worst==='bad'?'warn':r.worst==='warn'?'neutral':'good'), style:'cursor:pointer;', onclick:()=>{state.centre=r.name; onFilterChange(); activeTab='exec'; buildTabs(); renderAll();}},[
      el('div',{class:'ihead'},[
        el('span',{style:`display:inline-block;width:9px;height:9px;border-radius:50%;background:${dotColor[r.worst]};`}),
        el('span',{class:'ititle'}, r.name+' · '+(r.state||'—')),
      ]),
      ...r.flags.map(f=>el('p',{}, (f.level==='bad'?'🔴 ':f.level==='warn'?'🟡 ':'🟢 ')+f.text)),
    ]);
    v.appendChild(card);
  });

  currentExporter = {filename:'exceptions.csv', columns:[
    {key:'name',label:'Centre'},{key:'state',label:'State'},{key:'worst',label:'Severity'},
    {key:'revGrowth',label:'Revenue Growth %'},{key:'gpPct',label:'GP%'},{key:'csat',label:'CSAT'}
  ], rows: rows};
}

/* ================================================================
   VIEW: Rankings & Leaderboards
   ================================================================ */
function renderRankings(){
  const v = document.getElementById('view-rankings');
  v.innerHTML='';

  const cr = centreRanking();
  const sr = stateRanking();
  const ar = armRanking();
  const execRows = getFilteredExecRows();
  const execMap = groupSum(execRows, r=>r.exec);
  const execArr = [...execMap.entries()].map(([k,v])=>({name:k,...v})).sort((a,b)=>b.revenue-a.revenue).slice(0,10);

  v.appendChild(el('div',{class:'grid3'},[
    panel('Centre Leaderboard', null, dataTable({
      columns:[
        {key:'rank',label:'#',render:r=>el('td',{},el('span',{class:'rank-badge top'},r.rank))},
        {key:'name',label:'Centre'},
        {key:'revenue',label:'Revenue',render:r=>numCell(r.revenue)},
      ], rows: cr.slice(0,10), onRowClick:r=>{state.centre=r.name; onFilterChange();}
    })),
    panel('ARM Leaderboard', null, dataTable({
      columns:[
        {key:'rank',label:'#',render:r=>el('td',{},el('span',{class:'rank-badge top'},r.rank))},
        {key:'name',label:'ARM'},
        {key:'revenue',label:'Revenue',render:r=>numCell(r.revenue)},
      ], rows: ar.slice(0,10), onRowClick:r=>{state.arm=r.key; onFilterChange();}
    })),
    panel('State Leaderboard', null, dataTable({
      columns:[
        {key:'rank',label:'#',render:r=>el('td',{},el('span',{class:'rank-badge top'},r.rank))},
        {key:'name',label:'State'},
        {key:'revenue',label:'Revenue',render:r=>numCell(r.revenue)},
      ], rows: sr.slice(0,10), onRowClick:r=>{state.state=r.key; onFilterChange();}
    })),
  ]));

  v.appendChild(panel('Executive Leaderboard (All-Time, within current filters)', 'Top 10 by revenue', dataTable({
    columns:[
      {key:'rank', label:'#', render:(r)=>el('td',{}, el('span',{class:'rank-badge top'}, execArr.indexOf(r)+1))},
      {key:'name', label:'Executive'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gp', label:'GP', render:r=>numCell(r.gp)},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
    ], rows: execArr
  })));

  currentExporter = {filename:'centre_rankings.csv', columns:[
    {key:'rank',label:'Rank'},{key:'name',label:'Centre'},{key:'revenue',label:'Revenue'}
  ], rows: cr};
}

/* ================================================================
   VIEW: Geographic View
   ================================================================ */
function renderGeo(){
  const v = document.getElementById('view-geo');
  v.innerHTML='';
  const sr = stateRanking();
  const maxRev = sr.length? sr[0].revenue : 1;

  v.appendChild(el('div',{class:'section-sub'}, 'State-level revenue distribution. Bubble size = revenue, colour = GP%. Click a state to drill down.'));

  const gridWrap = el('div',{style:'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:20px;'});
  sr.forEach(s=>{
    const size = 42 + Math.round(safeDiv(s.revenue,maxRev)*50);
    const color = s.gpPct>=25?'#22d3a8':s.gpPct>=15?'#e8b74e':'#f2555a';
    const card = el('div',{class:'panel', style:'text-align:center;cursor:pointer;padding:16px 10px;', onclick:()=>{state.state=s.key; onFilterChange();}},[
      el('div',{style:`width:${size}px;height:${size}px;border-radius:50%;background:${color}22;border:2px solid ${color};margin:0 auto 10px auto;display:flex;align-items:center;justify-content:center;font-size:11px;color:${color};font-weight:700;`}, s.gpPct.toFixed(0)+'%'),
      el('div',{style:'font-size:12.5px;font-weight:600;'}, s.name),
      el('div',{style:'font-size:11px;color:var(--text-faint);margin-top:3px;'}, fmtINR(s.revenue)),
    ]);
    gridWrap.appendChild(card);
  });
  v.appendChild(gridWrap);

  const tableId = 'geoTable';
  const sorted = applySorting(tableId, sr, 'revenue');
  v.appendChild(panel('State Detail', null, dataTable({
    id: tableId,
    columns:[
      {key:'rank', label:'#', render:r=>el('td',{}, r.rank)},
      {key:'name', label:'State'},
      {key:'revenue', label:'Revenue', render:r=>numCell(r.revenue)},
      {key:'gpPct', label:'GP%', render:r=>el('td',{class:'num'}, r.gpPct.toFixed(1)+'%')},
      {key:'txns', label:'Txns', render:r=>numCell(r.txns, fmtNum)},
      {key:'bar', label:'Share', render:r=>barCell(r.revenue, maxRev)},
    ], rows: sorted, onRowClick:r=>{state.state=r.key; onFilterChange();}
  })));

  currentExporter = {filename:'geographic_state_detail.csv', columns:[
    {key:'name',label:'State'},{key:'revenue',label:'Revenue'},{key:'gpPct',label:'GP%'}
  ], rows: sorted};
}

/* ================================================================
   VIEW: AI Insights (rule-based narrative engine — fully offline)
   ================================================================ */
function stdev(arr){
  const m = arr.reduce((a,b)=>a+b,0)/(arr.length||1);
  const v = arr.reduce((a,b)=>a+(b-m)*(b-m),0)/(arr.length||1);
  return Math.sqrt(v);
}

function buildInsights(){
  const insights = [];
  const series = withYoY(withMoM(monthlySeries()));
  const cr = centreRanking();
  const sr = stateRanking();

  // 1. Growth / decline headline
  if(series.length>=2){
    const last = series[series.length-1];
    const dir = (last.mom||0)>=0 ? 'grew' : 'declined';
    insights.push({
      type: (last.mom||0)>=0?'good':'warn',
      icon: (last.mom||0)>=0?'▲':'▼',
      title: `Revenue ${dir} ${Math.abs(last.mom||0).toFixed(1)}% month-on-month`,
      body: `${last.label} closed at ${fmtINR(last.revenue)} in revenue with ${fmtINR(last.gp)} gross profit (${last.gpPct.toFixed(1)}% GP), versus ${fmtINR(series[series.length-2].revenue)} the prior month.`,
      action: (last.mom||0)<0
        ? `Review the centres driving the decline below and confirm whether it is seasonal, one-off, or a sustained trend before the next review cycle.`
        : `Sustain momentum by reallocating high-performing playbooks (schemes, upsell scripts) from top centres to mid-tier ones.`
    });
  }
  if(last_yoy_insight(series)) insights.push(last_yoy_insight(series));

  // 2. Top / bottom performer movement (compare first half vs second half of filtered window to spot movers)
  if(cr.length>=4){
    const topPerformer = cr[0];
    const bottomPerformer = cr[cr.length-1];
    insights.push({
      type:'neutral', icon:'★',
      title:`${topPerformer.name} leads all centres`,
      body:`${topPerformer.name} (${topPerformer.state||'—'}) generated ${fmtINR(topPerformer.revenue)} at ${topPerformer.gpPct.toFixed(1)}% GP — ${(safeDiv(topPerformer.revenue, cr[cr.length-1].revenue)).toFixed(1)}x the revenue of the lowest-performing centre, ${bottomPerformer.name}.`,
      action:`Consider a peer-learning session pairing ${topPerformer.name}'s manager with the bottom-quartile centres.`
    });
  }

  // 3. Outlier detection on centre MoM (using last two months of raw fact table, unfiltered by centre selection to keep it meaningful)
  const outlier = detectOutlierCentres();
  if(outlier) insights.push(outlier);

  // 4. Business unit trend
  const buRows = getFilteredBURows();
  if(buRows.length){
    const buMap = groupSum(buRows, r=>r.bu);
    const buArr = [...buMap.entries()].map(([k,v])=>({name:k,...v, gpPct:safeDiv(v.gp,v.revenue)*100})).sort((a,b)=>b.revenue-a.revenue);
    if(buArr.length>=2){
      const top = buArr[0];
      const totalRev = buArr.reduce((s,r)=>s+r.revenue,0)||1;
      insights.push({
        type:'neutral', icon:'◆',
        title:`${top.name} is the largest business unit at ${(safeDiv(top.revenue,totalRev)*100).toFixed(0)}% of revenue`,
        body:`Across the selected period, ${top.name} contributed ${fmtINR(top.revenue)} in revenue at ${top.gpPct.toFixed(1)}% GP. The next largest unit is ${buArr[1].name} at ${fmtINR(buArr[1].revenue)}.`,
        action: top.gpPct < (buArr.reduce((s,r)=>s+r.gpPct,0)/buArr.length)
          ? `${top.name} carries below-average GP% despite its scale — a small pricing or mix improvement here has outsized P&L impact.`
          : `${top.name}'s GP% is healthy relative to the portfolio — protect its share as other units are grown.`
      });
    }
  }

  // 5. Regional performance spread
  if(sr.length>=3){
    const revs = sr.map(s=>s.revenue);
    const top = sr[0], bottom = sr[sr.length-1];
    const spread = safeDiv(top.revenue - bottom.revenue, bottom.revenue||1)*100;
    insights.push({
      type:'neutral', icon:'⌖',
      title:`${top.name} outperforms ${bottom.name} by ${spread.toFixed(0)}%`,
      body:`Regional performance is uneven: ${top.name} delivers ${fmtINR(top.revenue)} versus ${fmtINR(bottom.revenue)} in ${bottom.name}, despite both operating under the Aptronix network.`,
      action:`Investigate whether the gap reflects market size/opportunity or execution — benchmark ATS and GP% (not just revenue) between the two.`
    });
  }

  // 6. CSAT risk flag
  const csatRows = getFilteredCSAT();
  if(csatRows.length){
    const byCentre = groupSum(csatRows.map(r=>({centre:r.centre, revenue:r.value, gp:0, txns:1})), r=>r.centre);
    const low = [...byCentre.entries()].map(([k,v])=>({name:k, value:v.revenue/v.txns})).filter(c=>c.value<75).sort((a,b)=>a.value-b.value);
    if(low.length){
      insights.push({
        type:'warn', icon:'⚠',
        title:`${low.length} centre${low.length>1?'s':''} below 75% CSAT`,
        body:`${low.slice(0,3).map(c=>c.name+' ('+c.value.toFixed(0)+'%)').join(', ')}${low.length>3?' and '+(low.length-3)+' more':''} are trending below the 75% CSAT threshold for the selected period.`,
        action:`Flag these centres for a service-quality audit — low CSAT centres often precede revenue attrition in the following quarter.`
      });
    }
  }

  return insights;
}

function last_yoy_insight(series){
  const withYoyVals = series.filter(s=>s.yoy!==null);
  if(!withYoyVals.length) return null;
  const last = withYoyVals[withYoyVals.length-1];
  return {
    type: last.yoy>=0?'good':'warn', icon: last.yoy>=0?'▲':'▼',
    title:`Year-on-year revenue ${last.yoy>=0?'up':'down'} ${Math.abs(last.yoy).toFixed(1)}%`,
    body:`${last.label} compares to the same month last year at ${fmtPct(last.yoy)} growth, reflecting ${last.yoy>=0?'expanding':'contracting'} demand versus the prior year.`,
    action: last.yoy<0 ? `A negative YoY print despite any MoM stability suggests a structural shift (competition, pricing, or footfall) worth a deeper root-cause review.` : `Year-on-year growth is healthy — validate it is broad-based across centres rather than concentrated in one or two outliers.`
  };
}

function detectOutlierCentres(){
  // last two available months, unfiltered by month-range so it always has data, but respects entity filters
  const allMk = [...new Set(FACT_MONTH.map(r=>r[0]))].sort((a,b)=>a-b);
  if(allMk.length<2) return null;
  const mkLast = allMk[allMk.length-1], mkPrev = allMk[allMk.length-2];
  const lastMap = {}, prevMap = {};
  FACT_MONTH.forEach(([mk,c,rev])=>{
    if(!centreMatches(c)) return;
    if(mk===mkLast) lastMap[c]=rev;
    if(mk===mkPrev) prevMap[c]=rev;
  });
  const moms = [];
  Object.keys(lastMap).forEach(c=>{
    if(prevMap[c]!==undefined && prevMap[c]>0){
      moms.push({centre:c, mom: safeDiv(lastMap[c]-prevMap[c], prevMap[c])*100});
    }
  });
  if(moms.length<4) return null;
  const vals = moms.map(m=>m.mom);
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  const sd = stdev(vals) || 1;
  const outliers = moms.filter(m=>Math.abs(m.mom-mean) > 1.5*sd).sort((a,b)=>Math.abs(b.mom-mean)-Math.abs(a.mom-mean));
  if(!outliers.length) return null;
  const o = outliers[0];
  return {
    type: o.mom>=0?'good':'warn', icon:'✦',
    title:`${o.centre} is a statistical outlier this month (${fmtPct(o.mom)} MoM)`,
    body:`Against a network average MoM movement of ${fmtPct(mean)}, ${o.centre} moved ${fmtPct(o.mom)} between ${monthLabel(mkPrev)} and ${monthLabel(mkLast)} — more than 1.5 standard deviations from the network mean.`,
    action: o.mom>=0
      ? `Understand what drove the spike (a scheme, bulk order, or new tie-up) — it may be replicable elsewhere.`
      : `This drop warrants a same-week check-in with the centre manager to rule out data issues, stock-outs, or staffing gaps.`
  };
}

function renderAI(){
  const v = document.getElementById('view-ai');
  v.innerHTML='';
  v.appendChild(el('div',{class:'section-sub'}, 'Automatically generated from the current filter selection — narrative summaries, outliers, and suggested management actions. Recomputes as you change filters.'));
  const insights = buildInsights();
  if(!insights.length){
    v.appendChild(el('div',{class:'empty-state'}, 'Not enough data in the current selection to generate insights. Try widening the filters.'));
  } else {
    insights.forEach(ins=>{
      v.appendChild(el('div',{class:'insight-card '+ins.type},[
        el('div',{class:'ihead'},[el('span',{class:'icon'},ins.icon), el('span',{class:'ititle'},ins.title)]),
        el('p',{},ins.body),
        el('div',{class:'action'},[el('b',{},'Suggested action: '), ins.action]),
      ]));
    });
  }
  currentExporter = null;
}

/* ================================================================
   Master render
   ================================================================ */
const RENDERERS = {
  exec: renderExec, revenue: renderRevenue, gp: renderGP, csat: renderCSAT, licenses: renderLicenses, targets: renderTargets,
  centre: renderCentre, centreexplorer: renderCentreExplorer, stateperf: renderStatePerf, arm: renderARM, armexplorer: renderArmExplorer, bu: renderBU,
  growth: renderGrowth, exceptions: renderExceptions, rankings: renderRankings, geo: renderGeo, ai: renderAI,
};

function renderAll(){
  showActiveView();
  const fn = RENDERERS[activeTab];
  if(fn) fn();
  document.getElementById('asof').textContent = 'Data: '+monthLabel(MIN_MK)+' – '+monthLabel(MAX_MK);
}

function populateDataConfidenceBar(){
  const unmapped = CENTRES.filter(c=>c.State==='Unmapped').length;
  document.getElementById('tb-coverage').textContent = `Through ${monthLabel(MAX_MK)} · Coverage ${CENTRES.length} centres`;
  const pill = document.getElementById('tb-validation');
  const pillText = document.getElementById('tb-validation-text');
  if(unmapped>0){
    pill.classList.add('warn');
    pillText.textContent = `${unmapped} centre${unmapped>1?'s':''} unmapped`;
  } else {
    pillText.textContent = 'All centres mapped';
  }
}

function init(){
  buildTabs();
  buildViewShells();
  buildFilterBar();
  buildBreadcrumb();
  populateDataConfidenceBar();
  renderAll();
  document.getElementById('loadOverlay').style.display='none';
}

window.addEventListener('chartjs-ready', function(){
  renderAll(); // Chart.js finished loading asynchronously — redraw with real charts
});

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
