import {rankCandidates,marketBreadth,SCORE_VERSION} from "./intelligence-core.mjs";
const $ = id => document.getElementById(id);
const esc = value => String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const money=n => n==null||!Number.isFinite(Number(n))?"—":Number(n)>=1e9?"$"+(Number(n)/1e9).toFixed(2)+"B":Number(n)>=1e6?"$"+(Number(n)/1e6).toFixed(2)+"M":Number(n)>=1e3?"$"+(Number(n)/1e3).toFixed(1)+"K":"$"+Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const percentage=n => n==null||!Number.isFinite(Number(n))?"—":(Number(n)>0?"+":"")+Number(n).toFixed(1)+"%";
let rows=[], candidates=[], focused=null, sampleTime=null, sourceName="Provider";
function status(message,level="neutral"){
  const el=$("intel-engine-status");
  if(el){el.textContent=message;el.dataset.level=level;}
}
function candidateCard(x,index){
  const selected=focused===x.mint;
  const tier=x.tier==="RESEARCH FIRST"?"focus":x.tier==="HIGH RISK"?"danger":"soft";
  const score=x.score===null?"—":String(x.score);
  const lit=x.score===null?0:x.score;
  const flags=x.warnings.length ? esc(x.warnings[0]) : "No triggered numeric red flags";
  return '<button class="intel-candidate '+(selected?"is-selected":"")+'" type="button" data-intel-mint="'+esc(x.mint)+'" aria-pressed="'+selected+'">'+
    '<span class="intel-position">'+String(index+1).padStart(2,"0")+'</span>'+
    '<span class="intel-avatar">'+esc(x.symbol.slice(0,2).toUpperCase())+'</span>'+
    '<span class="intel-asset"><strong>'+esc(x.symbol)+'</strong><small>'+esc(x.name)+'</small><small class="intel-minor">'+flags+'</small></span>'+
    '<span class="intel-candidate-numbers"><strong>'+money(x.liquidity)+'</strong><small>LIQUIDITY</small></span>'+
    '<span class="intel-score-wrap"><span class="intel-score '+tier+'">'+score+'</span><span class="intel-score-track"><i style="width:'+lit+'%"></i></span><small>'+esc(x.tier)+'</small></span></button>';
}
function renderDetail(x){
  const host=$("intel-analysis");
  if(!x){host.innerHTML='<div class="intel-empty">Select a candidate to inspect the evidence behind its ranking.</div>';return;}
  const quality=x.coverage+"/"+x.totalFields+" fields";
  const condition=esc(x.conditions);
  const flags=x.warnings.length ? x.warnings.map(v=>'<li>'+esc(v)+'</li>').join("") : "<li>No numeric red flags triggered; contract/security checks remain unavailable.</li>";
  const cues=x.reasons.length ? x.reasons.map(v=>'<li>'+esc(v)+'</li>').join("") : "<li>Insufficient market observations for an evidence-based assessment.</li>";
  host.innerHTML='<div class="intel-analysis-top"><span class="intel-kicker">AURA / EVIDENCE DOSSIER</span><span class="intel-confidence">'+esc(quality)+'</span></div>'+
    '<h3>'+esc(x.symbol)+' <span>'+esc(x.name)+'</span></h3>'+
    '<div class="intel-bias '+(x.outlook==="Positive momentum"?"bull":x.outlook==="Weakening momentum"?"bear":"")+""><span>OBSERVED MARKET BIAS</span><strong>'+esc(x.outlook)+'</strong></div>'+
    '<div class="intel-analysis-grid"><div><span>1H CHANGE</span><strong>'+percentage(x.h1)+'</strong></div><div><span>24H CHANGE</span><strong>'+percentage(x.h24)+'</strong></div><div><span>24H VOLUME</span><strong>'+money(x.volume)+'</strong></div><div><span>POOL AGE</span><strong>'+(x.ageHours===null?"—":x.ageHours<24?x.ageHours.toFixed(1)+"h":Math.floor(x.ageHours/24)+"d")+'</strong></div></div>'+
    '<div class="intel-narrative"><span>WHAT THE DATA SUPPORTS</span><ul>'+cues+'</ul></div>'+
    '<div class="intel-narrative risk"><span>RISK & BLIND SPOTS</span><ul>'+flags+(x.missing.length?'<li>Missing: '+esc(x.missing.join(", "))+'</li>':"")+'</ul></div>'+
    '<div class="intel-condition"><span>WHAT WOULD CHANGE THE OUTLOOK</span><p>'+condition+'. Re-check freshness, liquidity, token authorities and wallet concentration independently.</p></div>'+
    '<button class="intel-inspect" id="intel-inspect" type="button">Inspect market pair <span aria-hidden="true">↗</span></button>'+
    '<p class="intel-disclaimer">Rule-based observations, not a 1h/24h return forecast, trading instruction, audit or probability of profit.</p>';
  $("intel-inspect").addEventListener("click",()=>{
    document.dispatchEvent(new CustomEvent("aura:inspect-token",{detail:{mint:x.mint}}));
    $("market-detail")?.scrollIntoView({behavior:"smooth",block:"start"});
  });
}
function showSelection(mint){
  focused=mint;
  render();
}
function render(){
  const host=$("intel-candidates");
  if(!host)return;
  const breadth=marketBreadth(rows);
  const best=candidates.filter(x=>x.eligible&&x.score!==null);
  const shown=[...best.slice(0,5)];
  if(!shown.length)shown.push(...candidates.filter(x=>x.score!==null).slice(0,5));
  const selected=candidates.find(x=>x.mint===focused) || shown[0] || null;
  if(!focused||!candidates.some(x=>x.mint===focused)) focused=selected?.mint||null;
  $("intel-screened").textContent=String(breadth.seen);
  $("intel-qualified").textContent=String(breadth.eligible);
  $("intel-breadth").textContent=breadth.with24h ? Math.round(100*breadth.up/breadth.with24h)+"%" : "—";
  $("intel-breadth-context").textContent=breadth.with24h ? breadth.up+" up / "+breadth.down+" down · "+breadth.with24h+" reported" : "24h change unavailable";
  $("intel-coverage").textContent=breadth.seen?Math.round(100*breadth.complete/breadth.seen)+"%":"—";
  $("intel-coverage-context").textContent=breadth.complete+" of "+breadth.seen+" scoreable";
  $("intel-feed-label").textContent=sourceName+" · "+(sampleTime?new Date(sampleTime).toLocaleTimeString():"No sample time");
  if(!shown.length)host.innerHTML='<div class="intel-empty">No candidates meet the minimum evidence requirements in this feed. AURA will not fabricate a ranking.</div>';
  else host.innerHTML=shown.map(candidateCard).join("");
  host.querySelectorAll("[data-intel-mint]").forEach(el=>el.addEventListener("click",()=>showSelection(el.dataset.intelMint)));
  renderDetail(selected);
}
function receive(e){
  const d=e.detail || {};
  if(!Array.isArray(d.items))return;
  rows=d.items;
  sampleTime=d.fetchedAt || null;
  sourceName=d.source || "Third-party data";
  candidates=rankCandidates(rows);
  status("ANALYSIS UPDATED","good");
  render();
}
function init(){
  if(!$("intel-candidates"))return;
  document.addEventListener("aura:market-feed",receive);
  document.addEventListener("aura:market-error",()=>status(rows.length?"STALE / LAST SNAPSHOT":"DATA UNAVAILABLE","warning"));
  $("intel-scan")?.addEventListener("click",()=>{
    status("REFRESH REQUESTED","neutral");
    $("market-refresh")?.click();
  });
  $("intel-method")?.addEventListener("click",()=>{});
  status("AWAITING MARKET TELEMETRY");
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init); else init();
