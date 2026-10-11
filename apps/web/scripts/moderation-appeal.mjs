// Local-only browser check of the suspension notice and appeal, and of the operational status
// route (ADR 0019). Requires the local Supabase stack and a running app (BASE_URL defaults to
// http://localhost:3100). To cover the status route, start the app with OPS_STATUS_SECRET and
// pass the same value to this script; without it those checks are skipped.
// PLAYWRIGHT_MODULE may point to a playwright(-core)/index.mjs; otherwise uses "playwright".
//
// Creates three synthetic accounts (qa-appeal-*@example.test): the owner of a page, an editor of
// the same workspace and a platform administrator, and removes them at the end, also when a check
// fails. No credential is printed.
//
//   node scripts/moderation-appeal.mjs            run the check
//   node scripts/moderation-appeal.mjs --cleanup  only remove leftovers of an interrupted run
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const local = (value) => ["localhost", "127.0.0.1"].includes(new URL(value).hostname);
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
assert(local(base) && local(env.NEXT_PUBLIC_SUPABASE_URL), "This script is restricted to the local app and database.");
const db = process.env.DB_CONTAINER ?? "supabase_db_lnk";

function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error(`Local QA database command failed: ${result.stderr.split("\n")[0]}`);
  return result.stdout.trim();
}

function cleanup() {
  sql(`
    delete from public.workspaces where created_by in (select id from auth.users where email like 'qa-appeal-%@example.test');
    delete from public.slug_history where slug like 'qa-appeal-%';
    delete from auth.users where email like 'qa-appeal-%@example.test';
  `);
}

if (process.argv.includes("--cleanup")) {
  cleanup();
  console.log("Removed the qa-appeal-* fixture.");
  process.exit(0);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const suffix = randomBytes(4).toString("hex");
let checks = 0;
function check(value, label) { assert(value, label); checks += 1; console.log(`PASS ${label}`); }

function createUser(role) {
  const id = randomUUID();
  const email = `qa-appeal-${role}-${suffix}@example.test`;
  const password = randomBytes(24).toString("hex");
  sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA Appeal"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}','email_verified',true),now(),now());
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);
      perform public.ensure_personal_workspace();
    end $$;
  `);
  return { id, email, password };
}

async function session(browser, user, viewport) {
  const cookies = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
  assert(!(await client.auth.signInWithPassword({ email: user.email, password: user.password })).error, "QA login failed");
  const context = await browser.newContext({ viewport });
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" })));
  return context.newPage();
}

const asAdmin = (admin, statement) => sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true); ${statement} end $$;`);

