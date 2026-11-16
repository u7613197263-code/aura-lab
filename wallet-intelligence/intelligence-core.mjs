// AURA Intelligence v0.3 — deterministic, inspectable screening. Not a return forecast.
const between = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = x => x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x);
const percentage = x => finite(x);
const base58 = x => typeof x === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
export const SCORE_VERSION = "heuristic-0.3.0";

export function assessToken(t, now=Date.now()) {
  const mint=t?.id || t?.address || t?.mint || "";
  const liquidity=finite(t?.liquidity ?? t?.liquidityUsd);
  const volume=finite(t?.volume24h);
  const buys=finite(t?.buys24h), sells=finite(t?.sells24h);
  const h1=percentage(t?.stats1h?.priceChange), h24=percentage(t?.stats24h?.priceChange);
  const price=finite(t?.usdPrice);
  const born=finite(t?.poolCreatedAt);
  const ageHours=born !== null && born>0 && born<=now ? (now-born)/3600000 : null;
  const trades=buys !== null && sells !== null ? buys+sells : null;
  const buyShare=trades !== null && trades>=10 ? buys/trades : null;
  const coverage=[price,liquidity,volume,h1,h24,ageHours,buyShare].filter(x=>x!==null).length;
  const warnings=[];
  if(liquidity!==null && liquidity<50000)warnings.push("Thin liquidity under $50K");
  if(volume!==null && volume<10000)warnings.push("Limited 24h traded volume");
  if(ageHours!==null && ageHours<24)warnings.push("Pool younger than 24h");
  if(liquidity>0 && volume!==null && volume/liquidity>15)warnings.push("Extreme volume-to-liquidity turnover");
  if(h24!==null && h24>80)warnings.push("24h price spike: elevated reversal risk");
  if(h1!==null && h1>30)warnings.push("1h spike: elevated volatility");
  if(h24!==null && h24< -35)warnings.push("Sharp 24h drawdown");
  if(buyShare!==null && buyShare<.37)warnings.push("24h sell-side transaction imbalance");
  if(born===null)warnings.push("Pool age not reported");
  const missing=[];
  if(price===null)missing.push("price");
  if(liquidity===null)missing.push("liquidity");
  if(volume===null)missing.push("24h volume");
  if(h1===null || h24===null)missing.push("price-change history");
  if(buyShare===null)missing.push("transaction direction");
  const sufficient=coverage>=5 && price!==null && liquidity!==null && volume!==null && h1!==null && h24!==null;
  const ineligible=liquidity!==null && liquidity<25000 || volume!==null && volume<10000 || ageHours!==null && ageHours<2;
  let score=null;
  if(sufficient){
    const liquidityPart=between((Math.log10(Math.max(liquidity,1))-4)*20,0,30);
    const volumePart=between((Math.log10(Math.max(volume,1))-3)*10,0,20);
    const momentumPart=between(7+h1*.55,0,12)+between(4+h24*.16,0,8);
    const flowPart=buyShare===null ? 0 : between(buyShare*18,0,15);
    const agePart=ageHours===null ? 0 : between(Math.log2(1+ageHours)*2.0,0,15);
    const penalty=(liquidity>0 && volume/liquidity>15?12:0)+(h24>80?10:0)+(h1>30?6:0)+(h24< -35?8:0)+(ageHours!==null&&ageHours<24?5:0);
    score=Math.round(between(liquidityPart+volumePart+momentumPart+flowPart+agePart-penalty,0,100));
    if(ineligible)score=Math.min(score,45);
  }
  const eligible=sufficient && !ineligible && (ageHours===null || ageHours>=24) && warnings.filter(x=>/Extreme|spike|drawdown/i.test(x)).length===0;
  const reasons=[];
  if(liquidity!==null)reasons.push(liquidity>=100000?"Deep observed pool liquidity":liquidity>=50000?"Moderate observed liquidity":"Low observed liquidity");
  if(volume!==null)reasons.push(volume>=100000?"Strong 24h market turnover":volume>=10000?"Active 24h turnover":"Limited 24h turnover");
  if(h1!==null&&h24!==null)reasons.push(h1>0&&h24>0?"Both 1h and 24h price changes positive":h1<0&&h24<0?"Both 1h and 24h price changes negative":"Mixed 1h and 24h momentum");
  if(buyShare!==null)reasons.push(buyShare>=.56?"More buys than sells by transaction count":buyShare<.44?"More sells than buys by transaction count":"Balanced buy/sell transaction count");
  const outlook=h1===null||h24===null?"Unknown":h1>0&&h24>0&&buyShare!==null&&buyShare>=.52?"Positive momentum":h1<0&&h24<0?"Weakening momentum":"Mixed / uncertain";
  const conditions=outlook==="Positive momentum"?"Review if 1h momentum turns negative or liquidity deteriorates":outlook==="Weakening momentum"?"Look for a sustained reversal in 1h change and transaction balance":"Watch for agreement between 1h and 24h trends with adequate liquidity";
  return {mint,name:t?.name||t?.symbol||"Unknown",symbol:t?.symbol||"TOKEN",price,liquidity,volume,h1,h24,ageHours,buyShare,trades,
    score,eligible,coverage,totalFields:7,missing,warnings,reasons,outlook,conditions,
    tier:!sufficient?"INSUFFICIENT DATA":ineligible?"HIGH RISK":eligible&&score>=70?"RESEARCH FIRST":eligible&&score>=54?"WATCH":"CAUTION",
    source:t?.source||"Unknown source"};
}

export function rankCandidates(rows, now=Date.now()) {
  const bestByMint=new Map();
  for(const item of Array.isArray(rows)?rows:[]){
    const x=assessToken(item,now);
    if(!base58(x.mint))continue;
    const prior=bestByMint.get(x.mint);
    if(!prior||(x.liquidity??-1)>(prior.liquidity??-1))bestByMint.set(x.mint,x);
  }
  return [...bestByMint.values()].sort((a,b)=>(Number(b.eligible)-Number(a.eligible))||
    ((b.score??-1)-(a.score??-1)) || ((b.liquidity??0)-(a.liquidity??0)));
}

export function marketBreadth(rows){
  const unique=rankCandidates(rows);
  const with24h=unique.filter(t=>t.h24!==null);
  const up=with24h.filter(t=>t.h24>0).length;
  const down=with24h.filter(t=>t.h24<0).length;
  const complete=unique.filter(t=>t.score!==null).length;
  const eligible=unique.filter(t=>t.eligible).length;
  return {seen:unique.length,with24h:with24h.length,up,down,flat:with24h.length-up-down,complete,eligible,
    sampleOnly:true};
}
