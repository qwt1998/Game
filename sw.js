// Lets the home-screen app open without a connection.
// Always asks the network first so new versions show up at once; the saved copy is only used offline.
// When a new file needs to work offline, add it to FILES and bump the number in CACHE.
const CACHE='paodan-v1';
const FILES=['./','index.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  const req=e.request;
  if(req.method!=='GET'||new URL(req.url).origin!==location.origin)return;
  e.respondWith(fetch(req).then(function(res){
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}
    return res;
  }).catch(function(){
    return caches.match(req,{ignoreSearch:true}).then(function(hit){return hit||(req.mode==='navigate'?caches.match('./'):Response.error());});
  }));
});
