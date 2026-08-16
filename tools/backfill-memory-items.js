#!/usr/bin/env node
// Backfill prudent de la refonte FSRS (tâche #11 du plan Mnoria FSRS,
// 13-16/08/2026). Rejoue l'historique RÉEL de daily_quiz_answers dans les
// nouvelles tables memory_items / memory_item_fsrs_states /
// memory_review_events, sans jamais inventer de précision perdue, sans
// jamais fusionner deux MemoryItems par ressemblance de contenu.
//
// PÉRIMÈTRE VOLONTAIREMENT RESTREINT aux slots "notion:%" (buildNotionQuestions
// + buildCustomTopicQuiz/buildEnumerableCustomTopicQuiz), à l'exclusion des
// anciens slots "morning"/"evening"/"culture_generale"/"revision"/
// "eclairages"/"daily"/"ce_jour_histoire" — décision prise après inspection
// des données réelles (13/08/2026), pas une simplification arbitraire :
//   1. Ces anciens slots sont un mécanisme RETIRÉ (plus de génération
//      planifiée depuis la fusion des QCM, cf. commentaire "Le QCM n'a plus
//      de génération planifiée" dans server.js) — aucune nouvelle ligne n'y
//      est plus jamais écrite.
//   2. Ils ne sont PAS exclus de runDataRetentionCleanup (seuls "notion:%"
//      et "cgreview-%" le sont) : au 16/08/2026 leurs lignes daily_quiz les
//      plus anciennes ont déjà plus de 25 jours et seront purgées par la
//      tâche de rétention existante dans les prochains jours, avec ou sans
//      cette migration.
//   3. Contrairement aux slots "notion:%" (un (quiz_date, slot) donné n'est
//      généré qu'UNE FOIS, cf. lib/spaced-repetition/memory-model.js), les
//      ids positionnels "morning-qN"/"evening-qN" de ces anciens slots se
//      RÉPÈTENT à l'identique d'un jour sur l'autre avec un contenu
//      DIFFÉRENT à chaque fois. Résoudre une repasse "cgreview-{questionId}"
//      vers son quiz_date d'origine y serait ambigu (plusieurs candidats
//      possibles) — on préfère ne pas les migrer plutôt que risquer
//      d'attribuer une repasse à la mauvaise question (cf. invariant
//      "quelques doublons plutôt qu'une fusion incorrecte").
// C'est aussi exactement le périmètre déjà mis en avant par le produit :
// "Mes apprentissages"/"Ma mémoire" ne portent que sur les QCM de notion.
//
// Idempotent : peut être relancé sans dupliquer (upsert sur natural_key,
// UNIQUE (user_id, memory_item_id) et UNIQUE (user_id, memory_item_id,
// reviewed_at) empêchent toute double écriture).
//
// Usage : node tools/backfill-memory-items.js [--dry-run]
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { resolveLegacyUser } = require("../lib/users");
const { buildMemoryItemNaturalKey } = require("../lib/spaced-repetition/memory-model");
const { reviewMemoryItem } = require("../lib/spaced-repetition/fsrs-scheduler");
const { mapMnoriaReviewToFsrsRating } = require("../lib/spaced-repetition/rating-mapper");
const { resolveQuestionVariantLabel } = require("../lib/spaced-repetition/question-variant");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (data && data.length) rows.push(...data);
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Même reconnaissance que isCultureGeneraleQuestionId (server.js) : ne migre
// que les questions de connaissance durable, jamais les questions actu qui
// partagent parfois la même ligne daily_quiz (anciens slots "daily").
function isNotionQuestionId(id) {
  return String(id || "").startsWith("notion:");
}

function isTestVoterKey(voterKey) {
  return /^test-/.test(String(voterKey || ""));
}

