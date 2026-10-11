// Local-only rehearsal of the account erasure and of the retention job (ADR 0018,
// docs/runbooks/ACCOUNT_DELETION.md). Requires the local Supabase stack and a running app
// (BASE_URL defaults to http://localhost:3100) started with SUPABASE_SECRET_KEY and CRON_SECRET.
// PLAYWRIGHT_MODULE may point to a playwright(-core)/index.mjs; otherwise uses "playwright".
//
// It creates three synthetic accounts (qa-erasure-*@example.test): the person to erase, with a
// personal page, an agency of their own, a real image file in the bucket, a lead, a report link, an
// invitation and a waitlist entry; a bystander with a page and an image; and a platform
// administrator, who runs the erasure from the product's own screen. It then checks, in the
// database and in the bucket, that everything of the person is gone and nothing of the bystander is.
// It removes its own fixture at the end, also when a check fails. No credential is printed.
//
//   node scripts/account-erasure.mjs            run the rehearsal
//   node scripts/account-erasure.mjs --cleanup  only remove leftovers of an interrupted run
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

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

const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });

async function cleanup() {
  const names = sql("select coalesce(string_agg(o.name, ','), '') from storage.objects o where o.bucket_id = 'media' and split_part(o.name, '/', 1) in (select m.id::text from public.media_assets m join public.workspaces w on w.id = m.workspace_id join auth.users u on u.id = w.created_by where u.email like 'qa-erasure-%@example.test');");
  if (names) await service.storage.from("media").remove(names.split(","));
  sql(`
    delete from public.media_assets where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like 'qa-erasure-%@example.test');
    delete from public.workspaces where created_by in (select id from auth.users where email like 'qa-erasure-%@example.test');
    delete from public.slug_history where slug like 'qa-erasure-%';
    delete from public.waitlist_signups where email like 'qa-erasure-%@example.test';
    delete from public.privacy_request_events where request_id in (select id from public.privacy_requests where evidence_reference like 'QA-ERASURE-%' or user_id in (select id from auth.users where email like 'qa-erasure-%@example.test'));
    delete from public.privacy_requests where evidence_reference like 'QA-ERASURE-%' or user_id in (select id from auth.users where email like 'qa-erasure-%@example.test');
    delete from auth.users where email like 'qa-erasure-%@example.test';
  `);
}

if (process.argv.includes("--cleanup")) {
  await cleanup();
  console.log("Removed the qa-erasure-* fixture.");
  process.exit(0);
}

