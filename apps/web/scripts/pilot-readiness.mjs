// Local-only browser pass over the pilot-readiness screens (docs/SPRINT_9_REPORT.md, addendum of
// 2026-10-13): the help center, the pricing page, the status page, the first-steps checklist, the
// monthly-to-yearly and cancellation confirmations, and the product funnel of the administrator.
// It starts the production build itself (billing in sandbox, with no provider behind it) against
// the local Supabase stack and opens every screen in Chrome at 390 and 320 px.
//
//   PLAYWRIGHT_MODULE  path to a playwright(-core)/index.mjs; otherwise uses "playwright"
//   AXE_PATH           path to axe-core's axe.min.js; without it the accessibility rules are skipped
//   BROWSER_EXECUTABLE a Chrome/Chromium binary; otherwise the installed Chrome channel
//
// On every screen: no horizontal overflow, text fields of at least 16 px, controls of at least
// 24 px, no serious or critical axe-core violation of the WCAG 2.2 A/AA rules, no runtime error and
// no Content-Security-Policy violation. It is an automated pass: it does not replace a person with
// a real phone, another browser, a keyboard or a screen reader.
//
// Needs a production build made for this address:
//   NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web
//
//   node scripts/pilot-readiness.mjs            run
//   node scripts/pilot-readiness.mjs --cleanup  only remove the qa-pilot-*@example.test accounts
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
const EMAILS = "qa-pilot-%@example.test";
const DEAD_PORT = Number(process.env.DEAD_PORT ?? 4999);

function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error(`Local QA database command failed: ${result.stderr.split("\n")[0]}`);
  return result.stdout.trim();
}

function cleanup() {
  sql(`
    delete from public.billing_events where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAILS}');
    delete from public.profiles where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAILS}');
    delete from public.slug_history where slug like 'qa-pilot-%';
    delete from public.workspaces where created_by in (select id from auth.users where email like '${EMAILS}');
    delete from auth.users where email like '${EMAILS}';
  `);
}

if (process.argv.includes("--cleanup")) {
  cleanup();
  console.log("Removed the qa-pilot-* fixture.");
  process.exit(0);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const axeSource = process.env.AXE_PATH && existsSync(process.env.AXE_PATH) ? readFileSync(process.env.AXE_PATH, "utf8") : null;
const suffix = randomBytes(4).toString("hex");
const findings = [];
const errors = [];
const violations = [];
let checks = 0;
function check(value, label) { assert(value, label); checks += 1; console.log(`PASS ${label}`); }

/** The production build with billing in sandbox and no provider to talk to: screens render, a command fails closed. */
async function startApp() {
  assert(existsSync(`${APP_DIR}.next/BUILD_ID`), `No production build. Run: NEXT_PUBLIC_APP_URL=${base} npm run build --workspace=@lnk/web`);
  const signingSecret = sql("select decrypted_secret from vault.decrypted_secrets where name = 'billing_signing_secret';");
  assert(signingSecret.length >= 32, "The local Vault has no billing_signing_secret: run scripts/billing-lifecycle.mjs once, which creates it.");
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"],
    // Nothing listens on that port: the adapter gets a refused connection, as from a provider that is down.
    env: { ...process.env, NEXT_PUBLIC_APP_URL: base, BILLING_MODE: "sandbox", STRIPE_SECRET_KEY: "sk_test_local_pilot_000000000000000000", STRIPE_WEBHOOK_SECRET: "whsec_local_pilot_000000000000000000", STRIPE_API_BASE_URL: `http://127.0.0.1:${DEAD_PORT}`, BILLING_SIGNING_SECRET: signingSecret, SUPPORT_EMAIL: "" },
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw Error(`The application did not start on ${base}:\n${logs.join("").slice(-800)}`);
}

function createUser(role) {
  const id = randomUUID();
  const email = `qa-pilot-${role}-${suffix}@example.test`;
  const password = randomBytes(24).toString("hex");
  sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA Piloto"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}','email_verified',true),now(),now());
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);
      perform public.ensure_personal_workspace();
    end $$;
  `);
  return { id, email, password };
}

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function watched(context) {
  await context.exposeFunction("__reportCsp", (blocked, directive) => { violations.push(`${directive} ${blocked}`); });
  await context.addInitScript(() => { document.addEventListener("securitypolicyviolation", (event) => { globalThis.__reportCsp(event.blockedURI, event.effectiveDirective); }); });
  return context;
}

async function signedIn(browser, user) {
  const cookies = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
  assert(!(await client.auth.signInWithPassword({ email: user.email, password: user.password })).error, "QA login failed");
  const context = await watched(await browser.newContext(PHONE));
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" })));
  return context;
}

async function open(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
}

/**
 * One screen, at two phone widths. Problems are collected, not thrown, so one run reports them all.
 * `scope` limits the accessibility rules to one part of a page this change touched only there.
 */
async function audit(page, name, scope = null) {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const facts = await page.evaluate(() => {
      const visible = (node) => { const box = node.getBoundingClientRect(); const style = getComputedStyle(node); return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"; };
      const controls = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")].filter(visible);
      const sizes = controls.map((node) => { const box = node.getBoundingClientRect(); return { tag: node.tagName.toLowerCase(), text: (node.textContent || node.getAttribute("aria-label") || node.getAttribute("name") || "").trim().slice(0, 40), w: Math.round(box.width), h: Math.round(box.height), inline: getComputedStyle(node).display === "inline" }; });
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        smallFields: [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")].filter(visible).filter((node) => parseFloat(getComputedStyle(node).fontSize) < 16).length,
        // Links inside a sentence are exempt from the target-size rule; a 1px control is the skip link.
        tiny: sizes.filter((item) => !item.inline && item.w > 1 && item.h > 1 && (item.w < 24 || item.h < 24)),
        under44: sizes.filter((item) => !item.inline && (item.w < 44 || item.h < 44)).length,
        controls: sizes.length,
      };
    });
    if (facts.overflow > 1) findings.push(`${name} @${width}: horizontal overflow of ${facts.overflow}px`);
    if (facts.smallFields > 0) findings.push(`${name} @${width}: ${facts.smallFields} text field(s) under 16px`);
    for (const item of facts.tiny) findings.push(`${name} @${width}: control under 24px: <${item.tag}> "${item.text}" ${item.w}x${item.h}`);
    if (width === 390) console.log(`     ${name}: ${facts.controls} controls, ${facts.under44} under 44px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (axeSource) {
    await page.evaluate(axeSource);
    const found = await page.evaluate(async (selector) => (await globalThis.axe.run(selector ? document.querySelector(selector) : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length, target: String(item.nodes[0]?.target ?? "") })), scope);
    for (const item of found.filter((violation) => violation.impact === "serious" || violation.impact === "critical")) findings.push(`${name}: axe ${item.impact} ${item.id} (${item.nodes} node(s), first: ${item.target})`);
  }
  checks += 1;
  console.log(`DONE ${name}`);
}

