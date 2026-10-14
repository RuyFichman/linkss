// Local-only rehearsal of transactional e-mail (ADR 0021, docs/runbooks/MAIL.md) and of the
// invitation confirmed on another device (ADR 0012, addendum). It starts a stand-in for Resend's
// `POST /emails` on loopback, starts the production build against it and the local Supabase stack,
// and plays every notice: a form contact sent from a real browser, the preference that turns it
// off, a suspension, an answered appeal, a failed payment, a yearly renewal, a provider that fails
// once, and the daily job. Then a person signs up from an invitation in one browser and opens the
// confirmation e-mail (read from the local Mailpit) in another, with no cookie in common.
//
//   PLAYWRIGHT_MODULE  path to a playwright(-core)/index.mjs; otherwise uses "playwright"
//   BROWSER_EXECUTABLE a Chrome/Chromium binary; otherwise the installed Chrome channel
//
// Needs a production build for http://127.0.0.1:3100 and the local stack started after
// supabase/config.toml and the confirmation template were last changed (`npx supabase stop` and
// `npx supabase start`; data is kept). Creates qa-mail-*@example.test accounts and removes them.
//
//   node scripts/mail-lifecycle.mjs            run
//   node scripts/mail-lifecycle.mjs --cleanup  only remove leftovers of an interrupted run
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

const APP_PORT = 3100;
const STAND_IN_PORT = Number(process.env.STAND_IN_PORT ?? 4800);
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const base = `http://127.0.0.1:${APP_PORT}`;
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
assert(["localhost", "127.0.0.1"].includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname), "This script is restricted to the local database.");
assert((env.CRON_SECRET ?? "").length >= 32 && (env.SUPABASE_SECRET_KEY ?? "").length > 20, "CRON_SECRET and SUPABASE_SECRET_KEY must be in apps/web/.env.local.");
const db = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const EMAILS = "qa-mail-%@example.test";

function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error(`Local QA database command failed: ${result.stderr.split("\n")[0]}`);
  return result.stdout.trim();
}

function cleanup() {
  sql(`
    delete from public.billing_events where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAILS}');
    delete from public.profiles where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAILS}');
    delete from public.slug_history where slug like 'qa-mail-%';
    delete from public.workspaces where created_by in (select id from auth.users where email like '${EMAILS}');
    delete from auth.users where email like '${EMAILS}';
  `);
}

if (process.argv.includes("--cleanup")) {
  cleanup();
  console.log("Removed the qa-mail-* fixture.");
  process.exit(0);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const suffix = randomBytes(4).toString("hex");
let checks = 0;
function check(value, label) { assert(value, label); checks += 1; console.log(`PASS ${label}`); }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Stand-in for Resend: records every request; can be told to fail the next ones. ----
const received = [];
let failNext = 0;
const standIn = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const entry = { method: request.method, path: request.url, headers: request.headers, body: (() => { try { return JSON.parse(body); } catch { return null; } })() };
    if (failNext > 0) {
      failNext -= 1;
      entry.answered = 503;
      received.push(entry);
      response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ name: "internal_server_error" }));
      return;
    }
    entry.answered = 200;
    received.push(entry);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `re_local_${received.length}` }));
  });
});
await new Promise((resolve) => standIn.listen(STAND_IN_PORT, "127.0.0.1", resolve));
const sentTo = (address) => received.filter((entry) => entry.answered === 200 && entry.body?.to?.[0] === address);

async function startApp() {
  assert(existsSync(`${APP_DIR}.next/BUILD_ID`), `No production build. Run: NEXT_PUBLIC_APP_URL=${base} npm run build --workspace=@lnk/web`);
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_PUBLIC_APP_URL: base, BILLING_MODE: "off", RESEND_API_KEY: "re_local_standin_000000000000", MAIL_FROM: "Linkfav <avisos@linkfav.example>", RESEND_API_BASE_URL: `http://127.0.0.1:${STAND_IN_PORT}`, SUPPORT_EMAIL: "ajuda@linkfav.example" },
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { child, logs };
    } catch {
      // Not listening yet.
    }
    await wait(500);
  }
  child.kill();
  throw Error(`The application did not start on ${base}:\n${logs.join("").slice(-800)}`);
}