let browser;
try {
  cleanup();
  const owner = createUser("owner");
  const editor = createUser("editor");
  const admin = createUser("admin");
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}');`);
  const workspace = sql(`
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true);
      perform public.create_agency_workspace('QA Appeal');
    end $$;
    select id from public.workspaces where created_by='${owner.id}' and kind='agency';`);
  const slug = `qa-appeal-${suffix}`;
  sql(`
    update public.workspaces set plan_id='agency' where id='${workspace}';
    insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values ('${workspace}','${editor.id}','editor','active',now());
    insert into public.profiles(workspace_id,title,slug) values ('${workspace}','Loja da Marina','${slug}');`);
  const profile = sql(`select id from public.profiles where slug='${slug}';`);
  const home = `${base}/app/w/${workspace}`;
  const screen = `${home}/paginas/${profile}/moderacao`;

  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });
  const ownerPage = await session(browser, owner, { width: 390, height: 844 });
  const errors = [];
  ownerPage.on("pageerror", (error) => errors.push(error.message));

  await ownerPage.goto(home);
  await ownerPage.locator(".app-tabs").waitFor({ timeout: 60000 });
  check(await ownerPage.getByText("Ver o motivo e contestar").count() === 0, "No notice while nothing is suspended");

  asAdmin(admin, `perform public.set_profile_moderation('${profile}', true, 'Suspensa no ensaio local de contestação.');`);
  await ownerPage.goto(home);
  const notice = ownerPage.getByRole("alert").filter({ hasText: "suspensa pela moderação" });
  await notice.waitFor();
  check(await notice.innerText().then((text) => text.includes("Loja da Marina")), "Every workspace screen names the suspended page");
  check(!(await notice.innerText()).includes("ensaio local"), "The administrator's justification is not shown");
  check(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "The notice fits a phone screen");
  await ownerPage.goto(`${home}/resultados`);
  check(await ownerPage.getByText("Ver o motivo e contestar").count() === 1, "The notice is on the other workspace screens too");

  await ownerPage.getByRole("link", { name: "Ver o motivo e contestar" }).click();
  await ownerPage.waitForURL(/\/moderacao$/);
  check(await ownerPage.getByText("Descumprimento das regras de uso").count() === 1, "The screen shows the category of the suspension");
  await ownerPage.getByLabel("Sua contestação").fill("curto");
  await ownerPage.getByRole("button", { name: "Enviar contestação" }).click();
  await ownerPage.getByText("Escreva pelo menos 20 caracteres.").waitFor();
  check(sql(`select count(*) from public.moderation_appeals where profile_id='${profile}';`) === "0", "A message that is too short is refused with its reason and nothing is recorded");
  await ownerPage.getByLabel("Sua contestação").fill("A página é da nossa própria loja.\nSegue o endereço do nosso registro para conferência.");
  await ownerPage.getByRole("button", { name: "Enviar contestação" }).click();
  await ownerPage.getByText("Sua contestação foi recebida e está em análise.").waitFor({ timeout: 30000 });
  check(await ownerPage.getByRole("button", { name: "Enviar contestação" }).count() === 0, "After sending, the form gives way to the waiting state");
  check(await ownerPage.getByText("Em análise", { exact: true }).count() === 1, "The appeal is listed as waiting");

  const editorPage = await session(browser, editor, { width: 390, height: 844 });
  await editorPage.goto(screen);
  await editorPage.getByText("Só o proprietário e os administradores da conta podem contestar.").waitFor({ timeout: 60000 });
  check(await editorPage.getByLabel("Sua contestação").count() === 0 && !(await editorPage.locator("main").innerText()).includes("nossa própria loja"), "An editor sees the notice, not the form or the appeal text");

  const adminPage = await session(browser, admin, { width: 1280, height: 900 });
  await adminPage.goto(screen);
  await adminPage.waitForLoadState("networkidle");
  const outside = await adminPage.locator("body").innerText();
  check(!outside.includes("Suspensão da página") && !outside.includes("Loja da Marina") && !outside.includes("nossa própria loja"), "A person outside the workspace sees nothing of the screen");
  await adminPage.goto(`${base}/app/administracao/denuncias`);
  const card = adminPage.locator("article").filter({ hasText: slug });
  await card.waitFor({ timeout: 60000 });
  check(await card.innerText().then((text) => text.includes("nossa própria loja")), "The administrator reads the appeal in the queue");
  await card.getByLabel("Resposta ao dono da página").fill("Registro conferido. A página volta ao ar.");
  await card.getByRole("button", { name: "Aceitar e reativar a página" }).click();
  await adminPage.locator("article").filter({ hasText: slug }).getByText("aceita", { exact: true }).waitFor({ timeout: 30000 });
  check(sql(`select moderation_status from public.profiles where id='${profile}';`) === "active", "Accepting the appeal reactivates the page");

  await ownerPage.goto(home);
  await ownerPage.locator(".app-tabs").waitFor();
  check(await ownerPage.getByText("Ver o motivo e contestar").count() === 0, "The notice is gone once the page is back");
  await ownerPage.goto(screen);
  check(await ownerPage.getByText("Esta página não está suspensa.").count() === 1, "The screen says the page is no longer suspended");
  check(sql(`select count(*) from public.audit_events where target_id='${profile}' and action in ('moderation.suspended','moderation.appealed','moderation.appeal_decided','moderation.reactivated');`) === "4", "Suspension, appeal, decision and reactivation are in the audit trail");
  check(errors.length === 0, "No browser runtime errors");

  const secret = process.env.OPS_STATUS_SECRET ?? "";
  if (secret.length >= 32) {
    check((await fetch(`${base}/api/ops/status`)).status === 401, "The status route refuses a call without its secret");
    const response = await fetch(`${base}/api/ops/status`, { headers: { authorization: `Bearer ${secret}` } });
    const body = await response.json();
    check(Array.isArray(body.checks) && body.checks.length === 11 && body.checks.filter((item) => item.name.startsWith("job:")).length === 4, "The status route answers with the eleven checks");
    check(!JSON.stringify(body).includes("@") && !JSON.stringify(body).includes(slug), "The status body names no address and no page");
  } else {
    console.log("SKIP status route (start the app with OPS_STATUS_SECRET and pass it to this script)");
  }
  console.log(`${checks} checks passed.`);
} finally {
  await browser?.close();
  cleanup();
}
