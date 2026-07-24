# Base d'événements historiques quotidiens

Architecture pour la fonctionnalité "Ce jour-là" : jusqu'à 4 événements par
jour de l'année (un par catégorie `france` / `europe` / `world` /
`culture_science`). Branchée sur une route API (`/api/historical-events`) et
une page de test isolée (`/historical-events-test`, non liée à l'accueil) —
cf. section "Routeur API" plus bas.

## Lots de données externes ("cartes-jour-annee-aout-semaine-1" et suivants)

Un lot externe (dossier `index.json` + `schema.json` + `days/MM-DD.json`,
un objet par catégorie avec `why_it_matters`, `anecdote`,
`anecdote_reliability`, `tags`, `sources[]`) se fusionne dans
`events.json` via :

```bash
node tools/historical-events-merge-daily-batch.js <dossier-source> --write
```

Dry-run par défaut (sans `--write`). `--force` autorise le remplacement d'un
événement déjà présent sur le même `date_key`/`category`. Le script corrige
automatiquement (avec avertissement journalisé) toute incohérence entre la
clé de catégorie du fichier jour et le champ `category` interne de
l'événement — la clé fait foi, car c'est elle qui définit l'emplacement réel
dans l'interface.

La source primaire (`historical_source_name`/`_url`, obligatoires) est
dérivée de `sources[0]` ; `sources[1]` alimente la source secondaire. Les
champs de notation éditoriale (`date_certainty`, `historical_importance`,
`narrative_strength`, `image_relevance`, `image_rights_verified`), absents
de ces lots, sont laissés à `null` plutôt que d'inventer une valeur — le
validateur les accepte désormais en optionnel (stricts uniquement quand
renseignés).

## Fichiers

- `data/historical-events/events.json` — source de vérité éditoriale (tableau
  d'événements), à remplir progressivement. 24 événements à ce stade (12 mars
  + 1-7 août).
- `tools/historical-events-merge-daily-batch.js` — fusionne un lot externe
  "jour par jour" (`index.json` + `days/MM-DD.json`) dans `events.json`.
  Dry-run par défaut ; `--write` pour écrire, `--force` pour remplacer un
  créneau `date_key`/`category` déjà occupé.
- `data/historical-events/credits.csv` — feuille de calcul dédiée au suivi des
  droits/crédits image (une ligne par `id`), pratique pour la recherche
  d'images avant de reporter les champs `image_*` dans `events.json`.
- `public/images/historical-events/` — dossier de destination des images une
  fois les droits vérifiés (vide pour l'instant, `.gitkeep` seul).
- `lib/historical-events/constants.js` — catégories, périodes, statuts,
  niveaux de certitude, bornes de notation et de longueur.
- `lib/historical-events/validator.js` — `validateEvent(event)` (un événement)
  et `validateDataset(events)` (jeu complet + détection des doublons).
- `tools/historical-events-audit.js` — audit hors-ligne : validation +
  couverture par jour/statut. Aucun accès réseau.
- `tools/historical-events-import.js` — import vers Supabase. **Dry-run par
  défaut** (aucune connexion réseau) ; le mode réel n'est déclenché qu'avec
  `--live`, et refuse d'importer si le jeu de données ne valide pas.
- `data/migration-historical-events.sql` — SQL de création de la table
  `historical_events`, à exécuter manuellement dans le SQL editor Supabase
  (jamais exécuté automatiquement, suit la convention des autres
  `data/migration-*.sql` du projet).
- `test/historical-events.test.js` — tests du validateur (`node --test`).

## Champs d'un événement

`id, month, day, date_key, category, year, year_display, period, title,
summary_short, summary_long, location, historical_source_name,
historical_source_url, secondary_source_name, secondary_source_url,
date_certainty, historical_importance, narrative_strength, image_relevance,
image_filename, image_source_url, image_original_url, image_author,
image_date, image_institution, image_license, image_license_url,
image_credit, image_rights_verified, content_warnings, review_status, notes,
why_it_matters, anecdote, anecdote_reliability, tags, sources`.

`date_key` est toujours `MM-DD` (dérivé de `month`/`day`, vérifié par le
validateur). `id` : minuscules/chiffres/tirets uniquement.

`date_certainty`, `historical_importance`, `narrative_strength`,
`image_relevance`, `image_rights_verified`, `why_it_matters`, `anecdote`,
`anecdote_reliability`, `tags` et `sources` sont **optionnels** au niveau du
validateur générique (les événements du workflow éditorial complet n'ont pas
les champs narratifs, les lots externes légers n'ont pas les notations) —
mais strictement validés dès qu'ils sont renseignés.

### Valeurs autorisées

- `category` : `france`, `europe`, `world`, `culture_science`
- `period` : `antiquity`, `middle_ages`, `renaissance`, `early_modern`,
  `french_revolution`, `revolution_empire`, `revolution_19th`,
  `world_war_1`, `world_war_2`, `decolonization`, `20th_century`,
  `21st_century`, `contemporary`
- `review_status` : `draft`, `reviewed`, `validated`, `rejected`
- `date_certainty` : `high`, `medium`, `low` (ou absent)
- `anecdote_reliability` : `well_attested`, `traditional`, `debated`,
  `uncertain` (ou absent — mais obligatoire dès qu'`anecdote` est renseigné).
  **`uncertain` n'est jamais exposée publiquement** : `public-mapper.js`
  retire le texte de l'anecdote avant même l'API, ce n'est pas qu'un masquage
  côté interface.
- `historical_importance` / `narrative_strength` / `image_relevance` :
  entiers 1 à 5 (ou absent)
- `sources` : tableau de `{ title, url }` (12 maximum) — alternative à
  `historical_source_name`/`_url` pour les lots qui n'utilisent pas ce
  vocabulaire
- `tags` : tableau de chaînes (60 caractères max chacune)

### Règles du validateur

- dates plausibles (`month` 1-12, `day` valide pour ce mois, 29 février
  toléré) et `date_key` cohérent avec `month`/`day`
- valeurs autorisées pour `category`, `period`, `review_status`,
  `date_certainty`, `anecdote_reliability`
- pas de doublon : ni `id` en double, ni deux événements sur le même couple
  `date_key`/`category` (donc jamais plus d'un événement par catégorie et par
  jour, soit 4 maximum)
- URLs (`historical_source_url`, `secondary_source_url`, `image_source_url`,
  `image_original_url`, `image_license_url`, `sources[].url`) au format
  `http(s)://…` quand renseignées ; `historical_source_url` et
  `historical_source_name` obligatoires (source primaire — dérivée de
  `sources[0]` par le script de fusion pour les lots externes)
- `summary_short` et `summary_long` non vides et dans les bornes de longueur
- `image_license` obligatoire si `image_rights_verified` est vrai
- `image_filename` obligatoire si `review_status = "validated"`
- `date_certainty = "high"` obligatoire si `review_status = "validated"`
- `anecdote_reliability` obligatoire dès qu'`anecdote` est renseignée

## Commandes

```bash
# Tests du validateur
npm run test:historical-events

# Audit du jeu de données (validation + couverture par jour/statut)
npm run audit:historical-events

# Import Supabase — dry-run (aucun réseau, par défaut)
node tools/historical-events-import.js

# Import Supabase — réel (nécessite SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
# et que la table existe déjà, cf. migration SQL ci-dessous)
node tools/historical-events-import.js --live
```

La migration `data/migration-historical-events.sql` doit être collée une
fois dans le SQL editor de Supabase avant tout `--live` (non exécutée par ce
chantier).

## Lecture des données (repository, service, mapper)

Modules isolés, sans accès réseau ni appel IA, qui lisent uniquement
`data/historical-events/events.json` :

- `lib/historical-events/repository.js` — `createHistoricalEventsRepository()`.
  Charge et **valide au chargement** (via `validateDataset` du validateur
  existant) le fichier local, met le résultat en cache mémoire, puis expose
  `getAll()`, `getByDateKey(dateKey, { onlyValidated })`,
  `getByMonthDay(month, day, { onlyValidated })`,
  `getTodayEvents({ now, onlyValidated })` (date injectable). Les événements
  `rejected` sont **toujours** exclus dès l'indexation. Chaque événement
  retourné est une copie superficielle (jamais l'objet mis en cache) : aucune
  mutation d'un appelant ne peut atteindre le cache. JSON invalide ou dataset
  qui échoue au validateur → erreur explicite (`Error` avec message clair),
  jamais un plantage silencieux.
- `lib/historical-events/service.js` — `createHistoricalEventsService()`.
  Construit la vue « jour » publique : `{ date_key, events: { france, europe,
  world } }`, catégories toujours dans cet ordre, `null` si absente.
  `getEventsForDateKey`, `getEventsForMonthDay`, `getTodayEvents` (date
  injectable, mêmes options que le repository).
- `lib/historical-events/public-mapper.js` — `toPublicEvent(event)` : retire
  les champs internes (`review_status`, `notes`, `date_certainty`,
  `historical_importance`, `narrative_strength`, `image_relevance`,
  `image_filename` brut, `image_source_url`, `image_original_url`,
  `image_rights_verified`, `month`/`day`/`date_key`) et ajoute `image_url`
  (URL locale sûre, ou `null`).
- `lib/historical-events/image-path.js` — `buildLocalImageUrl(filename)` /
  `isSafeImageFilename(filename)` : whitelist stricte de noms de fichiers à
  plat (`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.(jpg|jpeg|png|webp|avif|gif)$`),
  rejette `..`, chemins absolus, séparateurs, caractères de contrôle. Aucun
  accès disque : pure validation de chaîne, préfixée par
  `/images/historical-events/` (le dossier `public/` est servi tel quel par
  Express, cf. `server.js:149`).

### Format de sortie public

```json
{
  "date_key": "03-12",
  "events": {
    "france": { "id": "...", "title": "...", "image_url": "/images/historical-events/....jpg", "...": "..." },
    "europe": null,
    "world": null
  }
}
```

### Routeur API (branché)

`routes/historical-events.js` exporte `createHistoricalEventsRouter()`,
monté dans `server.js` sur `/api/historical-events` : `GET /today` et
`GET /:dateKey` (`?onlyValidated=true` en option).

### Page de test isolée

`GET /historical-events-test` sert `views/historical-events-test.html`
(`public/historical-events-test-page.js` + `.css`, jamais chargés par
`script.js`/`style.css`) — sélectionne automatiquement la date du jour
(heure de Paris), avec un champ de saisie manuelle pour tester n'importe
quelle date. En développement local (`localhost`/`127.0.0.1` uniquement),
`?testDate=MM-DD` force la date au chargement — ignoré sur tout autre nom
d'hôte (donc jamais actif sur le site déployé).

## Reste à faire

- Peupler le reste de `data/historical-events/events.json` (365/366 jours ×
  jusqu'à 4 catégories) — 8 jours couverts à ce stade (12 mars + 1-7 août).
- Exécuter la migration SQL mise à jour sur Supabase si `--live` doit être
  utilisé (non fait ici, l'API publique lit directement le fichier local).
- Décider si l'affichage doit rejoindre l'accueil ou rester une page de test
  isolée à terme.
- Décider si `credits.csv` reste un outil de travail ponctuel ou si son
  contenu doit être fusionné automatiquement dans `events.json` (pas de
  script de fusion pour l'instant, fusion manuelle).
