// Local-only browser regression checks for the mobile editor. Requires the local Supabase stack
// and a running app (BASE_URL defaults to http://localhost:3100).
// PLAYWRIGHT_MODULE may point to a bundled playwright/index.mjs; otherwise uses "playwright".
// Creates a unique synthetic account, removes only its own fixture, and writes screenshots to
// test-results/editor-mobile. No credentials or cookies are printed or saved.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const local = (value) => ["localhost", "127.0.0.1"].includes(new URL(value).hostname);
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
assert(local(base) && local(env.NEXT_PUBLIC_SUPABASE_URL), "This script is restricted to local app and database.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("test-results/editor-mobile");
mkdirSync(output, { recursive: true });
const userId = randomUUID();
const blockId = randomUUID();
const suffix = randomBytes(5).toString("hex");
const email = `qa-mobile-${suffix}@example.test`;
const password = randomBytes(24).toString("hex");
const slug = `qa-mobile-${suffix}`;
const db = process.env.DB_CONTAINER ?? "supabase_db_lnk";
function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], { input: statement, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error("Local QA database command failed.");
  return result.stdout.trim();
}
let browser;
let checks = 0;
function check(value, label) { assert(value, label); checks++; console.log("PASS " + label); }
try {
  sql(`
    insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    values ('00000000-0000-0000-0000-000000000000','${userId}','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"display_name":"QA Mobile"}',now(),now(),'','','','');
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),'${userId}','${userId}','email',jsonb_build_object('sub','${userId}','email','${email}','email_verified',true),now(),now());
    do $$ begin
      perform set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      perform public.ensure_personal_workspace();
    end $$;
    insert into public.profiles(workspace_id,title,slug,bio,blocks)
    select id,'Marina • Estúdio criativo','${slug}','Design, identidade e ideias que ganham vida.',
    '[{"id":"${blockId}","type":"link","title":"Conheça meu trabalho","url":"https://example.com/","visible":true}]'::jsonb
    from public.workspaces where created_by='${userId}' and kind='personal';
  `);
  const [workspaceId, profileId] = sql(`select workspace_id || '|' || id from public.profiles where slug='${slug}';`).split("|");
  const cookies = [];
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert(!signedIn.error, "QA login failed");
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: new URL(base).hostname, path: "/", sameSite: "Lax" })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/app/w/${workspaceId}/paginas/${profileId}`);
  await page.locator(".studio").waitFor({ timeout: 60000 });
  const dock = page.locator(".studio-mobile-nav");
  await dock.waitFor();
  async function saved() { await page.waitForFunction(() => document.querySelector(".studio-status .ui-badge")?.textContent === "Salvo"); }
  async function layout(label) {
    await page.waitForFunction(() => Math.abs(document.querySelector(".studio").getBoundingClientRect().height - window.innerHeight) < 2);
    const box = await page.locator(".studio").boundingBox();
    const viewport = page.viewportSize();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow && box.width <= viewport.width + 1 && box.height <= viewport.height + 1, label);
  }
  await page.screenshot({ animations: "disabled", path: resolve(output, "content-390.png") });
  const addBox = await page.locator("#editor-add").boundingBox();
  const dockBox = await dock.boundingBox();
  check(addBox.y + addBox.height <= dockBox.y && dockBox.y - addBox.y - addBox.height < 24, "Add block stays within thumb reach above navigation");
  await layout("390px: fits viewport");
  const panelBox = await page.locator(".studio-panel").boundingBox();
  check(panelBox.height > 600, "Editing receives most of the mobile viewport");
  check(!await page.locator(".studio-stage").isVisible(), "Preview is outside editing focus order");
  const targets = await dock.locator("button").evaluateAll((nodes) => nodes.map((node) => ({ w: node.getBoundingClientRect().width, h: node.getBoundingClientRect().height })));
  check(targets.every(({ w, h }) => w >= 44 && h >= 44), "Bottom controls have 44px touch targets");

  await page.locator(`[data-block-card="${blockId}"] .studio-row-main`).click();
  await page.locator(`[id="${blockId}-first"]`).fill("Portfólio atualizado no celular");
  await saved();
  check(sql(`select blocks->0->>'title' from public.profiles where id='${profileId}';`) === "Portfólio atualizado no celular", "Autosave persists the edit");
  check(await page.locator(`[id="${blockId}-first"]`).evaluate((node) => parseFloat(getComputedStyle(node).fontSize)) >= 16, "Input avoids automatic iOS text-field zoom");
  await page.screenshot({ animations: "disabled", path: resolve(output, "edit-390.png") });
  await dock.getByRole("button", { name: "Prévia", exact: true }).click();
  check(!await page.locator(".studio-panel").isVisible(), "Preview hides the editor controls");
  check(await page.locator(".studio-frame-view").innerText().then((text) => text.includes("Portfólio atualizado no celular")), "Preview shows latest edit");
  await page.screenshot({ animations: "disabled", path: resolve(output, "preview-390.png") });
  await page.getByRole("button", { name: "Continuar editando" }).click();
  check(await page.locator(`[id="${blockId}-first"]`).inputValue() === "Portfólio atualizado no celular", "Preview resumes the same form and value");
  await dock.getByRole("button", { name: "Prévia", exact: true }).click();
  await page.locator(`.studio-frame-view [data-block-id="${blockId}"]`).click();
  check(await page.locator(`[id="${blockId}-first"]`).isVisible(), "Tapping a preview block opens its editor");
  await page.locator(`[id="${blockId}-first"]`).focus();
  await page.setViewportSize({ width: 390, height: 460 });
  await page.waitForFunction(() => document.querySelector(".studio")?.hasAttribute("data-keyboard"));
  await layout("Keyboard resize keeps the editor within the visible area");
  check(!await dock.isVisible(), "Keyboard gives its space to the form");
  const fieldBox = await page.locator(`[id="${blockId}-first"]`).boundingBox();
  check(fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= 460, "Focused field stays above keyboard");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector(".studio")?.hasAttribute("data-keyboard"));
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.locator("#editor-add").click();
  check(await page.locator(".studio-picker-grid > li").count() === 9, "All nine block types remain available");
  await page.screenshot({ animations: "disabled", path: resolve(output, "picker-390.png") });
  await page.locator("#editor-add-first").click();
  const newId = await page.locator(".studio-edit-head [id$='-done']").getAttribute("id").then((id) => id.replace(/-done$/, ""));
  await page.locator(`[id="${newId}-first"]`).fill("Novo link");
  await page.locator(`[id="${newId}-url"]`).fill("javascript:alert(1)");
  await page.locator(".studio-edit-head h2").click();
  check(await page.locator(".studio-head button[type='submit']").isDisabled(), "Invalid content cannot be published");
  check(await page.locator("[aria-invalid='true']").count() > 0, "Invalid field is identified");
  await layout("Validation state fits mobile");
  await page.locator(`[id="${newId}-url"]`).fill("https://example.org/");
  await saved();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.locator(`[id="${newId}-up"]`).click();
  await saved();
  check(sql(`select blocks->0->>'id' from public.profiles where id='${profileId}';`) === newId, "Touch reordering persists");
  await page.locator(`[id="${newId}-toggle"]`).click();
  await page.locator(`[id="${newId}-delete"]`).click();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await saved();
  check(await page.locator(`[data-block-card="${newId}"]`).count() === 1, "Deleting and undoing restores the block");

  await dock.getByRole("button", { name: "Estilos", exact: true }).click();
  await page.locator("#styles-row-templates").click();
  await dock.getByRole("button", { name: "Prévia", exact: true }).click();
  await page.getByRole("button", { name: "Continuar editando" }).click();
  check(await page.locator("#styles-back").isVisible(), "Preview preserves the open style section");
  await dock.getByRole("button", { name: "Página", exact: true }).click();
  check(await page.locator("#address-title").count() === 1, "Page settings remain available");
  await dock.getByRole("button", { name: "Conteúdo", exact: true }).click();
  await page.locator("#editor-header-toggle").click();
  const { default: sharp } = await import("sharp");
  const picture = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#d5c7ef" } }).png().toBuffer();
  let releaseUpload;
  let uploadReached;
  const uploadStarted = new Promise((resolve) => { uploadReached = resolve; });
  const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  await page.route("**/api/media", async (route) => {
    uploadReached();
    await uploadGate;
    await route.fulfill({ status: 503, json: { ok: false, error: "unavailable" } });
  });
  try {
    await page.locator("#editor-avatar-file").setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: picture });
    await page.getByRole("button", { name: "Usar esta imagem", exact: true }).click();
    await uploadStarted;
    check(await page.locator(".studio-head button[type='submit']").isDisabled(), "Publishing waits for the in-flight upload");
    check(await dock.getByRole("button", { name: "Estilos", exact: true }).isDisabled(), "An in-flight upload cannot be discarded by changing tabs");
    await dock.getByRole("button", { name: "Prévia", exact: true }).click();
    await page.getByRole("button", { name: "Continuar editando" }).click();
    check(await page.getByRole("button", { name: "Cancelar envio", exact: true }).isVisible(), "Upload survives preview and return");
  } finally { releaseUpload(); }
  await page.getByRole("alert").filter({ hasText: "Não foi possível enviar a imagem agora" }).waitFor();
  check(await dock.getByRole("button", { name: "Estilos", exact: true }).isEnabled(), "Upload failure releases navigation and shows a useful error");
  await page.screenshot({ animations: "disabled", path: resolve(output, "upload-error-390.png") });
  await dock.getByRole("button", { name: "Conteúdo", exact: true }).click();
  for (const [width, height] of [[320,568], [768,1024], [844,390], [1024,768], [1440,900]]) {
    await page.setViewportSize({ width, height });
    await layout(`${width}x${height}: no overflow`);
    if (width >= 1024) {
      check(await page.locator(".studio-panel").isVisible() && await page.locator(".studio-stage").isVisible(), "Desktop keeps editor and preview side by side");
      check(!await dock.isVisible(), "Desktop does not receive mobile navigation");
    }
    await page.screenshot({ animations: "disabled", path: resolve(output, `content-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator(".studio").waitFor();
  check(await page.locator(`[data-block-card="${blockId}"]`).innerText().then((text) => text.includes("Portfólio atualizado no celular")), "Reload restores saved content");
  await page.locator(".studio-head button[type='submit']").click();
  await page.waitForFunction(() => document.querySelector(".studio-head button[type='submit']")?.textContent === "Tudo publicado");
  check(sql(`select live_publication_id is not null from public.profiles where id='${profileId}';`) === "t", "Publishing still uses the saved draft");
  for (const id of [newId, blockId]) {
    await page.locator(`[id="${id}-toggle"]`).click();
    await page.locator(`[id="${id}-delete"]`).click();
  }
  check(await page.getByText("Sua página ainda não tem blocos.", { exact: true }).isVisible(), "Empty state guides the next action");
  await page.screenshot({ animations: "disabled", path: resolve(output, "empty-390.png") });
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await saved();
  await page.locator(`[id="${blockId}-toggle"]`).click();
  await context.setOffline(true);
  await page.locator(`[id="${blockId}-first"]`).fill("Alteração sem conexão");
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).waitFor({ timeout: 25000 });
  check(await page.locator(`[id="${blockId}-first"]`).inputValue() === "Alteração sem conexão", "Network failure keeps the local edit");
  check(await page.locator(".studio-head button[type='submit']").isDisabled(), "Network failure cannot publish stale content");
  check((await page.locator(".studio-head").boundingBox()).height < 190, "Save failure keeps a compact, readable header");
  await page.screenshot({ animations: "disabled", path: resolve(output, "save-error-390.png") });
  await context.setOffline(false);
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await saved();
  check(sql(`select blocks->0->>'title' from public.profiles where id='${profileId}';`) === "Alteração sem conexão", "Retry saves after the connection returns");
  check(errors.length === 0, "No browser runtime errors");
  console.log(`${checks} checks passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  sql(`
    delete from public.profiles where workspace_id in (select id from public.workspaces where created_by='${userId}');
    delete from public.slug_history where slug='${slug}';
    delete from public.workspaces where created_by='${userId}';
    delete from auth.users where id='${userId}' and email='${email}';
  `);
}
