// Billing life cycle on the local stack (Sprint 8 part 1, D7; ADR 0014).
//
// A payment provider's sandbox cannot call localhost and no provider account exists yet, so this
// script IS the provider: it serves a local emulator of the part of Stripe's API the adapter uses
// (src/modules/billing/testing/stripe-emulator.ts, written from Stripe's documentation), starts the
// production build of the application pointed at it, and then plays a whole subscription life
// against the REAL adapter, the REAL webhook route, the REAL Server Actions and the REAL database:
//
//   limit reached -> subscribe -> pay -> renew -> a payment fails -> recovered -> fails again ->
//   grace ends -> the provider gives up -> subscribe again -> upgrade -> downgrade -> cancel -> end
//
// with, at each step, a duplicated delivery, a concurrent delivery and an out-of-order delivery,
// and with the negative cases: forged, unsigned, stale and oversized webhooks; an event for an
// unknown customer and for another workspace's customer; an amount that is not in the catalogue;
// the success address opened without paying; a checkout started twice; the owner's own form
// replayed with an admin's, an editor's, an outsider's and nobody's session; direct calls to the
// RPCs and direct writes to the billing tables with each role.
//
// What it proves: the product is consistent with our reading of Stripe's documentation, end to end.
// What it does not prove: that Stripe behaves as the emulator does. That needs a Stripe sandbox.
//
// LOCAL STACK ONLY. It refuses to run against anything that is not a local Supabase. It creates the
// accounts qa-billing-*@example.test with their workspaces and pages, and the local Vault secret
// `billing_signing_secret` if it does not exist (never printed). It never touches other accounts.
// The clock is moved only by editing the script's own subscription rows (grace_until, held_until)
// and then running the product's own job. --cleanup removes every qa-billing-* account.
//
//   npm run db:start                                                        (repository root)
//   NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web
//   node scripts/billing-lifecycle.mjs              (in apps/web) runs everything and exits
//   node scripts/billing-lifecycle.mjs --serve      keeps the emulator and the app up for a browser:
//                                                   its checkout page has "pay", "leave pending" and
//                                                   "go back" buttons, and /emulator shows controls
//   node scripts/billing-lifecycle.mjs --cleanup    removes what it created
//
// Reads apps/web/.env.local for the Supabase URL, the publishable key and CRON_SECRET.
// Environment: APP_PORT (default 3100), EMULATOR_PORT (default 4242), DB_CONTAINER (supabase_db_lnk).

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { createStripeEmulator } from "../src/modules/billing/testing/stripe-emulator.ts";

const APP_PORT = Number(process.env.APP_PORT ?? 3100);
const EMULATOR_PORT = Number(process.env.EMULATOR_PORT ?? 4242);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const EMULATOR_URL = `http://127.0.0.1:${EMULATOR_PORT}`;
const DB_CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const CLEANUP = process.argv.includes("--cleanup");
const SERVE = process.argv.includes("--serve");
const EMAIL_PREFIX = "qa-billing-";
const SLUG_PREFIX = "qa-billing-";
const WORKSPACE = "QA Cobrança";
const ERASURE_EVIDENCE = "QA-BILLING-ERASURE";
// Local-only values for the emulator. They are not secrets of any real account.
const STRIPE_KEY = "sk_test_local_emulator_0000000000000000";
const WEBHOOK_SECRET = "whsec_local_emulator_0000000000000000";
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function readEnv() {
  const text = readFileSync(fileURLToPath(new URL("../.env.local", import.meta.url)), "utf8");
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
}

const env = readEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(SUPABASE_URL)) {
  console.error("Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a local Supabase stack.");
  process.exit(2);
}

function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}

function cleanup() {
  // Media, pages and billing rows cascade from the workspaces; the ledger has no foreign key.
  sql(`
    delete from public.billing_events where provider_event_id like 'evt_emu%' or provider_event_id like 'reconcile:%_emu%' or provider_event_id in ('evt_unknown_customer', 'evt_crossed');
    delete from public.billing_events where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAIL_PREFIX}%@example.test');
    delete from public.profiles where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAIL_PREFIX}%@example.test');
    delete from public.slug_history where slug like '${SLUG_PREFIX}%';
    delete from public.workspaces where created_by in (select id from auth.users where email like '${EMAIL_PREFIX}%@example.test');
    delete from public.privacy_request_events where request_id in (select id from public.privacy_requests where evidence_reference = '${ERASURE_EVIDENCE}' or user_id in (select id from auth.users where email like '${EMAIL_PREFIX}%@example.test'));
    delete from public.privacy_requests where evidence_reference = '${ERASURE_EVIDENCE}' or user_id in (select id from auth.users where email like '${EMAIL_PREFIX}%@example.test');
    delete from auth.users where email like '${EMAIL_PREFIX}%@example.test';`);
}

if (CLEANUP) {
  cleanup();
  console.log(`Removed the ${EMAIL_PREFIX}*@example.test accounts, their workspaces, pages and billing rows.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** Four people (random passwords that exist only in this process), one agency workspace on the free plan. */
function setupAccounts(password) {
  cleanup();
  const people = ["owner", "admin", "editor", "outsider"];
  const out = sql(`
    do $$
    declare
      v_name text;
      v_user uuid;
      v_owner uuid;
      v_workspace uuid;
    begin
      foreach v_name in array array['owner', 'admin', 'editor', 'outsider'] loop
        v_user := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', '${EMAIL_PREFIX}' || v_name || '@example.test', extensions.crypt('${password}', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', 'QA ' || v_name), now(), now(), '', '', '', '');
        insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
        values (gen_random_uuid(), v_user, v_user::text, 'email', jsonb_build_object('sub', v_user::text, 'email', '${EMAIL_PREFIX}' || v_name || '@example.test', 'email_verified', true), now(), now());
        perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
        perform public.ensure_personal_workspace();
        if v_name = 'owner' then
          v_owner := v_user;
          v_workspace := public.create_agency_workspace('${WORKSPACE}');
        elsif v_name = 'outsider' then
          perform public.create_agency_workspace('QA Cobrança Vizinha');
        end if;
      end loop;
      perform set_config('request.jwt.claims', '', true);
      -- Colleagues need seats: a larger plan for the two inserts, then back to how a workspace starts.
      update public.workspaces set plan_id = 'agency' where id = v_workspace;
      insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
      select v_workspace, u.id, case when u.email like '%admin%' then 'admin' else 'editor' end::public.workspace_role, 'active', now()
      from auth.users u where u.email in ('${EMAIL_PREFIX}admin@example.test', '${EMAIL_PREFIX}editor@example.test');
      update public.workspaces set plan_id = 'free' where id = v_workspace;
    end;
    $$;
    select w.id || '|' || (select o.id from public.workspaces o join auth.users ou on ou.id = o.created_by where ou.email = '${EMAIL_PREFIX}outsider@example.test' and o.kind = 'agency')
    from public.workspaces w where w.name = '${WORKSPACE}';`);
  const [workspaceId, outsiderWorkspaceId] = out.split("|");
  return { workspaceId, outsiderWorkspaceId, people };
}

/** A signed-in session the way the browser holds it: the cookies @supabase/ssr sets. */
async function signIn(name, password) {
  const jar = new Map();
  const supabase = createServerClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([key, value]) => ({ name: key, value })),
      setAll: (cookies) => {
        for (const { name: key, value } of cookies) {
          if (value) jar.set(key, value);
          else jar.delete(key);
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: `${EMAIL_PREFIX}${name}@example.test`, password });
  if (error) throw new Error(`sign-in failed for ${name}: ${error.message}`);
  return { name, supabase, cookie: () => [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ") };
}

// ---------------------------------------------------------------------------------------------
// The provider: emulator over HTTP, with a checkout page for the browser
// ---------------------------------------------------------------------------------------------

const emulator = createStripeEmulator({ webhookSecret: WEBHOOK_SECRET, now: () => new Date(), origin: EMULATOR_URL, runId: randomBytes(3).toString("hex") });

async function deliver(delivery, overrides = {}) {
  const response = await fetch(`${BASE_URL}/api/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(overrides.signature === null ? {} : { "stripe-signature": overrides.signature ?? delivery.signatureHeader }) },
    body: overrides.body ?? delivery.rawBody,
  });
  return response.status;
}

