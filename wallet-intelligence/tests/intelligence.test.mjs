import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {assessToken,rankCandidates,marketBreadth,SCORE_VERSION} from "../intelligence-core.mjs";

const MINT="So11111111111111111111111111111111111111112";
const MINT_2="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const now=Date.parse("2026-11-17T12:00:00Z");
const good={
 id:MINT,name:"Observed asset",symbol:"OBS",usdPrice:2,liquidity:200000,volume24h:150000,
 buys24h:580,sells24h:420,stats1h:{priceChange:4},stats24h:{priceChange:12},
 poolCreatedAt:now-72*3600000,source:"GeckoTerminal"
};
test("high-coverage source-backed asset ranks as review candidate without claiming a return probability",()=>{
 const x=assessToken(good,now);
 assert.equal(SCORE_VERSION,"heuristic-0.3.0");
 assert.equal(x.eligible,true);
 assert.ok(x.score>=50&&x.score<=100);
 assert.equal(x.outlook,"Positive momentum");
 assert.ok(x.reasons.some(s=>s.includes("volume")||s.includes("turnover")));
 assert.equal(x.missing.length,0);
 assert.equal(Object.hasOwn(x,"predictedReturn"),false);
 assert.equal(Object.hasOwn(x,"probabilityOfProfit"),false);
});
test("thin liquidity and immature pools cannot enter eligible candidate list",()=>{
 assert.equal(assessToken({...good,liquidity:2000},now).eligible,false);
 assert.equal(assessToken({...good,poolCreatedAt:now-3600000},now).eligible,false);
 assert.equal(assessToken({...good,poolCreatedAt:null},now).eligible,false);
});
test("missing telemetry is not silently converted to zero or false precision",()=>{
 const x=assessToken({id:MINT,name:"Sparse",usdPrice:null,liquidity:100000,volume24h:null},now);
 assert.equal(x.score,null);
 assert.equal(x.eligible,false);
 assert.equal(x.outlook,"Unknown");
 assert.ok(x.missing.includes("price"));
});
test("dangerous turnover and price spikes trigger risk gates",()=>{
 const x=assessToken({...good,volume24h:6000000,stats24h:{priceChange:120}},now);
 assert.equal(x.eligible,false);
 assert.ok(x.warnings.some(s=>s.includes("turnover")));
 assert.ok(x.warnings.some(s=>s.includes("spike")));
});
test("ranking de-duplicates mint addresses by deeper liquidity and reports sample breadth",()=>{
 const rows=[good,{...good,id:MINT_2,stats24h:{priceChange:-7},stats1h:{priceChange:-2}},
 {...good,liquidity:1000}];
 const ranked=rankCandidates(rows,now);
 assert.equal(ranked.length,2);
 assert.equal(ranked.find(x=>x.mint===MINT).liquidity,200000);
 const breadth=marketBreadth(rows);
 assert.equal(breadth.seen,2);assert.equal(breadth.up,1);assert.equal(breadth.down,1);
 assert.equal(breadth.sampleOnly,true);
});
test("web page is read-only and clearly labels the ranking as heuristic",async()=>{
 const page=await readFile(new URL("../index.html",import.meta.url),"utf8");
 const client=await readFile(new URL("../intelligence-ui.mjs",import.meta.url),"utf8");
 const api=await readFile(new URL("../../wallet-intelligence-api/server.mjs",import.meta.url),"utf8");
 assert.match(page,/Candidate Radar/);
 assert.match(page,/not a predictive model/);
 assert.match(page,/read-only/i);
 assert.match(client,/aura:market-feed/);
 assert.match(api,/api\.geckoterminal\.com/);
 assert.match(api,/api\.dexscreener\.com/);
 assert.doesNotMatch(client,/sendTransaction|signTransaction|wallet-adapter/);
});
