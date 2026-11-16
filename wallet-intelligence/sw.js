const CACHE="aura-wallet-intelligence-0.3.0";
const SHELL=["./","./index.html","./app.js","./manifest.webmanifest","./icon.svg","./market.js","./intelligence.css","./intelligence-core.mjs","./intelligence-ui.mjs"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=="GET"||u.origin!==self.location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{
   if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
   return r;
 }).catch(async()=>await caches.match(e.request)||await caches.match("./index.html")));
});
