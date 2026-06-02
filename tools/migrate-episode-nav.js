require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const navPath = path.join(__dirname, "../data/debate-episode-nav.json");

async function checkColumnExists() {
  const { error } = await supabase.from("debates").select("episode_nav").limit(1);
  if (error && error.message.includes("episode_nav")) {
    console.error("❌ La colonne 'episode_nav' n'existe pas encore dans Supabase.");
    console.error("   Exécute d'abord ce SQL dans le Supabase Dashboard → SQL Editor :");
    console.error("");
    console.error("   ALTER TABLE debates ADD COLUMN IF NOT EXISTS episode_nav jsonb DEFAULT NULL;");
    console.error("");
    process.exit(1);
  }
}

async function run() {
  await checkColumnExists();
  console.log("✓ Colonne 'episode_nav' détectée dans Supabase.\n");

  const raw = JSON.parse(fs.readFileSync(navPath, "utf8"));
  const entries = Object.entries(raw).filter(([, v]) => v && typeof v === "object");

  console.log(`Migration de ${entries.length} débats...\n`);

  let ok = 0, fail = 0;
  for (const [debateId, nav] of entries) {
    const { error } = await supabase.from("debates").update({ episode_nav: nav }).eq("id", debateId);
    if (error) {
      console.error(`  ✗ débat ${debateId}: ${error.message}`);
      fail++;
    } else {
      const prev = nav.previous_episode_id ? `← ${nav.previous_episode_id}` : "début";
      const next = nav.next_episode_id ? `→ ${nav.next_episode_id}` : "fin";
      console.log(`  ✓ débat ${debateId}: ${prev} | ${next}`);
      ok++;
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✓ Migrés  : ${ok}`);
  if (fail) console.log(`✗ Échecs  : ${fail}`);
  console.log(`─────────────────────────────`);

  if (fail === 0) {
    console.log("\n✅ Migration réussie !");
    console.log("   Tu peux maintenant supprimer data/debate-episode-nav.json");
  } else {
    console.log("\n⚠️  Certains débats n'ont pas pu être migrés. Vérifie les erreurs ci-dessus.");
  }
}

run().catch(e => { console.error("Erreur fatale:", e.message); process.exit(1); });
