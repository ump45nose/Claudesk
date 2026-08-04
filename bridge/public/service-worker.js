const CACHE_NAME = "claude-official-remote-20260804-2";
const SHELL_ASSETS = [
  "/",
  "/remote-main-menu.css?v=20260801-2",
  "/remote-main-menu.js?v=20260801-4",
  "/remote-preload.js?v=20260804-2",
  "/remote-shell.css?v=20260804-1",
  "/manifest.webmanifest?v=20260801-1",
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
    "/_frame-rt/",
    "/assets/",
    "/audio/",
    "/i18n/",
    "/images/",
  ].some((prefix) => url.pathname.startsWith(prefix));
  const compatibilityAsset = [...url.searchParams.keys()]
    .some((key) => key.startsWith("claudesk-"))
    || /\/assets\/v1\/shared-(?:12-kUZ_jZyi|17-YFu3JFq7)\.js$/.test(url.pathname);
  if (compatibilityAsset) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
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
