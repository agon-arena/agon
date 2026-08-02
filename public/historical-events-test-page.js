"use strict";

// Page de test isolée "Ce jour dans l'Histoire" (views/historical-events-test.html).
// Fichier dédié, jamais chargé par les autres pages — ne touche pas à script.js.
// Toutes les données de l'API sont insérées via textContent/createElement,
// jamais innerHTML, puisqu'elles ne sont pas sous notre contrôle direct.

(function () {
  var CATEGORY_ORDER = ["france", "europe", "world"];
  var CATEGORY_LABELS = {
    france: "Histoire de France",
    europe: "Histoire européenne",
    world: "Histoire du monde"
  };
  var DATE_KEY_PATTERN = /^\d{2}-\d{2}$/;
  var DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // "?testDate=MM-DD" ne fonctionne qu'en dev (localhost) : jamais de forçage
  // de date possible sur le site déployé, même sur cette page de test.
  var IS_DEV_ENVIRONMENT = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  // Même logique que parisDateKey() côté serveur (server.js) : "aujourd'hui"
  // doit rester cohérent avec le reste du site, pas l'heure locale du visiteur.
  function getParisDateKey(date) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date || new Date());
    var get = function (type) { var p = parts.filter(function (x) { return x.type === type; })[0]; return p ? p.value : ""; };
    return get("month") + "-" + get("day");
  }

  function resolveInitialDateKey() {
    if (IS_DEV_ENVIRONMENT) {
      var params = new URLSearchParams(window.location.search);
      var testDate = params.get("testDate");
      // isValidDateKey (définie plus bas, mais les déclarations de fonction
      // sont hoistées) vérifie aussi que le mois/jour sont plausibles — le
      // pattern seul laisserait passer un "99-99" qui ferait échouer l'API.
      if (testDate && isValidDateKey(testDate)) return testDate;
    }
    return getParisDateKey();
  }

  var dateDisplay = document.getElementById("het-date-display");
  var statusEl = document.getElementById("het-status");
  var cardsEl = document.getElementById("het-cards");

  var historyToggle = document.getElementById("het-history-toggle");
  var historyPanel = document.getElementById("het-history-panel");
  var historyDateInput = document.getElementById("het-history-date");
  var historyPrevBtn = document.getElementById("het-history-prev");
  var historyNextBtn = document.getElementById("het-history-next");
  var historyTodayBtn = document.getElementById("het-history-today");

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function isValidDateKey(value) {
    if (!DATE_KEY_PATTERN.test(value)) return false;
    var month = Number(value.slice(0, 2));
    var day = Number(value.slice(3, 5));
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false;
    return true;
  }

  function setStatus(text, isError) {
    statusEl.replaceChildren();
    if (/^Chargement\b/i.test(String(text || ""))) {
      var hourglass = document.createElement("img");
      hourglass.src = "/sablier-96.png";
      hourglass.alt = "";
      hourglass.className = "het-loading-hourglass";
      hourglass.setAttribute("aria-hidden", "true");
      statusEl.appendChild(hourglass);
    }
    statusEl.appendChild(document.createTextNode(text || ""));
    statusEl.hidden = !text;
    statusEl.classList.toggle("het-status-error", !!isError);
  }

  function clearCards() {
    while (cardsEl.firstChild) cardsEl.removeChild(cardsEl.firstChild);
  }

  function formatDateDisplay(dateKey) {
    var months = [
      "janvier", "février", "mars", "avril", "mai", "juin",
      "juillet", "août", "septembre", "octobre", "novembre", "décembre"
    ];
    var month = Number(dateKey.slice(0, 2));
    var day = Number(dateKey.slice(3, 5));
    if (!month || !day || !months[month - 1]) return dateKey;
    return String(day) + " " + months[month - 1];
  }

  function formatEventTitle(dateKey, event) {
    var title = typeof event.title === "string" ? event.title.trim() : "";
    var dateText = formatDateDisplay(dateKey);
    var yearDisplay = typeof event.year_display === "string" ? event.year_display.trim() : "";
    var yearsAgoText = formatYearsAgo(event.year);
    var prefix = dateText ? "Le " + dateText : "";

    if (yearDisplay) prefix += (prefix ? " " : "") + yearDisplay;
    if (yearsAgoText) prefix += (prefix ? ", " : "") + yearsAgoText;
    if (!prefix) return title;
    return title ? prefix + ", " + title : prefix;
  }

  // "il y a N ans" par rapport à l'année en cours — year peut être négatif
  // (avant J.-C., cf. validateEvent) : la soustraction reste correcte telle
  // quelle. Pas de texte si l'année est absente/invalide ou dans le futur
  // (rien de sensé à afficher dans ce cas).
  // Minuscule car toujours intégré au milieu de la phrase-titre combinée
  // (cf. buildCategoryBlock) : "Le 28 juillet 1794, il y a 232 ans, ...".
  function formatYearsAgo(year) {
    if (!Number.isInteger(year)) return "";
    var diff = new Date().getFullYear() - year;
    if (diff < 0) return "";
    if (diff === 0) return "cette année";
    if (diff === 1) return "il y a 1 an";
    return "il y a " + diff.toLocaleString("fr-FR") + " ans";
  }

  var CATEGORY_ICONS = {
    france: "fa-solid fa-landmark",
    europe: "fa-solid fa-earth-europe",
    world: "fa-solid fa-globe"
  };

  // Bloc accordéon d'une catégorie (France/Europe/Monde) — même visuel que
  // les blocs .ecl-block de views/eclairages.html : titre cliquable replié
  // par défaut, contenu déplié en dessous, "Masquer" en bas. registerBlock
  // (défini plus bas) gère l'accordéon (un seul ouvert à la fois).
  function buildCategoryBlock(categoryKey, dateKey, event) {
    var block = document.createElement("div");
    block.className = "het-block";

    var contentId = "het-block-content-" + categoryKey;
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "het-block-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", contentId);

    var toggleTitle = document.createElement("span");
    toggleTitle.className = "het-block-toggle-title";
    var toggleIcon = document.createElement("i");
    toggleIcon.className = CATEGORY_ICONS[categoryKey] || "fa-solid fa-clock-rotate-left";
    toggleTitle.appendChild(toggleIcon);
    toggleTitle.appendChild(document.createTextNode(" " + (CATEGORY_LABELS[categoryKey] || categoryKey)));
    toggle.appendChild(toggleTitle);

    var chevron = document.createElement("i");
    chevron.className = "fa-solid fa-chevron-down het-block-chevron";
    toggle.appendChild(chevron);

    block.appendChild(toggle);

    var content = document.createElement("div");
    content.className = "het-block-content";
    content.id = contentId;
    content.hidden = true;

    var title = typeof event.title === "string" ? event.title : "";
    var yearDisplay = typeof event.year_display === "string" ? event.year_display : "";

    var body = document.createElement("div");
    body.className = "het-card-body";

    var titleEl = document.createElement("h2");
    titleEl.className = "het-card-title";
    titleEl.textContent = formatEventTitle(dateKey, event);
    body.appendChild(titleEl);

    if (event.summary_short) {
      var summaryShort = document.createElement("p");
      summaryShort.className = "het-card-summary-short";
      summaryShort.textContent = event.summary_short;
      body.appendChild(summaryShort);
    }

    if (event.image_url) {
      var figure = document.createElement("figure");
      figure.className = "het-card-figure";

      var img = document.createElement("img");
      img.className = "het-card-image";
      img.src = event.image_url;
      img.alt = title
        ? "Illustration — " + title + (yearDisplay ? " (" + yearDisplay + ")" : "")
        : "Illustration historique";
      img.loading = "lazy";
      figure.appendChild(img);

      if (title || event.image_page_url) {
        var imageMeta = document.createElement("figcaption");
        imageMeta.className = "het-card-image-meta";

        function appendImageMetaSeparator() {
          if (imageMeta.firstChild) imageMeta.appendChild(document.createTextNode(" / "));
        }

        if (title) {
          var imageCaption = document.createElement("em");
          imageCaption.textContent = title;
          imageMeta.appendChild(imageCaption);
        }

        if (event.image_page_url) {
          appendImageMetaSeparator();
          var imageSourceLink = document.createElement("a");
          imageSourceLink.href = event.image_page_url;
          imageSourceLink.target = "_blank";
          imageSourceLink.rel = "noopener noreferrer";
          imageSourceLink.textContent = "Source de l'image";
          imageMeta.appendChild(imageSourceLink);
        }

        figure.appendChild(imageMeta);
      }

      body.appendChild(figure);
    }

    // "En savoir plus" assemble, dans cet ordre : summary_long, why_it_matters,
    // puis l'anecdote précédée de "Le détail étonnant" — jamais affichée si
    // anecdote_reliability vaut "uncertain" (déjà retirée côté serveur par
    // public-mapper.js, revérifié ici en filet de sécurité).
    var hasMoreToShow = !!(event.summary_long || event.why_it_matters ||
      (event.anecdote && event.anecdote_reliability !== "uncertain"));

    if (hasMoreToShow) {
      var toggleId = "het-summary-long-" + categoryKey;
      // Nommé différemment de "toggle" (le bouton d'en-tête de catégorie,
      // déclaré plus haut) : "var" n'a pas de portée de bloc, un même nom
      // ici écraserait la référence utilisée par registerAccordionBlock plus
      // bas et rendrait l'en-tête de catégorie non cliquable.
      var moreToggle = document.createElement("button");
      moreToggle.type = "button";
      moreToggle.className = "het-card-toggle";
      moreToggle.textContent = "En savoir plus";
      moreToggle.setAttribute("aria-expanded", "false");
      moreToggle.setAttribute("aria-controls", toggleId);
      body.appendChild(moreToggle);

      var moreDetails = document.createElement("div");
      moreDetails.className = "het-card-more";
      moreDetails.id = toggleId;
      moreDetails.hidden = true;

      if (event.summary_long || event.why_it_matters) {
        var moreBlock = document.createElement("div");
        moreBlock.className = "het-card-more-block";

        if (event.summary_long) {
          var summaryLong = document.createElement("p");
          summaryLong.className = "het-card-summary-long";
          summaryLong.textContent = event.summary_long;
          moreBlock.appendChild(summaryLong);
        }

        if (event.why_it_matters) {
          var whyItMatters = document.createElement("p");
          whyItMatters.className = "het-card-why-it-matters";
          whyItMatters.textContent = event.why_it_matters;
          moreBlock.appendChild(whyItMatters);
        }

        moreDetails.appendChild(moreBlock);
      }

      if (event.anecdote && event.anecdote_reliability !== "uncertain") {
        var anecdote = document.createElement("p");
        anecdote.className = "het-card-anecdote";
        var anecdoteLabel = document.createElement("strong");
        anecdoteLabel.textContent = "Le détail étonnant";
        anecdote.appendChild(anecdoteLabel);
        anecdote.appendChild(document.createTextNode(event.anecdote));
        moreDetails.appendChild(anecdote);
      }

      body.appendChild(moreDetails);

      moreToggle.addEventListener("click", function () {
        var isHidden = moreDetails.hidden;
        moreDetails.hidden = !isHidden;
        moreToggle.setAttribute("aria-expanded", isHidden ? "true" : "false");
        moreToggle.textContent = isHidden ? "Réduire" : "En savoir plus";
      });
    }

    if (event.location) {
      var location = document.createElement("p");
      location.className = "het-card-meta";
      var locationLabel = document.createElement("strong");
      locationLabel.textContent = "Lieu : ";
      location.appendChild(locationLabel);
      location.appendChild(document.createTextNode(event.location));
      body.appendChild(location);
    }

    if (event.historical_source_name) {
      var sourceMeta = document.createElement("p");
      sourceMeta.className = "het-card-meta";
      var sourceLabel = document.createElement("strong");
      sourceLabel.textContent = "Source : ";
      sourceMeta.appendChild(sourceLabel);
      sourceMeta.appendChild(document.createTextNode(event.historical_source_name));
      body.appendChild(sourceMeta);
    }

    if (event.historical_source_url) {
      var sourceLink = document.createElement("a");
      sourceLink.className = "het-card-source-link";
      sourceLink.href = event.historical_source_url;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = "Voir la source historique";
      body.appendChild(sourceLink);
    }

    content.appendChild(body);

    var collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.className = "het-block-collapse";
    var collapseIcon = document.createElement("i");
    collapseIcon.className = "fa-solid fa-chevron-up";
    collapseButton.appendChild(collapseIcon);
    collapseButton.appendChild(document.createTextNode(" Masquer"));
    content.appendChild(collapseButton);

    block.appendChild(content);

    registerAccordionBlock(toggle, content, collapseButton);

    return block;
  }

  // Accordéon : un seul bloc ouvert à la fois. openBlocks liste les
  // { toggle, content } déjà enregistrés pour pouvoir refermer les autres
  // quand l'un d'eux s'ouvre — même principe que window.eclRegisterAccordionBlock
  // dans views/eclairages.html, simplifié ici (pas de chargement API différé :
  // les 3 catégories sont déjà toutes chargées ensemble).
  var accordionBlocks = [];
  function registerAccordionBlock(toggle, content, collapseButton) {
    var entry = { toggle: toggle, content: content };
    accordionBlocks.push(entry);

    // Même comportement que views/eclairages.html : ramener le titre de la
    // rubrique juste sous le bandeau sticky (.topbar), qu'on l'ouvre ou
    // qu'on la referme — scrollIntoView le collerait au tout bord haut,
    // partiellement recouvert par le bandeau.
    function scrollToggleIntoView() {
      var topbar = document.querySelector(".topbar");
      var offset = (topbar ? topbar.offsetHeight : 0) + 16;
      var targetTop = window.pageYOffset + toggle.getBoundingClientRect().top - offset;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    }

    function open() {
      accordionBlocks.forEach(function (other) {
        if (other === entry) return;
        other.toggle.setAttribute("aria-expanded", "false");
        other.content.hidden = true;
      });
      toggle.setAttribute("aria-expanded", "true");
      content.hidden = false;
      scrollToggleIntoView();
    }

    function collapse() {
      toggle.setAttribute("aria-expanded", "false");
      content.hidden = true;
      scrollToggleIntoView();
    }

    toggle.addEventListener("click", function () {
      var isOpen = toggle.getAttribute("aria-expanded") === "true";
      if (isOpen) collapse(); else open();
    });
    collapseButton.addEventListener("click", collapse);
  }

  // Catégorie sans événement ce jour-là : on n'affiche rien plutôt qu'une
  // carte "Aucun événement disponible" — seules les catégories réellement
  // renseignées apparaissent.
  function renderEvents(dateKey, events) {
    clearCards();
    accordionBlocks = [];
    CATEGORY_ORDER.forEach(function (categoryKey) {
      var event = events ? events[categoryKey] : null;
      if (event) cardsEl.appendChild(buildCategoryBlock(categoryKey, dateKey, event));
    });
  }

  function loadDate(dateKey) {
    dateDisplay.textContent = formatDateDisplay(dateKey);
    clearCards();
    setStatus("Chargement…", false);

    fetch("/api/historical-events/" + encodeURIComponent(dateKey), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Réponse API inattendue (HTTP " + response.status + ").");
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.events) throw new Error("Réponse API invalide (pas de champ events).");
        setStatus("", false);
        renderEvents(dateKey, data.events);
      })
      .catch(function (error) {
        clearCards();
        setStatus("Impossible de charger les événements du " + formatDateDisplay(dateKey) + " : " + error.message, true);
      });
  }

  // Décale une dateKey ("MM-DD") de N jours — 2024 sert d'année bissextile
  // arbitraire pour que le 29 février existe le temps du calcul, seul le
  // résultat MM-DD est conservé.
  function shiftDateKey(dateKey, deltaDays) {
    var month = Number(dateKey.slice(0, 2));
    var day = Number(dateKey.slice(3, 5));
    var d = new Date(Date.UTC(2024, month - 1, day));
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }

  // input[type=date] a besoin d'une année complète : l'année en cours est
  // utilisée pour l'affichage, sans impact sur le contenu chargé (seul MM-DD
  // est envoyé à l'API, cf. inputValueToDateKey).
  function dateKeyToInputValue(dateKey) {
    return String(new Date().getFullYear()) + "-" + dateKey;
  }

  function inputValueToDateKey(value) {
    return value.slice(5);
  }

  // Jamais de jour "suivant" au-delà d'aujourd'hui : contrairement à
  // parallele-historique.html (bloqué faute de contenu généré à l'avance),
  // rien n'empêcherait techniquement de consulter un jour futur ici (almanach
  // cyclique) — mais uniquement les jours précédents doivent rester
  // consultables, par choix.
  function updateHistoryArrowsState(dateKey) {
    if (historyNextBtn) historyNextBtn.disabled = dateKey >= getParisDateKey();
  }

  function goToDate(dateKey) {
    if (historyDateInput) historyDateInput.value = dateKeyToInputValue(dateKey);
    if (historyTodayBtn) historyTodayBtn.hidden = dateKey === getParisDateKey();
    updateHistoryArrowsState(dateKey);
    loadDate(dateKey);
  }

  if (historyToggle && historyPanel) {
    historyToggle.addEventListener("click", function () {
      var isHidden = historyPanel.hidden;
      historyPanel.hidden = !isHidden;
      historyToggle.setAttribute("aria-expanded", isHidden ? "true" : "false");
    });
  }
  if (historyDateInput) {
    // max empêche le sélecteur natif de proposer un jour futur ; le contrôle
    // ci-dessous couvre la saisie manuelle au clavier, qui peut le contourner.
    historyDateInput.max = dateKeyToInputValue(getParisDateKey());
    historyDateInput.addEventListener("change", function () {
      var value = historyDateInput.value;
      if (!value) return;
      var dateKey = inputValueToDateKey(value);
      goToDate(dateKey > getParisDateKey() ? getParisDateKey() : dateKey);
    });
  }
  if (historyPrevBtn) {
    historyPrevBtn.addEventListener("click", function () {
      goToDate(shiftDateKey(inputValueToDateKey(historyDateInput.value), -1));
    });
  }
  if (historyNextBtn) {
    historyNextBtn.addEventListener("click", function () {
      var target = shiftDateKey(inputValueToDateKey(historyDateInput.value), 1);
      if (target > getParisDateKey()) return;
      goToDate(target);
    });
  }
  if (historyTodayBtn) {
    historyTodayBtn.addEventListener("click", function () {
      goToDate(getParisDateKey());
    });
  }

  // Sélection automatique du bon jour à l'ouverture : date du jour (heure de
  // Paris), sauf ?testDate=MM-DD en développement local (cf. IS_DEV_ENVIRONMENT
  // et resolveInitialDateKey ci-dessus).
  var initialDateKey = resolveInitialDateKey();
  goToDate(initialDateKey);

  // Dégradé + "suite ↓" tant que le bas du panneau (.het-panel) dépasse le
  // viewport — .het-body::after (cf. historical-events-test.css) réserve une
  // grande zone tampon sous le panneau, donc on mesure la position réelle de
  // .het-panel plutôt que document.documentElement.scrollHeight (même
  // principe que attachPageScrollFadeHint dans script.js, dupliqué ici car
  // cette page ne charge pas script.js).
  (function attachScrollFadeHint() {
    var hint = document.createElement("div");
    hint.className = "het-scroll-fade-hint is-hidden";
    hint.innerHTML = '<span class="het-scroll-fade-hint-text">suite <span aria-hidden="true">↓</span></span>';
    document.body.appendChild(hint);
    hint.querySelector(".het-scroll-fade-hint-text").addEventListener("click", function (e) {
      e.stopPropagation();
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
    });

    function update() {
      var panel = document.querySelector(".het-panel");
      var contentEnd = panel ? window.scrollY + panel.getBoundingClientRect().bottom : document.documentElement.scrollHeight;
      var hasOverflow = contentEnd > window.innerHeight + 2;
      var atBottom = window.scrollY + window.innerHeight >= contentEnd - 4;
      hint.classList.toggle("is-hidden", !hasOverflow || atBottom);
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    requestAnimationFrame(update);

    // attributes+attributeFilter:['hidden'] est nécessaire en plus de childList :
    // ouvrir/fermer un bloc accordéon ne fait que basculer l'attribut "hidden"
    // sur du contenu déjà présent dans le DOM, ce que childList seul ne détecte pas.
    var mutationFrame = null;
    new MutationObserver(function () {
      if (mutationFrame) return;
      mutationFrame = requestAnimationFrame(function () {
        mutationFrame = null;
        update();
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  })();
})();
