(function auraLabRuntime() {
  "use strict";
  const VERSION="1.1.0";
  const KEY="aura_market_intelligence_110";
  const $=id=>document.getElementById(id);
  const ADDR=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const HORIZONS=[{key:"m5",label:"5 min",ms:300000,tolerance:120000},{key:"m15",label:"15 min",ms:900000,tolerance:300000},{key:"h1",label:"1 hour",ms:3600000,tolerance:600000}];
  const POLICIES=["Risk first","Momentum confirmed","Early research"];
  const empty=()=>({schema:1,version:VERSION,auto:true,lastScan:null,decisions:[],wallets:[],notes:[],walletRead:null,scanError:null});
  function read(){
    try{const s=JSON.parse(localStorage.getItem(KEY)||"null");if(!s||s.schema!==1)return empty();
      const base=empty();for(const k of ["auto","lastScan","decisions","wallets","notes"])if(Object.hasOwn(s,k))base[k]=s[k];
      if(!Array.isArray(base.decisions)||!Array.isArray(base.wallets)||!Array.isArray(base.notes))return empty();
      base.decisions=base.decisions.slice(-1400);base.wallets=base.wallets.slice(0,100);base.notes=base.notes.slice(-600);
      return base;
    }catch{return empty();}
  }
  let db=read(),lastSnapshot=null,health=null,healthError=null,scanBusy=false;
  const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const nf=(x,n=1)=>typeof x==="number"&&Number.isFinite(x)?x.toLocaleString("en-US",{maximumFractionDigits:n}):"—";
  const prettyTime=x=>x?new Date(x).toLocaleString():"—";
  const nowIso=()=>new Date().toISOString();
  const safeNum=x=>x==null||x===""?null:Number.isFinite(Number(x))?Number(x):null;
  const price=t=>safeNum(t?.price??t?.priceUsd);
  const take=(xs,n)=>Array.isArray(xs)?xs.slice(-n):[];
  function persist(){
    try{localStorage.setItem(KEY,JSON.stringify({...db,walletRead:undefined,scanError:undefined}));}
    catch(e){toast("Local storage unavailable. Export your research.");}
  }
  function toast(m){const el=$("aurx-status");if(el)el.textContent=m;}
  function policyDecision(x,policy){
    if(!x||!x.t||!ADDR.test(String(x.mint||"")))return {action:"NO_TRADE",reason:"Missing or invalid token identity"};
    const p=price(x.t);
    if(!(p>0))return {action:"NO_TRADE",reason:"No usable observed price"};
    if(x.liq===null||x.vol1===null||x.age===null)return {action:"NO_TRADE",reason:"Insufficient liquidity, activity or age evidence"};
    if(x.liq<10000)return {action:"NO_TRADE",reason:"Hard stop: very thin reported liquidity"};
    if(Number(x.t.boost)>0&&policy!=="Early research")return {action:"NO_TRADE",reason:"Promotional activity requires independent review"};
    if(policy==="Risk first")return x.gate&&x.score!==null&&x.score>=60?{action:"WATCH",reason:"Passed mandatory evidence gates and score ≥60"}:{action:"NO_TRADE",reason:"Risk gate or evidence threshold not met"};
    if(policy==="Momentum confirmed")return x.gate&&x.h1>3&&x.h24>0&&x.balance!==null&&x.balance>=.52?{action:"WATCH",reason:"Positive multi-horizon momentum with observed buy-count balance"}:{action:"NO_TRADE",reason:"Momentum, activity or risk confirmation missing"};
    if(policy==="Early research")return x.age>=1&&x.age<48&&x.liq>=30000&&x.vol1>=3000&&x.h1!==null&&Math.abs(x.h1)<=40?{action:"WATCH",reason:"Early-pool research cohort; NOT verified as safe or executable"}:{action:"NO_TRADE",reason:"Early cohort boundaries or research data unavailable"};
    return {action:"NO_TRADE",reason:"Unknown strategy"};
  }
  function updateOutcomes(tokens,stamp){
    const byMint=new Map(tokens.filter(t=>ADDR.test(String(t?.address||""))&&price(t)>0).map(t=>[t.address,t]));
    const at=Date.parse(stamp);
    let changed=0;
    for(const d of db.decisions){
      if(d.action!=="WATCH"||!d.outcomes)continue;
      for(const h of HORIZONS){
        if(d.outcomes[h.key])continue;
        const elapsed=at-Date.parse(d.decisionAt),target=h.ms,cut=target+h.tolerance;
        if(elapsed<target)continue;
        if(elapsed>cut){d.outcomes[h.key]={status:"MISSED_WINDOW",at:stamp,reason:"No on-time provider-as-of evidence"};changed++;continue;}
        const t=byMint.get(d.mint);
        if(!t)continue;
        // DEX Screener snapshot provides retrieval-time data only; this is not an exact-time verified fill.
        const pct=(price(t)/d.entryPrice-1)*100;
        d.outcomes[h.key]={status:"UNVERIFIED_MARKOUT",at:stamp,priceUsd:price(t),returnPct:pct,netProxyPct:pct-1.5,source:"DEX Screener browser snapshot; provider as-of unknown"};
        changed++;
      }
    }
    if(changed)persist();
    return changed;
  }
  function ingest(snapshot){
    if(!snapshot||!Array.isArray(snapshot.tokens))return;
    lastSnapshot=snapshot;
    const stamp=new Date(snapshot.scanTime||Date.now()).toISOString();
    db.lastScan=stamp;
    updateOutcomes(snapshot.tokens,stamp);
    if(db.auto&&window.AuraMarket&&typeof window.AuraMarket.ranking==="function"){
      const ranked=window.AuraMarket.ranking(snapshot.tokens,Date.parse(stamp));
      let accepted=0;
      for(const x of ranked.slice(0,20)){
        for(const policy of POLICIES){
          if(db.decisions.some(d=>d.mint===x.mint&&d.policy===policy&&Date.parse(stamp)-Date.parse(d.decisionAt)<3600000))continue;
          const p=policyDecision(x,policy);
          const record={
            id:"aura-"+Date.parse(stamp)+"-"+x.mint+"-"+policy.replace(/\s/g,"-"),
            decisionAt:stamp,mint:x.mint,symbol:String(x.symbol||"?").slice(0,36),
            policy,modelVersion:"rule-"+VERSION,action:p.action,reason:p.reason,
            entryPrice:price(x.t),liquidityUsd:x.liq,score:x.score,flags:take(x.flags,12),
            discoveryScope:snapshot.origin||"DEX Screener promotional/profiled sample",
            provenance:"browser reception timestamp; source as-of unknown",
            outcomes:p.action==="WATCH"?{}:null
          };
          db.decisions.push(record);
          if(p.action==="WATCH")accepted++;
        }
      }
      db.decisions=db.decisions.slice(-1400);
      toast("Recorded "+ranked.slice(0,20).length+" tokens · "+accepted+" research WATCH signals · no orders placed.");
    }
    persist();render();
  }
  function outcomeCell(d,h){
    if(d.action==="NO_TRADE")return '<span class="aurx-muted">ABSTAIN</span>';
    const o=d.outcomes?.[h];
    if(!o)return '<span class="aurx-muted">PENDING</span>';
    if(o.status==="UNVERIFIED_MARKOUT")return '<span class="'+(o.returnPct>=0?"aurx-up":"aurx-down")+'">'+(o.returnPct>0?"+":"")+nf(o.returnPct,2)+'%*</span>';
    return '<span class="aurx-warning">MISSED</span>';
  }
  function renderDecisions(){
    const el=$("aurx-decision-rows");if(!el)return;
    const list=[...db.decisions].reverse().slice(0,40);
    el.innerHTML=list.length?list.map(d=>'<tr><td><b>'+esc(d.symbol)+'</b><small>'+esc(d.mint.slice(0,6))+'…</small></td><td>'+esc(d.policy)+'</td><td><span class="'+(d.action==="WATCH"?"aurx-up":"aurx-muted")+'">'+esc(d.action)+'</span><small>'+esc(d.reason)+'</small></td><td>'+outcomeCell(d,"m5")+'</td><td>'+outcomeCell(d,"h1")+'</td></tr>').join(""):'<tr><td colspan="5" class="aurx-empty">Run a market scan to generate versioned, prospective decisions.</td></tr>';
    const accepted=db.decisions.filter(d=>d.action==="WATCH"),captured=accepted.flatMap(d=>Object.values(d.outcomes||{})).filter(x=>x.status==="UNVERIFIED_MARKOUT"),missed=accepted.flatMap(d=>Object.values(d.outcomes||{})).filter(x=>x.status==="MISSED_WINDOW");
    $("aurx-decisions").textContent=nf(db.decisions.length,0);
    $("aurx-watches").textContent=nf(accepted.length,0);
    $("aurx-markouts").textContent=nf(captured.length,0);
    $("aurx-missed").textContent=nf(missed.length,0);
    $("aurx-sample-age").textContent=db.lastScan?prettyTime(db.lastScan):"Not scanned";
    $("aurx-auto").checked=!!db.auto;
  }
  function renderWallets(){
    const el=$("aurx-wallets");if(!el)return;
    el.innerHTML=db.wallets.length?db.wallets.map(w=>'<div class="aurx-walletrow"><div><b>'+esc(w.label||"Unlabeled wallet")+'</b><small>'+esc(w.address.slice(0,9))+'…'+esc(w.address.slice(-5))+'</small></div><div><a href="https://solscan.io/account/'+encodeURIComponent(w.address)+'" target="_blank" rel="noopener noreferrer">Explorer</a><button type="button" data-watch-read="'+esc(w.address)+'">Activity</button><button type="button" data-watch-delete="'+esc(w.address)+'" aria-label="Remove wallet">×</button></div></div>').join(""):'<div class="aurx-empty">No wallet addresses saved. Add a public Solana address to begin an evidence-based watchlist.</div>';
  }
  function renderNotes(){
    const el=$("aurx-notes");if(!el)return;
    el.innerHTML=db.notes.length?[...db.notes].reverse().slice(0,28).map(n=>'<article class="aurx-note"><div class="aurx-notehead"><span>'+esc(n.kind)+'</span><time>'+esc(prettyTime(n.at))+'</time></div><p>'+esc(n.text)+'</p>'+(n.reference?'<small>Reference · '+esc(n.reference)+'</small>':"")+'</article>').join(""):'<div class="aurx-empty">Record an observation, hypothesis, correction or retraction. Entries are append-only in this browser.</div>';
  }
  async function readSampler(){
    const status=$("aurx-collector");if(status)status.textContent="FETCHING";
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
      let r;try{r=await fetch("https://raw.githubusercontent.com/u7613197263-code/aura-lab/crypto-signal-lab/data/market-ledger.json?intelligence="+Date.now(),{signal:controller.signal,cache:"no-store"});}finally{clearTimeout(timer);}
      if(!r.ok)throw new Error("HTTP "+r.status);
      const d=await r.json();
      if(d.schema_version!==1||!Array.isArray(d.assets))throw new Error("Unrecognized sampler schema");
      health=d;healthError=null;
    }catch(e){healthError=String(e.message||e).slice(0,130);}renderHealth();
  }
  function renderHealth(){
    const el=$("aurx-health");if(!el)return;
    if(!health){$("aurx-collector").textContent="UNAVAILABLE";el.textContent="Sampler unavailable: "+(healthError||"no data received");return;}
    const last=Date.parse(health.sampler?.last_success_at||""),age=Number.isFinite(last)?(Date.now()-last)/60000:null;
    const h5=health.assets.flatMap(a=>a.outcomes||[]).filter(o=>o.horizon_seconds===300);
    const valid=h5.filter(o=>o.status==="captured").length,miss=h5.filter(o=>o.status==="missed_window").length;
    const coverage=h5.length?(valid/h5.length*100):null;
    $("aurx-collector").textContent=age===null?"UNKNOWN":age>20?"STALE":"BEST EFFORT";
    el.innerHTML='<div><b>Source</b><span>Original public sampler v1</span></div>'+
      '<div><b>Latest sample</b><span>'+esc(prettyTime(health.generated_at))+' '+(age===null?"":"("+nf(age,0)+"m ago)")+'</span></div>'+
      '<div><b>Tracked tokens</b><span>'+nf(health.assets.length,0)+'</span></div>'+
      '<div><b>5m captured / missed</b><span>'+nf(valid,0)+' / '+nf(miss,0)+'</span></div>'+
      '<div><b>Raw 5m slot capture</b><span>'+nf(coverage,1)+'% (not verified time accuracy)</span></div>'+
      '<div><b>Data quality</b><span>Legacy horizon may allow up to +30 min; no provider-as-of timestamp</span></div>';
  }
  function addWallet(){
    const addr=String($("aurx-wallet-input").value||"").trim(),label=String($("aurx-wallet-label").value||"").trim().slice(0,48);
    if(!ADDR.test(addr)){toast("Enter a valid public Solana address (base58, 32–44 characters).");return;}
    if(db.wallets.some(w=>w.address===addr)){toast("Wallet already tracked.");return;}
    if(db.wallets.length>=100){toast("Watchlist limit: 100 wallets. Export before replacing.");return;}
    db.wallets.push({address:addr,label,createdAt:nowIso(),verification:"Unverified wallet owner; public address only"});
    $("aurx-wallet-input").value="";$("aurx-wallet-label").value="";persist();renderWallets();toast("Public wallet saved locally. Profitability and ownership are NOT verified.");
  }
  async function readWallet(address){
    const box=$("aurx-wallet-activity");if(!ADDR.test(address)||!box)return;
    box.textContent="Loading public Solana signatures — provider may rate-limit browser requests…";
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),11000);
    try{
      const r=await fetch("https://api.mainnet-beta.solana.com",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getSignaturesForAddress",params:[address,{limit:8,commitment:"finalized"}]}),signal:controller.signal});
      if(!r.ok)throw new Error("RPC HTTP "+r.status);
      const body=await r.json();
      if(body.error)throw new Error(body.error.message||"RPC returned error");
      if(!Array.isArray(body.result))throw new Error("RPC returned no signature list");
      const rows=body.result;
      box.innerHTML='<b>Recent finalized transaction signatures</b><small>Not decoded swaps, realized profits or identity attribution. Provider: public Solana RPC.</small>'+
        (rows.length?rows.map(x=>'<div class="aurx-wallettx"><span>'+esc(x.signature?.slice(0,13)||"")+"…</span><span>"+esc(x.blockTime?new Date(x.blockTime*1000).toLocaleString():"Time unknown")+'</span><em>'+(x.err?"TX ERROR":"FINALIZED")+'</em></div>').join(""):'<p>No recent transactions returned in this limited query.</p>');
    }catch(e){box.textContent="Wallet read unavailable: "+String(e.message||e).slice(0,140)+". Explorer link remains available. No smart-money label assigned.";}finally{clearTimeout(timer);}
  }
  function addNote(){
    const text=String($("aurx-note-input").value||"").trim().slice(0,3000),reference=String($("aurx-note-ref").value||"").trim().slice(0,140),kind=$("aurx-note-kind").value;
    if(text.length<3){toast("Write an observation or research note first.");return;}
    if(!["OBSERVED FACT","HYPOTHESIS","CORRECTION","RETRACTION"].includes(kind)){toast("Invalid note classification.");return;}
    if(db.notes.length>=600){toast("Notebook is full. Export your archive before adding more.");return;}
    const id="note-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
    db.notes.push({id,kind,text,reference,at:nowIso(),source:"user annotation",revision:"append-only"});
    $("aurx-note-input").value="";persist();renderNotes();toast("Note saved on this device. Conclusions remain unverified until supported by evidence.");
  }
  function exportArchive(){
    const payload={format:"aura-market-intelligence-backup",schema:1,exportedAt:nowIso(),data:{decisions:db.decisions,wallets:db.wallets,notes:db.notes,auto:db.auto,lastScan:db.lastScan}};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="aura-market-intelligence-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),250);
    toast("Local research backup exported. Keep it private.");
  }
  async function importArchive(file){
    if(!file||file.size>2_000_000){toast("Choose a JSON research backup under 2 MB.");return;}
    try{const pack=JSON.parse(await file.text());
      if(pack?.format!=="aura-market-intelligence-backup"||pack.schema!==1)throw new Error("Invalid backup format");
      const d=pack.data||{};
      if(!Array.isArray(d.decisions)||!Array.isArray(d.wallets)||!Array.isArray(d.notes)||d.decisions.length>1400||d.wallets.length>100||d.notes.length>600)throw new Error("Invalid archive contents");
      if(!d.wallets.every(w=>typeof w.address==="string"&&ADDR.test(w.address)))throw new Error("Invalid stored wallet address");
      if(!d.notes.every(n=>typeof n.text==="string"&&n.text.length<=3000))throw new Error("Invalid stored note");
      if(!window.confirm("Replace this device's Intelligence Lab research with the backup? Export current data first."))return;
      db={...empty(),decisions:d.decisions,wallets:d.wallets,notes:d.notes,auto:Boolean(d.auto),lastScan:d.lastScan||null};
      persist();render();toast("Research archive restored locally.");
    }catch(e){toast("Import rejected: "+String(e.message||e).slice(0,120));}
  }

  async function fetchNewPools(){
    const target=$("aurx-recent"),label=$("aurx-organic-source"),stamp=$("aurx-recent-time");
    if(!target||!label)return;
    target.textContent="Requesting source-backed new-pool data...";
    label.textContent="FETCHING";
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
    try{
      const response=await fetch("https://aura-market-api.onrender.com/api/market/feeds?feed=recent",{signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const data=await response.json();
      if(!Array.isArray(data.items))throw new Error("Malformed provider response");
      const fallback=!!data.fallback,origin=String(data.source||"Unknown source")+(fallback?" (promotional fallback)":" (new-pool sample)");
      label.textContent=fallback?"PROMOTIONAL FALLBACK":"GECKO NEW POOLS";
      stamp.textContent="Provider snapshot: "+prettyTime(data.fetchedAt)+" / "+(data.cached?"cached":"network")+" / "+(data.providerWarning||"");
      const tokens=data.items.filter(x=>ADDR.test(String(x.id||""))).slice(0,30);
      const renderPool=x=>{
        const mint=x.id,liq=safeNum(x.liquidity),vol=safeNum(x.volume24h);
        const age=x.poolCreatedAt?Math.max(0,(Date.now()-Number(x.poolCreatedAt))/3600000):null;
        const name=esc(x.name||"Unknown"),ticker=esc(x.symbol||"TOKEN");
        return ['<div class="aurx-pool"><div><b>',ticker,'</b><small>',name,'</small><span>',esc(mint.slice(0,7)),'...',esc(mint.slice(-5)),
          '</span></div><div class="aurx-poolmeta"><b>USD ',nf(liq,0),'</b><small>LIQUIDITY</small><small>24h volume USD ',nf(vol,0),
          '</small><small>Age ',nf(age,1),'h</small><button data-aurx-mint="',esc(mint),'" type="button">Research token</button></div></div>'].join('');
      };
      target.innerHTML=tokens.length?tokens.slice(0,12).map(renderPool).join(""):'<div class="aurx-empty">No token identities provided by this source.</div>';
      if(db.auto&&tokens.length){
        const mapped=tokens.map(x=>({
          address:x.id,symbol:x.symbol,name:x.name,price:x.usdPrice,priceUsd:x.usdPrice,
          liquidity:{usd:x.liquidity},volume:{h1:null,h24:x.volume24h},
          priceChange:{h1:x.stats1h?.priceChange,h24:x.stats24h?.priceChange},
          txns:{h1:{buys:null,sells:null}},pairCreatedAt:x.poolCreatedAt,
          boost:fallback?1:0,pairAddress:x.poolAddress
        }));
        ingest({tokens:mapped,scanTime:data.fetchedAt||nowIso(),origin});
      }
    }catch(e){
      label.textContent="UNAVAILABLE";
      target.textContent="Provider unavailable: "+String(e.message||e).slice(0,150)+". No source data fabricated.";
    }finally{clearTimeout(timer);}
  }
  function render(){
    renderDecisions();renderWallets();renderNotes();renderHealth();
  }
  function init(){
    if(!$("aurx-decision-rows"))return;
    $("aurx-auto").addEventListener("change",e=>{db.auto=e.target.checked;persist();toast(db.auto?"Research decisions automatically recorded on new scans.":"Automatic research decisions paused.");});
    $("aurx-run").addEventListener("click",()=>{const b=$("scanBtn");if(b){b.click();toast("Requested a live market scan. New evidence will be logged when received.");}});
    $("aurx-export").addEventListener("click",exportArchive);
    $("aurx-import").addEventListener("change",e=>{importArchive(e.target.files?.[0]);e.target.value="";});
    $("aurx-wallet-add").addEventListener("click",addWallet);
    $("aurx-wallets").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const r=b.getAttribute("data-watch-read"),d=b.getAttribute("data-watch-delete");if(r)readWallet(r);if(d){db.wallets=db.wallets.filter(w=>w.address!==d);persist();renderWallets();toast("Wallet removed from local watchlist.");}});
    $("aurx-note-add").addEventListener("click",addNote);
    $("aurx-recent-fetch").addEventListener("click",fetchNewPools);
    $("aurx-recent").addEventListener("click",e=>{const b=e.target.closest("button[data-aurx-mint]");if(!b)return;const mint=b.getAttribute("data-aurx-mint");if(!ADDR.test(mint))return;const q=$("searchInput");if(q)q.value=mint;if(typeof window.switchTab==="function")window.switchTab("scanner");$("searchBtn")?.click();});
    $("aurx-refresh-health").addEventListener("click",readSampler);
    if(window.AuraMarket&&typeof window.AuraMarket.refresh==="function"){
      const old=window.AuraMarket.refresh;
      window.AuraMarket.refresh=function(snapshot){const out=old.apply(this,arguments);try{ingest(snapshot);}catch(e){toast("Research addon error: "+String(e.message||e).slice(0,80));}return out;};
    }
    render();readSampler();
    setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine&&db.auto&&!scanBusy&&(!db.lastScan||Date.now()-Date.parse(db.lastScan)>5*60000)){
      const btn=$("scanBtn");if(btn&&!btn.disabled){scanBusy=true;btn.click();setTimeout(()=>{scanBusy=false;},20000);}
    }},300000);
  }
  window.AuraLabCore={policyDecision};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
