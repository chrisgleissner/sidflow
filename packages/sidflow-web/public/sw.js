const CACHE_PREFIX = 'sidflow-offline';
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v1`;
const MAX_CACHE_ENTRIES = 24;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (!shouldHandleRequest(url)) {
    return;
  }

  event.respondWith(handleRequest(request, url));
});

function shouldHandleRequest(url) {
  if (url.pathname.startsWith('/api/playback/')) {
    return true;
  }
  if (url.pathname.startsWith('/wasm/')) {
    return true;
  }
  return false;
}

async function handleRequest(request, url) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
      void pruneCache(cache);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      void notifyClients({ type: 'offline-response', url: url.pathname });
      return cached;
    }
    return new Response(null, {
      status: 503,
      statusText: 'Offline',
    });
  }
}

async function pruneCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) {
    return;
  }
  const excess = keys.slice(0, keys.length - MAX_CACHE_ENTRIES);
  await Promise.all(excess.map((key) => cache.delete(key)));
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(
    clients.map((client) =>
      client.postMessage({
        source: 'sidflow-sw',
        ...message,
      })
    )
  );
}
