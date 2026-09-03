-- À exécuter une fois dans le SQL editor de Supabase. PRÉPARÉE, PAS EXÉCUTÉE.
-- Audit egress du 03/09/2026 : media_extras n'a aucune limite côté écriture
-- (le bot de veille ajoute une entrée par article trouvé pour un débat, sans
-- jamais purger) — médiane 8 items/débat mais p90=30 et un maximum observé de
-- 263 items (94 Ko) sur un seul débat très suivi. Ce tableau complet part sur
-- CHAQUE chargement de la liste accueil (DEBATES_LIST_SELECT_COLUMNS,
-- server.js), pas seulement quand on ouvre le débat — mesuré : ~970 Ko pour
-- un chargement homepage par défaut (limit=120), media_extras en étant de
-- loin la part dominante.
--
-- Tronquer côté Node après réception ne réduit rien : PostgREST aurait déjà
-- transféré le tableau complet avant qu'on puisse le couper — l'egress
-- facturé par Supabase, c'est ce trajet PostgREST → serveur. D'où cette
-- fonction, exposée par PostgREST comme "colonne calculée" (nommée d'après la
-- table en premier argument) : Postgres calcule le tableau tronqué et ne
-- renvoie QUE ça sur le fil.
--
-- Additive et sans risque : la colonne media_extras elle-même n'est pas
-- touchée (page débat individuelle, DEBATE_DETAIL_SELECT_COLUMNS côté
-- server.js, continue de lire la colonne brute complète, comportement
-- inchangé). Cette fonction n'est utilisée QUE par la liste accueil, une fois
-- server.js mis à jour pour la sélectionner à la place de media_extras.
--
-- Garde les 20 DERNIERS éléments du tableau (les plus récents, en supposant
-- l'ordre d'ajout chronologique du bot de veille — cf. added_at sur chaque
-- item) : couvre la médiane (8) et la quasi-totalité du p90 (30) sans
-- changement visible, ne coupe que la longue traîne des débats hyper-suivis.
CREATE OR REPLACE FUNCTION media_extras_list_preview(d debates) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN d.media_extras IS NULL OR jsonb_array_length(d.media_extras) <= 20 THEN d.media_extras
    ELSE (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(d.media_extras) WITH ORDINALITY AS t(elem, idx)
      WHERE idx > jsonb_array_length(d.media_extras) - 20
    )
  END
$$;
