// Local-only automated QA at phone width for the Sprint 9 screens and the public page, including
// `/aceite` with active legal texts and the "Aceitar" path of the pixel consent (ADR 0015, 0017).
// Requires the local Supabase stack and a running app (BASE_URL defaults to http://localhost:3100).
//
//   PLAYWRIGHT_MODULE  path to a playwright(-core)/index.mjs; otherwise uses "playwright"
//   AXE_PATH           path to axe-core's axe.min.js; without it the accessibility rules are skipped
//
// What it checks on every screen, at 390 px and again at 320 px: no horizontal overflow, text
// fields of at least 16 px (no zoom on focus in iOS), controls of at least 24 px (WCAG 2.2 target
// size; the count under 44 px is reported), and no serious or critical axe-core violation of the
// WCAG 2.2 A/AA rules. This is an automated pass: it does not replace a person using a real
// phone or a screen reader.
//
// It creates synthetic accounts (qa-mobile-a11y-*@example.test) and, while it runs, two ACTIVE
// legal texts marked as test (so `/aceite` has something to show), and removes all of it at the
// end, also when a check fails. If a legal text is already active locally, `/aceite` is skipped.
// Vendor requests: the two public measurement libraries are really fetched; every other request to
// Meta or Google is answered locally, so no visit is sent to them.
//
//   node scripts/mobile-a11y.mjs            run
//   node scripts/mobile-a11y.mjs --cleanup  only remove leftovers of an interrupted run
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const local = (value) => ["localhost", "127.0.0.1"].includes(new URL(value).hostname);
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
assert(local(base) && local(env.NEXT_PUBLIC_SUPABASE_URL), "This script is restricted to the local app and database.");
const db = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const LEGAL_VERSION = "2026-10-11-qa";

function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error(`Local QA database command failed: ${result.stderr.split("\n")[0]}`);
  return result.stdout.trim();
}

function cleanup() {
  sql(`
    delete from public.privacy_request_events where request_id in (select r.id from public.privacy_requests r join auth.users u on u.id = r.user_id where u.email like 'qa-mobile-a11y-%@example.test');
    delete from public.privacy_requests where user_id in (select id from auth.users where email like 'qa-mobile-a11y-%@example.test');
    delete from public.workspaces where created_by in (select id from auth.users where email like 'qa-mobile-a11y-%@example.test');
    delete from public.slug_history where slug like 'qa-mobile-a11y-%';
    delete from auth.users where email like 'qa-mobile-a11y-%@example.test';
    delete from public.legal_acceptances where document_id in (select id from public.legal_documents where version = '${LEGAL_VERSION}');
    delete from public.legal_documents where version = '${LEGAL_VERSION}';
  `);
}

