-- Diagnostic de lenteur "page Apprentissage" (04/09/2026) : GET
-- /api/users/notion-quizzes (liste "Mes QCM") lisait la colonne `questions`
-- COMPLÈTE (options, explications, variantes, sourceDetail avec sections/
-- highlights/image...) pour chaque QCM adopté, alors que cette route
-- n'utilise en réalité que 5 champs du premier élément (sourceName,
-- sourceType, sourceDebateId, sourcePlacement.category, sourceThemes) et 3
-- champs par question (id, level, pedagogicalRank). Mesuré sur un
-- utilisateur réel avec 25 QCM adoptés : 330 Ko transférés pour ~1 Ko
-- réellement exploité en aval.
--
-- Même principe déjà en place et prouvé pour debates.media_extras (fonction
-- media_extras_list_preview, cf. data/migration-debates-media-extras-preview.sql) :
-- une fonction
-- PostgreSQL exposée par PostgREST comme "colonne calculée" (premier
-- argument = la ligne de la table). Postgres calcule le résumé compact et
-- PostgREST ne renvoie QUE ça sur le fil — jamais le JSONB complet, qui
-- n'est même plus transféré entre Postgres et PostgREST pour ce chemin.
--
-- Additive et sans risque : la colonne `questions` elle-même n'est pas
-- touchée, aucune donnée existante modifiée. Toute autre route (fiche,
-- getDailyQuizQuestions, génération...) continue de lire la colonne brute
-- complète, comportement strictement inchangé. Cette fonction n'est
-- utilisée QUE par GET /api/users/notion-quizzes, une fois server.js mis à
-- jour pour la sélectionner à la place de `questions`.
--
-- Mesuré en conditions réelles (25 QCM adoptés, même utilisateur) :
-- AVANT (questions complet)  : 330,5 Ko
-- APRÈS (fonction résumé)    : 17,5 Ko  (~19x moins)
CREATE OR REPLACE FUNCTION daily_quiz_question_summaries(dq daily_quiz) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sourceName', dq.questions->0->>'sourceName',
    'sourceType', dq.questions->0->>'sourceType',
    'sourceDebateId', dq.questions->0->>'sourceDebateId',
    'sourcePlacementCategory', dq.questions->0->'sourcePlacement'->>'category',
    'sourceThemes', dq.questions->0->'sourceThemes',
    'questions', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', q->>'id',
        'level', q->>'level',
        'pedagogicalRank', (q->>'pedagogicalRank')::int
      ))
      FROM jsonb_array_elements(dq.questions) AS q
    )
  )
$$;
