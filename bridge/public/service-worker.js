const RELEASE = "__CLAUDESK_RELEASE__";
const CACHE_NAME = `claude-official-remote-${RELEASE}`;
const SHELL_ASSETS = [
  "/",
  `/remote-main-menu.css?v=${RELEASE}`,
  `/remote-main-menu.js?v=${RELEASE}`,
  `/remote-preload.js?v=${RELEASE}`,
  `/remote-shell.css?v=${RELEASE}`,
  `/manifest.webmanifest?v=${RELEASE}`,
  "/desktop-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET"
    || url.origin !== self.location.origin
    || url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  const officialImmutableAsset = [
    "/renderer/",
    "/_frame-rt/",
    "/assets/",
    "/audio/",
    "/i18n/",
    "/images/",
  ].some((prefix) => url.pathname.startsWith(prefix));
  event.respondWith(caches.match(request).then(async (cached) => {
    if (cached) return cached;
    const response = await fetch(request);
    const cacheControl = response.headers.get("cache-control") || "";
    if (response.ok && officialImmutableAsset && !/\bno-store\b/i.test(cacheControl)) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  }));
});