if (process.argv.includes("--cleanup")) {
  cleanup();
  console.log("Removed the qa-mobile-a11y-* fixture.");
  process.exit(0);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const axeSource = process.env.AXE_PATH && existsSync(process.env.AXE_PATH) ? readFileSync(process.env.AXE_PATH, "utf8") : null;
const suffix = randomBytes(4).toString("hex");
const findings = [];
let checks = 0;
function check(value, label) { assert(value, label); checks += 1; console.log(`PASS ${label}`); }

function createUser(role) {
  const id = randomUUID();
  const email = `qa-mobile-a11y-${role}-${suffix}@example.test`;
  const password = randomBytes(24).toString("hex");
  sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA Mobile"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${id}','${id}','email',jsonb_build_object('sub','${id}','email','${email}','email_verified',true),now(),now());
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);
      perform public.ensure_personal_workspace();
    end $$;
  `);
  return { id, email, password };
}

async function signedIn(browser, user) {
  const cookies = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
  assert(!(await client.auth.signInWithPassword({ email: user.email, password: user.password })).error, "QA login failed");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" })));
  return context;
}

/** One screen, at two phone widths. Problems are collected, not thrown, so one run reports them all. */
async function audit(page, name) {
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
        // Links inside a sentence are exempt from the target-size rule (WCAG 2.5.8, inline exception).
        // A 1px control is visually hidden until focused (the skip link): not a touch target.
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
    const violations = await page.evaluate(async () => (await globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length, target: String(item.nodes[0]?.target ?? "") })));
    for (const item of violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")) findings.push(`${name}: axe ${item.impact} ${item.id} (${item.nodes} node(s), first: ${item.target})`);
  }
  checks += 1;
  console.log(`DONE ${name}`);
}

let browser;
try {
  cleanup();
  const owner = createUser("owner");
  const admin = createUser("admin");
  sql(`insert into public.platform_admins (user_id) values ('${admin.id}');`);
  const workspace = sql(`select id from public.workspaces where created_by='${owner.id}' and kind='personal';`);
  const slug = `qa-mobile-a11y-${suffix}`;
  const blocks = JSON.stringify([
    { id: randomUUID(), type: "link", title: "Conheça meu trabalho", url: "https://example.com/", visible: true },
    { id: randomUUID(), type: "form", title: "Fale comigo", fields: ["name", "email", "message"], buttonLabel: "Enviar", consentText: "Aceito ser contatado.", consentRequired: true, visible: true },
  ]).replace(/'/g, "''");
  sql(`
    update public.workspaces set plan_id='agency' where id='${workspace}';
    insert into public.profiles(workspace_id,title,slug,bio,blocks,theme) values ('${workspace}','Marina Estúdio','${slug}','Design e identidade.','${blocks}'::jsonb,
      '{"background":"#101418","button":"#ffd166","buttonStyle":"filled","corners":"rounded","spacing":"regular","font":"system"}'::jsonb);`);
  const profile = sql(`select id from public.profiles where slug='${slug}';`);
  sql(`
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true);
      perform public.publish_profile('${profile}');
      perform public.set_profile_pixels('${profile}', '1234567890123456', 'G-QAMOBILE01');
      perform public.request_account_deletion();
      perform public.request_data_access();
    end $$;`);

  const legalFree = sql("select count(*) from public.legal_documents where status = 'active';") === "0";
  if (legalFree) {
    const body = "TEXTO DE TESTE, SEM VALOR JURÍDICO. ".repeat(12);
    sql(`insert into public.legal_documents (kind, version, body, status, activated_at) values ('terms','${LEGAL_VERSION}','${body}','active',now()), ('privacy','${LEGAL_VERSION}','${body}','active',now());`);
  }

  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });
  const errors = [];

  // ---- Visitor on the published page: browser bar color, preload, and the consent "Aceitar" path. ----
  const consent = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const vendorRequests = [];
  const violations = [];
  await consent.exposeFunction("__reportCsp", (blocked, directive) => { violations.push(`${directive} ${blocked}`); });
  await consent.addInitScript(() => { document.addEventListener("securitypolicyviolation", (event) => { globalThis.__reportCsp(event.blockedURI, event.effectiveDirective); }); });
  const LIBRARIES = [/^https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js/, /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?/];
  await consent.route(/^https:\/\/([a-z0-9-]+\.)*(facebook\.com|facebook\.net|google-analytics\.com|analytics\.google\.com|googletagmanager\.com|google\.com|doubleclick\.net)\//, async (route) => {
    const url = route.request().url();
    vendorRequests.push(url);
    // The two public libraries are fetched for real; anything that would report a visit is answered here.
    if (LIBRARIES.some((pattern) => pattern.test(url))) return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
  const publicPage = await consent.newPage();
  publicPage.on("pageerror", (error) => errors.push(error.message));
  await publicPage.goto(`${base}/${slug}`);
  await publicPage.getByRole("button", { name: "Aceitar" }).waitFor({ timeout: 15000 });
  check(vendorRequests.length === 0, "Before a choice, nothing is requested from Meta or Google");
  check(await publicPage.locator('meta[name="theme-color"]').getAttribute("content") === "#101418", "The browser bar takes the page's own background color");
  check(await publicPage.evaluate(() => getComputedStyle(document.documentElement).backgroundColor) === "rgb(16, 20, 24)", "The document background is the page's, so no light band shows around a dark page");
  await audit(publicPage, "/<página> publicada, com o aviso de consentimento");
  await publicPage.getByRole("button", { name: "Aceitar" }).click();
  await publicPage.waitForTimeout(4000);
  check(vendorRequests.some((url) => LIBRARIES[0].test(url)), "After Aceitar, the Meta Pixel library is requested");
  check(vendorRequests.some((url) => LIBRARIES[1].test(url) && url.includes("G-QAMOBILE01")), "After Aceitar, the Google tag is requested with the page's measurement ID");
  check(await publicPage.evaluate(() => typeof globalThis.fbq === "function" && typeof globalThis.gtag === "function"), "Both libraries are initialised on the page");
  check(await publicPage.getByRole("button", { name: "Aceitar" }).count() === 0, "The notice goes away after the choice");
  console.log(`     vendor requests after consent: ${vendorRequests.length}`);
  for (const host of [...new Set(vendorRequests.map((url) => new URL(url).host))]) console.log(`       ${host}`);
  check(violations.length === 0, `No Content-Security-Policy violation after consent${violations.length ? `: ${[...new Set(violations)].join("; ")}` : ""}`);
  await publicPage.reload();
  await publicPage.locator("h1").waitFor();
  await publicPage.waitForTimeout(1500);
  check(await publicPage.getByRole("button", { name: "Aceitar" }).count() === 0, "The choice is remembered on the next visit");



  // ---- Signed-in person: the acceptance gate first, then "Meus dados" and the workspace. ----
  const ownerContext = await signedIn(browser, owner);
  const ownerPage = await ownerContext.newPage();
  ownerPage.on("pageerror", (error) => errors.push(error.message));
  if (legalFree) {
    await ownerPage.goto(`${base}/app`);
    await ownerPage.waitForURL(/\/aceite/, { timeout: 60000 });
    check(true, "With active legal texts, the product sends a signed-in person to /aceite");
    await audit(ownerPage, "/aceite");
    check(await ownerPage.getByText("TEXTO DE TESTE").count() > 0 || await ownerPage.getByRole("link").count() > 0, "/aceite shows or links the texts to accept");
    const boxes = ownerPage.getByRole("checkbox");
    for (let index = 0; index < await boxes.count(); index += 1) await boxes.nth(index).check();
    await ownerPage.locator("form button[type=submit]").first().click();
    await ownerPage.waitForURL((url) => !url.pathname.startsWith("/aceite"), { timeout: 30000 });
    check(sql(`select count(*) from public.legal_acceptances where user_id='${owner.id}';`) === "2", "Accepting records both texts and lets the person in");
    await ownerPage.goto(`${base}/app`);
    await ownerPage.waitForLoadState("networkidle");
    check(!new URL(ownerPage.url()).pathname.startsWith("/aceite"), "The gate does not come back after acceptance");
  } else {
    console.log("SKIP /aceite (a legal text is already active in this database)");
  }
  await ownerPage.goto(`${base}/app/conta/dados`);
  await ownerPage.locator("h1").waitFor({ timeout: 60000 });
  await audit(ownerPage, "/app/conta/dados");
  await ownerPage.goto(`${base}/app/w/${workspace}`);
  await ownerPage.locator(".app-tabs").waitFor();
  await audit(ownerPage, "/app/w/<conta> (lista de páginas)");

  // ---- Platform administrator: the two queues, with a suspension so the appeal screen has content. ----
  sql(`do $$ begin perform set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true); perform public.set_profile_moderation('${profile}', true, 'Suspensa no QA automático de celular.'); end $$;`);
  await ownerPage.goto(`${base}/app/w/${workspace}/paginas/${profile}/moderacao`);
  await ownerPage.getByLabel("Sua contestação").waitFor({ timeout: 60000 });
  await audit(ownerPage, "/app/w/<conta>/paginas/<página>/moderacao");
  const adminContext = await signedIn(browser, admin);
  const adminPage = await adminContext.newPage();
  if (legalFree) {
    sql(`insert into public.legal_acceptances (user_id, document_id, document_sha256) select '${admin.id}', id, body_sha256 from public.legal_documents where version='${LEGAL_VERSION}';`);
  }
  await adminPage.goto(`${base}/app/administracao/privacidade`);
  await adminPage.locator("h1").waitFor({ timeout: 60000 });
  await audit(adminPage, "/app/administracao/privacidade");
  await adminPage.goto(`${base}/app/administracao/denuncias`);
  await adminPage.locator("h1").waitFor();
  await audit(adminPage, "/app/administracao/denuncias");

  // ---- Visitor: sign-in screens, the report form, the suspended page. ----
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await visitor.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/entrar", "/cadastro", "/recuperar-acesso", "/confirmar-email", `/denunciar?pagina=${slug}`]) {
    await page.goto(`${base}${path}`);
    await page.locator("h1").first().waitFor({ timeout: 60000 });
    await audit(page, path.replace(slug, "<página>"));
  }
  // The published copy is cached for up to a minute: ask until the suspension shows.
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await page.goto(`${base}/${slug}`);
    if (await page.getByText("Marina Estúdio").count() === 0) break;
    await page.waitForTimeout(2000);
  }
  check(await page.getByText("Marina Estúdio").count() === 0, "A suspended page stops showing its content within the cache window");
  await audit(page, "/<página> suspensa");

  check(errors.length === 0, `No browser runtime errors${errors.length ? `: ${errors[0]}` : ""}`);
  if (!axeSource) console.log("NOTE accessibility rules were skipped (AXE_PATH not set)");
  if (findings.length === 0) console.log(`
${checks} checks passed with no finding.`);
} finally {
  if (findings.length > 0) {
    console.log(`
${findings.length} finding(s):`);
    for (const finding of findings) console.log(`  - ${finding}`);
    process.exitCode = 1;
  }
  await browser?.close();
  cleanup();
}
