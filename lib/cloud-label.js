// Génération IA du libellé court (cloud_label) destiné aux futures bulles Agôn.
// Module isolé, appelé en arrière-plan après la création d'une arène :
// un échec retourne null et n'impacte jamais la création.

// Libellés trop génériques refusés même si l'IA les propose.
const GENERIC_LABELS = new Set([
  "politique", "societe", "economie", "education", "justice", "culture",
  "medias", "sport", "sports", "sante", "climat", "environnement", "france",
  "monde", "europe", "international", "actualite", "actualites", "debat",
  "debats", "sujet", "question", "information", "infos",
  "debat important", "sujet actuel", "question de societe", "question actuelle"
]);

const MAX_LABEL_LENGTH = 35;

function _normalizeForCompare(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Filet de sécurité indépendant de l'IA : nettoie et valide le libellé.
// Retourne null si le résultat est inutilisable (vide, trop court, générique).
function sanitizeCloudLabel(raw) {
  let label = String(raw || "")
    .replace(/["«»“”‘’']/g, (c) => (c === "'" || c === "’" ? "'" : ""))
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/^\s*(sujet|d[ée]bat|label|titre|th[èe]me|ar[èe]ne)\s*:\s*/i, "")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!…]+$/, "")
    .trim();

  if (label.length > MAX_LABEL_LENGTH) {
    const cut = label.slice(0, MAX_LABEL_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    label = (lastSpace >= 12 ? cut.slice(0, lastSpace) : cut).trim();
  }

  const normalized = _normalizeForCompare(label);
  if (normalized.length < 3 || GENERIC_LABELS.has(normalized)) return null;
  return label;
}

function _buildPrompt({ question, content, optionA, optionB, category, type }) {
  const lines = [
    "Tu génères un libellé très court pour une bulle d'affichage, à partir d'un débat.",
    "",
    "Règles strictes :",
    "- 2 à 4 mots, 35 caractères maximum",
    '- spécifique au sujet (jamais un thème générique comme "Politique", "Société", "Économie")',
    "- pas de question, pas de point d'interrogation, pas de phrase complète",
    '- pas de guillemets, pas d\'emoji, pas de préfixe ("Sujet :", "Débat :")',
    "- pas de formulation polémique",
    "- compréhensible sans connaître le débat",
    "",
    "Exemples :",
    '- "Faut-il interdire les téléphones portables au collège ?" → "Téléphones au collège"',
    '- "Les réseaux sociaux abîment-ils la santé mentale des jeunes ?" → "Réseaux sociaux"',
    '- "La France doit-elle relancer le nucléaire ?" → "Nucléaire"',
    '- "Faut-il rendre l\'uniforme obligatoire à l\'école ?" → "Uniforme scolaire"',
    '- "Le tourisme à La Réunion est-il une chance ou une menace ?" → "Tourisme réunionnais"',
    "",
    'Réponds uniquement en JSON : {"label":"..."}',
    "",
    "Question : " + String(question || "").trim()
  ];

  const resume = String(content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (resume) lines.push("Contexte : " + resume);
  if (String(optionA || "").trim()) lines.push("Position A : " + String(optionA).trim());
  if (String(optionB || "").trim()) lines.push("Position B : " + String(optionB).trim());
  if (String(category || "").trim()) lines.push("Thématique : " + String(category).trim());
  if (type === "open") lines.push("Type : arène libre (réponses ouvertes, sans camps)");

  return lines.join("\n");
}

async function generateCloudLabel(fields) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!String(fields?.question || "").trim()) return null;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: _buildPrompt(fields) }],
        response_format: { type: "json_object" },
        max_tokens: 60,
        temperature: 0.2
      })
    });
    if (!r.ok) return null;
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { return null; }
    return sanitizeCloudLabel(parsed.label);
  } catch {
    return null;
  }
}

module.exports = { generateCloudLabel, sanitizeCloudLabel };
