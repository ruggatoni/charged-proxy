/* The Charged Proxy — service worker
   Routes proxied requests to Scramjet (/scramjet/…) or Ultraviolet (/uv/service/…).
   Everything else (the site itself) passes straight through. */

importScripts("/scram/scramjet.all.js");
importScripts("/uv/uv.bundle.js");
importScripts("/uv/uv.config.js");
importScripts(__uv$config.sw);

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const uv = new UVServiceWorker();

// When an image, script or stylesheet sets a cookie, Scramjet tells the page
// and waits for it to reply. But the browser holds service worker messages
// until the page has finished loading, and the page can't finish without that
// file, so the first visit to a site could hang forever. Wait briefly instead;
// the page still gets the cookie once it's ready.
const dispatch = scramjet.dispatch.bind(scramjet);
scramjet.dispatch = (client, message) =>
  Promise.race([dispatch(client, message), new Promise((resolve) => setTimeout(resolve, 300))]);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function handleRequest(event) {
  await scramjet.loadConfig();
  if (scramjet.route(event)) return scramjet.fetch(event);
  if (uv.route(event)) return uv.fetch(event);
  return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
