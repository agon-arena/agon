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

  var monthSelect = document.getElementById("het-date-month");
  var daySelect = document.getElementById("het-date-day");
  var dateDisplay = document.getElementById("het-date-display");
  var statusEl = document.getElementById("het-status");
  var cardsEl = document.getElementById("het-cards");

  var MONTH_NAMES = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre"
  ];

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function populateMonthSelect() {
    MONTH_NAMES.forEach(function (name, index) {
      var option = document.createElement("option");
      option.value = pad2(index + 1);
      option.textContent = name;
      monthSelect.appendChild(option);
    });
  }

  // Reconstruit les options du menu "jour" selon le mois choisi (28/29/30/31
  // jours) — en conservant le jour déjà sélectionné s'il reste valide dans le
  // nouveau mois, sinon en le ramenant au dernier jour valide (ex. 31 -> 30).
  function populateDaySelect(month, preferredDay) {
    var daysInMonth = DAYS_IN_MONTH[month - 1];
    var targetDay = Math.min(preferredDay || 1, daysInMonth);
    while (daySelect.firstChild) daySelect.removeChild(daySelect.firstChild);
    for (var day = 1; day <= daysInMonth; day++) {
      var option = document.createElement("option");
      option.value = pad2(day);
      option.textContent = String(day);
      if (day === targetDay) option.selected = true;
      daySelect.appendChild(option);
    }
  }

  function currentDateKeyFromSelects() {
    return monthSelect.value + "-" + daySelect.value;
  }

  function setSelectsFromDateKey(dateKey) {
    var month = Number(dateKey.slice(0, 2));
    var day = Number(dateKey.slice(3, 5));
    monthSelect.value = pad2(month);
    populateDaySelect(month, day);
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
    statusEl.textContent = text || "";
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

  // "il y a N ans" par rapport à l'année en cours — year peut être négatif
  // (avant J.-C., cf. validateEvent) : la soustraction reste correcte telle
  // quelle. Pas de texte si l'année est absente/invalide ou dans le futur
  // (rien de sensé à afficher dans ce cas).
  function formatYearsAgo(year) {
    if (!Number.isInteger(year)) return "";
    var diff = new Date().getFullYear() - year;
    if (diff < 0) return "";
    if (diff === 0) return "Cette année";
    if (diff === 1) return "Il y a 1 an";
    return "Il y a " + diff.toLocaleString("fr-FR") + " ans";
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
  function buildCategoryBlock(categoryKey, event) {
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

    if (event.image_url) {
      var img = document.createElement("img");
      img.className = "het-card-image";
      img.src = event.image_url;
      img.alt = title
        ? "Illustration — " + title + (yearDisplay ? " (" + yearDisplay + ")" : "")
        : "Illustration historique";
      img.loading = "lazy";
      content.appendChild(img);
    }

    var body = document.createElement("div");
    body.className = "het-card-body";

    if (yearDisplay) {
      var year = document.createElement("p");
      year.className = "het-card-year";
      year.textContent = yearDisplay;
      body.appendChild(year);
    }

    var yearsAgoText = formatYearsAgo(event.year);
    if (yearsAgoText) {
      var yearsAgo = document.createElement("p");
      yearsAgo.className = "het-card-years-ago";
      yearsAgo.textContent = yearsAgoText;
      body.appendChild(yearsAgo);
    }

    var titleEl = document.createElement("h2");
    titleEl.className = "het-card-title";
    titleEl.textContent = title;
    body.appendChild(titleEl);

    if (event.summary_short) {
      var summaryShort = document.createElement("p");
      summaryShort.className = "het-card-summary-short";
      summaryShort.textContent = event.summary_short;
      body.appendChild(summaryShort);
    }

    // "En savoir plus" assemble, dans cet ordre : summary_long, why_it_matters,
    // puis l'anecdote précédée de "Le détail étonnant" — jamais affichée si
    // anecdote_reliability vaut "uncertain" (déjà retirée côté serveur par
    // public-mapper.js, revérifié ici en filet de sécurité).
    var hasMoreToShow = !!(event.summary_long || event.why_it_matters ||
      (event.anecdote && event.anecdote_reliability !== "uncertain"));

    if (hasMoreToShow) {
      var toggleId = "het-summary-long-" + categoryKey;
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "het-card-toggle";
      toggle.textContent = "En savoir plus";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", toggleId);
      body.appendChild(toggle);

      var moreDetails = document.createElement("div");
      moreDetails.className = "het-card-more";
      moreDetails.id = toggleId;
      moreDetails.hidden = true;

      if (event.summary_long) {
        var summaryLong = document.createElement("p");
        summaryLong.className = "het-card-summary-long";
        summaryLong.textContent = event.summary_long;
        moreDetails.appendChild(summaryLong);
      }

      if (event.why_it_matters) {
        var whyItMatters = document.createElement("p");
        whyItMatters.className = "het-card-why-it-matters";
        whyItMatters.textContent = event.why_it_matters;
        moreDetails.appendChild(whyItMatters);
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

      toggle.addEventListener("click", function () {
        var isHidden = moreDetails.hidden;
        moreDetails.hidden = !isHidden;
        toggle.setAttribute("aria-expanded", isHidden ? "true" : "false");
        toggle.textContent = isHidden ? "Réduire" : "En savoir plus";
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

    if (event.image_credit) {
      var credit = document.createElement("p");
      credit.className = "het-card-credit";
      credit.textContent = event.image_credit;
      body.appendChild(credit);
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

    function open() {
      accordionBlocks.forEach(function (other) {
        if (other === entry) return;
        other.toggle.setAttribute("aria-expanded", "false");
        other.content.hidden = true;
      });
      toggle.setAttribute("aria-expanded", "true");
      content.hidden = false;
    }

    function collapse() {
      toggle.setAttribute("aria-expanded", "false");
      content.hidden = true;
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
      if (event) cardsEl.appendChild(buildCategoryBlock(categoryKey, event));
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

  // Changer le mois reconstruit d'abord la liste des jours valides (28-31
  // selon le mois) avant de recharger — sinon un jour comme "31" resterait
  // sélectionné en passant sur un mois qui n'en compte pas autant.
  monthSelect.addEventListener("change", function () {
    populateDaySelect(Number(monthSelect.value), Number(daySelect.value));
    loadDate(currentDateKeyFromSelects());
  });
  daySelect.addEventListener("change", function () {
    loadDate(currentDateKeyFromSelects());
  });

  // Sélection automatique du bon jour à l'ouverture : date du jour (heure de
  // Paris), sauf ?testDate=MM-DD en développement local (cf. IS_DEV_ENVIRONMENT
  // et resolveInitialDateKey ci-dessus).
  populateMonthSelect();
  var initialDateKey = resolveInitialDateKey();
  setSelectsFromDateKey(initialDateKey);
  loadDate(initialDateKey);
})();