async function run() {
  console.log(DRY_RUN ? "=== BACKFILL FSRS (--dry-run, aucune écriture) ===" : "=== BACKFILL FSRS ===");

  console.log("\n[1/5] Lecture des QCM de notion (daily_quiz, slot LIKE 'notion:%')...");
  const quizRows = await fetchAllRows(() =>
    supabase.from("daily_quiz").select("quiz_date, slot, questions").like("slot", "notion:%"));
  console.log(`  ${quizRows.length} ligne(s) daily_quiz.`);

  // contentByDateAndId : clé d'identité complète (quiz_date + slot + questionId)
  // -> question, utilisée pour les réponses "originales" (mêmes quiz_date que
  // la publication) ET pour construire memory_items.
  const contentByDateAndId = new Map();
  let skippedNoSubject = 0;
  for (const row of quizRows) {
    for (const q of row.questions || []) {
      if (!isNotionQuestionId(q.id)) continue;
      if (!q.sourceType || !q.sourceDebateId) {
        skippedNoSubject++;
        continue;
      }
      contentByDateAndId.set(`${row.quiz_date}:${q.id}`, { slot: row.slot, quizDate: row.quiz_date, question: q });
    }
  }
  console.log(`  ${contentByDateAndId.size} question(s) de notion identifiée(s).`);
  if (skippedNoSubject) console.log(`  ~ ${skippedNoSubject} question(s) ignorée(s) (sourceType/sourceDebateId manquant).`);

  console.log("\n[2/5] Upsert memory_items...");
  const memoryItemIdByNaturalKey = new Map();
  const memoryItemEntries = [...contentByDateAndId.values()].map(({ slot, quizDate, question }) => ({
    natural_key: buildMemoryItemNaturalKey({ slot, quizDate, questionId: question.id }),
    subject_type: question.sourceType,
    subject_source_id: String(question.sourceDebateId),
    slot,
    quiz_date: quizDate,
    question_id: question.id
  }));
  if (!DRY_RUN && memoryItemEntries.length) {
    for (let i = 0; i < memoryItemEntries.length; i += 500) {
      const chunk = memoryItemEntries.slice(i, i + 500);
      const { error } = await supabase.from("memory_items").upsert(chunk, { onConflict: "natural_key", ignoreDuplicates: true });
      if (error) throw new Error(`memory_items upsert: ${error.message}`);
    }
  }
  if (memoryItemEntries.length) {
    const naturalKeys = memoryItemEntries.map((e) => e.natural_key);
    // Chunk plus petit que pour l'upsert ci-dessus : natural_key est une
    // chaîne longue (slot::quiz_date::questionId, ~80-100 caractères), et un
    // filtre .in() les encode dans l'URL — testé empiriquement le 16/08/2026,
    // 200 déclenche déjà des échecs réseau (URL trop longue), 100 est fiable.
    for (let i = 0; i < naturalKeys.length; i += 100) {
      const chunk = naturalKeys.slice(i, i + 100);
      if (DRY_RUN) continue;
      const { data, error } = await supabase.from("memory_items").select("id, natural_key").in("natural_key", chunk);
      if (error) throw new Error(`memory_items select: ${error.message}`);
      for (const row of data || []) memoryItemIdByNaturalKey.set(row.natural_key, row.id);
    }
  }
  console.log(`  ${memoryItemEntries.length} memory_item(s) ${DRY_RUN ? "à créer (dry-run)" : "upsertés"}.`);

  console.log("\n[3/5] Lecture de daily_quiz_answers (originales + repasses)...");
  const answerRows = await fetchAllRows(() =>
    supabase.from("daily_quiz_answers")
      .select("quiz_date, voter_key, question_id, option_index, difficulty, created_at")
      .order("created_at", { ascending: true }));
  console.log(`  ${answerRows.length} ligne(s) daily_quiz_answers au total (tous slots confondus).`);

  const byVoter = new Map();
  let testVoterSkipped = 0;
  for (const row of answerRows) {
    if (isTestVoterKey(row.voter_key)) { testVoterSkipped++; continue; }
    const qid = String(row.question_id || "");
    const isOriginal = qid.startsWith("notion:");
    const isReview = qid.startsWith("cgreview-");
    if (!isOriginal && !isReview) continue; // hors périmètre (actu, anciens slots, etc.)
    if (!byVoter.has(row.voter_key)) byVoter.set(row.voter_key, { original: [], review: [] });
    const bucket = byVoter.get(row.voter_key);
    if (isOriginal) {
      bucket.original.push(row);
    } else {
      const ref = qid.slice("cgreview-".length);
      bucket.review.push({ ...row, ref });
    }
  }
  console.log(`  ${byVoter.size} visiteur(s) avec au moins une réponse dans le périmètre.`);
  if (testVoterSkipped) console.log(`  ~ ${testVoterSkipped} ligne(s) ignorée(s) (voter_key de test).`);

  console.log("\n[4/5] Rejeu chronologique par visiteur...");
  let eventsWritten = 0;
  let skippedNoContent = 0;
  let skippedAmbiguousReview = 0;
  let usersResolved = 0;

  for (const [voterKey, { original, review }] of byVoter) {
    // ownOriginalByQuestionId : résolution des repasses scopée à CE visiteur
    // uniquement (jamais un index global cross-visiteur) — une repasse ne
    // peut porter que sur une question que ce même visiteur a déjà vue.
    const ownOriginalByQuestionId = new Map();
    const timeline = [];

    for (const row of original) {
      const entry = contentByDateAndId.get(`${row.quiz_date}:${row.question_id}`);
      if (!entry) { skippedNoContent++; continue; }
      ownOriginalByQuestionId.set(row.question_id, entry);
      timeline.push({ entry, row, reviewedAt: new Date(row.created_at) });
    }
    for (const row of review) {
      const entry = ownOriginalByQuestionId.get(row.ref);
      if (!entry) { skippedAmbiguousReview++; continue; } // pas (encore) de réponse originale connue pour ce ref chez ce visiteur
      timeline.push({ entry, row, reviewedAt: new Date(row.created_at) });
    }
    timeline.sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
    if (!timeline.length) continue;

    let userId = null;
    if (!DRY_RUN) {
      const { user } = await resolveLegacyUser(supabase, voterKey);
      userId = user.id;
      usersResolved++;
    }

    const stateByNaturalKey = new Map();
    const reviewCountByNaturalKey = new Map();

    for (const { entry, row } of timeline) {
      const naturalKey = buildMemoryItemNaturalKey({ slot: entry.slot, quizDate: entry.quizDate, questionId: entry.question.id });
      const memoryItemId = memoryItemIdByNaturalKey.get(naturalKey);
      if (!DRY_RUN && !memoryItemId) { skippedNoContent++; continue; }

      const isCorrect = Number(row.option_index) === Number(entry.question.correctIndex);
      const perceivedDifficulty = ["facile", "moyen", "difficile"].includes(row.difficulty) ? row.difficulty : null;
      const rating = mapMnoriaReviewToFsrsRating({ isCorrect, perceivedDifficulty });
      const reviewCount = reviewCountByNaturalKey.get(naturalKey) || 0;
      const questionVariant = resolveQuestionVariantLabel(entry.question, reviewCount);
      const reviewedAt = new Date(row.created_at);

      const currentState = stateByNaturalKey.get(naturalKey) || null;
      const { nextState, elapsedDays, schedulerModelId } = reviewMemoryItem({ currentState, rating, now: reviewedAt });
      stateByNaturalKey.set(naturalKey, nextState);
      reviewCountByNaturalKey.set(naturalKey, reviewCount + 1);

      if (!DRY_RUN) {
        const { error } = await supabase.from("memory_review_events").upsert({
          user_id: userId,
          memory_item_id: memoryItemId,
          question_variant: questionVariant,
          is_correct: isCorrect,
          perceived_difficulty: perceivedDifficulty,
          rating,
          elapsed_days: elapsedDays,
          due_at: nextState.due.toISOString(),
          stability_after: nextState.stability,
          difficulty_after: nextState.difficulty,
          scheduler_model_id: schedulerModelId,
          reviewed_at: reviewedAt.toISOString()
        }, { onConflict: "user_id,memory_item_id,reviewed_at", ignoreDuplicates: true });
        if (error) throw new Error(`memory_review_events upsert (voter=${voterKey}): ${error.message}`);
      }
      eventsWritten++;
    }

    if (!DRY_RUN) {
      const finalStates = [...stateByNaturalKey.entries()].map(([naturalKey, state]) => ({
        user_id: userId,
        memory_item_id: memoryItemIdByNaturalKey.get(naturalKey),
        state: state.state,
        due_at: state.due.toISOString(),
        stability: state.stability,
        difficulty: state.difficulty,
        scheduled_days: state.scheduledDays,
        learning_steps: state.learningSteps,
        reps: state.reps,
        lapses: state.lapses,
        last_review_at: state.lastReviewAt ? state.lastReviewAt.toISOString() : null,
        scheduler_model_id: require("../lib/spaced-repetition/scheduler-version").SCHEDULER_MODEL_ID,
        updated_at: new Date().toISOString()
      })).filter((s) => s.memory_item_id);
      for (let i = 0; i < finalStates.length; i += 500) {
        const chunk = finalStates.slice(i, i + 500);
        const { error } = await supabase.from("memory_item_fsrs_states").upsert(chunk, { onConflict: "user_id,memory_item_id" });
        if (error) throw new Error(`memory_item_fsrs_states upsert (voter=${voterKey}): ${error.message}`);
      }
    }
  }

  console.log("\n[5/5] Résumé");
  console.log("─────────────────────────────");
  console.log(`memory_items ${DRY_RUN ? "à créer" : "créés/déjà présents"} : ${memoryItemEntries.length}`);
  console.log(`Visiteurs traités (hors test) : ${byVoter.size}${DRY_RUN ? "" : ` (users résolus : ${usersResolved})`}`);
  console.log(`memory_review_events ${DRY_RUN ? "à écrire" : "écrits"} : ${eventsWritten}`);
  if (skippedNoContent) console.log(`~ Réponses ignorées (contenu introuvable, hors fenêtre) : ${skippedNoContent}`);
  if (skippedAmbiguousReview) console.log(`~ Repasses ignorées (pas de réponse originale connue chez ce visiteur) : ${skippedAmbiguousReview}`);
  console.log("─────────────────────────────");
  console.log(DRY_RUN ? "\nDry-run terminé, aucune écriture effectuée." : "\n✅ Backfill terminé.");
}

run().catch((e) => { console.error("Erreur fatale:", e.message); process.exit(1); });
