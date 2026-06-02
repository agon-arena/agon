require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const keywordsPath = path.join(__dirname, "../data/debate-keywords.json");

async function checkColumnExists() {
  const { error } = await supabase.from("debates").select("keywords").limit(1);
  if (error && error.message.includes("keywords")) {
    console.error("❌ La colonne 'keywords' n'existe pas encore dans Supabase.");
    console.error("   Exécute d'abord ce SQL dans le Supabase Dashboard → SQL Editor :");
    console.error("");
    console.error("   ALTER TABLE debates ADD COLUMN IF NOT EXISTS keywords jsonb DEFAULT '[]'::jsonb;");
    console.error("");
    process.exit(1);
  }
}

async function run() {
  await checkColumnExists();
  console.log("✓ Colonne 'keywords' détectée dans Supabase.\n");

  const raw = JSON.parse(fs.readFileSync(keywordsPath, "utf8"));
  const entries = Object.entries(raw).filter(([, v]) => Array.isArray(v) && v.length);

  console.log(`Migration de ${entries.length} débats...\n`);

  let ok = 0, fail = 0;
  for (const [debateId, keywords] of entries) {
    const { error } = await supabase
      .from("debates")
      .update({ keywords })
      .eq("id", debateId);

    if (error) {
      console.error(`  ✗ débat ${debateId}: ${error.message}`);
      fail++;
    } else {
      console.log(`  ✓ débat ${debateId}: [${keywords.join(", ")}]`);
      ok++;
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✓ Migrés  : ${ok}`);
  if (fail) console.log(`✗ Échecs  : ${fail}`);
  console.log(`─────────────────────────────`);

  if (fail === 0) {
    console.log("\n✅ Migration réussie !");
    console.log("   Tu peux maintenant supprimer data/debate-keywords.json");
    console.log("   (mais garde-le encore quelques jours pour vérifier que tout fonctionne)");
  } else {
    console.log("\n⚠️  Certains débats n'ont pas pu être migrés. Vérifie les erreurs ci-dessus.");
  }
}

run().catch(e => { console.error("Erreur fatale:", e.message); process.exit(1); });
