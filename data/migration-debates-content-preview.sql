-- À exécuter une fois dans le SQL editor de Supabase. PRÉPARÉE, PAS EXÉCUTÉE.
-- Diagnostic egress du 06/09/2026 : la liste accueil (DEBATES_LIST_SELECT_COLUMNS,
-- server.js) envoyait `content` en entier pour CHAQUE débat (~1 Ko/débat en
-- moyenne, mesuré) alors que la carte fermée n'affiche que la première phrase
-- (getIndexContextClosedPreviewText, public/script.js) — le reste du texte
-- n'était utile qu'au clic "en savoir plus" (buildIndexContextPreviewHtml),
-- une minorité de cartes. Sur un chargement homepage par défaut (120 débats),
-- ça représentait la 2e plus grosse part du poids après media_extras (déjà
-- traité, cf. data/migration-debates-media-extras-preview.sql, même principe
-- ci-dessous).
--
-- Contrairement à media_extras (pur déchet, jamais affiché au-delà du lot
-- actif), le texte complet EST utile — juste pas sur cette route liste. Le
-- correctif complet a donc deux volets : cette fonction (aperçu + indicateur
-- de troncature) côté liste, et un chargement à la demande du texte complet
-- au clic "en savoir plus" côté client (fetch /api/debates/:id, déjà caché
-- 3 min côté serveur, DEBATE_DETAIL_CACHE_TTL_MS — jamais une nouvelle
-- route). La page débat individuelle continue de lire `content` en clair,
-- comportement inchangé.
--
-- Retourne un OBJET (pas juste le texte tronqué) : {preview, hasMore}.
-- hasMore permet au client de savoir s'il existe du texte au-delà de
-- l'aperçu SANS avoir besoin du texte complet pour le déterminer — sans ce
-- champ, comparer preview au texte complet pour décider d'afficher le bouton
-- "en savoir plus" serait impossible (on n'a justement plus le texte
-- complet). 400 caractères = marge large au-delà de la plus longue première
-- phrase réaliste (la troncature précise à la phrase reste faite côté client,
-- getIndexContextClosedPreviewText, EXACTEMENT comme avant — cette fonction
-- ne fait qu'éviter d'envoyer le texte au-delà d'une marge généreuse).
--
-- Additive et sans risque : la colonne `content` elle-même n'est pas
-- touchée, aucune donnée existante modifiée. N'est utilisée QUE par
-- GET /api/debates (liste), une fois server.js mis à jour pour la
-- sélectionner à la place de `content`.
CREATE OR REPLACE FUNCTION content_list_preview(d debates) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'preview', left(d.content, 400),
    'hasMore', length(coalesce(d.content, '')) > 400
  )
$$;
