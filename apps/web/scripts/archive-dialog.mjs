// Local-only browser regression for the confirmation dialog of a command that changes its own
// control: archiving turns "Arquivar" into "Desarquivar" once the server re-renders the page list.
// Before the fix, the open dialog took the "Desarquivar" title while showing "Página arquivada.",
// and the next opening showed that old result instead of asking to unarchive.
//
//   PLAYWRIGHT_MODULE  path to a playwright(-core)/index.mjs; otherwise uses "playwright"
//
// Needs a production build made for this address:
//   NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web
//
//   node scripts/archive-dialog.mjs            run
//   node scripts/archive-dialog.mjs --cleanup  only remove the qa-archive-*@example.test accounts
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

const APP_PORT = Number(process.env.APP_PORT ?? 3100);
const base = `http://127.0.0.1:${APP_PORT}`;
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
assert(["localhost", "127.0.0.1"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname), "This script is restricted to the local database.");
const db = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const EMAILS = "qa-archive-%@example.test";

function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error(`Local QA database command failed: ${result.stderr.split("\n")[0]}`);
  return result.stdout.trim();
}

function cleanup() {
  sql(`
    delete from public.profiles where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAILS}');
    delete from public.slug_history where slug like 'qa-archive-%';
    delete from public.workspaces where created_by in (select id from auth.users where email like '${EMAILS}');
    delete from auth.users where email like '${EMAILS}';
  `);
}

if (process.argv.includes("--cleanup")) {
  cleanup();
  console.log("Removed the qa-archive-* fixture.");
  process.exit(0);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const suffix = randomBytes(4).toString("hex");
let checks = 0;
function check(value, label) { assert(value, label); checks += 1; console.log(`PASS ${label}`); }

async function startApp() {
  assert(existsSync(`${APP_DIR}.next/BUILD_ID`), `No production build. Run: NEXT_PUBLIC_APP_URL=${base} npm run build --workspace=@lnk/web`);
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], { cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_PUBLIC_APP_URL: base } });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return child;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw Error(`The application did not start on ${base}:\n${logs.join("").slice(-800)}`);
}

function createOwner() {
  const id = randomUUID();
  const email = `qa-archive-${suffix}@example.test`;
  const password = randomBytes(24).toString("hex");
  const workspace = sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA Arquivo"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}','email_verified',true),now(),now());
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);
      perform public.ensure_personal_workspace();
    end $$;
    select id from public.workspaces where created_by = '${id}' limit 1;
  `).split("\n").at(-1);
  sql(`insert into public.profiles(workspace_id,title,slug) values ('${workspace}','QA Arquivo','qa-archive-${suffix}');`);
  return { email, password, workspace };
}

let browser;
let app;
try {
  cleanup();
  app = await startApp();
  const owner = createOwner();
  const cookies = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
  assert(!(await client.auth.signInWithPassword({ email: owner.email, password: owner.password })).error, "QA login failed");
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" });
  const context = await browser.newContext();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/app/w/${owner.workspace}`);

  const dialog = page.locator("dialog[open]");
  const heading = dialog.getByRole("heading", { level: 2 });

  await page.getByRole("button", { name: "Arquivar: QA Arquivo" }).click();
  check((await heading.innerText()) === "Arquivar esta página?", "The archive dialog asks to archive");
  await dialog.getByRole("button", { name: "Arquivar página" }).click();
  await dialog.getByText("Página arquivada.").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Desarquivar: QA Arquivo" }).waitFor({ timeout: 30000 });
  check((await heading.innerText()) === "Arquivar esta página?", "After archiving, with the list already re-rendered, the open dialog keeps its title");
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();

  await page.getByRole("button", { name: "Desarquivar: QA Arquivo" }).click();
  check((await heading.innerText()) === "Desarquivar esta página?", "The next opening asks to unarchive");
  check(await dialog.getByRole("button", { name: "Desarquivar página" }).isVisible(), "It offers to unarchive instead of showing the previous result");
  check(!(await dialog.getByText("Página arquivada.").isVisible()), "The archive result is gone");
  await dialog.getByRole("button", { name: "Desarquivar página" }).click();
  await dialog.getByText("Página desarquivada.", { exact: false }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Arquivar: QA Arquivo" }).waitFor({ timeout: 30000 });
  check((await heading.innerText()) === "Desarquivar esta página?", "After unarchiving, the open dialog keeps its title");
  check(sql(`select status from public.profiles where slug = 'qa-archive-${suffix}';`) === "draft", "The page is a draft again");
  check(errors.length === 0, `No runtime error${errors.length ? `: ${errors.join("; ")}` : ""}`);
  console.log(`\n${checks} checks passed.`);
} finally {
  await browser?.close();
  app?.kill();
  cleanup();
}
