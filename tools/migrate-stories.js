require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const storiesPath = path.join(__dirname, "../data/stories.json");

async function checkTableExists() {
  const { error } = await supabase.from("stories").select("story_id").limit(1);
  if (error && (error.message.includes("stories") || error.code === "42P01")) {
    console.error("❌ La table 'stories' n'existe pas encore dans Supabase.");
    console.error("   Exécute d'abord ce SQL dans le Supabase Dashboard → SQL Editor :");
    console.error(`
   CREATE TABLE IF NOT EXISTS stories (
     story_id text PRIMARY KEY,
     story_title text NOT NULL DEFAULT '',
     main_actors jsonb DEFAULT '[]'::jsonb,
     central_tension text DEFAULT '',
     keywords jsonb DEFAULT '[]'::jsonb,
     status text DEFAULT 'active',
     first_episode_id text DEFAULT NULL,
     latest_episode_id text DEFAULT NULL,
     latest_episode_title text DEFAULT '',
     created_at timestamptz DEFAULT now(),
     updated_at timestamptz DEFAULT now()
   );
`);
    process.exit(1);
  }
}

async function run() {
  await checkTableExists();
  console.log("✓ Table 'stories' détectée dans Supabase.\n");

  const raw = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
  const stories = Array.isArray(raw) ? raw : [];

  console.log(`Migration de ${stories.length} stories...\n`);

  let ok = 0, fail = 0;
  for (const story of stories) {
    const row = {
      story_id:            String(story.story_id || "").trim(),
      story_title:         String(story.story_title || "").trim(),
      main_actors:         Array.isArray(story.main_actors) ? story.main_actors : [],
      central_tension:     String(story.central_tension || "").trim(),
      keywords:            Array.isArray(story.keywords) ? story.keywords : [],
      status:              String(story.status || "active").trim(),
      first_episode_id:    story.first_episode_id ? String(story.first_episode_id) : null,
      latest_episode_id:   story.latest_episode_id ? String(story.latest_episode_id) : null,
      latest_episode_title:String(story.latest_episode_title || "").trim(),
      created_at:          story.created_at || new Date().toISOString(),
      updated_at:          story.updated_at || new Date().toISOString(),
    };

    if (!row.story_id) { console.warn("  ⚠ story sans story_id ignorée"); continue; }

    const { error } = await supabase.from("stories").upsert(row, { onConflict: "story_id" });
    if (error) {
      console.error(`  ✗ ${row.story_id}: ${error.message}`);
      fail++;
    } else {
      console.log(`  ✓ ${row.story_id}: "${row.story_title}"`);
      ok++;
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✓ Migrées : ${ok}`);
  if (fail) console.log(`✗ Échecs  : ${fail}`);
  console.log(`─────────────────────────────`);

  if (fail === 0) {
    console.log("\n✅ Migration réussie !");
    console.log("   Tu peux maintenant supprimer data/stories.json et data/debate-story-links.json");
  } else {
    console.log("\n⚠️  Certaines stories n'ont pas pu être migrées. Vérifie les erreurs ci-dessus.");
  }
}

run().catch(e => { console.error("Erreur fatale:", e.message); process.exit(1); });
