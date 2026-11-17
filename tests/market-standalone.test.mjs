import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
const root=new URL("../",import.meta.url);
const [page,terminal,styles,sw,manifest]=await Promise.all([
 readFile(new URL("index.html",root),"utf8"),readFile(new URL("market-terminal.js",root),"utf8"),
 readFile(new URL("market-ui.css",root),"utf8"),readFile(new URL("sw.js",root),"utf8"),
 readFile(new URL("manifest.webmanifest",root),"utf8")
]);
const sandbox={window:{},document:{readyState:"loading",addEventListener(){}},console};
vm.runInNewContext(terminal,sandbox,{timeout:1000});
const {classify,ranking}=sandbox.window.AuraMarket;
const mint="So11111111111111111111111111111111111111112";
const mint2="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const now=Date.parse("2026-11-17T12:00:00Z");
const good={address:mint,name:"Token A",symbol:"AAA",priceUsd:"1.25",liquidity:{usd:180000},volume:{h1:12000,h24:100000},priceChange:{h1:4,h24:12},txns:{h1:{buys:130,sells:90}},pairCreatedAt:now-72*3600000,boost:0};
test("Market PWA uses unique standalone identity and 5 focused Android screens",()=>{
 assert.equal(JSON.parse(manifest).short_name,"AURA Market");
 for(const id of ["overview","scanner","research","lab","portfolio"]) assert.match(page,new RegExp('id="'+id+'"'));
 for(const id of ["tokenRows","inspector","terminal-research","terminal-candidates","positions","globalOutcomeRows"]) assert.equal(page.split('id="'+id+'"').length-1,1,id);
 assert.match(page,/market-ui\.css/);assert.match(page,/market-terminal\.js/);
 assert.match(styles,/position:fixed/);assert.match(styles,/safe-area-inset-bottom/);assert.match(styles,/prefers-reduced-motion/);
 assert.match(sw,/aura-market-terminal-1\.0\.0/);
});
test("Legacy Crypto Signal Lab functionality is preserved and separated from Wallet",()=>{
 for(const feature of ["PAPER PORTFOLIO","Run on-chain checks","SHARED FORWARD OUTCOMES","Download local backup","Copy research brief"])assert.ok(page.includes(feature),feature);
 assert.match(page,/HORIZONS=\[300,900,3600,21600,86400\]/);
 assert.match(page,/GLOBAL_LEDGER_URL/);
 assert.match(page,/window\.AuraMarket\?\.refresh/);
 assert.match(page,/switchTab\("research",false\)/);
 assert.doesNotMatch(page,/walletconnect|sendTransaction|signTransaction/i);
});
test("Inline legacy JS syntax parses",()=>{
 const scripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
 assert.ok(scripts.length>=1);
 for(const js of scripts)new vm.Script(js);
 new vm.Script(terminal);
});
test("Liquid mature token with complete observations may be eligible for research",()=>{
 const x=classify(good,now);
 assert.equal(x.gate,true);
 assert.equal(x.bias,"POSITIVE MOMENTUM");
 assert.ok(x.score>=45&&x.score<=100);
 assert.equal(x.fields,7);
 assert.equal(x.missing.length,0);
 assert.equal(Object.hasOwn(x,"predictedPrice"),false);
});
test("Liquidity and maturity gates block thin and newborn token promotions",()=>{
 assert.equal(classify({...good,liquidity:{usd:1500}},now).gate,false);
 assert.equal(classify({...good,pairCreatedAt:now-3600000},now).gate,false);
 assert.equal(classify({...good,priceChange:{h1:55,h24:170}},now).gate,false);
});
test("Missing numbers stay unavailable and score is suppressed",()=>{
 const x=classify({...good,volume:{},priceChange:{}},now);
 assert.equal(x.gate,false);assert.equal(x.score,null);assert.ok(x.missing.includes("volume"));assert.equal(x.bias,"UNKNOWN");
});
test("Promotion never increases score, ranked list prioritizes eligible research candidates",()=>{
 const promoted=classify({...good,boost:200},now),ordinary=classify(good,now);
 assert.ok(promoted.score<ordinary.score);
 assert.ok(promoted.flags.some(x=>x.includes("Promotional")));
 const rs=ranking([{...good,address:mint2,liquidity:{usd:1200}},good],now);
 assert.equal(rs[0].mint,mint);
});
test("Live data is not fabricated; signals are caveated, charts are source-backed",()=>{
 assert.match(terminal,/GeckoTerminal OHLCV|GeckoTerminal/);
 assert.match(terminal,/No observed tokens passed all research gates/);
 assert.match(terminal,/not a calibrated probability/);
 assert.match(terminal,/No substitute data|no substitute data/);
});
