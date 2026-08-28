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

  function mount() {
    var pathname = String(window.location.pathname || '');
    if (pathname === '/debate' || pathname.indexOf('/debates/') === 0 || pathname.indexOf('/admin') === 0) return;
    if (document.querySelector('.home-bottom-nav')) return;

    var spacer = document.createElement('div');
    spacer.className = 'mnoria-global-bottom-nav-spacer';
    spacer.setAttribute('aria-hidden', 'true');

    var nav = document.createElement('nav');
    nav.className = 'home-bottom-nav';
    nav.setAttribute('aria-label', 'Navigation principale');
    nav.appendChild(makeItem('fa-regular fa-compass', 'Explorer', goHome));
    nav.appendChild(makeItem('fa-solid fa-plus', 'Ouvrir', function () { openPage('/create'); }));
    nav.appendChild(makeItem('fa-solid fa-rotate-right', 'Actualiser', function () { window.location.reload(); }));
    nav.appendChild(makeItem('fa-solid fa-house', 'Accueil', goHome));
    nav.appendChild(makeItem('fa-regular fa-bell', 'Alertes', function () { openPage('/notifications'); }));

    document.body.classList.add('mnoria-global-bottom-nav-enabled');
    document.body.appendChild(spacer);
    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