/** Sends every delivery once, in order. */
async function deliverAll(deliveries) {
  const statuses = [];
  for (const delivery of deliveries) statuses.push(await deliver(delivery));
  return statuses;
}

/** The hostile mailman: reversed order, every delivery three times at once, then everything again. */
async function deliverBadly(deliveries) {
  const statuses = [];
  for (const delivery of [...deliveries].reverse()) statuses.push(...(await Promise.all([deliver(delivery), deliver(delivery), deliver(delivery)])));
  for (const delivery of deliveries) statuses.push(await deliver(delivery));
  return statuses;
}

const page = (title, body) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><p style="background:#fff3cd;padding:.5rem 1rem;border-radius:.5rem"><b>Emulador local</b>: nenhuma cobrança real.</p><h1>${title}</h1>${body}</body></html>`;
const button = (action, label) => `<form method="post" action="${action}" style="margin:.5rem 0"><button style="min-height:44px;padding:0 1rem;font-size:1rem">${label}</button></form>`;

function startEmulatorServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", EMULATOR_URL);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const html = (status, text) => response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(text);
    const redirect = (location) => response.writeHead(303, { location }).end();

    const checkout = /^\/emulator\/checkout\/([A-Za-z0-9_]+)(\/(pay|pending|back))?$/.exec(url.pathname);
    if (checkout) {
      const session = emulator.session(checkout[1]);
      if (!session) return html(404, page("Checkout não encontrado", ""));
      if (request.method === "GET") {
        return html(200, page("Pagamento (emulado)", `<p>Valor: <b>R$ ${(session.amount / 100).toFixed(2).replace(".", ",")}</b> por ${session.interval === "year" ? "ano" : "mês"}.</p>
          ${button(`${url.pathname}/pay`, "Pagar")}${button(`${url.pathname}/pending`, "Deixar o pagamento pendente")}${button(`${url.pathname}/back`, "Voltar sem pagar")}`));
      }
      if (checkout[3] === "back") return redirect(session.cancelUrl);
      const { deliveries } = emulator.completeCheckout(session.id, { paid: checkout[3] === "pay" });
      await deliverAll(deliveries);
      return redirect(session.successUrl);
    }
    const portal = /^\/emulator\/portal\/([A-Za-z0-9_]+)$/.exec(url.pathname);
    if (portal) return html(200, page("Forma de pagamento (emulada)", `<p>Aqui o provedor mostraria o cartão e os recibos.</p><p><a href="${url.searchParams.get("return") ?? BASE_URL}">Voltar</a></p>`));

    // Controls for manual checks: /emulator/control/<action>?subscription=<id>
    const control = /^\/emulator\/control\/(fail|recover|renew|end|delete|dispute|refund)$/.exec(url.pathname);
    if (control && request.method === "POST") {
      const id = url.searchParams.get("subscription") ?? "";
      const actions = { fail: () => emulator.endPeriod(id, { paymentFails: true }), recover: () => emulator.recover(id), renew: () => emulator.endPeriod(id), end: () => emulator.endPeriod(id), delete: () => emulator.deleteSubscription(id), dispute: () => emulator.dispute(id), refund: () => emulator.refund(id) };
      try {
        const statuses = await deliverAll(actions[control[1]]());
        return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, webhook: statuses }));
      } catch (error) {
        return response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: String(error.message ?? error) }));
      }
    }

    const result = emulator.handle({ method: request.method ?? "GET", path: url.pathname, query: url.searchParams, body: new URLSearchParams(body), authorization: request.headers.authorization ?? null, idempotencyKey: request.headers["idempotency-key"] ?? null });
    response.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.json));
  });
  return new Promise((resolve) => server.listen(EMULATOR_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------------------------
// The application: the production build, started with the billing environment
// ---------------------------------------------------------------------------------------------

function ensureVaultSecret() {
  // Created inside the database when missing, read back for the child process, never printed.
  return sql(`
    do $$ begin
      if not exists (select 1 from vault.secrets where name = 'billing_signing_secret') then
        perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'billing_signing_secret');
      end if;
    end $$;
    select decrypted_secret from vault.decrypted_secrets where name = 'billing_signing_secret';`);
}

async function startApp(signingSecret, mode = "sandbox") {
  if (!existsSync(`${APP_DIR}.next/BUILD_ID`)) throw new Error("No production build. Run: NEXT_PUBLIC_APP_URL=" + BASE_URL + " npm run build --workspace=@lnk/web");
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_PUBLIC_APP_URL: BASE_URL, BILLING_MODE: mode, STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE_URL: EMULATOR_URL, BILLING_SIGNING_SECRET: signingSecret },
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return { child, logs };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error(`The application did not start on ${BASE_URL}:\n${logs.join("").slice(-800)}`);
}

// ---------------------------------------------------------------------------------------------
// Acting as a person: pages and Server Actions over plain HTTP, like a browser without JavaScript
// ---------------------------------------------------------------------------------------------

const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// React separates adjacent text nodes with empty comments; they are not spaces.
const visibleText = (html) => decode(html.replace(/<!-- -->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

async function get(session, path) {
  const response = await fetch(`${BASE_URL}${path}`, { headers: session ? { cookie: session.cookie() } : {}, redirect: "manual" });
  const html = await response.text();
  return { status: response.status, location: response.headers.get("location"), html, text: visibleText(html) };
}

/** Every form of a page with its hidden fields (the Server Action reference React renders for no-JS posts). */
function formsOf(html) {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((match) => ({
    text: visibleText(match[1]),
    fields: [...match[1].matchAll(/<input\b[^>]*>/g)].map((tag) => [/name="([^"]*)"/.exec(tag[0])?.[1], decode(/value="([^"]*)"/.exec(tag[0])?.[1] ?? "")]).filter(([name]) => name),
  }));
}

function formWith(html, label) {
  const found = formsOf(html).find((form) => form.text.includes(label) && form.fields.some(([name]) => name.startsWith("$ACTION")));
  if (!found) throw new Error(`No form with "${label}" and a Server Action on the page`);
  return found;
}

/** Posts a form the way a browser would. `as` may be another person: the form is the owner's, the session is not. */
async function submit(as, path, form, extra = []) {
  const data = new FormData();
  for (const [name, value] of [...form.fields, ...extra]) data.append(name, value);
  const response = await fetch(`${BASE_URL}${path}`, { method: "POST", body: data, redirect: "manual", headers: { ...(as ? { cookie: as.cookie() } : {}), origin: BASE_URL } });
  const html = await response.text();
  return { status: response.status, location: response.headers.get("location"), text: visibleText(html) };
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

let appLogs = [];
/** Outcomes the application logged for one event name, in order (structured JSON lines). */
function outcomes(eventName) {
  return appLogs.join("").split("\n").filter((line) => line.includes(`"event":"${eventName}"`)).map((line) => /"outcome":"([a-z_]+)"/.exec(line)?.[1] ?? "");
}
/** Runs `work` and answers the outcome the server logged for it. A refusal has nowhere to show on a screen that has no form. */
async function outcomeOf(eventName, work) {
  const before = outcomes(eventName).length;
  const result = await work();
  for (let attempt = 0; attempt < 40 && outcomes(eventName).length === before; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  return { result, outcome: outcomes(eventName).at(-1) ?? "" };
}

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "  ok  " : "  FAIL"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
}
const step = (title) => console.log(`\n== ${title}`);

function state(workspaceId) {
  const [plan, subscriptions, live, planChanges, pages, members, links, events, invoices] = sql(`
    select (select plan_id from public.workspaces where id = '${workspaceId}'),
      (select count(*) from public.billing_subscriptions where workspace_id = '${workspaceId}'),
      coalesce((select status || ':' || plan_id || ':' || billing_interval || ':' || cancel_at_period_end from public.billing_subscriptions where workspace_id = '${workspaceId}' and status in ('active', 'past_due')), 'none'),
      (select count(*) from public.audit_events where workspace_id = '${workspaceId}' and action = 'billing.plan_changed'),
      (select count(*) from public.profiles where workspace_id = '${workspaceId}' and deleted_at is null),
      (select count(*) from public.workspace_memberships where workspace_id = '${workspaceId}' and status = 'active'),
      (select count(*) from public.report_links where workspace_id = '${workspaceId}' and revoked_at is null),
      (select count(*) from public.billing_events where workspace_id = '${workspaceId}'),
      (select count(*) from public.billing_invoices where workspace_id = '${workspaceId}');`).split("|");
  return { plan, subscriptions: Number(subscriptions), live, planChanges: Number(planChanges), pages: Number(pages), members: Number(members), links: Number(links), events: Number(events), invoices: Number(invoices) };
}

async function runJob() {
  const response = await fetch(`${BASE_URL}/api/jobs/billing`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  return { status: response.status, body: await response.json() };
}

async function lifecycle(fixtures, password) {
  const { workspaceId, outsiderWorkspaceId } = fixtures;
  const owner = await signIn("owner", password);
  const admin = await signIn("admin", password);
  const editor = await signIn("editor", password);
  const outsider = await signIn("outsider", password);
  const plano = `/app/w/${workspaceId}/plano`;
  const home = `/app/w/${workspaceId}`;

  step("A workspace on the free plan reaches its limit");
  const first = await owner.supabase.from("profiles").insert({ workspace_id: workspaceId, title: "Cliente Um", bio: "", slug: `${SLUG_PREFIX}um` }).select("id").single();
  check("the owner creates the first page", !first.error, first.error?.message);
  const refused = await owner.supabase.from("profiles").insert({ workspace_id: workspaceId, title: "Cliente Dois", bio: "", slug: `${SLUG_PREFIX}dois` });
  check("the second page is refused by the database (LK010)", refused.error?.code === "LK010", refused.error?.code);
  const ownerList = await get(owner, home);
  check("the owner sees the limit and the way to the plans", ownerList.text.includes("Ver planos com mais páginas") && ownerList.html.includes(`href="${plano}"`));
  const adminList = await get(admin, home);
  check("an admin sees the limit sentence without the link", adminList.text.includes("no plano atual") && !adminList.text.includes("Ver planos com mais páginas"));
  const editorList = await get(editor, home);
  check("an editor sees neither the link nor the Plano tab", !editorList.text.includes("Ver planos") && !editorList.html.includes(`href="${plano}"`));
  check("an admin has the Plano tab", adminList.html.includes(`href="${plano}"`));

  step("The plans screen (AC1)");
  const plans = await get(owner, plano);
  check("it opens for the owner and says it is a test environment", plans.status === 200 && plans.text.includes("Ambiente de teste"));
  for (const price of ["R$ 14,90", "R$ 149,00", "R$ 57,90", "R$ 579,00"]) check(`it shows ${price}`, plans.text.includes(price));
  check("it states the yearly saving in reais", plans.text.includes("Economize R$ 29,80 por ano") && plans.text.includes("Economize R$ 115,80 por ano"));
  check("it marks the current plan", plans.text.includes("Plano atual"));
  const adminPlans = await get(admin, plano);
  check("an admin sees the plan and no way to buy", adminPlans.status === 200 && adminPlans.text.includes("Só o proprietário") && !formsOf(adminPlans.html).some((form) => form.text.includes("Assinar")));
  const editorPlans = await get(editor, plano);
  check("an editor is told who can see billing, and sees no price", editorPlans.text.includes("ficam com o proprietário e os administradores") && !editorPlans.text.includes("R$ 14,90"));
  const outsiderPlans = await get(outsider, plano);
  check("a member of another workspace gets the not-found state, with nothing about this workspace", !outsiderPlans.text.includes("R$ 14,90") && !outsiderPlans.text.includes("Seu plano") && !formsOf(outsiderPlans.html).some((form) => form.text.includes("Assinar")));
  const anonymous = await get(null, plano);
  check("without a session the page redirects to sign-in", anonymous.status === 307 && (anonymous.location ?? "").includes("/entrar"));

  step("Checkout: the amount comes from the catalogue");
  const subscribeForm = formWith(plans.html, "Assinar Pro mensal");
  const started = await submit(owner, plano, subscribeForm, [["amount", "1"], ["unit_amount", "1"], ["planId", "agency"]]);
  check("starting checkout redirects to the provider's hosted page", started.status === 303 && (started.location ?? "").startsWith(`${EMULATOR_URL}/emulator/checkout/`), `${started.status} ${started.location}`);
  const sessionId = emulator.sessionIdFromUrl(started.location ?? "");
  const session = emulator.session(sessionId);
  check("the provider was asked for exactly R$ 14,90 per month, whatever the browser added to the form", session?.amount === 1490 && session?.interval === "month" && session?.currency === "brl", JSON.stringify(session));
  check("the provider knows which workspace the subscription is for", session?.workspaceId === workspaceId);
  check("the return addresses are the application's own", session?.successUrl === `${BASE_URL}${plano}/retorno?resultado=sucesso`, session?.successUrl);
  const again = await submit(owner, plano, subscribeForm);
  check("starting checkout again opens the same checkout, not a second one", again.location === started.location);
  check("no provider request carried card or personal data", !emulator.requests.some((request) => /card|cpf|cnpj|email/i.test(JSON.stringify(request.body))));

  step("The success address without paying grants nothing");
  const early = await get(owner, `${plano}/retorno?resultado=sucesso`);
  check("the return page waits instead of confirming", early.text.includes("Aguardando a confirmação do pagamento") && !early.text.includes("Pagamento confirmado"));
  check("the workspace is still on the free plan", state(workspaceId).plan === "free");
  check("an admin opening the success address changes nothing either", (await get(admin, `${plano}/retorno?resultado=sucesso`)).status === 200 && state(workspaceId).plan === "free");

  step("The owner's form replayed by somebody else");
  for (const [who, person] of [["an admin", admin], ["an editor", editor]]) {
    const replay = await outcomeOf("billing.checkout", () => submit(person, plano, subscribeForm));
    check(`${who} replaying the owner's checkout form is refused (forbidden)`, replay.result.status !== 303 && replay.outcome === "forbidden", `${replay.result.status} ${replay.outcome}`);
  }
  const outsiderReplay = await outcomeOf("billing.checkout", () => submit(outsider, plano, subscribeForm));
  check("a member of another workspace replaying it gets not found", outsiderReplay.result.status !== 303 && outsiderReplay.outcome === "not_found", `${outsiderReplay.result.status} ${outsiderReplay.outcome}`);
  const anonymousReplay = await submit(null, plano, subscribeForm);
  check("nobody's session replaying it is sent to sign-in", anonymousReplay.status === 307 && (anonymousReplay.location ?? "").includes("/entrar"), `${anonymousReplay.status}`);
  check("none of the replays opened a checkout", emulator.requests.filter((request) => request.path === "/v1/checkout/sessions").length === 2);

  step("Subscribe: pay, with duplicated, concurrent and reversed deliveries (AC2)");
  const paid = emulator.completeCheckout(sessionId);
  const statuses = await deliverBadly(paid.deliveries);
  check("every delivery is acknowledged", statuses.every((status) => status === 200), statuses.join(","));
  let now = state(workspaceId);
  check("the workspace is on the Pro plan", now.plan === "pro", now.plan);
  check("one subscription row", now.subscriptions === 1 && now.live === "active:pro:month:false", now.live);
  check("one plan change in the audit trail", now.planChanges === 1, String(now.planChanges));
  check("one ledger row per provider event", now.events === paid.deliveries.length, String(now.events));
  check("one invoice stored", now.invoices === 1);
  const confirmed = await get(owner, `${plano}/retorno?resultado=sucesso`);
  check("the return page now says the payment is confirmed", confirmed.text.includes("Pagamento confirmado. O plano Pro já está valendo"));
  const billing = await get(owner, plano);
  check("the billing area says plan, state, amount per interval and next charge", /Seu plano Pro Ativo Valor R\$ 14,90 por mês Próxima cobrança \d{2}\/\d{2}\/\d{4}/.test(billing.text), billing.text.slice(0, 400));
  check("the payment history has the receipt link", billing.text.includes("Ver recibo") && billing.html.includes("https://invoice.stripe.example.test/"));
  check("an admin does not see the payment history", !(await get(admin, plano)).text.includes("Ver recibo"));
  const blocked = await outcomeOf("billing.checkout", () => submit(owner, plano, subscribeForm));
  check("a second checkout is refused while a subscription exists", blocked.result.status !== 303 && blocked.outcome === "already_subscribed", `${blocked.result.status} ${blocked.outcome}`);

  step("Renewal");
  check("renewal deliveries are acknowledged", (await deliverBadly(emulator.endPeriod(paid.subscriptionId))).every((status) => status === 200));
  now = state(workspaceId);
  check("still Pro, one more invoice, no new plan change", now.plan === "pro" && now.invoices === 2 && now.planChanges === 1, JSON.stringify(now));

  step("A payment fails: the grace period (AC4)");
  await deliverBadly(emulator.endPeriod(paid.subscriptionId, { paymentFails: true }));
  now = state(workspaceId);
  check("the subscription is past due and the plan is held", now.live === "past_due:pro:month:false" && now.plan === "pro", now.live);
  const graceDays = Number(sql(`select round(extract(epoch from (grace_until - now())) / 86400.0, 2) from public.billing_subscriptions where provider_subscription_id = '${paid.subscriptionId}'`));
  check("the grace period is seven days from the failure", graceDays > 6.99 && graceDays <= 7, String(graceDays));
  const failing = await get(owner, home);
  check("the owner sees the banner with the date and the way to fix it", /Aviso: O último pagamento do plano Pro falhou\. O plano continua valendo até \d{2}\/\d{2}\/\d{4}\./.test(failing.text) && failing.text.includes("Atualizar forma de pagamento"));
  const adminFailing = await get(admin, home);
  check("an admin sees the banner and who can fix it", adminFailing.text.includes("O último pagamento do plano Pro falhou") && adminFailing.text.includes("O proprietário da conta pode regularizar"));
  check("an editor sees no banner", !(await get(editor, home)).text.includes("pagamento"));
  const portal = await submit(owner, plano, formWith((await get(owner, plano)).html, "Atualizar forma de pagamento"));
  check("fixing the payment opens the provider's own page", portal.status === 303 && (portal.location ?? "").startsWith(`${EMULATOR_URL}/emulator/portal/`), `${portal.status}`);

  step("Recovered inside the period");
  await deliverBadly(emulator.recover(paid.subscriptionId));
  now = state(workspaceId);
  check("active again, plan never changed", now.live === "active:pro:month:false" && now.plan === "pro" && now.planChanges === 1, JSON.stringify(now));
  check("the banner is gone", !(await get(owner, home)).text.includes("O último pagamento"));

  step("Fails again and nobody pays: grace ends by the clock");
  await deliverAll(emulator.endPeriod(paid.subscriptionId, { paymentFails: true }));
  let job = await runJob();
  check("the job does nothing before the deadline", job.status === 200 && job.body.graceExpired === 0 && state(workspaceId).plan === "pro", JSON.stringify(job.body));
  sql(`update public.billing_subscriptions set grace_until = now() - interval '1 minute' where provider_subscription_id = '${paid.subscriptionId}'`);
  job = await runJob();
  check("after the deadline the job ends the grace period", job.body.graceExpired === 1 && job.body.planChanges === 1, JSON.stringify(job.body));
  now = state(workspaceId);
  check("the plan is lost and nothing was deleted", now.plan === "free" && now.pages === 1 && now.members === 3, JSON.stringify(now));
  check("running the job again changes nothing", (await runJob()).body.graceExpired === 0 && state(workspaceId).planChanges === 2);
  const suspended = await get(owner, plano);
  check("the billing area says the plan is suspended and the data is kept", suspended.text.includes("Plano suspenso por falta de pagamento") && suspended.text.includes("continuam guardados"));
  check("the job refuses a call without its secret", (await fetch(`${BASE_URL}/api/jobs/billing`, { method: "POST" })).status === 401);

  step("The provider gives up; the owner subscribes again (Agency is bought by upgrading)");
  await deliverBadly(emulator.deleteSubscription(paid.subscriptionId));
  now = state(workspaceId);
  check("the subscription is over, the plan stays free", now.live === "none" && now.plan === "free");
  // More than ten minutes later in real life; here the idempotency window is moved by ending the first checkout's bucket.
  const again2 = await submit(owner, plano, formWith((await get(owner, plano)).html, "Assinar Pro anual"));
  check("a yearly checkout opens", again2.status === 303, `${again2.status}`);
  const yearly = emulator.session(emulator.sessionIdFromUrl(again2.location ?? ""));
  check("the provider was asked for exactly R$ 149 per year", yearly?.amount === 14900 && yearly?.interval === "year", JSON.stringify(yearly));
  const backFromCheckout = await get(owner, `${plano}/retorno?resultado=cancelado`);
  check("leaving the checkout says nothing was charged", backFromCheckout.text.includes("Nada foi cobrado"));
  const monthly = await submit(owner, plano, formWith((await get(owner, plano)).html, "Assinar Pro mensal"));
  const second = emulator.completeCheckout(emulator.sessionIdFromUrl(monthly.location ?? ""));
  await deliverBadly(second.deliveries);
  now = state(workspaceId);
  check("subscribed again: a second subscription row, Pro", now.subscriptions === 2 && now.live === "active:pro:month:false" && now.plan === "pro", JSON.stringify(now));

  step("A checkout left open is paid later: the second paying subscription is refused");
  const stray = emulator.completeCheckout(yearly.id);
  const strayStatuses = await deliverAll(stray.deliveries);
  now = state(workspaceId);
  check("the stray deliveries are acknowledged and change neither the plan nor the live subscription", strayStatuses.every((status) => status === 200) && now.live === "active:pro:month:false" && now.plan === "pro", JSON.stringify(now));
  check("the stray subscription is recorded only as ended, with its payment in the history (it needs a refund by hand)", sql(`select status from public.billing_subscriptions where provider_subscription_id = '${stray.subscriptionId}'`) === "ended");
  check("the webhook route reported the conflict", outcomes("billing.webhook").includes("conflict"));
  check("the stray subscription was cancelled at the provider", emulator.subscriptionStatus(stray.subscriptionId) === "canceled");

  step("Upgrade: immediate");
  const upgradePath = `${plano}/confirmar?acao=mudar&plano=agency`;
  const upgradePage = await get(owner, upgradePath);
  check("the confirmation says the change is immediate and what is gained", upgradePage.text.includes("A mudança vale agora") && upgradePage.text.includes("10 páginas"));
  const upgraded = await submit(owner, upgradePath, formWith(upgradePage.html, "Mudar para o Agência"));
  now = state(workspaceId);
  check("the plan is Agency at once, without waiting for a webhook", now.plan === "agency" && now.live === "active:agency:month:false", `${upgraded.status} ${JSON.stringify(now)}`);
  check("the difference was invoiced", now.invoices >= 4);
  await deliverBadly(emulator.updated(second.subscriptionId));
  check("the provider's own delivery about it changes nothing more", state(workspaceId).planChanges === now.planChanges);
  const more = await owner.supabase.from("profiles").insert([{ workspace_id: workspaceId, title: "Cliente Dois", bio: "", slug: `${SLUG_PREFIX}dois` }, { workspace_id: workspaceId, title: "Cliente Três", bio: "", slug: `${SLUG_PREFIX}tres` }]);
  check("the second and third pages, refused before, are created", !more.error, more.error?.message);
  const link = await owner.supabase.rpc("create_report_link", { p_profile_id: first.data.id, p_token_hash: createHash("sha256").update(randomBytes(32)).digest("hex"), p_period_days: 30, p_expires_in_days: 30 });
  check("a report link is created (the plan has shared reports)", !link.error, link.error?.message);

  step("Downgrade with 3 pages, 3 members and an active report link (AC3)");
  const downPath = `${plano}/confirmar?acao=mudar&plano=pro`;
  const downPage = await get(owner, downPath);
  check("the confirmation lists the pages above the limit with the real numbers", downPage.text.includes("2 de 3 páginas ficam acima do limite de 1"), downPage.text.slice(0, 600));
  check("it lists the people above the limit", downPage.text.includes("A conta tem 3 pessoas") && downPage.text.includes("o novo limite é de 1 lugar"));
  check("it says the report link stops opening and is kept", downPage.text.includes("1 link de relatório ativo deixa de abrir") && downPage.text.includes("ficam guardados"));
  check("it says when the change happens and that nothing is deleted", downPage.text.includes("já está pago e continua valendo até") && downPage.text.includes("Nada é apagado"));
  check("an admin cannot open the confirmation", (await get(admin, downPath)).text.includes("Só o proprietário"));
  await submit(owner, downPath, formWith(downPage.html, "Mudar para o Pro"));
  now = state(workspaceId);
  check("the plan already paid for is kept until the period ends", now.plan === "agency" && now.live === "active:pro:month:false", JSON.stringify(now));
  check("the billing area says so", (await get(owner, plano)).text.includes("A partir dessa data a conta passa para o plano Pro"));
  sql(`update public.billing_subscriptions set held_until = now() - interval '1 minute' where provider_subscription_id = '${second.subscriptionId}'`);
  job = await runJob();
  now = state(workspaceId);
  check("when the paid period ends the job applies the cheaper plan", job.body.holdsReleased === 1 && now.plan === "pro", JSON.stringify(job.body));
  check("what the confirmation said is what happened: 3 pages, 3 members and the link are all still there", now.pages === 3 && now.members === 3 && now.links === 1, JSON.stringify(now));
  const fourth = await owner.supabase.from("profiles").insert({ workspace_id: workspaceId, title: "Cliente Quatro", bio: "", slug: `${SLUG_PREFIX}quatro` });
  check("only new pages are refused", fourth.error?.code === "LK010", fourth.error?.code);
  const pagesStillEditable = await owner.supabase.from("profiles").update({ bio: "ainda editável" }).eq("id", first.data.id).select("id");
  check("existing pages stay editable above the limit", !pagesStillEditable.error && pagesStillEditable.data.length === 1);

  step("Cancel: access holds until the end of the paid period");
  const cancelPath = `${plano}/confirmar?acao=cancelar`;
  const cancelPage = await get(owner, cancelPath);
  check("the confirmation says until when the plan holds and what stops", cancelPage.text.includes("continua valendo até") && cancelPage.text.includes("O que muda nesta conta") && cancelPage.text.includes("O selo do produto volta a aparecer"));
  const editorCancel = await outcomeOf("billing.cancel", () => submit(editor, cancelPath, formWith(cancelPage.html, "Cancelar a assinatura")));
  check("an editor replaying the owner's cancellation is refused", editorCancel.outcome === "forbidden" && state(workspaceId).live === "active:pro:month:false", editorCancel.outcome);
  const outsiderCancel = await outcomeOf("billing.cancel", () => submit(outsider, cancelPath, formWith(cancelPage.html, "Cancelar a assinatura")));
  check("a member of another workspace replaying it gets not found", outsiderCancel.outcome === "not_found" && state(workspaceId).live === "active:pro:month:false", outsiderCancel.outcome);
  await submit(owner, cancelPath, formWith(cancelPage.html, "Cancelar a assinatura"));
  now = state(workspaceId);
  check("cancellation is scheduled and the plan holds", now.live === "active:pro:month:true" && now.plan === "pro", now.live);
  check("the billing area says the date and that nothing is deleted", /Assinatura cancelada\. O plano Pro continua valendo até \d{2}\/\d{2}\/\d{4}/.test((await get(owner, plano)).text));
  await deliverBadly(emulator.endPeriod(second.subscriptionId));
  now = state(workspaceId);
  check("at the end of the period the workspace is on the free plan", now.plan === "free" && now.live === "none");
  check("and every page, member and link is still there", now.pages === 3 && now.members === 3 && now.links === 1, JSON.stringify(now));

  step("Monthly to yearly on a running subscription");
  const third = await submit(owner, plano, formWith((await get(owner, plano)).html, "Assinar Pro mensal"));
  const thirdPaid = emulator.completeCheckout(emulator.sessionIdFromUrl(third.location ?? ""));
  await deliverBadly(thirdPaid.deliveries);
  const monthlyPlan = await get(owner, plano);
  check("the plan screen offers the yearly billing with what it saves", monthlyPlan.text.includes("Passar para o anual") && monthlyPlan.text.includes("Economize R$ 29,80 por ano no plano anual"), monthlyPlan.text.slice(0, 600));
  check("an admin is told the interval and not offered the change", !(await get(admin, plano)).text.includes("Passar para o anual"));
  const yearlyPath = `${plano}/confirmar?acao=anual`;
  const yearlyPage = await get(owner, yearlyPath);
  check("the confirmation says what is charged today, what is saved and that the plan stays", yearlyPage.text.includes("R$ 149,00 por ano") && yearlyPage.text.includes("descontando a parte do mês atual") && yearlyPage.text.includes("R$ 29,80 a menos") && yearlyPage.text.includes("continuam iguais"), yearlyPage.text.slice(0, 600));
  check("an admin cannot open the confirmation", (await get(admin, yearlyPath)).text.includes("Só o proprietário"));
  const editorYearly = await outcomeOf("billing.change_interval", () => submit(editor, yearlyPath, formWith(yearlyPage.html, "Passar para o anual")));
  check("an editor replaying the owner's change is refused", editorYearly.outcome === "forbidden" && state(workspaceId).live === "active:pro:month:false", editorYearly.outcome);
  const outsiderYearly = await outcomeOf("billing.change_interval", () => submit(outsider, yearlyPath, formWith(yearlyPage.html, "Passar para o anual")));
  check("a member of another workspace replaying it gets not found", outsiderYearly.outcome === "not_found" && state(workspaceId).live === "active:pro:month:false", outsiderYearly.outcome);
  const invoicesBefore = state(workspaceId).invoices;
  const changedInterval = await submit(owner, yearlyPath, formWith(yearlyPage.html, "Passar para o anual"));
  now = state(workspaceId);
  check("the subscription is yearly at once, on the same plan, without waiting for a webhook", now.live === "active:pro:year:false" && now.plan === "pro", `${changedInterval.status} ${JSON.stringify(now)}`);
  const intervalRequest = emulator.requests.filter((request) => request.method === "POST" && request.path === `/v1/subscriptions/${thirdPaid.subscriptionId}`).at(-1)?.body ?? {};
  check("the provider was asked for exactly R$ 149 per year, charged now", intervalRequest["items[0][price_data][unit_amount]"] === "14900" && intervalRequest["items[0][price_data][recurring][interval]"] === "year" && intervalRequest.proration_behavior === "always_invoice", JSON.stringify(intervalRequest));
  const yearlyInvoice = Number(sql(`select amount_cents from public.billing_invoices where workspace_id = '${workspaceId}' order by issued_at desc, created_at desc limit 1`));
  check("one invoice more: the year less the unused part of the month", now.invoices === invoicesBefore + 1 && yearlyInvoice >= 14900 - 1490 && yearlyInvoice < 14900, `${invoicesBefore} ${now.invoices} ${yearlyInvoice}`);
  const yearlyPlan = await get(owner, plano);
  check("the billing area says yearly, the next charge, and how to go back to monthly", /Valor R\$ 149,00 por ano Próxima cobrança \d{2}\/\d{2}\/\d{4}/.test(yearlyPlan.text) && yearlyPlan.text.includes("Sua assinatura é anual") && !yearlyPlan.text.includes("Passar para o anual"), yearlyPlan.text.slice(0, 600));
  check("the confirmation is no longer available", (await get(owner, yearlyPath)).text.includes("não está disponível para a situação atual"));
  const backToMonthly = await owner.supabase.rpc("begin_billing_interval_change", { p_workspace_id: workspaceId, p_interval: "month" });
  check("yearly to monthly is refused by the database", backToMonthly.error?.code === "LK103" && backToMonthly.error?.details === "interval", `${backToMonthly.error?.code} ${backToMonthly.error?.details}`);
  for (const [who, person, code] of [["an admin", admin, "42501"], ["a member of another workspace", outsider, "P0002"]]) {
    const direct = await person.supabase.rpc("begin_billing_interval_change", { p_workspace_id: workspaceId, p_interval: "year" });
    check(`${who} calling begin_billing_interval_change gets ${code}`, direct.error?.code === code, direct.error?.code);
  }

  step("Cancel with a reason");
  const reasonPage = await get(owner, cancelPath);
  check("the cancellation asks why and says the answer is optional", reasonPage.text.includes("Por que você está cancelando? (opcional)") && reasonPage.text.includes("O cancelamento acontece com ou sem ela") && reasonPage.text.includes("O preço não cabe no momento"));
  const editorReason = await editor.supabase.rpc("record_cancellation_feedback", { p_workspace_id: workspaceId, p_reason: "other" });
  check("an editor cannot record a reason", editorReason.error?.code === "42501", editorReason.error?.code);
  await submit(owner, cancelPath, formWith(reasonPage.html, "Cancelar a assinatura"), [["reason", "too_expensive"], ["comment", "  caro para agora  "]]);
  now = state(workspaceId);
  check("the cancellation is scheduled", now.live === "active:pro:year:true" && now.plan === "pro", now.live);
  check("the reason, the trimmed comment, the plan and the interval are stored", sql(`select reason, comment, plan_id, billing_interval from public.billing_cancellation_feedback where workspace_id = '${workspaceId}'`) === "too_expensive|caro para agora|pro|year");
  check("the owner cannot read the stored answers", (await owner.supabase.from("billing_cancellation_feedback").select("id")).error?.code === "42501");
  check("the log says the answer was stored and never carries the comment", outcomes("billing.cancel_feedback").at(-1) === "ok" && !appLogs.join("").includes("caro para agora"));
  const exported = await owner.supabase.rpc("export_workspace_data", { p_workspace_id: workspaceId });
  check("the workspace export has the answer and the billing records", exported.data?.billingCancellationFeedback?.length === 1 && exported.data.billingCancellationFeedback[0].reason === "too_expensive" && exported.data?.billingSubscriptions?.length === now.subscriptions && exported.data?.billingInvoices?.length === now.invoices,
    `${exported.error?.code} ${exported.data?.billingCancellationFeedback?.length} ${exported.data?.billingSubscriptions?.length}/${now.subscriptions} ${exported.data?.billingInvoices?.length}/${now.invoices}`);
  await deliverBadly(emulator.endPeriod(thirdPaid.subscriptionId));
  now = state(workspaceId);
  check("at the end of the paid year the workspace is on the free plan, with everything kept", now.plan === "free" && now.live === "none" && now.pages === 3 && now.members === 3, JSON.stringify(now));

  step("Webhooks nobody should believe (AC2)");
  const before = JSON.stringify(state(workspaceId));
  const sample = emulator.updated(second.subscriptionId)[0];
  check("unsigned", (await deliver(sample, { signature: null })) === 400);
  check("signed with another secret", (await deliver(sample, { signature: emulator.sign(sample.rawBody, new Date(), "whsec_attacker_0000000000000000000") })) === 400);
  check("body changed after signing", (await deliver(sample, { body: sample.rawBody.replace('"canceled"', '"active"') })) === 400);
  check("a real delivery replayed ten minutes later", (await deliver(sample, { signature: emulator.sign(sample.rawBody, new Date(Date.now() - 10 * 60_000)) })) === 400);
  check("larger than the limit", (await deliver(sample, { body: "x".repeat(300 * 1024), signature: "t=1,v1=" + "a".repeat(64) })) === 400);
  const unknownBody = JSON.stringify({ id: "evt_unknown_customer", type: "customer.subscription.updated", data: { object: { id: "sub_nobody", customer: "cus_nobody" } } });
  check("an event for a customer nobody registered is acknowledged and ignored", (await deliver({ rawBody: unknownBody, signatureHeader: emulator.sign(unknownBody) })) === 200);
  const unrelated = emulator.unrelated();
  check("an event type the product does not listen to is acknowledged and ignored", (await deliver(unrelated)) === 200);
  check("none of them changed anything", JSON.stringify(state(workspaceId)) === before);

  step("Another workspace's customer cannot touch this one");
  const outsiderPlano = `/app/w/${outsiderWorkspaceId}/plano`;
  const outsiderCheckout = await submit(outsider, outsiderPlano, formWith((await get(outsider, outsiderPlano)).html, "Assinar Agência mensal"));
  const theirs = emulator.completeCheckout(emulator.sessionIdFromUrl(outsiderCheckout.location ?? ""));
  await deliverAll(theirs.deliveries);
  check("the other workspace is on Agency, this one is untouched", state(outsiderWorkspaceId).plan === "agency" && state(workspaceId).plan === "free");
  const crossed = JSON.stringify({ id: "evt_crossed", type: "customer.subscription.updated", data: { object: { id: second.subscriptionId, customer: emulator.session(emulator.sessionIdFromUrl(outsiderCheckout.location ?? "")).customer } } });
  const crossedDelivery = await outcomeOf("billing.webhook", () => deliver({ rawBody: crossed, signatureHeader: emulator.sign(crossed) }));
  check("their customer paired with this workspace's subscription is refused", crossedDelivery.outcome === "customer_mismatch" && sql(`select count(*) from public.billing_events where provider_event_id = 'evt_crossed'`) === "0", crossedDelivery.outcome);
  check("and this workspace's ended subscription is as it was", sql(`select status from public.billing_subscriptions where provider_subscription_id = '${second.subscriptionId}'`) === "ended");

  step("A chargeback ends the paid plan at once");
  await deliverAll(emulator.dispute(theirs.subscriptionId));
  check("the disputed subscription is cancelled at the provider and the plan is free", emulator.subscriptionStatus(theirs.subscriptionId) === "canceled" && state(outsiderWorkspaceId).plan === "free");

  step("Direct calls, without the interface");
  for (const [who, person, code] of [["an admin", admin, "42501"], ["an editor", editor, "42501"], ["a member of another workspace", outsider, "P0002"]]) {
    const checkout = await person.supabase.rpc("begin_billing_checkout", { p_workspace_id: workspaceId, p_plan_id: "agency", p_interval: "month" });
    check(`${who} calling begin_billing_checkout gets ${code}`, checkout.error?.code === code, checkout.error?.code);
    const change = await person.supabase.rpc("begin_billing_change", { p_workspace_id: workspaceId, p_kind: "cancel" });
    check(`${who} calling begin_billing_change gets ${code}`, change.error?.code === code, change.error?.code);
  }
  const forgedCustomer = await owner.supabase.rpc("register_billing_customer", { p_workspace_id: workspaceId, p_customer_id: "cus_forged", p_signature: "0".repeat(64) });
  check("the owner cannot bind a customer without the server's signature", forgedCustomer.error?.code === "LK060", forgedCustomer.error?.code);
  const forgedSnapshot = await owner.supabase.rpc("apply_billing_snapshot", { p_payload: "{}", p_signature: "0".repeat(64) });
  check("an unsigned snapshot is refused", forgedSnapshot.data?.status === "forbidden", JSON.stringify(forgedSnapshot.data));
  const directPlan = await owner.supabase.from("workspaces").update({ plan_id: "agency" }).eq("id", workspaceId).select("id");
  check("the owner cannot write the plan", directPlan.error?.code === "42501", directPlan.error?.code);
  const directSubscription = await owner.supabase.from("billing_subscriptions").update({ status: "active" }).eq("workspace_id", workspaceId).select("id");
  check("the owner cannot write a subscription", directSubscription.error?.code === "42501", directSubscription.error?.code);
  const directLedger = await owner.supabase.from("billing_events").select("provider_event_id").limit(1);
  check("the owner cannot read the event ledger", directLedger.error?.code === "42501", directLedger.error?.code);
  check("an editor reads no subscription", ((await editor.supabase.from("billing_subscriptions").select("id")).data ?? []).length === 0);
  check("an admin reads no invoice", ((await admin.supabase.from("billing_invoices").select("id")).data ?? []).length === 0);
  check("the owner reads their invoices", ((await owner.supabase.from("billing_invoices").select("id")).data ?? []).length > 0);

  step("An account erasure ends a running subscription at the provider before deleting anything");
  const lastCheckout = await submit(outsider, outsiderPlano, formWith((await get(outsider, outsiderPlano)).html, "Assinar Pro anual"));
  const last = emulator.completeCheckout(emulator.sessionIdFromUrl(lastCheckout.location ?? ""));
  await deliverAll(last.deliveries);
  check("the person to erase is paying for a yearly plan", state(outsiderWorkspaceId).live === "active:pro:year:false", state(outsiderWorkspaceId).live);
  const asked = await outsider.supabase.rpc("request_account_deletion");
  check("they ask for the deletion of their account", !asked.error, asked.error?.code);
  // The editor of the first workspace doubles as the platform administrator who runs the request.
  sql(`insert into public.platform_admins (user_id) select id from auth.users where email = '${EMAIL_PREFIX}editor@example.test';`);
  const requestId = sql(`select r.id from public.privacy_requests r join auth.users u on u.id = r.user_id where u.email = '${EMAIL_PREFIX}outsider@example.test';`);
  const reviewed = await editor.supabase.rpc("review_privacy_request", { p_request_id: requestId, p_status: "processing", p_reason_code: "manual_review" });
  check("a platform administrator puts the request in processing", !reviewed.error, reviewed.error?.code);
  const listed = await owner.supabase.rpc("list_erasure_subscriptions", { p_request_id: requestId });
  check("somebody who is not a platform administrator cannot list the subscriptions to end", listed.error?.code === "42501", listed.error?.code);
  const queuePath = "/app/administracao/privacidade";
  const queue = await get(editor, queuePath);
  const eraseForm = formsOf(queue.html).find((form) => form.fields.some(([name, value]) => name === "requestId" && value === requestId) && form.fields.some(([name]) => name === "confirmation"));
  check("the queue offers the erasure and says the subscription is ended without an automatic refund", Boolean(eraseForm) && queue.text.includes("encerrada agora no provedor de pagamento, sem reembolso automático"));
  const deletesBefore = emulator.requests.filter((request) => request.method === "DELETE").length;
  const typed = { fields: (eraseForm?.fields ?? []).filter(([name]) => name !== "evidence" && name !== "confirmation") };
  const erased = await outcomeOf("privacy.erasure", () => submit(editor, queuePath, typed, [["evidence", ERASURE_EVIDENCE], ["confirmation", "EXCLUIR"]]));
  check("the erasure runs to the end", erased.outcome === "erased" && (erased.result.location ?? "").includes("exclusao=erased"), `${erased.outcome} ${erased.result.status} ${erased.result.location}`);
  check("the subscription was cancelled at the provider at once, by one request", emulator.subscriptionStatus(last.subscriptionId) === "canceled" && emulator.requests.filter((request) => request.method === "DELETE" && request.path === `/v1/subscriptions/${last.subscriptionId}`).length === 1 && emulator.requests.filter((request) => request.method === "DELETE").length === deletesBefore + 1);
  check("the account and its workspaces are gone, with their billing rows", sql(`select (select count(*) from auth.users where email = '${EMAIL_PREFIX}outsider@example.test') + (select count(*) from public.workspaces where id = '${outsiderWorkspaceId}') + (select count(*) from public.billing_subscriptions where workspace_id = '${outsiderWorkspaceId}') + (select count(*) from public.billing_customers where workspace_id = '${outsiderWorkspaceId}')`) === "0");
  check("the log says one subscription was ended and names nobody", appLogs.join("").split("\n").some((line) => line.includes('"event":"privacy.erasure"') && line.includes('"outcome":"erased"') && line.includes('"subscriptionsEnded":1') && !/example\.test|sub_emu|cus_emu/.test(line)));
  now = state(workspaceId);
  check("the other workspace is untouched", now.pages === 3 && now.members === 3 && now.plan === "free", JSON.stringify(now));
}

