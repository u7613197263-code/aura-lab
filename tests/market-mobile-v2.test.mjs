import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const [page,classic,sw,manifest]=await Promise.all([
 readFile(new URL('index.html',root),'utf8'),
 readFile(new URL('classic.html',root),'utf8'),
 readFile(new URL('sw.js',root),'utf8'),
 readFile(new URL('manifest.webmanifest',root),'utf8')
]);
const script=page.match(/<script>([\s\S]+?)<\/script>/)?.[1]||'';
test('mobile v2 document has valid standalone JS and PWA identity',()=>{
 assert.match(page,/<!doctype html>/i);assert.match(page,/<meta name="viewport"/);
 assert.ok(script.length>10000);new vm.Script(script);assert.match(page,/<link rel="manifest"/);
 const m=JSON.parse(manifest);assert.equal(m.short_name,'AURA Market');assert.equal(m.display,'standalone');
});
test('four task-first mobile destinations and a single asset detail',()=>{
 for(const id of ['today','explore','activity','library'])assert.match(page,new RegExp('id="view-'+id+'"'));
 const nav=page.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-go="([^"]+)"/g)].map(x=>x[1]),['today','explore','activity','library']);
 for(const id of ['detail-overlay','detail-body','detail-close'])assert.match(page,new RegExp('id="'+id+'"'));
});
test('mobile viewport, reduced motion, focus, and safe areas are present',()=>{
 for(const marker of ['safe-area-inset-bottom','prefers-reduced-motion','focus-visible','max-width:1176px'])assert.ok(page.includes(marker),marker);
});
test('Today displays source confidence, current research and collector quality',()=>{
 for(const id of ['net-status','hero-title','stat-universe','stat-eligible','quick-quality','capture-rate','home-candidates'])assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(page,/short-horizon history is unreliable/i);
});
test('Explore supports real feed and explicit search endpoint workflows',()=>{
 for(const id of ['token-search','search-external','explore-list','search-external-status'])assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(script,/api\/market\/search\?q=/);assert.match(script,/api\/market\/token\?mint=/);
 assert.match(script,/function searchExternal\(/);assert.match(script,/function openDetail\(/);
});
test('prior v1.1 browser paper data and intelligence are retained untouched',()=>{
 assert.match(script,/const DBKEY='aura_market_mobile_v2_prod_1'/);
 assert.ok(script.includes("'aura_crypto_pwa_021'"));assert.ok(script.includes("'aura_market_intelligence_110'"));
 assert.doesNotMatch(script,/localStorage\.removeItem\(['"]aura_crypto_pwa_021/);
 assert.doesNotMatch(script,/localStorage\.setItem\(['"]aura_crypto_pwa_021/);
 assert.doesNotMatch(script,/localStorage\.setItem\(['"]aura_market_intelligence_110/);
});
test('Classic page remains same-origin with existing full trading and research UI',()=>{
 assert.match(page,/href="\.\/classic\.html"/);
 for(const feature of ['PAPER PORTFOLIO','SHARED FORWARD OUTCOMES','Run on-chain checks'])assert.ok(classic.includes(feature),feature);
 assert.match(classic,/aura_crypto_pwa_021/);assert.match(classic,/intelligence-lab\.js/);
});
test('legacy watchlist and notes migration is explicit and non-destructive',()=>{
 assert.match(page,/id="migrate-legacy"/);assert.match(page,/Migration is optional/);
 assert.match(script,/function migrateLegacy\(/);assert.match(script,/store\.wallets\.push/);assert.match(script,/store\.notes\.push/);
 assert.doesNotMatch(script,/store\.cash\s*=/);
});
test('paper observations carry uncertainty and require a later source snapshot',()=>{
 assert.match(script,/UNVERIFIED_PROVIDER_TIME/);
 assert.match(script,/Date\.parse\(t\.fetchedAt\)<=Date\.parse\(o\.at\)/);
 assert.match(page,/Automatic learning<\/span><strong>Not operational/);
 assert.match(page,/No real trading/i);
});
test('synthetic data is explicit and cannot enter permanent research',()=>{
 assert.match(script,/if\(state\.demo\)return;try\{localStorage\.setItem/);
 assert.match(page,/DESIGN PREVIEW · SYNTHETIC DATA/);
});
test('service worker keeps offline Classic and v2 routes independent',()=>{
 assert.match(sw,/aura-market-mobile-2\.0\.0/);
 assert.match(sw,/\.\/classic\.html/);
 assert.match(sw,/url\.origin!==self\.location\.origin/);
 assert.match(sw,/cache\.put\(req,copy\)/);
 assert.doesNotMatch(sw,/cache\.put\('\.\/index\.html',copy\)/);
});
test('there is no wallet signing or real transaction authority',()=>{
 assert.doesNotMatch(script,/signTransaction|sendTransaction|walletconnect/i);
});
