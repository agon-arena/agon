// Fonction unique centralisant la conversion (résultat objectif + ressenti
// Facile/Moyen/Difficile) -> rating FSRS (Again/Hard/Good/Easy). Aucun autre
// endroit du code ne doit recalculer ce mapping.
//
// Règle : le résultat objectif domine TOUJOURS le ressenti. Une réponse
// fausse est toujours Again, quel que soit le ressenti déclaré (l'utilisateur
// peut se tromper en la trouvant "facile" — ça ne change rien au fait qu'il
// ne l'a pas retrouvée). Une réponse juste est graduée par le ressenti :
//   incorrect               -> Again
//   correct + difficile     -> Hard
//   correct + moyen (ou non renseigné, valeur par défaut de l'UI) -> Good
//   correct + facile        -> Easy
//
// perceivedDifficulty reste par ailleurs stocké BRUT (avec is_correct) dans
// memory_review_events, séparément du rating calculé ici — signal de
// métacognition (écart ressenti/réalité, ex. "confidence_mismatch")
// disponible pour de futurs rapports, jamais réinjecté dans le calcul FSRS
// lui-même au-delà de ce mapping.
const VALID_PERCEIVED_DIFFICULTIES = new Set(["facile", "moyen", "difficile"]);

function mapMnoriaReviewToFsrsRating({ isCorrect, perceivedDifficulty }) {
  if (typeof isCorrect !== "boolean") {
    throw new Error("mapMnoriaReviewToFsrsRating: isCorrect doit être un booléen.");
  }
  if (perceivedDifficulty != null && !VALID_PERCEIVED_DIFFICULTIES.has(perceivedDifficulty)) {
    throw new Error(`mapMnoriaReviewToFsrsRating: perceivedDifficulty invalide "${perceivedDifficulty}".`);
  }

  if (!isCorrect) return "Again";

  const effectiveDifficulty = perceivedDifficulty || "moyen";
  if (effectiveDifficulty === "difficile") return "Hard";
  if (effectiveDifficulty === "facile") return "Easy";
  return "Good";
}

module.exports = {
  mapMnoriaReviewToFsrsRating
};
