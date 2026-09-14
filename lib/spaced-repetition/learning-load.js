// Jauge de charge de mémorisation — combien de connaissances ont été
// mémorisées aujourd'hui (cf. server.js fetchLearningLoadGaugeForUser, qui
// réutilise le même comptage que "Connaissances mémorisées ce jour"). Simple
// comptage du jour, remis à zéro chaque jour (demande du 14/09/2026, "pas de
// calcul sur plusieurs jours comme actuellement") — plus de simulation de
// report FSRS sur plusieurs jours ici, juste des seuils sur le nombre brut.
//
// Paliers d'affichage (demande du 13/09/2026, "idéal doit se situer pour 6
// connaissances mémorisées ce jour, surcharge à partir de 9") — en nombre
// BRUT de connaissances mémorisées aujourd'hui.
const GAUGE_DISPLAY_PEAK_THRESHOLDS = {
  moderate: 3,   // count >= 3 -> "moderate"
  busy: 6,       // count >= 6 -> "busy" (rythme idéal)
  overloaded: 9  // count >= 9 -> "overloaded" (surcharge)
};

function levelFromPeakLoad(peakLoad) {
  const load = Math.max(0, Number(peakLoad) || 0);
  if (load >= GAUGE_DISPLAY_PEAK_THRESHOLDS.overloaded) return "overloaded";
  if (load >= GAUGE_DISPLAY_PEAK_THRESHOLDS.busy) return "busy";
  if (load >= GAUGE_DISPLAY_PEAK_THRESHOLDS.moderate) return "moderate";
  return "calm";
}

module.exports = {
  GAUGE_DISPLAY_PEAK_THRESHOLDS,
  levelFromPeakLoad
};
