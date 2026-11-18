/* AURA Market 2.0: same-origin app shell only, never cache third-party market data. */
const SHELL_CACHE='aura-market-mobile-2.0.0';
const SHELL=['./','./index.html','./classic.html','./manifest.webmanifest','./icon.svg','./market-ui.css','./market-terminal.js','./intelligence-lab.css','./intelligence-lab.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aura-market-')&&key!==SHELL_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){
   event.respondWith(fetch(req).then(response=>{
     if(response.ok){const copy=response.clone();caches.open(SHELL_CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});}
     return response;
   }).catch(async()=>await caches.match(req,{ignoreSearch:true})||await caches.match('./index.html')));
   return;
 }
 event.respondWith(fetch(req).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(SHELL_CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});}
   return response;
 }).catch(()=>caches.match(req)));
});
