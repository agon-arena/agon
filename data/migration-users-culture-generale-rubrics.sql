-- À exécuter une fois dans le SQL editor de Supabase.
-- Personnalisation du QCM Culture Générale par rubrique (cf. CULTURE_GENERALE_RUBRICS
-- côté server.js) : NULL = pas de personnalisation, toutes les rubriques s'affichent
-- (comportement inchangé pour tout visiteur n'ayant jamais ouvert le réglage).

ALTER TABLE users ADD COLUMN IF NOT EXISTS culture_generale_rubrics TEXT[];