/** The same build with billing off: what staging does between the merge and the founder's configuration. */
async function billingOff(fixtures, password) {
  const { workspaceId } = fixtures;
  const owner = await signIn("owner", password);
  step("Billing mode off: the product behaves as before billing existed");
  const plans = await get(owner, `/app/w/${workspaceId}/plano`);
  check("the plan screen opens and says paid plans are not for sale", plans.status === 200 && plans.text.includes("ainda não estão à venda"));
  check("it offers nothing to buy and is not marked as a test environment", !formsOf(plans.html).some((form) => form.text.includes("Assinar")) && !plans.text.includes("Ambiente de teste"));
  const list = await get(owner, `/app/w/${workspaceId}`);
  check("the limit screen keeps its sentence and has no link to the plans", list.text.includes("no plano atual") && !list.text.includes("Ver planos"));
  const body = "{}";
  check("the webhook answers 503 and changes nothing", (await deliver({ rawBody: body, signatureHeader: emulator.sign(body) })) === 503);
  const job = await runJob();
  check("the job still runs the clock and reads nothing at the provider", job.status === 200 && job.body.checked === 0, JSON.stringify(job.body));
  const home = await fetch(`${BASE_URL}/`).then((response) => response.text());
  check("the marketing home still shows the paid plans with their prices", !visibleText(home).includes("Em breve") && visibleText(home).includes("R$ 14,90") && visibleText(home).includes("R$ 57,90"));
}

