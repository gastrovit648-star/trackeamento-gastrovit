/**
 * Backup de events_log antes do TTL parcial.
 * Exporta rows com created_at < now() - 14d para NDJSON local.
 *
 * Uso:  npx tsx scripts/backup-events-log.ts
 * Saída: backups/events_log/events_log_pre_ttl_<timestamp>.ndjson
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, createWriteStream } from "fs";
import { join } from "path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    console.warn("[backup] .env.local não encontrado — usando env do processo");
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Faltando NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  const dir = join(process.cwd(), "backups", "events_log");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `events_log_pre_ttl_${stamp}.ndjson`);
  const out = createWriteStream(outPath, { encoding: "utf8" });

  console.log(`[backup] cutoff (created_at <): ${cutoff}`);
  console.log(`[backup] output: ${outPath}`);

  const PAGE = 1000;
  let start = 0;
  let total = 0;

  while (true) {
    const { data, error } = await supabase
      .from("events_log")
      .select("*")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);

    if (error) {
      console.error("\n[backup] erro na query:", error);
      out.end();
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      out.write(JSON.stringify(row) + "\n");
    }
    total += data.length;
    process.stdout.write(`\r[backup] rows exportadas: ${total}`);
    start += data.length;
    if (data.length < PAGE) break;
  }

  process.stdout.write("\n");
  out.end();
  await new Promise<void>((resolve) => out.on("close", () => resolve()));
  console.log(`[backup] concluído. ${total} rows → ${outPath}`);
}

main().catch((err) => {
  console.error("[backup] fatal:", err);
  process.exit(1);
});