+nf(liq,0)+'</b><small>LIQUIDITY</small><small>24h volume 
    renderDecisions();renderWallets();renderNotes();renderHealth();
  }
  function init(){
    if(!$("aurx-decision-rows"))return;
    $("aurx-auto").addEventListener("change",e=>{db.auto=e.target.checked;persist();toast(db.auto?"Research decisions automatically recorded on new scans.":"Automatic research decisions paused.");});
    $("aurx-run").addEventListener("click",()=>{const b=$("scanBtn");if(b){b.click();toast("Requested a live market scan. New evidence will be logged when received.");}});
    $("aurx-export").addEventListener("click",exportArchive);
    $("aurx-import").addEventListener("change",e=>{importArchive(e.target.files?.[0]);e.target.value="";});
    $("aurx-wallet-add").addEventListener("click",addWallet);
    $("aurx-wallets").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const r=b.getAttribute("data-watch-read"),d=b.getAttribute("data-watch-delete");if(r)readWallet(r);if(d){db.wallets=db.wallets.filter(w=>w.address!==d);persist();renderWallets();toast("Wallet removed from local watchlist.");}});
    $("aurx-note-add").addEventListener("click",addNote);
    $("aurx-refresh-health").addEventListener("click",readSampler);
    if(window.AuraMarket&&typeof window.AuraMarket.refresh==="function"){
      const old=window.AuraMarket.refresh;
      window.AuraMarket.refresh=function(snapshot){const out=old.apply(this,arguments);try{ingest(snapshot);}catch(e){toast("Research addon error: "+String(e.message||e).slice(0,80));}return out;};
    }
    render();readSampler();
    setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine&&db.auto&&!scanBusy&&(!db.lastScan||Date.now()-Date.parse(db.lastScan)>5*60000)){
      const btn=$("scanBtn");if(btn&&!btn.disabled){scanBusy=true;btn.click();setTimeout(()=>{scanBusy=false;},20000);}
    }},300000);
  }
  window.AuraLabCore={policyDecision};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
