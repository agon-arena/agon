require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const keywordsPath = path.join(__dirname, "../data/veille-pending-keywords.json");
const storiesPath  = path.join(__dirname, "../data/veille-pending-stories.json");
const linksPath    = path.join(__dirname, "../data/veille-pending-links.json");

async function checkColumnsExist() {
  const { error } = await supabase.from("veille_pending").select("pending_keywords").limit(1);
  if (error && error.message.includes("pending_keywords")) {
    console.error("❌ Les colonnes n'existent pas encore dans veille_pending.");
    console.error("   Exécute d'abord ce SQL dans Supabase Dashboard → SQL Editor :\n");
    console.error("   ALTER TABLE veille_pending ADD COLUMN IF NOT EXISTS pending_keywords jsonb DEFAULT '[]';");
    console.error("   ALTER TABLE veille_pending ADD COLUMN IF NOT EXISTS pending_story_selection jsonb DEFAULT NULL;");
    console.error("   ALTER TABLE veille_pending ADD COLUMN IF NOT EXISTS pending_linked_debate_id text DEFAULT NULL;");
    process.exit(1);
  }
}

async function run() {
  await checkColumnsExist();
  console.log("✓ Colonnes détectées dans veille_pending.\n");

  const keywords = JSON.parse(fs.readFileSync(keywordsPath, "utf8"));
  const stories  = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
  const links    = JSON.parse(fs.readFileSync(linksPath, "utf8"));

  const allIds = new Set([...Object.keys(keywords), ...Object.keys(stories), ...Object.keys(links)]);
  console.log(`Items veille_pending à mettre à jour : ${allIds.size}\n`);

  let ok = 0, skip = 0, fail = 0;
  for (const id of allIds) {
    const update = {};
    if (keywords[id] !== undefined) update.pending_keywords = keywords[id];
    if (stories[id]  !== undefined) update.pending_story_selection = stories[id];
    if (links[id]    !== undefined) update.pending_linked_debate_id = String(links[id] || "").trim() || null;

    const { error } = await supabase.from("veille_pending").update(update).eq("id", Number(id));
    if (error) {
      if (error.message.includes("0 rows")) {
        console.log(`  ~ item ${id}: plus dans veille_pending (déjà publié), ignoré`);
        skip++;
      } else {
        console.error(`  ✗ item ${id}: ${error.message}`);
        fail++;
      }
    } else {
      console.log(`  ✓ item ${id}: ${Object.keys(update).join(", ")}`);
      ok++;
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✓ Migrés  : ${ok}`);
  if (skip) console.log(`~ Ignorés : ${skip} (déjà publiés)`);
  if (fail) console.log(`✗ Échecs  : ${fail}`);
  console.log(`─────────────────────────────`);

  if (fail === 0) {
    console.log("\n✅ Migration réussie !");
    console.log("   Tu peux supprimer :");
    console.log("   - data/veille-pending-keywords.json");
    console.log("   - data/veille-pending-stories.json");
    console.log("   - data/veille-pending-links.json");
  }
}

run().catch(e => { console.error("Erreur fatale:", e.message); process.exit(1); });