assert((env.SUPABASE_SECRET_KEY ?? "").length > 20 && (env.CRON_SECRET ?? "").length >= 32, "SUPABASE_SECRET_KEY and CRON_SECRET must be in apps/web/.env.local.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const suffix = randomBytes(4).toString("hex");
const evidence = `QA-ERASURE-${suffix}`;
// A few bytes are enough: the cleanup must remove a real object from the bucket, not just a row.
const webp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
let checks = 0;
function check(value, label) { assert(value, label); checks += 1; console.log(`PASS ${label}`); }

function createUser(role) {
  const id = randomUUID();
  const email = `qa-erasure-${role}-${suffix}@example.test`;
  const password = randomBytes(24).toString("hex");
  sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA Erasure"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}','email_verified',true),now(),now());
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);
      perform public.ensure_personal_workspace();
    end $$;
  `);
  const workspace = sql(`select id from public.workspaces where created_by='${id}' and kind='personal';`);
  return { id, email, password, workspace };
}

async function addPageWithImage(workspace, slug) {
  sql(`insert into public.profiles(workspace_id,title,slug) values ('${workspace}','QA Erasure','${slug}');`);
  const profile = sql(`select id from public.profiles where slug='${slug}';`);
  const media = randomUUID();
  const uploaded = await service.storage.from("media").upload(`${media}/448.webp`, webp, { contentType: "image/webp" });
  assert(!uploaded.error, "Could not upload the fixture image to the local bucket.");
  sql(`insert into public.media_assets (id, workspace_id, profile_id, kind, status, width, height, bytes, variants, activated_at)
       values ('${media}','${workspace}','${profile}','image','ready',448,336,${webp.length},'[{"w": 448, "h": 336, "bytes": ${webp.length}}]', now());`);
  return { profile, media };
}

const objects = (media) => Number(sql(`select count(*) from storage.objects where bucket_id='media' and name like '${media}/%';`));

let browser;
try {
  await cleanup();
  const person = createUser("person");
  const bystander = createUser("bystander");
  const admin = createUser("admin");
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}');`);

  const personal = await addPageWithImage(person.workspace, `qa-erasure-p-${suffix}`);
  const agency = sql(`
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${person.id}","role":"authenticated"}', true);
      perform public.create_agency_workspace('QA Erasure Agência');
    end $$;
    select id from public.workspaces where created_by='${person.id}' and kind='agency';`);
  sql(`update public.workspaces set plan_id='agency' where id='${agency}';`);
  const client = await addPageWithImage(agency, `qa-erasure-c-${suffix}`);
  const other = await addPageWithImage(bystander.workspace, `qa-erasure-b-${suffix}`);
  sql(`
    insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, name, email, consent_given, consent_required, consent_text, consent_version, dedupe_key, purge_after)
    values ('${person.workspace}','${personal.profile}','b',1,'QA','qa@example.test',false,false,'x',md5('x'),md5('${suffix}'),now() + interval '90 days'),
           ('${bystander.workspace}','${other.profile}','b',1,'QA','qa@example.test',false,false,'x',md5('x'),md5('b${suffix}'),now() + interval '90 days');
    insert into public.report_links (workspace_id, profile_id, token_hash, period_days, expires_at) values ('${agency}','${client.profile}',encode(extensions.digest('${suffix}','sha256'),'hex'),30,now() + interval '30 days');
    insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at) values ('${bystander.workspace}','${person.email}','editor',encode(extensions.digest('i${suffix}','sha256'),'hex'),now() + interval '7 days');
  `);

  // The person asks, as they would in "Meus dados"; the operator moves the request to processing.
  sql(`
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${person.id}","role":"authenticated"}', true);
      perform public.request_account_deletion();
      perform set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true);
      perform public.review_privacy_request((select id from public.privacy_requests where user_id='${person.id}'), 'processing', 'manual_review');
    end $$;`);
  const request = sql(`select id from public.privacy_requests where user_id='${person.id}';`);
  check(objects(personal.media) === 1 && objects(client.media) === 1 && objects(other.media) === 1, "Fixture: three image files are in the bucket");

  const cookies = [];
  const session = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
  assert(!(await session.auth.signInWithPassword({ email: admin.email, password: admin.password })).error, "QA login failed");
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${base}/app/administracao/privacidade`);
  const form = page.locator(`form:has(input[name="requestId"][value="${request}"]):has(input[name="confirmation"])`);
  await form.waitFor({ timeout: 60000 });
  check(await form.count() === 1, "The queue offers the erasure for the request in processing");

  // Without the confirmation word nothing happens.
  await form.locator('input[name="evidence"]').fill(evidence);
  await form.locator('input[name="confirmation"]').fill("excluir");
  await form.getByRole("button", { name: "Excluir a conta em definitivo" }).click();
  await page.waitForURL(/exclusao=confirmation/);
  check(sql(`select count(*) from auth.users where id='${person.id}';`) === "1" && sql(`select count(*) from public.profiles where workspace_id in ('${person.workspace}','${agency}') and deleted_at is null;`) === "2", "A wrong confirmation word changes nothing");

  await form.locator('input[name="evidence"]').fill(evidence);
  await form.locator('input[name="confirmation"]').fill("EXCLUIR");
  await form.getByRole("button", { name: "Excluir a conta em definitivo" }).click();
  await page.waitForURL(/exclusao=erased/, { timeout: 60000 });
  check(await page.getByRole("status").innerText().then((text) => text.includes("Conta excluída")), "The operator is told the account was erased");

  check(sql(`select count(*) from auth.users where id='${person.id}';`) === "0", "The account is gone from Auth");
  check(sql(`select count(*) from public.workspaces where id in ('${person.workspace}','${agency}');`) === "0", "Both workspaces are gone");
  check(sql(`select (select count(*) from public.profiles where id in ('${personal.profile}','${client.profile}')) + (select count(*) from public.form_leads where profile_id='${personal.profile}') + (select count(*) from public.report_links where workspace_id='${agency}') + (select count(*) from public.media_assets where id in ('${personal.media}','${client.media}')) + (select count(*) from public.workspace_invitations where email='${person.email}') + (select count(*) from public.user_accounts where id='${person.id}') + (select count(*) from public.workspace_memberships where user_id='${person.id}');`) === "0", "Pages, leads, report links, media rows, invitations, the account row and memberships are gone");
  check(objects(personal.media) === 0 && objects(client.media) === 0, "The person's image files are gone from the bucket");
  check(sql(`select status || '/' || reason_code || '/' || evidence_reference from public.privacy_requests where id='${request}';`) === `completed/fulfilled/${evidence}`, "The request is closed with the evidence reference");
  check(sql(`select count(*) from public.audit_events where target_id='${person.id}' and action in ('privacy.erasure_started','privacy.account_erased');`) === "2", "Both steps are in the audit trail");
  check(sql(`select count(*) from public.slug_history where slug in ('qa-erasure-p-${suffix}','qa-erasure-c-${suffix}');`) === "2", "The addresses are on hold");
  const visitor = await fetch(`${base}/qa-erasure-p-${suffix}`);
  check(visitor.status === 404, "The public address answers 404");

  check(sql(`select (select count(*) from auth.users where id='${bystander.id}') + (select count(*) from public.profiles where id='${other.profile}' and deleted_at is null) + (select count(*) from public.form_leads where profile_id='${other.profile}') + (select count(*) from public.media_assets where id='${other.media}');`) === "4" && objects(other.media) === 1, "The bystander's account, page, lead, media row and file are untouched");

  await page.goto(`${base}/app/administracao/privacidade`);
  check(await page.locator(`form:has(input[name="requestId"][value="${request}"]):has(input[name="confirmation"])`).count() === 0, "A closed request no longer offers the erasure");

  // Retention job, through its route, as the scheduler calls it.
  sql(`insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, name, email, consent_given, consent_required, consent_text, consent_version, dedupe_key, purge_after)
       values ('${bystander.workspace}','${other.profile}','b',1,'QA vencido','qa@example.test',false,false,'x',md5('x'),md5('e${suffix}'),now() - interval '1 minute');`);
  check((await fetch(`${base}/api/jobs/retention`)).status === 401, "The retention job refuses a call without the job secret");
  const job = await fetch(`${base}/api/jobs/retention`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  const report = await job.json();
  check(job.status === 200 && report.ok === true && report.leads >= 1, "The retention job runs and purges the expired lead");
  check(sql(`select string_agg(name, ',') from public.form_leads where profile_id='${other.profile}';`) === "QA", "The lead inside its retention period stays");
  check(errors.length === 0, "No browser runtime errors");
  console.log(`${checks} checks passed.`);
} finally {
  await browser?.close();
  await cleanup();
}
