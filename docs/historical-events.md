# Base d'événements historiques quotidiens

Architecture isolée pour une future fonctionnalité "Ce jour-là" : jusqu'à
3 événements par jour de l'année (un par catégorie `france` / `europe` /
`world`). Rien n'est encore branché sur les routes publiques ni sur
l'interface — ceci ne met en place que les fondations données/outillage.

## Fichiers

- `data/historical-events/events.json` — source de vérité éditoriale (tableau
  d'événements). Vide pour l'instant (`[]`), à remplir progressivement.
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
image_credit, image_rights_verified, content_warnings, review_status, notes`.

`date_key` est toujours `MM-DD` (dérivé de `month`/`day`, vérifié par le
validateur). `id` : minuscules/chiffres/tirets uniquement.

### Valeurs autorisées

- `category` : `france`, `europe`, `world`
- `period` : `antiquity`, `middle_ages`, `early_modern`, `revolution_19th`,
  `20th_century`, `21st_century`
- `review_status` : `draft`, `reviewed`, `validated`, `rejected`
- `date_certainty` : `high`, `medium`, `low`
- `historical_importance` / `narrative_strength` / `image_relevance` :
  entiers 1 à 5

### Règles du validateur

- dates plausibles (`month` 1-12, `day` valide pour ce mois, 29 février
  toléré) et `date_key` cohérent avec `month`/`day`
- valeurs autorisées pour `category`, `period`, `review_status`,
  `date_certainty`
- pas de doublon : ni `id` en double, ni deux événements sur le même couple
  `date_key`/`category` (donc jamais plus d'un événement par catégorie et par
  jour, soit 3 maximum)
- URLs (`historical_source_url`, `secondary_source_url`, `image_source_url`,
  `image_original_url`, `image_license_url`) au format `http(s)://…` quand
  renseignées ; `historical_source_url` et `historical_source_name`
  obligatoires (source primaire)
- `summary_short` et `summary_long` non vides et dans les bornes de longueur
- `image_license` obligatoire si `image_rights_verified` est vrai
- `image_filename` obligatoire si `review_status = "validated"`
- `date_certainty = "high"` obligatoire si `review_status = "validated"`

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

### Routeur API préparé (non branché)

`routes/historical-events.js` exporte `createHistoricalEventsRouter()` — un
`express.Router()` autonome avec `GET /today` et `GET /:dateKey`
(`?onlyValidated=true` en option). Il n'est chargé par aucun fichier
existant. Pour le brancher plus tard, dans `server.js`, ajouter (2 lignes,
après les autres `require`/`app.use`) :

```js
const { createHistoricalEventsRouter } = require("./routes/historical-events");
app.use("/api/historical-events", createHistoricalEventsRouter());
```

## Reste à faire

- Peupler `data/historical-events/events.json` (365/366 jours × jusqu'à 3
  catégories) — volontairement non fait ici.
- Exécuter la migration SQL sur Supabase (manuel, non fait ici).
- Lancer un premier `--live` une fois des événements `validated` présents.
- Décider et brancher la route API + l'affichage produit (aucune route ni
  vue modifiée par ce chantier).
- Décider si `credits.csv` reste un outil de travail ponctuel ou si son
  contenu doit être fusionné automatiquement dans `events.json` (pas de
  script de fusion pour l'instant, fusion manuelle).
