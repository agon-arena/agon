"use strict";

// Routeur Express dédié à la lecture de la base statique d'événements
// historiques. Volontairement NON monté sur l'app principale : ce fichier ne
// modifie et ne dépend jamais de server.js (cf. docs/historical-events.md
// pour le brancher plus tard, en 2 lignes).
//
// GET /today                  -> vue du jour (date serveur)
// GET /:dateKey (format MM-DD) -> vue d'un jour donné
// Query commun : ?onlyValidated=true pour ne garder que review_status="validated".

const express = require("express");
const { createHistoricalEventsService } = require("../lib/historical-events/service");
const { DATE_KEY_PATTERN } = require("../lib/historical-events/constants");

function createHistoricalEventsRouter(options = {}) {
  const { service = createHistoricalEventsService() } = options;
  const router = express.Router();

  function handle(res, buildResult) {
    // Promise.resolve(...).then(buildResult) gère aussi bien un résultat
    // synchrone qu'une Promise : le service est async depuis l'ajout du
    // repli d'image Wikipedia (cf. lib/historical-events/service.js), mais
    // cette fonction reste écrite pour ne pas dépendre de ce détail.
    Promise.resolve()
      .then(buildResult)
      .then((result) => res.json(result))
      .catch((err) => {
        // Erreur de lecture/validation du fichier local (JSON invalide, dataset
        // invalide, etc.) : jamais de fuite de stack, message clair seulement.
        res.status(500).json({ error: err.message });
      });
  }

  router.get("/today", (req, res) => {
    const onlyValidated = req.query.onlyValidated === "true";
    handle(res, () => service.getTodayEvents({ onlyValidated }));
  });

  router.get("/:dateKey", (req, res) => {
    const { dateKey } = req.params;
    if (!DATE_KEY_PATTERN.test(dateKey)) {
      res.status(400).json({ error: `date_key invalide ("${dateKey}"), format attendu MM-DD.` });
      return;
    }
    const onlyValidated = req.query.onlyValidated === "true";
    handle(res, () => service.getEventsForDateKey(dateKey, { onlyValidated }));
  });

  return router;
}

module.exports = { createHistoricalEventsRouter };
