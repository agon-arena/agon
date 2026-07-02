const SW_VERSION = "20260702-debate-source-fill-bottom";
const STATIC_CACHE = `agon-static-${SW_VERSION}`;

// Assets statiques versionnés (?v=... bumpé à chaque build) : sûrs à mettre en
// cache-first, une nouvelle version a une URL différente donc pas de risque de
// servir du contenu obsolète. Ça évite de retélécharger ces fichiers (et les CSS
// externes de polices/icônes) à chaque ouverture froide de l'app installée.
function isCacheableStaticAsset(url) {
  return /\.(?:css|js|png|jpe?g|svg|webp|woff2?|ttf)(?:\?.*)?$/i.test(url);
}

function buildRecoveryResponse(targetUrl) {
  const safeUrl = String(targetUrl || "/");
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>Agôn se reconnecte</title>
  <style>
    html,body{margin:0;background:#243038;color:#f3f6f4;font-family:Arial,Helvetica,sans-serif}
    body{display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px;box-sizing:border-box}
    main{max-width:360px;text-align:center}
    img{width:96px;height:96px;display:block;margin:0 auto 18px;animation:spin 1.1s linear infinite}
    h1{margin:0 0 10px;font-size:22px;line-height:1.2}
    p{margin:0;color:rgba(243,246,244,.74);font-size:14px;line-height:1.55}
    button{margin-top:20px;border:1px solid rgba(243,246,244,.35);background:rgba(255,255,255,.08);color:#f3f6f4;border-radius:999px;padding:10px 16px;font-weight:700}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main>
    <img src="/sablier-96.png" alt="">
    <h1>Reconnexion en cours</h1>
    <p>Agôn redémarre ou met à jour ses données. Cette page se recharge automatiquement dès que le serveur répond.</p>
    <button type="button" onclick="retry()">Réessayer</button>
  </main>
  <script>
    var target = ${JSON.stringify(safeUrl)};
    function retry(){
      fetch('/ping?sw-recover=' + Date.now(), { cache: 'no-store' })
        .then(function(r){
          if (r.ok) {
            try { sessionStorage.setItem("agon_last_reload_reason", JSON.stringify({ reason: "sw-recovery-page (serveur indisponible puis revenu)", at: Date.now() })); } catch(e) {}
            location.replace(target);
          }
        })
        .catch(function(){});
    }
    setInterval(retry, 2500);
    retry();
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache"
    }
  });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))
      )
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Force les pages HTML à être toujours rechargées depuis le réseau (contourne le cache iOS PWA).
  // Si le serveur répond 5xx pendant un redémarrage, on ne laisse pas iOS standalone
  // mémoriser une page d'erreur brute : on sert une page de récupération non cachable.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then((response) => {
        if (response && response.status >= 500) {
          return buildRecoveryResponse(request.url);
        }
        return response;
      }).catch(() => buildRecoveryResponse(request.url))
    );
    return;
  }

  // Assets statiques (CSS/JS/images/polices, même origine ou CDN) : cache-first
  // avec revalidation en arrière-plan, pour accélérer les ouvertures suivantes
  // de l'app sans jamais bloquer sur le réseau si une copie est déjà en cache.
  if (request.method === "GET" && isCacheableStaticAsset(request.url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request).then((response) => {
            if (response && (response.ok || response.type === "opaque")) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const rawTitle = String(payload.title || "").trim();
  const title = rawTitle.replace(/^from\s+ag[oô]n\s*:?\s*/i, "").trim() || "L'arène des idées";
  const options = {
    body: payload.body || "Nouvelle activité sur agôn.",
    icon: payload.icon || "/icon-192-optimized.png",
    badge: payload.badge || "/icon-192-optimized.png",
    data: {
      url: payload.url || "/",
      notificationId: payload.notificationId || payload.notification_id || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";
  const notificationId = event.notification?.data?.notificationId || null;

  event.waitUntil((async () => {
    if (notificationId) {
      try {
        await fetch("/api/notifications/read-from-push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId }),
          keepalive: true
        });
      } catch (_) {}
    }

    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of windowClients) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