// ---------------------------------------------------------------------------------------------

const password = randomBytes(18).toString("base64url");
const signingSecret = ensureVaultSecret();
if (signingSecret.length < 32) throw new Error("The local Vault secret billing_signing_secret is too short.");
const server = await startEmulatorServer();
let app;
try {
  app = await startApp(signingSecret);
  appLogs = app.logs;
  const fixtures = setupAccounts(password);
  if (SERVE) {
    console.log(`Emulator on ${EMULATOR_URL}, application on ${BASE_URL} (billing mode: sandbox).`);
    console.log(`Accounts: ${fixtures.people.map((name) => `${EMAIL_PREFIX}${name}@example.test`).join(", ")}`);
    console.log(`Password for all four (this run only): ${password}`);
    console.log(`Workspace: ${BASE_URL}/app/w/${fixtures.workspaceId}/plano`);
    console.log("Controls: POST " + EMULATOR_URL + "/emulator/control/{fail|recover|renew|delete|dispute|refund}?subscription=<provider subscription id>");
    console.log("Ctrl+C stops both. --cleanup removes the accounts.");
    await new Promise((resolve) => process.on("SIGINT", resolve));
  } else {
    await lifecycle(fixtures, password);
    const sandboxHome = visibleText(await fetch(`${BASE_URL}/`).then((response) => response.text()));
    check("in sandbox the marketing home shows the paid plans with their prices", !sandboxHome.includes("Em breve") && sandboxHome.includes("R$ 14,90"));
    const sandboxLogs = app.logs;
    app.child.kill();
    await new Promise((resolve) => app.child.once("exit", resolve));
    app = await startApp(signingSecret, "off");
    appLogs = app.logs;
    await billingOff(fixtures, password);
    app.logs.unshift(...sandboxLogs);
    console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${passed} checks passed, ${failures.length} failed.`);
    for (const failure of failures) console.log(`  - ${failure}`);
    // The application's own log lines about billing: outcome only, nothing about a person or a payment.
    const lines = app.logs.join("").split("\n").filter((line) => line.includes('"billing.'));
    const leaked = lines.filter((line) => /sub_emu|cus_emu|evt_emu|whsec_|sk_test_|example\.test|t=\d+,v1=/.test(line));
    console.log(`Application log: ${lines.length} billing lines, ${leaked.length} with a provider id, a secret, a signature or an address.`);
    if (leaked.length > 0) failures.push("billing log lines leak identifiers");
    console.log(`The accounts ${EMAIL_PREFIX}*@example.test stay in the local database; remove them with: node scripts/billing-lifecycle.mjs --cleanup`);
  }
} finally {
  app?.child.kill();
  server.close();
}
process.exit(failures.length === 0 ? 0 : 1);