+nf(vol,0)+'</small><small>Age '+nf(age,1)+'h</small><button data-aurx-mint="'+esc(mint)+'" type="button">Research token</button></div></div>';
      }).join(""):'<div class="aurx-empty">No token identities provided by this source.</div>';
      if(db.auto&&tokens.length){
        const mapped=tokens.map(x=>({address:x.id,symbol:x.symbol,name:x.name,price:x.usdPrice,priceUsd:x.usdPrice,liquidity:{usd:x.liquidity},volume:{h1:null,h24:x.volume24h},priceChange:{h1:x.stats1h?.priceChange,h24:x.stats24h?.priceChange},txns:{h1:{buys:null,sells:null}},pairCreatedAt:x.poolCreatedAt,boost:fallback?1:0,pairAddress:x.poolAddress}));
        ingest({tokens:mapped,scanTime:d.fetchedAt||nowIso(),origin});
      }
    }catch(e){label.textContent="UNAVAILABLE";target.innerHTML='<div class="aurx-empty">Provider unavailable: '+esc(String(e.message||e).slice(0,150))+'. No new-pool list was fabricated.</div>';}
    finally{clearTimeout(timer);}
  }
  function render(){
    renderDecisions();renderWallets();renderNotes();renderHealth();
  }
  function init(){
    if(!$("aurx-decision-rows"))return;
    $("aurx-auto").addEventListener("change",e=>{db.auto=e.target.checked;persist();toast(db.auto?"Research decisions automatically recorded on new scans.":"Automatic research decisions paused.");});
    $("aurx-run").addEventListener("click",()=>{const b=$("scanBtn");if(b){b.click();toast("Requested a live market scan. New evidence will be logged when received.");}});
    $("aurx-export").addEventListener("click",exportArchive);
    $("aurx-import").addEventListener("change",e=>{importArchive(e.target.files?.[0]);e.target.value="";});
    $("aurx-wallet-add").addEventListener("click",addWallet);
    $("aurx-wallets").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const r=b.getAttribute("data-watch-read"),d=b.getAttribute("data-watch-delete");if(r)readWallet(r);if(d){db.wallets=db.wallets.filter(w=>w.address!==d);persist();renderWallets();toast("Wallet removed from local watchlist.");}});
    $("aurx-note-add").addEventListener("click",addNote);
    $("aurx-refresh-health").addEventListener("click",readSampler);
    if(window.AuraMarket&&typeof window.AuraMarket.refresh==="function"){
      const old=window.AuraMarket.refresh;
      window.AuraMarket.refresh=function(snapshot){const out=old.apply(this,arguments);try{ingest(snapshot);}catch(e){toast("Research addon error: "+String(e.message||e).slice(0,80));}return out;};
    }
    render();readSampler();
    setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine&&db.auto&&!scanBusy&&(!db.lastScan||Date.now()-Date.parse(db.lastScan)>5*60000)){
      const btn=$("scanBtn");if(btn&&!btn.disabled){scanBusy=true;btn.click();setTimeout(()=>{scanBusy=false;},20000);}
    }},300000);
  }
  window.AuraLabCore={policyDecision};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
