// Restore rehearsal (docs/runbooks/BACKUP.md): a backup is not valid until it has been restored.
//
// Takes a folder written by scripts/db-backup.mjs, starts a THROWAWAY second Supabase stack on
// this computer (database, Auth and Storage only; its own containers, ports and volumes), loads
// the backup into it the same way a real restore would, and compares what arrived with the
// manifest, table by table. Then it removes the throwaway stack and its data.
//
// It never connects to production and never touches the regular local stack (`lnk`).
//
//   node scripts/db-restore-check.mjs backups/<folder>
//   node scripts/db-restore-check.mjs backups/<folder> --keep   leave the stack up to look around
//                                                               (database on port 54522)
//
// Needs Docker. Exit code 0 only when every table has the number of rows the manifest says.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROJECT = "lnk-restore-check";
const CONTAINER = `supabase_db_${PROJECT}`;
const WORKDIR = join(ROOT, "backups", ".restore-check");
const PORT_SHIFT = 200;
const KEEP = process.argv.includes("--keep");
const backup = resolve(process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "");
const FILES = ["roles.sql", "schema.sql", "data.sql", "migrations-schema.sql", "migrations-data.sql"];

if (!existsSync(join(backup, "manifest.json"))) {
  console.error("Usage: node scripts/db-restore-check.mjs backups/<folder written by db-backup.mjs>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(backup, "manifest.json"), "utf8"));

function supabase(args) {
  // One command line for the shell (npx is a .cmd on Windows). Every argument is a constant of this file.
  const result = spawnSync(`npx supabase ${args.join(" ")} --workdir "${WORKDIR}"`, { cwd: ROOT, shell: true, encoding: "utf8" });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Feeds SQL to the throwaway database. Returns the ERROR lines, deduplicated. */
function psql(input) {
  const result = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q", "-At"], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { rows: result.stdout.trim(), errors: [...new Set(result.stderr.split("\n").filter((line) => line.includes("ERROR")))] };
}

function removeStack() {
  supabase(["stop", "--no-backup"]);
  rmSync(WORKDIR, { recursive: true, force: true });
}

let failed = 0;
function check(name, condition, detail = "") {
  if (!condition) failed += 1;
  console.log(`${condition ? "  ok  " : "  FAIL"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
}

console.log(`Checking ${backup} (${manifest.source}, taken ${manifest.startedAt})`);
for (const name of FILES) {
  const digest = createHash("sha256").update(readFileSync(join(backup, name))).digest("hex");
  check(`${name} is the file the manifest describes`, digest === manifest.sha256[name]);
}
if (failed > 0) process.exit(1);

// The throwaway stack: the repository's configuration under another name and other ports, with no
// migrations of its own, so its database starts as an empty Supabase project would.
removeStack();
mkdirSync(join(WORKDIR, "supabase"), { recursive: true });
const config = readFileSync(join(ROOT, "supabase/config.toml"), "utf8")
  .replace(/^project_id = .*$/m, `project_id = "${PROJECT}"`)
  .replace(/^(\s*#?\s*(?:port|shadow_port|smtp_port|pop3_port|inspector_port)\s*=\s*)(\d+)/gm, (_match, key, port) => `${key}${Number(port) + PORT_SHIFT}`);
writeFileSync(join(WORKDIR, "supabase/config.toml"), config);
cpSync(join(ROOT, "supabase/templates"), join(WORKDIR, "supabase/templates"), { recursive: true });

console.log("Starting a throwaway database (this takes a minute)…");
const started = supabase(["start", "-x", "realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"]);
if (!started.ok) {
  console.error(started.output.slice(-1500));
  removeStack();
  process.exit(1);
}

try {
  // Same order and same switch as a real restore: roles, structure, then rows with triggers and
  // foreign-key checks off (the rows are already consistent; the order of the tables is not).
  const read = (name) => readFileSync(join(backup, name), "utf8");
  const structure = psql(`${read("roles.sql")}\n${read("schema.sql")}\n${read("migrations-schema.sql")}`);
  check("roles and structure load without errors", structure.errors.length === 0, structure.errors.slice(0, 3).join(" | "));
  const data = psql(`SET session_replication_role = replica;\n${read("data.sql")}\n${read("migrations-data.sql")}`);
  check("rows load without errors", data.errors.length === 0, data.errors.slice(0, 3).join(" | "));

  const tables = Object.keys(manifest.rows);
  const counted = psql(tables.map((table) => `select '${table}|' || count(*) from ${table.split(".").map((part) => `"${part}"`).join(".")};`).join("\n"));
  const restored = Object.fromEntries(counted.rows.split("\n").filter(Boolean).map((line) => line.split("|")).map(([table, count]) => [table, Number(count)]));
  const different = tables.filter((table) => restored[table] !== manifest.rows[table]);
  check(`all ${tables.length} tables have the rows the manifest says`, different.length === 0, different.slice(0, 5).map((table) => `${table}: ${restored[table]} of ${manifest.rows[table]}`).join(", "));

  const migrations = Number(psql("select count(*) from supabase_migrations.schema_migrations;").rows);
  check("the migration history came back", migrations === manifest.migrationsApplied, `${migrations} of ${manifest.migrationsApplied}`);

  // The product's own read of a published page, as a visitor makes it.
  const page = psql("select coalesce((select state from public.get_public_page((select slug from public.profiles where live_publication_id is not null and deleted_at is null order by created_at limit 1))), 'no page');").rows;
  check("a published page can be read from the restored database", page === "published" || page === "suspended" || page === "no page", page);
  if (page === "no page") console.log("        (the backup has no published page to read)");
  const rls = Number(psql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;").rows);
  check("every public table came back with row level security on", rls === 0, `${rls} without`);

  const accounts = manifest.rows["auth.users"] ?? 0;
  console.log(`\nRestored: ${accounts} accounts, ${manifest.rows["public.profiles"] ?? 0} pages, ${manifest.rows["public.profile_publications"] ?? 0} published versions, ${manifest.rows["public.form_leads"] ?? 0} leads.`);
  console.log("Not part of a backup, to be recreated after a real restore: Vault secrets, hosted Auth settings (runbook).");
  if (manifest.media) console.log(`Media files in the backup: ${manifest.media.downloaded} of ${manifest.media.listed} (not uploaded by this check).`);
} finally {
  if (KEEP) console.log(`\nThe throwaway stack is still up (database on port ${54322 + PORT_SHIFT}). Remove it with: npx supabase stop --no-backup --workdir "${WORKDIR}"`);
  else removeStack();
}

console.log(failed === 0 ? "\nPASS: this backup restores." : `\nFAIL: ${failed} check(s) failed. Do not rely on this backup.`);
process.exit(failed === 0 ? 0 : 1);
