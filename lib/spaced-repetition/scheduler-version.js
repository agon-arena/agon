// Choix de version du moteur FSRS, à relire avant toute mise à jour de
// ts-fsrs. Vérifié le 16/08/2026 (npm registry ts-fsrs, GitHub
// open-spaced-repetition/ts-fsrs issue #373 "TS-FSRS v6 Roadmap") :
//
// - Dernière version stable publiée : ts-fsrs 5.4.1, modèle FSRS-6
//   (FSRSVersion runtime : "v5.4.1 using FSRS-6.0"). C'est la version
//   installée ici (package.json, --save-exact).
// - Une préversion existe (ts-fsrs 6.0.0-beta.4, dist-tag "beta") mais reste
//   un beta, jamais recommandé pour une base de données de production.
// - FSRS-7 (35 poids, double courbe d'oubli long/court terme) est un modèle
//   PUBLIÉ dans la recherche (open-spaced-repetition/srs-benchmark) mais
//   PAS ENCORE implémenté dans ts-fsrs à ce jour : la case "FSRS-7" de la
//   TODO list de l'issue #373 est explicitement décochée, alors que FSRS-6/
//   5/4.5/4/3 sont tous cochés "fait". Aucune version stable ni beta de
//   ts-fsrs n'expose donc de modèle FSRS-7 utilisable.
// - Conséquence : ce projet utilise FSRS-6 via ts-fsrs 5.4.1 maintenant,
//   jamais une réimplémentation maison des équations FSRS-7 (interdit par
//   la spec — seule une implémentation officielle/stable fait foi). Migrer
//   vers FSRS-7 plus tard consistera à changer SCHEDULER_MODEL_ID une fois
//   ts-fsrs l'exposera, sans toucher au schéma (cf. notes ci-dessous) ni
//   perdre l'historique déjà écrit sous FSRS-6.
//
// Le schéma (memory_item_fsrs_states, memory_review_events) est conçu pour
// rester valide au changement de modèle, SANS migration destructive :
// - due_at est un TIMESTAMPTZ (échéance exacte), jamais un simple compteur
//   de jours entiers — même si FSRS-6 calcule aujourd'hui des intervalles à
//   la journée près en interne (next_interval() renvoie un entier de jours
//   côté ts-fsrs 5.x), la colonne elle-même n'encode aucune hypothèse
//   d'entier : un futur modèle à intervalles fractionnaires (FSRS-7) y
//   écrira une échéance plus précise sans changement de type.
// - Aucune colonne "interval_days INTEGER" n'est la source de vérité : si un
//   intervalle est un jour affiché en debug, il est dérivé de
//   (due_at - last_review_at) au moment de la lecture, jamais stocké comme
//   entier figé.
// - Chaque ligne memory_item_fsrs_states ET chaque memory_review_events
//   porte scheduler_model_id (ex. "ts-fsrs@5.4.1:fsrs-6") : un changement de
//   modèle ne réécrit jamais l'historique passé, il ne fait que faire
//   avancer ce tag sur les nouvelles écritures — des lignes de modèles
//   différents coexistent, comme n'importe quel scheduler de répétition
//   espacée qui change de version en production.
// - memory_review_events conserve reviewed_at en TIMESTAMPTZ (précision
//   native Postgres, largement sous la seconde) et n'a jamais de contrainte
//   d'unicité par jour : plusieurs reviews réelles du même MemoryItem le
//   même jour créent plusieurs lignes distinctes, jamais fusionnées.
const SCHEDULER_MODEL_ID = "ts-fsrs@5.4.1:fsrs-6";

module.exports = {
  SCHEDULER_MODEL_ID
};
