/* AURA Market · Decision Surface 1.0 · read-only analytical UI */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const API = "https://aura-market-api.onrender.com";
  const HORIZONS = [["m5","5M"],["h1","1H"],["h6","6H"],["h24","24H"]];
  const validMint = s => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  const escape = v => String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const numeric = x => x==null||x===""||!Number.isFinite(Number(x))?null:Number(x);
  const money = x => x==null?"—":"$"+(x>0&&x<.01?x.toLocaleString(undefined,{maximumSignificantDigits:5}):x>=1e6?(x/1e6).toFixed(2)+"M":x>=1e3?(x/1e3).toFixed(1)+"K":x.toLocaleString(undefined,{maximumFractionDigits:2}));
  const percent=x=>x==null?"—":(x>0?"+":"")+x.toFixed(1)+"%";
  const market = {tokens:[], ranked:[], selected:null, scanTime:null, view:"overview", chartRequest:0};

  function classify(t,at=Date.now()) {
    const liq=numeric(t.liquidity?.usd),vol1=numeric(t.volume?.h1),vol24=numeric(t.volume?.h24);
    const h1=numeric(t.priceChange?.h1),h24=numeric(t.priceChange?.h24);
    const buys=numeric(t.txns?.h1?.buys),sells=numeric(t.txns?.h1?.sells);
    const balance=buys!==null&&sells!==null&&buys+sells>=10?buys/(buys+sells):null;
    const created=numeric(t.pairCreatedAt),age=created!==null&&created>0&&created<=at?(at-created)/3600000:null;
    const fields=[liq,vol1,vol24,h1,h24,balance,age].filter(x=>x!==null).length;
    const missing=[];
    if(liq===null)missing.push("liquidity");
    if(vol1===null||vol24===null)missing.push("volume");
    if(h1===null||h24===null)missing.push("momentum");
    if(balance===null)missing.push("trade count balance");
    if(age===null)missing.push("pool maturity");
    const flags=[];
    if(liq!==null&&liq<50000)flags.push("Liquidity below $50K");
    if(vol1!==null&&vol1<3000)flags.push("Limited 1-hour activity");
    if(age!==null&&age<24)flags.push("Pool younger than 24 hours");
    if(h1!==null&&Math.abs(h1)>40)flags.push("Extreme 1-hour volatility");
    if(h24!==null&&Math.abs(h24)>140)flags.push("Extreme 24-hour volatility");
    if(liq>0&&vol24!==null&&vol24/liq>15)flags.push("Very high volume relative to liquidity");
    if(balance!==null&&balance<.4)flags.push("Sell-heavy transaction count");
    if(Number(t.boost)>0)flags.push("Promotional boost detected");
    const adequate=fields>=6&&liq!==null&&vol1!==null&&h1!==null&&h24!==null&&age!==null;
    const gate=adequate&&liq>=50000&&vol1>=3000&&age>=24&&Math.abs(h1)<=40&&Math.abs(h24)<=140&&!(liq>0&&vol24!==null&&vol24/liq>15);
    const cap=(v,low,high)=>Math.max(low,Math.min(high,v));
    let score=null;
    if(adequate){
      const depth=cap((Math.log10(Math.max(1,liq))-4)*21,0,30);
      const activity=cap((Math.log10(Math.max(1,vol1))-2.5)*13,0,20);
      const momentum=cap(8+h1*.45,0,13)+cap(3+h24*.12,0,7);
      const flow=balance===null?0:cap(balance*20,0,15);
      const maturity=cap(Math.log2(age+1)*2.3,0,15);
      score=Math.round(cap(depth+activity+momentum+flow+maturity-(Number(t.boost)>0?8:0)-(flags.some(f=>f.includes("Extreme"))?12:0),0,100));
      if(!gate)score=Math.min(score,49);
    }
    const bias=h1===null||h24===null?"UNKNOWN":h1>0&&h24>0?"POSITIVE MOMENTUM":h1<0&&h24<0?"WEAKENING":"MIXED / UNCERTAIN";
    const evidence=[
      liq===null?"Liquidity not available":liq>=100000?"Deep reported pool liquidity":liq>=50000?"Moderate pool liquidity":"Shallow reported pool liquidity",
      h1===null||h24===null?"Momentum information incomplete":h1>0&&h24>0?"1h and 24h changes both positive":h1<0&&h24<0?"1h and 24h changes both negative":"Mixed price-change horizons",
      balance===null?"Trade direction unavailable":balance>=.55?"Buy count exceeds sell count":balance<=.45?"Sell count exceeds buy count":"Buy/sell counts approximately balanced"
    ];
    return {mint:t.address,symbol:t.symbol,name:t.name,score,gate,flags,missing,fields,liq,vol1,vol24,h1,h24,balance,age,bias,evidence,source:"DEX Screener snapshot",t};
  }
  const ranking=(tokens,at)=>tokens.map(t=>classify(t,at)).filter(x=>validMint(x.mint)).sort((a,b)=>Number(b.gate)-Number(a.gate)||(b.score??-1)-(a.score??-1)||(b.liq??-1)-(a.liq??-1));
  function renderPulse(){
    const list=market.ranked;
    const eligible=list.filter(x=>x.gate);
    const compared=list.filter(x=>x.h24!==null);
    const rising=compared.filter(x=>x.h24>0).length;
    $("terminal-eligible").textContent=String(eligible.length);
    $("terminal-breadth").textContent=compared.length?Math.round(rising/compared.length*100)+"%":"—";
    $("terminal-coverage").textContent=list.length?Math.round(list.filter(x=>x.score!==null).length/list.length*100)+"%":"—";
    $("terminal-sampled").textContent=market.scanTime?new Date(market.scanTime).toLocaleTimeString():"No scan yet";
    $("terminal-universe").textContent="Discovery sample · "+list.length+" tokens · promotion/profile sources";
    const board=$("terminal-candidates");
    if(!list.length){board.innerHTML='<div class="aura-placeholder">No observations yet. Run a scan to assess the available public-market sample.</div>';return;}
    const shown=eligible.slice(0,5);
    if(!shown.length){board.innerHTML='<div class="aura-placeholder">No observed tokens passed all research gates. This is a valid outcome, not an error.</div>';return;}
    board.innerHTML=shown.map((x,i)=>'<button class="aura-candidate" type="button" data-market-pick="'+escape(x.mint)+'">'+
      '<span class="aura-rank">'+String(i+1).padStart(2,"0")+'</span><span class="aura-candidate-main"><strong>'+escape(x.symbol)+'</strong><small>'+escape(x.name)+'</small></span>'+
      '<span class="aura-candidate-change '+(x.h1>=0?"positive":"negative")+'">'+percent(x.h1)+'<small>1h change</small></span>'+
      '<span class="aura-candidate-score">'+x.score+'<small>screen / 100</small></span></button>').join("");
    board.querySelectorAll("[data-market-pick]").forEach(btn=>btn.addEventListener("click",()=>{
      if(typeof window.selectToken==="function")window.selectToken(btn.dataset.marketPick);
    }));
    const tilt=rising/Math.max(1,compared.length);
    const bias=compared.length<3?"Insufficient cross-section":tilt>.62?"More observed assets rising":tilt<.38?"More observed assets falling":"Mixed market breadth";
    $("terminal-market-bias").textContent=bias;
    $("terminal-market-narrative").textContent="Based on "+compared.length+" tokens with 24h changes within the selected DEX discovery sample. This is not the whole Solana market or a price forecast.";
  }
  function renderResearch(x){
    const wrap=$("terminal-research");if(!wrap)return;
    if(!x){wrap.innerHTML='<div class="aura-placeholder">Select a token from Discover or Candidate Radar. Your complete research dossier will appear here.</div>';return;}
    const data=x;
    const score=data.score===null?"NOT SCORABLE":data.score+"/100";
    wrap.innerHTML='<div class="aura-research-head"><div><div class="aura-eyebrow">TRANSPARENT RESEARCH DOSSIER</div><h3>'+escape(data.symbol)+' <span>'+escape(data.name)+'</span></h3></div><span class="aura-grade '+(data.gate?"pass":"limited")+'">'+(data.gate?"RESEARCH ELIGIBLE":"REVIEW WITH CAUTION")+'</span></div>'+
    '<div class="aura-research-meter"><div><small>EVIDENCE SCORE</small><strong>'+score+'</strong></div><div><small>FIELD COVERAGE</small><strong>'+data.fields+'/7</strong></div><div><small>OBSERVED BIAS</small><strong>'+escape(data.bias)+'</strong></div></div>'+
    '<div class="aura-evidence-title">Why this assessment?</div><ul class="aura-evidence-list">'+data.evidence.map(v=>'<li>'+escape(v)+'</li>').join("")+'</ul>'+
    '<div class="aura-evidence-title">Risk and missing evidence</div><ul class="aura-evidence-list caution">'+(data.flags.length?data.flags.map(v=>'<li>'+escape(v)+'</li>').join(""):'<li>No numeric gate triggered. Contract and wallet concentration remain unverified.</li>')+(data.missing.length?'<li>Unknown: '+escape(data.missing.join(", "))+'</li>':"")+'</ul>'+
    '<div class="aura-rulebox"><b>Scenario watch, not prediction</b><p>'+escape(data.bias==="POSITIVE MOMENTUM"?"Re-evaluate if 1h change turns negative, liquidity drops or buy-flow reverses.":data.bias==="WEAKENING"?"A reversal requires new positive price momentum with sufficient liquidity and trade support.":"Require agreement across horizons, adequate volume, and an acceptable risk screen before further research.")+'</p></div>'+
    '<p class="aura-footnote">This score is a heuristic, not a calibrated probability of return, safety audit or buy recommendation. Token identity is its Solana mint address.</p>';
  }
  function buildChart(t,horizon="hour"){
    const target=$("terminal-chart");if(!target)return;
    const pool=t?.pairAddress;
    if(!validMint(pool)){target.textContent="No validated Solana pool address for historical chart.";return;}
    const seq=++market.chartRequest;
    target.innerHTML='<div class="aura-placeholder">Loading historical OHLCV from GeckoTerminal…</div>';
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
    const timeframe=horizon==="day"?"day":"hour";
    const url=API+"/api/market/chart?pool="+encodeURIComponent(pool)+"&timeframe="+timeframe+"&aggregate=1";
    fetch(url,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      if(!response.ok)throw new Error("Historical chart unavailable ("+response.status+")");
      return response.json();
    }).then(d=>{
      if(seq!==market.chartRequest)return;
      const rows=Array.isArray(d.candles)?d.candles:[],observed=rows.map(x=>({time:Number(x[0]),close:Number(x[4])})).filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.close)&&p.close>0).sort((a,b)=>a.time-b.time);
      if(observed.length<2){target.textContent="Provider returned insufficient historical candles.";return;}
      const lo=Math.min(...observed.map(p=>p.close)),hi=Math.max(...observed.map(p=>p.close)),span=Math.max(hi-lo,hi*.002);
      const path=observed.map((p,i)=>(i?"L":"M")+(14+(i/(observed.length-1))*872).toFixed(2)+","+(166-148*(p.close-lo)/span).toFixed(2)).join(" ");
      const safe=(v)=>escape(v);
      target.innerHTML='<svg viewBox="0 0 900 190" class="aura-chart-svg" role="img" aria-label="Observed price history line chart"><defs><linearGradient id="auraChartGlow" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#6be9c7" stop-opacity=".32"/><stop offset="1" stop-color="#6be9c7" stop-opacity="0"/></linearGradient></defs><path d="'+path+' L886,184 L14,184 Z" fill="url(#auraChartGlow)"/><path d="'+path+'" fill="none" stroke="#73efd0" stroke-width="2.7" stroke-linecap="round"/></svg><div class="aura-chart-caption"><span>'+new Date(observed[0].time*1000).toLocaleString()+'</span><span>Last close '+safe(money(observed[observed.length-1].close))+'</span><span>'+new Date(observed[observed.length-1].time*1000).toLocaleString()+'</span></div>';
    }).catch(e=>{if(seq===market.chartRequest)target.innerHTML='<div class="aura-placeholder">'+escape(e.message)+'. Source rate-limits may apply; no substitute data are drawn.</div>';}).finally(()=>clearTimeout(timeout));
  }
  function selectChart(horizon){
    $("terminal-chart-tabs")?.querySelectorAll("button").forEach(el=>el.classList.toggle("active",el.dataset.timeframe===horizon));
    if(market.selected)buildChart(market.selected.t,horizon);
  }
  function onAsset(t){
    market.selected=market.ranked.find(x=>x.mint===t?.address)|| (t?classify(t,Date.now()):null);
    renderResearch(market.selected);
    const head=$("terminal-current");
    if(head)head.textContent=t? t.symbol+" · "+t.name:"Select an asset";
    selectChart("hour");
  }
  function refresh(snapshot){
    if(!snapshot)return;
    market.tokens=Array.isArray(snapshot.tokens)?snapshot.tokens:[];
    market.scanTime=snapshot.scanTime;
    market.ranked=ranking(market.tokens,snapshot.scanTime||Date.now());
    renderPulse();
    if(snapshot.selected)onAsset(snapshot.selected);
  }
  function onTab(tab){
    market.view=tab;
    $("terminal-page-name").textContent=({overview:"Market Pulse",scanner:"Discover",research:"Asset Research",lab:"Outcome Lab",portfolio:"Paper Portfolio",about:"Method & Privacy"})[tab]||"AURA Market";
  }
  function init(){
    $("terminal-chart-tabs")?.querySelectorAll("button").forEach(el=>el.addEventListener("click",()=>selectChart(el.dataset.timeframe)));
    document.querySelectorAll("[data-market-tab]").forEach(el=>el.addEventListener("click",()=>{if(typeof window.switchTab==="function")window.switchTab(el.dataset.marketTab)}));
    const method=$("terminal-method");if(method)method.addEventListener("click",()=>{if(typeof window.switchTab==="function")window.switchTab("about")});
    const scan=$("terminal-quick-scan");if(scan)scan.addEventListener("click",()=> $("scanBtn")?.click());
    onTab("overview");
    renderPulse();
  }
  window.AuraMarket={classify,ranking,refresh,onAsset,onTab};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
