-- À exécuter une fois dans le SQL editor de Supabase.
-- Intégration Noès (mission du 26/08/2026, cf. rapport d'audit) : première
-- brique du cache du "script Noès" — le couple question/réponse adapté à
-- l'oral, généré par IA à PARTIR de la connaissance source (question.knowledgeTarget
-- d'un daily_quiz), jamais à partir du QCM lui-même (cf. buildNoesScriptPrompt,
-- lib/coeus/noes-script.js).
--
-- Une ligne = le script complet d'UNE fiche (slot, quiz_date), pas d'UN
-- batch vidéo : l'appel IA se fait UNE SEULE FOIS pour toute la fiche
-- (jusqu'à 20 connaissances), puis lib/coeus/noes-batch.js découpe ce
-- tableau en lots canoniques de 5 (1-5, 6-10, 11-15, 16-20) au moment de la
-- génération vidéo — jamais l'inverse, pour ne jamais régénérer le script à
-- chaque nouveau lot demandé.
--
-- items (jsonb) : tableau ordonné, MÊME ORDRE que daily_quiz.questions,
-- [{knowledge_id, question, answer}] — knowledge_id = la natural_key du
-- MemoryItem correspondant (cf. buildMemoryItemNaturalKey,
-- lib/spaced-repetition/memory-model.js), donc directement traçable jusqu'à
-- la connaissance FSRS d'origine. Une connaissance sans knowledgeTarget
-- (contenu ancien non taggé) est simplement absente de ce tableau plutôt que
-- reconstruite depuis la question QCM — cf. le commentaire de
-- buildNoesScriptItemsFromQuestions.
--
-- V1 (périmètre de la mission) : sourceType toujours "custom" (recherche IA
-- / "Mes apprentissages"), colonne conservée en texte libre pour rester
-- extensible aux autres imports sans migration supplémentaire plus tard.
CREATE TABLE IF NOT EXISTS noes_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot TEXT NOT NULL,
  quiz_date DATE NOT NULL,
  source_type TEXT NOT NULL,
  items JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot, quiz_date)
);
