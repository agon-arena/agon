const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'views', 'qcm-du-jour.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function functionSource(name, nextName) {
  const start = page.indexOf(`function ${name}(`);
  const end = page.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} doit exister`);
  assert.notEqual(end, -1, `${nextName} doit délimiter la fonction`);
  return page.slice(start, end);
}

test('le tableau horizontal classique conserve Apprentissage, État et Niveau sans ancrage ni suppression', () => {
  const source = functionSource('renderMesQcmTableHtml', 'renderMesQcmPaginatedTablesHtml');
  assert.match(source, /<thead><tr><th><\/th><th>État<\/th><th>Niveau<\/th><\/tr><\/thead><tbody>/);
  assert.doesNotMatch(source, /<th>Ancrage<\/th>/);
  assert.doesNotMatch(source, /data-mesqcm-delete-index/);
  assert.doesNotMatch(source, /qcm-mesqcm-row-checkbox/);
  assert.match(page, /function renderMesQcmStateHtml\(q, questionCount\)/);
  assert.match(page, /En attente de<br>réalisation/);
  assert.match(page, /En cours<br>/);
  assert.doesNotMatch(source, /En cours \(/);
  assert.match(page, /function formatMesQcmLevelLabel\(level\) \{\s*\n\s*var tableLevelLabels = \{ elementaire: 'Élémentaire', avance: 'Approfondi', expert: 'Expert' \};/);
  assert.match(page, /function renderMesQcmLevelHtml\(q, questionCount\)[\s\S]*?formatMesQcmLevelLabel\(displayLevel\)/);
  assert.match(page, /function renderMesQcmLevelHtml\(q, questionCount\)[\s\S]*?qcm-mesqcm-level-count/);
  assert.match(page, /th:nth-child\(1\),[\s\S]*?td:nth-child\(1\)\s*\{\s*width: 45%;/);
  assert.match(page, /th:nth-child\(2\),[\s\S]*?td:nth-child\(2\)\s*\{\s*width: 30%;/);
  assert.match(page, /th:nth-child\(3\),[\s\S]*?td:nth-child\(3\)\s*\{\s*width: 25%;\s*position: relative;\s*left: -2px;/);
});

test('le mode détail inline masque État et Niveau et ne garde que les actions sous la ligne', () => {
  const source = functionSource('renderMesQcmTableHtml', 'renderMesQcmPaginatedTablesHtml');
  const visualRenderer = functionSource('renderMesQcmNameVisualHtml', 'renderMesQcmInlineDetailRowHtml');
  const detailRenderer = functionSource('renderMesQcmInlineDetailRowHtml', 'renderMesQcmTableHtml');
  const signatureRenderer = functionSource('mesQcmListSignature', 'mesQcmTrackingSlotIdentity');
  const hydrateRenderer = functionSource('hydrateVisibleMesQcmNameThumbs', 'compareMesQcmByStateThenName');
  const listRenderer = functionSource('renderMesQcmList', 'scrollToAndBlinkMesQcmRow');
  assert.match(source, /qcm-mesqcm-table--inline-details/);
  assert.match(source, /\? '<tbody>'/);
  assert.doesNotMatch(source, /<thead><tr><th>Apprentissage<\/th><\/tr><\/thead><tbody>/);
  assert.match(source, /data-mesqcm-toggle-index/);
  assert.match(source, /renderMesQcmNameVisualHtml\(q, meta, index\)/);
  assert.match(visualRenderer, /qcm-mesqcm-name-thumb/);
  assert.match(visualRenderer, /q\.image && q\.image\.url/);
  assert.match(visualRenderer, /data-mesqcm-thumb-index/);
  assert.match(visualRenderer, /qcm-mesqcm-name-thumb-fallback/);
  assert.match(signatureRenderer, /quiz\.image && quiz\.image\.url/);
  assert.match(hydrateRenderer, /fetchFicheImageForNoesFallback\(q\)/);
  assert.match(hydrateRenderer, /mesQcmThumbImageCache/);
  assert.match(page, /hydrateVisibleMesQcmNameThumbs\(quizzes\)/);
  assert.doesNotMatch(detailRenderer, /qcm-mesqcm-detail-label">État/);
  assert.doesNotMatch(detailRenderer, /qcm-mesqcm-detail-label">Niveau/);
  assert.match(detailRenderer, /q\.inProgress \? 'Continuer' : 'Commencer'/);
  assert.match(detailRenderer, /Consulter les connaissances/);
  assert.match(detailRenderer, /data-mesqcm-fiche-index/);
  assert.match(detailRenderer, /data-mesqcm-start-index/);
  assert.doesNotMatch(detailRenderer, /Options/);
  assert.match(page, /data-mesqcm-fiche-index/);
  assert.match(page, /openMesQcmFiche\(q\)/);
  assert.match(page, /data-mesqcm-start-index/);
  assert.match(page, /loadSlot\(q\.slot, q\.quizDate, q\.label, q\.level\)/);
  assert.match(listRenderer, /renderMesQcmPaginatedTablesHtml\(todayQuizzes, quizzes, false, \{ inlineDetails: true \}\)/);
  assert.match(listRenderer, /renderMesQcmPaginatedTablesHtml\(notStartedQuizzes, quizzes, false, \{ inlineDetails: true \}\)/);
  assert.match(listRenderer, /renderMesQcmPaginatedTablesHtml\(inProgressRestQuizzes, quizzes, false, \{ inlineDetails: true \}\)/);
});

test('les apprentissages en cours de création affichent uniquement leur état dans le détail déroulé', () => {
  const source = functionSource('renderCreatingNotionQuizzesHtml', 'pendingNotionQuizMessage');
  assert.match(source, /qcm-mesqcm-table--inline-details/);
  assert.match(source, /qcm-mesqcm-table qcm-mesqcm-table--inline-details"><tbody>/);
  assert.doesNotMatch(source, /<thead><tr><th>Apprentissage<\/th><\/tr><\/thead><tbody>/);
  assert.match(source, /data-creating-toggle/);
  assert.match(source, /qcm-mesqcm-detail-label">État/);
  assert.doesNotMatch(source, /qcm-mesqcm-detail-label">Niveau/);
  assert.doesNotMatch(source, /pendingCreationLevelHtml/);
  assert.doesNotMatch(source, /Niveau en préparation/);
  assert.doesNotMatch(source, /<th>État<\/th>/);
});

test('les apprentissages proposés restent un clic direct de mémorisation, sans détail État/Niveau', () => {
  const source = functionSource('renderLearnNextInlineList', 'appendLearnNextItems');
  assert.match(source, /qcm-mesqcm-name-btn qcm-learn-next-inline-item" data-index="/);
  assert.match(source, /qcm-mesqcm-name-title/);
  assert.match(source, /qcm-mesqcm-name-theme-icon/);
  assert.match(source, /qcm-mesqcm-name-label/);
  assert.match(source, /learnNextVisible\[parseInt\(btn\.getAttribute\('data-index'\), 10\)\]/);
  assert.doesNotMatch(source, /data-learn-next-toggle-index/);
  assert.doesNotMatch(source, /qcm-learn-next-inline-detail/);
  assert.doesNotMatch(source, /Préconisé/);
  assert.doesNotMatch(source, /data-learn-next-adopt-index/);
});

test('la connaissance ouverte conserve son ancrage et sa suppression', () => {
  const source = functionSource('openMesQcmActionMenu', 'formatNoesVttTime');
  assert.match(source, /<span>Ancrage<\/span>/);
  assert.match(source, /Supprimer cet apprentissage/);
  assert.match(source, /data-action="delete"/);
});

test('les rubriques de Mes acquis reprennent les icônes thématiques d’Explorer', () => {
  const renderer = functionSource('renderMesAcquisList', 'loadMesAcquis');
  const iconMapper = functionSource('getMesAcquisThemeIconClass', 'renderMesAcquisList');
  assert.match(renderer, /getMesAcquisThemeIconClass\(theme\).*qcm-mesqcm-theme-icon/);
  assert.match(iconMapper, /'Politique': 'fa-scale-balanced'/);
  assert.match(iconMapper, /'International': 'fa-globe'/);
  assert.match(iconMapper, /'Culture - arts': 'fa-palette'/);
  assert.match(iconMapper, /'Histoire': 'fa-landmark'/);
  assert.match(iconMapper, /'Sciences - technologie': 'fa-flask'/);
  assert.match(page, /\.qcm-mesqcm-theme-icon\s*\{/);
});

test('les anciens libellés Culture et Arts sont réunis dans une seule rubrique', () => {
  const normalizer = functionSource('normalizeKnowledgeThemeLabel', 'renderMesAcquisList');
  const renderer = functionSource('renderMesAcquisList', 'loadMesAcquis');
  assert.match(page, /'culture arts': 'Culture'/);
  assert.match(page, /'arts et culture': 'Culture'/);
  assert.match(normalizer, /return LEGACY_HYBRID_THEME_KEY_TO_GALAXY\[key\] \|\| raw;/);
  assert.match(renderer, /primaryTheme = normalizeKnowledgeThemeLabel\(primaryTheme\)/);
});

test('le serveur transmet le niveau effectif de chaque apprentissage', () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes",');
  const routeEnd = server.indexOf('app.get("/api/users/notion-quizzes/fiche",', routeStart);
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /level: effectiveLevel/);
});
