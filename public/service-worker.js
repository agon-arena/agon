// Invalidation du 03/09/2026 : purge du cache de navigation /apprentissage
// susceptible de resservir, via cachedFallback, une ancienne version de la
// page antérieure au câblage de la route progressive (audit read-only du
// 03/09/2026 — cf. server.js POST /api/users/notion-quizzes/custom/progressive).
const SW_VERSION = "20260903-progressive-routing-fix";
const STATIC_CACHE = `mnoria-static-${SW_VERSION}`;
const NAVIGATION_FETCH_TIMEOUT_MS = 8000;

// Assets statiques versionnés (?v=... bumpé à chaque build) : sûrs à mettre en
// cache-first, une nouvelle version a une URL différente donc pas de risque de
// servir du contenu obsolète. Ça évite de retélécharger ces fichiers (et les CSS
// externes de polices/icônes) à chaque ouverture froide de l'app installée.
function isCacheableStaticAsset(url) {
  return /\.(?:css|js|png|jpe?g|svg|webp|woff2?|ttf)(?:\?.*)?$/i.test(url);
}

function isMutableStaticAsset(url) {
  const parsedUrl = new URL(url);
  // Les feuilles et scripts portant une version explicite sont immuables :
  // leur servir immédiatement la copie locale évite jusqu'à 8 s d'attente
  // avant l'apparition du bandeau. Toute modification change ?v=..., donc ne
  // peut pas réutiliser silencieusement une ancienne ressource.
  if (parsedUrl.searchParams.has("v")) return false;
  return /\.(?:css|js)(?:\?.*)?$/i.test(url);
}