const text = (page) => page.evaluate(() => document.body.innerText);

let browser;
let app;
try {
  cleanup();
  app = await startApp();
  const owner = createUser("owner");
  const admin = createUser("admin");
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}');`);
  const workspace = sql(`select id from public.workspaces where created_by='${owner.id}' and kind='personal';`);
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });

  // ---- Visitor: help, pricing, status and the way to them from the home. ----
  const visitor = await watched(await browser.newContext(PHONE));
  const page = await open(visitor);
  await page.goto(`${base}/ajuda`);
  await page.locator("h1").waitFor({ timeout: 60000 });
  let body = await text(page);
  check(body.includes("Como crio a minha página?") && body.includes("Falar com a gente"), "/ajuda shows the questions and the contact section");
  check(body.includes("Durante o piloto, o atendimento é feito pela pessoa que enviou o seu convite") && await page.locator('a[href^="mailto:"]').count() === 0, "Without a support address configured, it says how support works and shows no address");
  check(body.includes("Como assino um plano pago?") && !body.includes("ainda não estão à venda"), "The billing answers explain how to subscribe");
  check(await page.locator('a[href="/denunciar"]').count() === 1 && await page.locator('a[href="/status"]').count() === 1, "It links the report form and the status page");
  await audit(page, "/ajuda");

  await page.goto(`${base}/precos`);
  await page.locator("h1").waitFor();
  body = await text(page);
  check(body.includes("Gratuito") && body.includes("Pro") && body.includes("Agência") && body.includes("10 páginas"), "/precos lists the three plans with what each includes");
  check(!body.includes("Em breve") && /R\$ ?14,90/.test(body) && /R\$ ?57,90/.test(body), "It shows the price of every paid plan, whatever the billing mode");
  check(body.includes("Os planos pagos são assinados de dentro da conta"), "It says paid plans are bought inside the account");
  await audit(page, "/precos");

  await page.goto(`${base}/status`);
  await page.locator("h1").waitFor();
  body = await text(page);
  check(body.includes("Tudo funcionando") && body.includes("Páginas e dados") && body.includes("Funcionando"), "/status reports the application and the database as working");
  check(body.includes("Se ela não abrir, o serviço está fora do ar") && /Última verificação: \d{2}\/\d{2}\/\d{4}/.test(body), "It states its own limit and when it last checked");
  const statusResponse = await fetch(`${base}/status`);
  check(statusResponse.status === 200 && (statusResponse.headers.get("cache-control") ?? "").includes("no-store"), "It is rendered per request, never served from a stale copy");
  await audit(page, "/status");

  await page.goto(`${base}/`);
  await page.locator("h1").waitFor();
  check(await page.locator('footer a[href="/ajuda"]').count() === 1 && await page.locator('footer a[href="/precos"]').count() === 1 && await page.locator('footer a[href="/status"]').count() === 1, "The home footer links help, pricing and status");
  // Only the footer changed on the home: the rest of that page is outside this pass.
  await audit(page, "/ (rodapé com os links novos)", "footer");

  // ---- A new account: first steps until the first publication. ----
  const ownerContext = await signedIn(browser, owner);
  const ownerPage = await open(ownerContext);
  await ownerPage.goto(`${base}/app/w/${workspace}`);
  await ownerPage.getByRole("heading", { name: "Primeiros passos" }).waitFor({ timeout: 60000 });
  check(await ownerPage.locator('li[aria-current="step"]').innerText().then((value) => value.includes("Crie a página") && value.includes("Agora")), "A new account sees the first steps, starting at creating the page");
  check(await ownerPage.getByRole("link", { name: "Criar a página" }).getAttribute("href") === `/app/w/${workspace}/paginas/nova`, "The current step leads to the page form");
  await audit(ownerPage, "/app/w/<conta> (primeiros passos, sem página)");
  await ownerPage.locator("summary").filter({ hasText: "Conta" }).click();
  check(await ownerPage.getByRole("link", { name: "Ajuda", exact: true }).getAttribute("href") === "/ajuda", "The account menu has the way to the help center");

  const slug = `qa-pilot-${suffix}`;
  const blocks = JSON.stringify([{ id: randomUUID(), type: "link", title: "Meu trabalho", url: "https://example.com/", visible: true }]);
  sql(`do $$ begin
    perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true);
    perform set_config('role', 'authenticated', true);
    insert into public.profiles(workspace_id,title,slug) values ('${workspace}','Piloto QA','${slug}');
    update public.profiles set blocks = '${blocks}'::jsonb where slug = '${slug}';
  end $$;`);
  const profile = sql(`select id from public.profiles where slug='${slug}';`);
  await ownerPage.goto(`${base}/app/w/${workspace}`);
  await ownerPage.getByRole("heading", { name: "Primeiros passos" }).waitFor();
  check(await ownerPage.locator('li[aria-current="step"]').innerText().then((value) => value.includes("Monte e publique")), "With a page created, the current step is publishing");
  check(await ownerPage.getByRole("link", { name: "Abrir o editor" }).getAttribute("href") === `/app/w/${workspace}/paginas/${profile}`, "It leads to the editor of that page");
  await audit(ownerPage, "/app/w/<conta> (primeiros passos, com rascunho)");
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true); perform public.publish_profile('${profile}'); end $$;`);
  await ownerPage.goto(`${base}/app/w/${workspace}`);
  await ownerPage.locator(".page-row").first().waitFor();
  check(await ownerPage.getByRole("heading", { name: "Primeiros passos" }).count() === 0, "After the first publication the first steps are gone");

  // ---- Billing: the yearly change and the cancellation with its reason, with a provider that does not answer. ----
  sql(`
    insert into public.billing_customers (workspace_id, provider, provider_customer_id) values ('${workspace}', 'stripe', 'cus_qa_pilot_${suffix}');
    insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, current_period_end, observed_at)
    values ('${workspace}', 'stripe', 'sub_qa_pilot_${suffix}', 'cus_qa_pilot_${suffix}', 'pro', 'month', 1490, 'BRL', 'active', now() + interval '20 days', now());
    update public.billing_subscriptions set granted_plan_id = 'pro' where workspace_id = '${workspace}';
  `);
  const plano = `/app/w/${workspace}/plano`;
  await ownerPage.goto(`${base}${plano}`);
  await ownerPage.getByRole("link", { name: "Passar para o anual" }).waitFor({ timeout: 60000 });
  check((await text(ownerPage)).includes("Sua assinatura é mensal. No anual você paga R$ 29,80 a menos por ano."), "The plan screen offers the yearly billing to a monthly subscriber");
  await audit(ownerPage, "/app/w/<conta>/plano (assinatura mensal)");
  await ownerPage.getByRole("link", { name: "Passar para o anual" }).click();
  await ownerPage.getByRole("heading", { name: "Passar para a cobrança anual" }).waitFor();
  check((await text(ownerPage)).includes("R$ 149,00 por ano") && (await text(ownerPage)).includes("Para voltar ao mensal depois"), "The confirmation says the amount, what is discounted and how to go back");
  await audit(ownerPage, "/app/w/<conta>/plano/confirmar?acao=anual");
  await ownerPage.getByRole("button", { name: "Passar para o anual" }).click();
  await ownerPage.getByText("O provedor de pagamento não respondeu").waitFor({ timeout: 30000 });
  check(sql(`select billing_interval from public.billing_subscriptions where workspace_id='${workspace}';`) === "month", "With the provider down the change fails in words and nothing changes");

  await ownerPage.goto(`${base}${plano}/confirmar?acao=cancelar`);
  await ownerPage.getByLabel("Por que você está cancelando? (opcional)").waitFor();
  check(await ownerPage.getByLabel("Por que você está cancelando? (opcional)").evaluate((node) => node.tagName === "SELECT" && node.value === "" && !node.required), "The reason is a labelled choice that starts empty and is not required");
  check(await ownerPage.getByLabel("Quer contar mais? (opcional)").evaluate((node) => node.tagName === "TEXTAREA" && node.maxLength === 500 && !node.required), "The comment is a labelled, optional field of at most 500 characters");
  await audit(ownerPage, "/app/w/<conta>/plano/confirmar?acao=cancelar");
  await ownerPage.getByLabel("Por que você está cancelando? (opcional)").selectOption("not_using");
  await ownerPage.getByLabel("Quer contar mais? (opcional)").fill("teste do piloto");
  await ownerPage.getByRole("button", { name: "Cancelar a assinatura" }).click();
  await ownerPage.getByText("O provedor de pagamento não respondeu").waitFor({ timeout: 30000 });
  check(sql(`select count(*) from public.billing_cancellation_feedback where workspace_id='${workspace}';`) === "0" && sql(`select cancel_at_period_end from public.billing_subscriptions where workspace_id='${workspace}';`) === "f", "A cancellation the provider did not accept stores no reason and cancels nothing");
  check(!app.logs.join("").includes("teste do piloto"), "The comment typed in the form is not in the application log");

  // ---- Platform administrator: the product funnel. A customer does not get there. ----
  await ownerPage.goto(`${base}/app/administracao/produto`);
  await ownerPage.waitForLoadState("networkidle");
  check(!(await text(ownerPage)).includes("Funil do produto"), "A customer who types the address of the funnel gets the not-found screen");
  const adminContext = await signedIn(browser, admin);
  const adminPage = await open(adminContext);
  await adminPage.goto(`${base}/app/administracao/produto`);
  await adminPage.getByRole("heading", { name: "Funil do produto" }).waitFor({ timeout: 60000 });
  body = await text(adminPage);
  check(["Ativação", "Tempo até publicar", "Criaram a conta", "Publicaram", "Coortes por semana de cadastro", "Motivos de cancelamento", "Como ler estes números"].every((part) => body.includes(part)), "The administrator sees activation, the funnel, the weekly cohorts and the cancellation reasons");
  const signedUp = await adminPage.locator("table").first().locator("tbody tr").first().locator("td").first().innerText();
  const direct = JSON.parse(sql(`begin; select set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true); select public.get_product_metrics()::text; commit;`).split("\n").filter((line) => line.startsWith("{")).at(-1));
  check(Number(signedUp) === direct.totals.signedUp && direct.totals.signedUp >= 1 && direct.totals.published >= 1, `The screen shows the database's count of accounts (${signedUp}), which includes the account that just published`);
  check(!body.includes("example.test") && !body.includes(slug), "It names no account and no page");
  await audit(adminPage, "/app/administracao/produto");

  check(errors.length === 0, `No browser runtime errors${errors.length ? `: ${errors[0]}` : ""}`);
  check(violations.length === 0, `No Content-Security-Policy violation${violations.length ? `: ${[...new Set(violations)].join("; ")}` : ""}`);
  if (!axeSource) console.log("NOTE accessibility rules were skipped (AXE_PATH not set)");
  if (findings.length === 0) console.log(`\n${checks} checks passed with no finding.`);
} finally {
  if (findings.length > 0) {
    console.log(`\n${findings.length} finding(s):`);
    for (const finding of findings) console.log(`  - ${finding}`);
    process.exitCode = 1;
  }
  await browser?.close();
  app?.child.kill();
  cleanup();
}
