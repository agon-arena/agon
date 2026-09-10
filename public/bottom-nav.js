(function () {
  'use strict';

  function openPage(path) {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.openDebateIframeModal === 'function') {
        window.parent.openDebateIframeModal(path);
        return;
      }
    } catch (error) {}
    window.location.href = path;
  }

  function goHome() {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.closeDebateIframeModal === 'function') {
        window.parent.closeDebateIframeModal({ skipReturnLoader: true });
        return;
      }
    } catch (error) {}
    window.location.href = '/?skipStartup=1';
  }

  function makeItem(iconClass, label, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-bottom-nav-item';
    button.setAttribute('aria-label', label);
    button.innerHTML = '<i class="' + iconClass + '" aria-hidden="true"></i><span>' + label + '</span>';
    button.addEventListener('click', action);
    return button;
  }

  function makeStaticItem(iconClass, label) {
    var button = makeItem(iconClass, label, function (event) {
      event.preventDefault();
    });
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('tabindex', '-1');
    button.style.pointerEvents = 'none';
    button.style.cursor = 'default';
    return button;
  }

  function mount() {
    var pathname = String(window.location.pathname || '');
    if (pathname === '/debate' || pathname.indexOf('/debates/') === 0 || pathname.indexOf('/admin') === 0) return;
    if (document.querySelector('.home-bottom-nav')) return;
    // Fenêtres Photo/PDF/Texte/Lien/YouTube/Manuellement de la page
    // Apprentissage (cf. openKnowledgeRouteModal, qcm-du-jour.html) : ces
    // pages sont chargées en iframe dans une fenêtre déjà pourvue de sa
    // propre croix de fermeture et de son propre bouton "Retourner aux
    // apprentissages" — ce bandeau y apparaissait en double, à l'intérieur
    // même de la fenêtre (demande du 30/08/2026).
    if (/(?:^|[?&])noNav=1(?:&|$)/.test(window.location.search)) return;

    var spacer = document.createElement('div');
    spacer.className = 'mnoria-global-bottom-nav-spacer';
    spacer.setAttribute('aria-hidden', 'true');

    var nav = document.createElement('nav');
    nav.className = 'home-bottom-nav';
    nav.setAttribute('aria-label', 'Navigation principale');
    // Page Éclairages (demande du 09/09/2026) : "Explorer" remplacé par "Accueil" (1ère place),
    // et "Apprentissages" (même icône/cible que partout ailleurs sur le site, cf. views/index.html
    // bottom-nav-item "Apprentissages" → /apprentissage) prend la place habituelle d'"Accueil"
    // plus loin dans la barre — les deux permutés, jamais dupliqués. Étendu le même jour à
    // Meilleures idées ("idem sur page scores et contributions" puis "... les meilleures idées") ;
    // Scores et contributions (/contributions) a le même résultat mais via son propre template
    // codé en dur (cf. views/mon-univers.html), pas ce script. Les autres pages qui chargent ce
    // même script gardent "Explorer"/"Accueil" inchangés.
    var usesAccueilFirst = pathname === '/eclairages' || pathname === '/meilleures-idees' || pathname === '/historical-events-test' || pathname === '/about' || pathname === '/contact';
    var usesStaticMonFile = pathname === '/eclairages' || pathname === '/meilleures-idees' || pathname === '/historical-events-test' || pathname === '/about' || pathname === '/contact';
    if (usesAccueilFirst) {
      nav.appendChild(makeItem('fa-solid fa-house', 'Accueil', goHome));
    } else {
      nav.appendChild(makeItem('fa-regular fa-compass', 'Explorer', goHome));
    }
    if (usesStaticMonFile) {
      nav.appendChild(makeStaticItem('fa-solid fa-user', 'Mon file'));
    } else {
      nav.appendChild(makeItem('fa-solid fa-plus', 'Ouvrir', function () { openPage('/create'); }));
    }
    nav.appendChild(makeItem('fa-solid fa-rotate-right', 'Actualiser', function () { window.location.reload(); }));
    if (usesAccueilFirst) {
      nav.appendChild(makeItem('fa-solid fa-list-check', 'Apprentissages', function () { openPage('/apprentissage'); }));
    } else {
      nav.appendChild(makeItem('fa-solid fa-house', 'Accueil', goHome));
    }
    nav.appendChild(makeItem('fa-regular fa-bell', 'Alertes', function () { openPage('/notifications'); }));

    document.body.classList.add('mnoria-global-bottom-nav-enabled');
    document.body.appendChild(spacer);
    document.body.appendChild(nav);
  }

  // Ce script est placé en fin de <body> : le corps existe déjà, donc le
  // bandeau peut être monté sans attendre DOMContentLoaded ni les autres
  // scripts différés de la page.
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
