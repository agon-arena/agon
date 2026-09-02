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

test('le tableau horizontal affiche Apprentissage, État et Niveau sans ancrage ni suppression', () => {
  const source = functionSource('renderMesQcmTableHtml', 'renderMesQcmPaginatedTablesHtml');
  assert.match(source, /<th>Apprentissage<\/th><th>État<\/th><th>Niveau<\/th>/);
  assert.doesNotMatch(source, /<th>Ancrage<\/th>/);
  assert.doesNotMatch(source, /data-mesqcm-delete-index/);
  assert.doesNotMatch(source, /qcm-mesqcm-row-checkbox/);
  assert.match(source, /En attente de<br>réalisation/);
  assert.match(source, /En cours<br>/);
  assert.doesNotMatch(source, /En cours \(/);
  assert.match(source, /elementaire: 'Élémentaire'/);
  assert.match(source, /avance: 'Approfondi'/);
  assert.match(source, /expert: 'Expert'/);
  assert.match(source, /qcm-mesqcm-level-count/);
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
  const normalizer = functionSource('normalizeMesAcquisThemeLabel', 'renderMesAcquisList');
  const renderer = functionSource('renderMesAcquisList', 'loadMesAcquis');
  assert.match(normalizer, /key === 'culture'/);
  assert.match(normalizer, /key === 'arts et culture'/);
  assert.match(normalizer, /return 'Culture - arts'/);
  assert.match(renderer, /primaryTheme = normalizeMesAcquisThemeLabel\(primaryTheme\)/);
});

test('le serveur transmet le niveau effectif de chaque apprentissage', () => {
  const routeStart = server.indexOf('app.get("/api/users/notion-quizzes",');
  const routeEnd = server.indexOf('app.get("/api/users/notion-quizzes/fiche",', routeStart);
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /level: effectiveLevel/);
});