function createUser(role) {
  const id = randomUUID();
  const email = `qa-mail-${role}-${suffix}@example.test`;
  const password = randomBytes(24).toString("hex");
  sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA ${role}"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}','email_verified',true),now(),now());
    do $$ begin perform set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true); perform public.ensure_personal_workspace(); end $$;
  `);
  return { id, email, password };
}

async function signedIn(browser, user) {
  const cookies = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
  assert(!(await client.auth.signInWithPassword({ email: user.email, password: user.password })).error, "QA login failed");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: "127.0.0.1", path: "/", sameSite: "Lax" })));
  return context;
}

async function runMailJob() {
  const response = await fetch(`${base}/api/jobs/mail`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  return { status: response.status, body: await response.json() };
}

async function until(condition, label, timeoutMs = 15000) {
  for (const started = Date.now(); Date.now() - started < timeoutMs;) {
    if (await condition()) return true;
    await wait(250);
  }
  throw Error(`Timed out waiting for: ${label}`);
}

let browser;
let app;
try {
  cleanup();
  app = await startApp();
  const owner = createUser("owner");
  const admin = createUser("admin");
  const moderator = createUser("moderator");
  sql(`insert into public.platform_admins (user_id) values ('${moderator.id}');`);
  const workspace = sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true); perform set_config('tests.ws', public.create_agency_workspace('QA Correio ${suffix}')::text, true); end $$; select id from public.workspaces where name = 'QA Correio ${suffix}';`);
  sql(`update public.workspaces set plan_id = 'agency' where id = '${workspace}';
       insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values ('${workspace}', '${admin.id}', 'admin', 'active', now());`);
  const slug = `qa-mail-${suffix}`;
  const blocks = JSON.stringify([{ id: randomUUID(), type: "form", title: "Fale comigo", fields: ["name", "email", "message"], buttonLabel: "Enviar", consentText: "Aceito ser contatado.", consentRequired: true, visible: true }]);
  sql(`do $$ begin
    perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true);
    perform set_config('role', 'authenticated', true);
    insert into public.profiles (workspace_id, title, slug) values ('${workspace}', 'Ateliê QA', '${slug}');
    update public.profiles set blocks = '${blocks}'::jsonb where slug = '${slug}';
  end $$;`);
  const profile = sql(`select id from public.profiles where slug = '${slug}';`);
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true); perform public.publish_profile('${profile}'); end $$;`);

  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });
  const errors = [];

  // ---- The admin turns off the contact notice in "Meus dados". ----
  const adminContext = await signedIn(browser, admin);
  const adminPage = await adminContext.newPage();
  adminPage.on("pageerror", (error) => errors.push(error.message));
  await adminPage.goto(`${base}/app/conta/dados#avisos`);
  const box = adminPage.getByLabel("Receber um e-mail quando alguém preencher o formulário de uma página que eu administro");
  await box.waitFor({ timeout: 60000 });
  check(await box.isChecked(), "The contact notice is on by default");
  await box.uncheck();
  await adminPage.getByRole("button", { name: "Salvar" }).click();
  await adminPage.getByText("Preferência salva.").waitFor();
  check(sql(`select notify_new_leads from public.user_accounts where id = '${admin.id}';`) === "f", "The admin turned it off for themselves");

  // ---- A visitor sends the form; the owner gets one notice, after the answer. ----
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitorPage = await visitor.newPage();
  visitorPage.on("pageerror", (error) => errors.push(error.message));
  await visitorPage.goto(`${base}/${slug}`);
  await visitorPage.getByLabel("Nome").fill("Visitante Sigiloso");
  await visitorPage.getByLabel("E-mail").fill("visitante-sigiloso@example.test");
  await visitorPage.getByLabel("Mensagem").fill("conteudo sigiloso");
  await visitorPage.getByRole("checkbox").check();
  const before = received.length;
  const started = Date.now();
  await visitorPage.getByRole("button", { name: "Enviar" }).click();
  await visitorPage.getByRole("status").filter({ hasText: /recebid|enviad|Obrigad/i }).first().waitFor({ timeout: 20000 });
  const answeredIn = Date.now() - started;
  await until(() => sentTo(owner.email).length === 1, "the owner's contact notice");
  const notice = sentTo(owner.email)[0];
  console.log(`     the visitor saw the answer in ${answeredIn} ms; the notice reached the provider after it`);
  check(notice.body.subject === "Novo contato na página Ateliê QA", "The owner gets \"Novo contato na página Ateliê QA\"");
  check(!/Sigiloso|sigiloso/.test(JSON.stringify(notice.body)), "Nothing the visitor typed is in the e-mail");
  check(notice.body.text.includes(`${base}/app/w/${workspace}/paginas/${profile}/contatos`), "It links to the contacts of that page");
  check(/^lnk-mail-[0-9a-f-]{36}$/.test(notice.headers["idempotency-key"] ?? ""), "It carries the outbox id as the idempotency key");
  check(notice.headers.authorization === "Bearer re_local_standin_000000000000" && notice.body.from === "Linkfav <avisos@linkfav.example>" && notice.body.reply_to === "ajuda@linkfav.example", "It goes with the key, the sender and the support address as reply-to");
  check(sentTo(admin.email).length === 0, "The admin who turned it off gets nothing");
  await visitorPage.goto(`${base}/${slug}`);
  await visitorPage.getByLabel("Nome").fill("Outra Pessoa");
  await visitorPage.getByLabel("E-mail").fill("outra@example.test");
  await visitorPage.getByLabel("Mensagem").fill("oi");
  await visitorPage.getByRole("checkbox").check();
  await visitorPage.getByRole("button", { name: "Enviar" }).click();
  await visitorPage.getByRole("status").filter({ hasText: /recebid|enviad|Obrigad/i }).first().waitFor({ timeout: 20000 });
  await wait(2500);
  check(received.length === before + 1 && sql(`select count(*) from public.form_leads where profile_id = '${profile}';`) === "2", "A second contact in the same hour is stored and sends no second e-mail");

  // ---- Suspension, appeal, failed payment and renewal: queued by the database, sent by the job. ----
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${moderator.id}","role":"authenticated"}', true); perform public.set_profile_moderation('${profile}', true, 'Imita uma marca, conforme denúncia de teste.', null); end $$;`);
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true); perform public.submit_moderation_appeal('${profile}', 'A marca é nossa; o registro está em nome da empresa.'); end $$;`);
  const appeal = sql(`select id from public.moderation_appeals where profile_id = '${profile}';`);
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${moderator.id}","role":"authenticated"}', true); perform public.decide_moderation_appeal('${appeal}', true, 'Conferimos o registro da marca. A página voltou ao ar.'); end $$;`);
  sql(`insert into public.billing_customers (workspace_id, provider, provider_customer_id) values ('${workspace}', 'stripe', 'cus_qa_mail_${suffix}');
       insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, grace_until, current_period_end, observed_at)
       values ('${workspace}', 'stripe', 'sub_qa_mail_${suffix}', 'cus_qa_mail_${suffix}', 'agency', 'year', 57900, 'BRL', 'past_due', now() + interval '7 days', now() + interval '3 days', now());`);
  check(sql(`select string_agg(kind || ':' || status, ',' order by kind) from public.mail_outbox where workspace_id = '${workspace}' and kind <> 'new_lead' and recipient_user_id = '${owner.id}';`) === "appeal_decided:pending,page_suspended:pending,payment_failed:pending", "The database queued the suspension, the answer and the failed payment for the owner");
  failNext = 1;
  let job = await runMailJob();
  check(job.status === 200 && job.body.outcome === "partial" && job.body.retried === 1, `The job sends what is due; one message hit a provider failure and waits (${JSON.stringify({ sent: job.body.sent, retried: job.body.retried })})`);
  const retrying = sql(`select id from public.mail_outbox where workspace_id = '${workspace}' and status = 'pending' and attempts = 1 limit 1;`);
  const failedKey = received.find((entry) => entry.answered === 503)?.headers["idempotency-key"];
  sql(`update public.mail_outbox set next_attempt_at = now() where id = '${retrying}';`);
  job = await runMailJob();
  check(job.status === 200 && job.body.outcome === "ok" && job.body.sent >= 1, "The next run sends it");
  check(received.filter((entry) => entry.headers["idempotency-key"] === failedKey).map((entry) => entry.answered).join(",") === "503,200", "With the same idempotency key as the attempt that failed");
  const subjects = sentTo(owner.email).map((entry) => entry.body.subject).sort();
  check(subjects.includes("A página Ateliê QA foi suspensa") && subjects.includes("Contestação aceita: a página Ateliê QA voltou ao ar") && subjects.includes("Não conseguimos cobrar o plano Agência"), `The owner got the suspension, the answer and the failed payment (${subjects.length} e-mails)`);
  const answer = sentTo(admin.email).find((entry) => entry.body.subject.startsWith("Contestação aceita"));
  check(answer?.body.text.includes("Conferimos o registro da marca.") && !JSON.stringify(sentTo(admin.email)).includes("Imita uma marca"), "The admin got the answer written for the workspace, and never the moderator's justification");
  check(!sentTo(admin.email).some((entry) => /cobrar|renova/.test(entry.body.subject)), "Billing notices go to the owner only");
  sql(`update public.billing_subscriptions set status = 'active', grace_until = null where provider_subscription_id = 'sub_qa_mail_${suffix}';`);
  job = await runMailJob();
  check(job.body.reminders === 1 && sentTo(owner.email).some((entry) => /^Sua assinatura anual do plano Agência renova em \d{2}\/\d{2}\/\d{4}$/.test(entry.body.subject) && entry.body.text.includes("R$ 579,00")), "A yearly renewal in three days gets one reminder with the amount");
  job = await runMailJob();
  check(job.body.reminders === 0 && job.body.claimed === 0, "Running the job again sends nothing twice");
  check(sql(`select count(*) from public.mail_outbox where workspace_id = '${workspace}' and status <> 'sent';`) === "0", "Every message of this workspace ended as sent");
  check((await fetch(`${base}/api/jobs/mail`, { method: "POST" })).status === 401, "The job refuses a call without its secret");
  const logLines = app.logs.join("").split("\n").filter((line) => line.includes('"mail.'));
  check(logLines.length > 0 && !logLines.some((line) => /example\.test|example|Sigiloso|Ateliê/.test(line)), `The application logged ${logLines.length} mail lines, none with an address or a name`);

  // ---- Invitation: sign up on one device, confirm on another. ----
  const token = randomBytes(32).toString("base64url");
  const invitee = `qa-mail-invitee-${suffix}@example.test`;
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true);
    perform public.create_workspace_invitation('${workspace}', '${invitee}', 'editor', '${createHash("sha256").update(token, "utf8").digest("hex")}'); end $$;`);
  const invitationPath = `/app/convite/${token}`;
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  phonePage.on("pageerror", (error) => errors.push(error.message));
  await phonePage.goto(`${base}/cadastro?next=${encodeURIComponent(invitationPath)}`);
  await phonePage.getByLabel("Nome").fill("Pessoa Convidada");
  await phonePage.getByLabel("E-mail").fill(invitee);
  await phonePage.getByLabel("Senha").fill("Convite2026seguro");
  await phonePage.locator("form button[type=submit]").click();
  await phonePage.getByRole("status").first().waitFor({ timeout: 30000 });
  let link = null;
  await until(async () => {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${invitee}`)}`).then((response) => response.json());
    const id = search.messages?.[0]?.ID;
    if (!id) return false;
    const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((response) => response.json());
    link = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(message.HTML ?? "")?.[1]?.replace(/&amp;/g, "&") ?? null;
    return link !== null;
  }, "the confirmation e-mail in Mailpit", 30000);
  check(new URL(link).searchParams.get("redirect_to")?.includes(encodeURIComponent(invitationPath).replace(/%2F/g, "/")) || new URL(link).searchParams.get("redirect_to")?.includes(invitationPath), "The confirmation e-mail carries the invitation in redirect_to");
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const laptopPage = await laptop.newPage();
  laptopPage.on("pageerror", (error) => errors.push(error.message));
  // Locally the Auth site address is the dev server's (supabase/config.toml); this build runs on another port.
  await laptopPage.goto(link.replace(new URL(link).origin, base));
  await laptopPage.waitForURL((url) => url.pathname === invitationPath, { timeout: 30000 });
  check(true, "Opened on another device, with no cookie in common, the link lands on the invitation");
  await laptopPage.getByRole("button", { name: /Aceitar/ }).click();
  await laptopPage.waitForURL((url) => url.pathname === `/app/w/${workspace}`, { timeout: 30000 });
  check(sql(`select m.role from public.workspace_memberships m join auth.users u on u.id = m.user_id where u.email = '${invitee}' and m.workspace_id = '${workspace}' and m.status = 'active';`) === "editor", "The invitation is accepted from the other device");

  check(errors.length === 0, `No browser runtime errors${errors.length ? `: ${errors[0]}` : ""}`);
  console.log(`\n${checks} checks passed.`);
} finally {
  await browser?.close();
  app?.child.kill();
  standIn.close();
  cleanup();
}