function buildRecoveryResponse(targetUrl) {
  const safeUrl = String(targetUrl || "/");
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Cache-Control" content="no-store">
  <title>Mnoria se reconnecte</title>
  <!-- Oswald : même police que le titre/bouton de la page "site inaccessible"
       (cf. showIndexLoadErrorState, script.js) — identité Mnoria pour ces deux
       écrans techniques. Requête best-effort : ce document doit rester utilisable
       même si elle échoue (ex. coupure réseau totale), auquel cas le navigateur
       retombe silencieusement sur le repli Impact/Arial Narrow/sans-serif ci-dessous. -->
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap">
  <style>
    html,body{margin:0;background:#243038;color:#f3f6f4;font-family:Arial,Helvetica,sans-serif}
    body{
      display:flex;align-items:center;justify-content:center;
      min-height:100vh;min-height:100dvh;
      padding:24px;
      padding-top:max(24px, env(safe-area-inset-top, 0px));
      padding-right:max(24px, env(safe-area-inset-right, 0px));
      padding-bottom:max(24px, env(safe-area-inset-bottom, 0px));
      padding-left:max(24px, env(safe-area-inset-left, 0px));
      box-sizing:border-box;
    }
    /* Même largeur de bloc que la page "site inaccessible" (showIndexLoadErrorState,
       script.js) : min(88vw,340px) plutôt qu'un max-width fixe, pour un comportement
       identique sur petit écran. */
    main{width:min(88vw,340px);box-sizing:border-box;text-align:center}
    img{width:96px;height:96px;display:block;margin:0 auto 20px;animation:spin 1.1s linear infinite}
    /* Même langage typographique que le titre de l'autre écran technique : Oswald,
       graisse 600, taille/interligne identiques — plus la grosse police sans-serif
       générique héritée du <h1> par défaut. */
    h1{margin:0 0 10px;font-family:'Oswald', Impact, 'Arial Narrow', sans-serif;font-size:19px;font-weight:600;line-height:1.3;color:#fff}
    p{margin:0;color:rgba(243,246,244,.74);font-size:14px;line-height:1.55}
    /* Bouton harmonisé avec .mnoria-tech-btn (script.js, showIndexLoadErrorState) :
       même rendu rempli/Oswald plutôt que le contour en pilule précédent — à faire
       évoluer en parallèle si ces valeurs changent, ce document n'a pas accès à ce
       <style> partagé (page HTML autonome générée par le service worker). */
    button{
      margin-top:22px;
      display:inline-block;
      font-family:'Oswald', Impact, 'Arial Narrow', sans-serif;
      font-weight:600;
      font-size:14px;
      letter-spacing:0.04em;
      color:#fff;
      background:#2c3e50;
      border:none;
      border-radius:8px;
      padding:8px 12px;
      cursor:pointer;
      -webkit-tap-highlight-color:transparent;
    }
    button:hover{background:#1f2d3d}
    button:active{background:#16212c}
    button:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:2px}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main>
    <img src="/sablier-96.png" alt="">
    <h1>Reconnexion en cours</h1>
    <p>Mnoria redémarre ou met à jour ses données. Cette page se recharge automatiquement dès que le serveur répond.</p>
    <button type="button" onclick="retry(this)">Réessayer</button>
  </main>
  <script>
    var target = ${JSON.stringify(safeUrl)};
    function retry(buttonEl){
      // Grisé le temps de cette tentative précise, quel que soit son issue (succès =
      // navigation, échec = la relance automatique ci-dessous reprendra de toute
      // façon) : évite un double-clic sans jamais rester bloqué grisé si ce fetch
      // particulier reste en attente sans jamais aboutir (pas de timeout explicite).
      if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.style.opacity = '0.5';
        setTimeout(function(){ buttonEl.disabled = false; buttonEl.style.opacity = ''; }, 2500);
      }
      fetch('/ping?sw-recover=' + Date.now(), { cache: 'no-store' })
        .then(function(r){
          if (r.ok) {
            try { sessionStorage.setItem("mnoria_last_reload_reason", JSON.stringify({ reason: "sw-recovery-page (serveur indisponible puis revenu)", at: Date.now() })); } catch(e) {}
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

function notifyClientsOfStalePage(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url === url) client.postMessage({ type: "mnoria:page-stale" });
    }
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Lancement standalone : sert la dernière page HTML connue en cache
  // IMMÉDIATEMENT (démarrage instantané), et revalide en arrière-plan pour
  // que le prochain lancement soit à jour — au lieu d'attendre le réseau à
  // chaque ouverture (coûteux sur mobile). Un serveur en 5xx pendant un
  // redémarrage ne casse rien : la page déjà affichée reste fonctionnelle, la
  // mise à jour arrière-plan échoue silencieusement et retentera au lancement
  // suivant. Seul le tout premier lancement (rien en cache encore) attend le
  // réseau, avec la page de récupération en filet si le serveur ne répond pas.
  if (request.mode === "navigate") {
    // Bouton "Actualiser" (cf. forceFullPageRefresh dans script.js) : marqueur
    // posé sur l'URL pour forcer explicitement le réseau, en ignorant le
    // cache-first ci-dessous — sinon, si la page affichée est bloquée/figée,
    // "Actualiser" ne ferait que réafficher la même page en cache à
    // l'identique, sans aucun moyen d'en sortir. On retire le marqueur avant
    // de l'utiliser comme clé de cache, sinon la revalidation alimente une
    // entrée "?_swrefresh=…" que les lancements normaux (URL propre) ne
    // consulteront jamais.
    const requestUrl = new URL(request.url);
    const forcedFresh = requestUrl.searchParams.has("_swrefresh");
    const navigationNetworkFirst = [
      "/apprentissage",
      "/create",
      "/notifications",
      "/contributions",
      "/mon-univers"
    ].includes(requestUrl.pathname);
    let cacheKeyRequest = request;
    if (forcedFresh) {
      requestUrl.searchParams.delete("_swrefresh");
      cacheKeyRequest = new Request(requestUrl.toString(), { headers: request.headers });
    }

    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cachedFallback = !forcedFresh && navigationNetworkFirst
          ? await cache.match(cacheKeyRequest)
          : null;
        const cachedResponse = forcedFresh || navigationNetworkFirst
          ? null
          : await cache.match(cacheKeyRequest);

        if (cachedResponse) {
          // Revalidation arrière-plan sans limite de temps : rien n'attend
          // dessus, elle met juste à jour le cache pour le prochain lancement.
          // Si le HTML fraîchement récupéré diffère de celui déjà affiché (typiquement
          // juste après un déploiement touchant les vues), la page en cours peut être
          // désynchronisée du CSS/JS déjà à jour (network-first) — ex. une classe liée
          // à une police renommée entre les deux versions. On prévient la page pour
          // qu'elle se recharge une fois, plutôt que d'attendre le lancement suivant.
          event.waitUntil(
            Promise.all([
              cachedResponse.clone().text().catch(() => null),
              fetch(request, { cache: "no-store" })
            ]).then(([oldHtml, response]) => {
              if (!response || !response.ok) return;
              const responseForCache = response.clone();
              return response.text().then((newHtml) => {
                cache.put(cacheKeyRequest, responseForCache);
                if (oldHtml !== null && newHtml !== oldHtml) {
                  return notifyClientsOfStalePage(cacheKeyRequest.url);
                }
              });
            }).catch(() => {})
          );
          return cachedResponse;
        }

        // Rien en cache (tout premier lancement, cache vidé, ou "Actualiser"
        // forcé) : on attend le réseau, avec le même filet de récupération
        // qu'avant si le serveur ne répond pas dans le délai imparti.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NAVIGATION_FETCH_TIMEOUT_MS);
        return fetch(request, { cache: "no-store", signal: controller.signal }).then((response) => {
          clearTimeout(timeoutId);
          if (response && response.status >= 500) {
            return cachedFallback || buildRecoveryResponse(request.url);
          }
          if (response && response.ok) {
            cache.put(cacheKeyRequest, response.clone());
          }
          return response;
        }).catch(() => {
          clearTimeout(timeoutId);
          return cachedFallback || buildRecoveryResponse(request.url);
        });
      })
    );
    return;
  }

  // CSS/JS : réseau d'abord, cache en secours. Ces fichiers pilotent le rendu
  // et doivent refléter immédiatement les corrections visuelles après reload.
  // Images/polices : cache-first avec revalidation arrière-plan pour garder
  // l'ouverture froide de l'app rapide.
  if (request.method === "GET" && isCacheableStaticAsset(request.url)) {
    if (isMutableStaticAsset(request.url)) {
      // Même filet que les navigations (timeout + repli cache) : sans lui, un
      // réseau qui reste ouvert sans jamais répondre (réveil du téléphone en
      // 4G/5G typiquement) laisse ce fetch en attente indéfinie — l'app reste
      // figée en attendant un script.min.js/style.min.css qui n'arrive jamais,
      // alors que la version en cache suffirait très bien à afficher la page.
      event.respondWith(
        caches.open(STATIC_CACHE).then((cache) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), NAVIGATION_FETCH_TIMEOUT_MS);
          return fetch(request, { cache: "no-store", signal: controller.signal }).then((response) => {
            clearTimeout(timeoutId);
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => {
            clearTimeout(timeoutId);
            return cache.match(request);
          });
        })
      );
      return;
    }

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
    body: payload.body || "Nouvelle activité sur mnoria.",
    icon: payload.icon || "/mnoria-icon-192.png",
    badge: payload.badge || "/mnoria-icon-192.png",
    data: {
      url: payload.url || "/",
      notificationId: payload.notificationId || payload.notification_id || null
    }
  };

  // Aucun son personnalisé possible sur la notification système elle-même (limitation
  // des navigateurs, aucune option "sound" supportée) — à la place, on prévient les
  // onglets/PWA déjà ouverts pour qu'ils jouent le même gong que l'animation de démarrage
  // (demande du 01/09/2026, "je veux mettre le même gong que l'animation").
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) client.postMessage({ type: "mnoria:play-notification-gong" });
    })
  ]));
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
