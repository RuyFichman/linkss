// Custom domains and pixels on the local stack (Sprint 8 part 2; ADR 0016, ADR 0017).
//
// A real domain cannot point at localhost and no hosting-provider token exists yet, so this script
// IS the outside world: it serves a tiny DNS resolver (TXT only) and an emulator of the four calls
// of Vercel's REST API the adapter uses (written from Vercel's reference), starts the production
// build of the application pointed at both, and then plays the life of a custom domain against the
// REAL Server Actions, the REAL DNS client, the REAL adapter, the REAL database and the REAL
// routing rules of next.config.ts (requests carry the custom hostname in the Host header):
//
//   claim -> check without the record -> publish the record -> proven -> point DNS -> live ->
//   another workspace claims the same name -> refused while the first proof stands -> taken over
//   when it is gone -> removed
//
// with the negative cases: each role and no session against the owner's own forms; what a custom
// hostname serves besides the page (nothing); and, for pixels, what is accepted, what the public
// page then carries, and which routes get the vendor origins in their Content-Security-Policy.
//
// What it proves: the product is consistent with our reading of Vercel's reference, end to end.
// What it does not prove: that Vercel behaves as the emulator does, that a certificate is issued,
// or that Meta and Google accept the page views. Those need a real domain and real accounts.
//
// LOCAL STACK ONLY. It refuses to run against anything that is not a local Supabase. It creates
// the accounts qa-domains-*@example.test with their workspaces and pages, and the local Vault
// secret `domains_signing_secret` if it does not exist (never printed). --cleanup removes them.
//
//   npm run db:start                                                        (repository root)
//   NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build --workspace=@lnk/web
//   node scripts/domains-lifecycle.mjs              (in apps/web) runs everything and exits
//   node scripts/domains-lifecycle.mjs --serve      leaves everything up after the run, for a browser
//   node scripts/domains-lifecycle.mjs --cleanup    removes what it created
//
// Environment: APP_PORT (3100), EMULATOR_PORT (4343), DNS_PORT (5354), DB_CONTAINER (supabase_db_lnk).

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { existsSync, readFileSync } from "node:fs";
import http, { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

const APP_PORT = Number(process.env.APP_PORT ?? 3100);
const EMULATOR_PORT = Number(process.env.EMULATOR_PORT ?? 4343);
const DNS_PORT = Number(process.env.DNS_PORT ?? 5354);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const EMULATOR_URL = `http://127.0.0.1:${EMULATOR_PORT}`;
const DB_CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const CLEANUP = process.argv.includes("--cleanup");
const SERVE = process.argv.includes("--serve");
const EMAIL_PREFIX = "qa-domains-";
const SLUG_PREFIX = "qa-domains-";
const HOST = "www.qa-domains-loja.test";
// Local-only values for the emulator. They are not credentials of any real account.
const PROVIDER_TOKEN = "local-emulator-token-000000000000";
const PROJECT_ID = "prj_local_emulator";
const META_ID = "1234567890123456";
const GA_ID = "G-QADOMAINS01";
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
  // Domains, pixels and pages cascade from the workspaces.
  sql(`
    delete from public.profiles where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAIL_PREFIX}%@example.test');
    delete from public.slug_history where slug like '${SLUG_PREFIX}%';
    delete from public.workspaces where created_by in (select id from auth.users where email like '${EMAIL_PREFIX}%@example.test');
    delete from auth.users where email like '${EMAIL_PREFIX}%@example.test';`);
}

if (CLEANUP) {
  cleanup();
  console.log(`Removed the ${EMAIL_PREFIX}*@example.test accounts, their workspaces, pages, domains and pixels.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** Three people of one agency workspace (owner, admin, editor) and an outsider with their own, both on the Agency plan by SQL. */
function setupAccounts(password) {
  cleanup();
  const out = sql(`
    do $$
    declare
      v_name text;
      v_user uuid;
      v_workspace uuid;
      v_other uuid;
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
          v_workspace := public.create_agency_workspace('QA Domínios');
        elsif v_name = 'outsider' then
          v_other := public.create_agency_workspace('QA Domínios Vizinha');
        end if;
      end loop;
      perform set_config('request.jwt.claims', '', true);
      update public.workspaces set plan_id = 'agency' where id in (v_workspace, v_other);
      insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
      select v_workspace, u.id, case when u.email like '%admin%' then 'admin' else 'editor' end::public.workspace_role, 'active', now()
      from auth.users u where u.email in ('${EMAIL_PREFIX}admin@example.test', '${EMAIL_PREFIX}editor@example.test');
    end;
    $$;
    select (select w.id from public.workspaces w where w.name = 'QA Domínios') || '|' || (select w.id from public.workspaces w where w.name = 'QA Domínios Vizinha');`);
  const [workspaceId, outsiderWorkspaceId] = out.split("|");
  return { workspaceId, outsiderWorkspaceId };
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
// The outside world: a TXT-only DNS resolver and the hosting provider's API
// ---------------------------------------------------------------------------------------------

/** name -> TXT values. What the "owner of the domain" has published. */
const zone = new Map();
const dnsQueries = [];

function startDns() {
  const socket = createSocket("udp4");
  socket.on("message", (query, remote) => {
    // Header (12 bytes), then one question: labels, type, class. Anything after it (EDNS) is ignored.
    let offset = 12;
    const labels = [];
    while (query[offset] !== 0) {
      labels.push(query.subarray(offset + 1, offset + 1 + query[offset]).toString("ascii"));
      offset += query[offset] + 1;
    }
    const questionEnd = offset + 5;
    const name = labels.join(".").toLowerCase();
    const type = query.readUInt16BE(offset + 1);
    dnsQueries.push(`${type}:${name}`);
    const values = type === 16 ? zone.get(name) ?? [] : [];
    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2);
    header.writeUInt16BE(values.length > 0 ? 0x8180 : 0x8183, 2); // answer, or NXDOMAIN
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(values.length, 6);
    const answers = values.map((value) => {
      const text = Buffer.from(value, "ascii");
      const record = Buffer.alloc(12 + 1 + text.length);
      record.writeUInt16BE(0xc00c, 0); // the name of the question
      record.writeUInt16BE(16, 2);
      record.writeUInt16BE(1, 4);
      record.writeUInt32BE(0, 6);
      record.writeUInt16BE(text.length + 1, 10);
      record.writeUInt8(text.length, 12);
      text.copy(record, 13);
      return record;
    });
    socket.send(Buffer.concat([header, query.subarray(12, questionEnd), ...answers]), remote.port, remote.address);
  });
  return new Promise((resolve) => socket.bind(DNS_PORT, "127.0.0.1", () => resolve(socket)));
}

/** hostname -> { pointing }. The project's domains at the provider. */
const provider = new Map();
const providerCalls = [];
let providerDown = false;

function startProvider() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", EMULATOR_URL);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const json = (status, body) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    providerCalls.push(`${request.method} ${url.pathname}`);
    if (providerDown) return json(500, { error: { code: "internal_server_error" } });
    if (request.headers.authorization !== `Bearer ${PROVIDER_TOKEN}`) return json(403, { error: { code: "forbidden" } });
    const describe = (name) => ({ name, apexName: name.split(".").slice(-2).join("."), projectId: PROJECT_ID, verified: true, createdAt: Date.now(), updatedAt: Date.now() });

    const one = new RegExp(`^/v9/projects/${PROJECT_ID}/domains/([^/]+)$`).exec(url.pathname);
    if (one && request.method === "GET") return provider.has(one[1]) ? json(200, describe(one[1])) : json(404, { error: { code: "not_found" } });
    if (one && request.method === "DELETE") {
      if (!provider.has(one[1])) return json(404, { error: { code: "not_found" } });
      provider.delete(one[1]);
      return json(200, {});
    }
    if (url.pathname === `/v10/projects/${PROJECT_ID}/domains` && request.method === "POST") {
      const name = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}").name;
      if (typeof name !== "string") return json(400, { error: { code: "bad_request" } });
      if (provider.has(name)) return json(400, { error: { code: "domain_already_exists" } });
      provider.set(name, { pointing: false });
      return json(200, describe(name));
    }
    const config = /^\/v6\/domains\/([^/]+)\/config$/.exec(url.pathname);
    if (config && request.method === "GET") {
      const pointing = provider.get(config[1])?.pointing === true;
      return json(200, { misconfigured: !pointing, configuredBy: pointing ? "CNAME" : null, acceptedChallenges: [], recommendedCNAME: [{ rank: 1, value: "qa.vercel-dns-emulator.test." }], recommendedIPv4: [{ rank: 1, value: ["203.0.113.10"] }] });
    }
    return json(404, { error: { code: "not_found" } });
  });
  return new Promise((resolve) => server.listen(EMULATOR_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------------------------
// The application: the production build, started with the domains environment
// ---------------------------------------------------------------------------------------------

function ensureVaultSecret() {
  // Created inside the database when missing, read back for the child process, never printed.
  return sql(`
    do $$ begin
      if not exists (select 1 from vault.secrets where name = 'domains_signing_secret') then
        perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'domains_signing_secret');
      end if;
    end $$;
    select decrypted_secret from vault.decrypted_secrets where name = 'domains_signing_secret';`);
}

async function startApp(signingSecret) {
  if (!existsSync(`${APP_DIR}.next/BUILD_ID`)) throw new Error("No production build. Run: NEXT_PUBLIC_APP_URL=" + BASE_URL + " npm run build --workspace=@lnk/web");
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_PUBLIC_APP_URL: BASE_URL, DOMAINS_SIGNING_SECRET: signingSecret, DOMAINS_DNS_RESOLVER: `127.0.0.1:${DNS_PORT}`, VERCEL_API_TOKEN: PROVIDER_TOKEN, VERCEL_PROJECT_ID: PROJECT_ID, VERCEL_API_BASE_URL: EMULATOR_URL },
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
// Acting as a person, and as a visitor of a custom hostname
// ---------------------------------------------------------------------------------------------

const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// React separates adjacent text nodes with empty comments; they are not spaces.
const visibleText = (html) => decode(html.replace(/<!-- -->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

async function get(session, path) {
  const response = await fetch(`${BASE_URL}${path}`, { headers: session ? { cookie: session.cookie() } : {}, redirect: "manual" });
  const html = await response.text();
  return { status: response.status, location: response.headers.get("location"), html, text: visibleText(html), csp: response.headers.get("content-security-policy") ?? "" };
}

/** A request the way it arrives for a custom domain: the application's address, the customer's Host. `fetch` cannot set Host. */
function visit(host, path, { method = "GET", body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: APP_PORT, path, method, headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, location: response.headers.location ?? null, html, text: visibleText(html), csp: String(response.headers["content-security-policy"] ?? ""), cache: String(response.headers["x-nextjs-cache"] ?? "") });
      });
    });
    request.on("error", reject);
    if (body !== null) request.write(body);
    request.end();
  });
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
async function submit(as, path, form, values = {}) {
  const data = new FormData();
  for (const [name, value] of form.fields) data.append(name, name in values ? values[name] : value);
  const response = await fetch(`${BASE_URL}${path}`, { method: "POST", body: data, redirect: "manual", headers: { ...(as ? { cookie: as.cookie() } : {}), origin: BASE_URL } });
  const html = await response.text();
  return { status: response.status, location: response.headers.get("location"), html, text: visibleText(html) };
}

let appLogs = [];
function outcomes(eventName) {
  return appLogs.join("").split("\n").filter((line) => line.includes(`"event":"${eventName}"`)).map((line) => /"outcome":"([a-z_]+)"/.exec(line)?.[1] ?? "");
}
/** Runs `work` and answers the outcome the server logged for it. A refusal has nowhere to show on a screen that has no form. */
async function outcomeOf(eventName, work) {
  const before = outcomes(eventName).length;
  const result = await work();
  for (let attempt = 0; attempt < 40 && outcomes(eventName).length === before; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  return { result, outcome: outcomes(eventName).length === before ? "" : outcomes(eventName).at(-1) ?? "" };
}

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "  ok  " : "  FAIL"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
}
const step = (title) => console.log(`\n== ${title}`);

function domainRow(profileId) {
  const row = sql(`select coalesce((select id || '|' || status || '|' || routing || '|' || challenge from public.profile_domains where profile_id = '${profileId}'), 'none');`);
  if (row === "none") return null;
  const [id, status, routing, challenge] = row.split("|");
  return { id, status, routing, challenge };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

async function lifecycle({ workspaceId, outsiderWorkspaceId }, password) {
  const owner = await signIn("owner", password);
  const admin = await signIn("admin", password);
  const editor = await signIn("editor", password);
  const outsider = await signIn("outsider", password);

  const created = await owner.supabase.from("profiles").insert({ workspace_id: workspaceId, title: "Loja QA Domínios", bio: "Página de teste", slug: `${SLUG_PREFIX}loja` }).select("id").single();
  const other = await outsider.supabase.from("profiles").insert({ workspace_id: outsiderWorkspaceId, title: "Vizinha QA Domínios", bio: "Outra conta", slug: `${SLUG_PREFIX}vizinha` }).select("id").single();
  if (created.error || other.error) throw new Error(`fixture pages: ${created.error?.message ?? other.error?.message}`);
  const pageId = created.data.id;
  const otherPageId = other.data.id;
  for (const [session, id] of [[owner, pageId], [outsider, otherPageId]]) {
    const published = await session.supabase.rpc("publish_profile", { p_profile_id: id });
    if (published.error) throw new Error(`publish: ${published.error.message}`);
  }
  // The editor opens on its "Página" tab, where the page settings are.
  const settings = `/app/w/${workspaceId}/paginas/${pageId}?aba=pagina`;
  const otherSettings = `/app/w/${outsiderWorkspaceId}/paginas/${otherPageId}?aba=pagina`;
  const record = `_linkfav.${HOST}`;

  step("Before any domain");
  const before = await visit(HOST, "/");
  check("an unknown hostname answers 404", before.status === 404, String(before.status));
  check("and never the marketing home", !before.text.includes("Criar minha página") && before.text.includes("Página não encontrada"));
  const empty = await get(owner, settings);
  check("the owner sees the domain form and the pixels form in the page settings", empty.text.includes("Domínio próprio") && empty.text.includes("Usar este domínio") && empty.text.includes("Salvar códigos"));
  const editorView = await get(editor, settings);
  check("an editor sees both sections without forms", editorView.text.includes("Proprietários e administradores configuram o domínio") && !editorView.text.includes("Usar este domínio") && !editorView.text.includes("Salvar códigos"));

  step("Claim");
  const claimForm = formWith(empty.html, "Usar este domínio");
  const invalid = await submit(owner, settings, claimForm, { hostname: "isto não é um domínio" });
  check("an invalid hostname is refused with a field message", invalid.text.includes("não parece um domínio") && domainRow(pageId) === null);
  const blocked = await submit(owner, settings, claimForm, { hostname: "pagina.linkfav.com" });
  check("the product's own domain is refused", blocked.text.includes("não pode ser usado") && domainRow(pageId) === null);
  for (const [who, expected] of [[editor, "forbidden"], [outsider, "not_found"], [null, "unauthenticated"]]) {
    const { outcome } = await outcomeOf("domains.claim", () => submit(who, settings, claimForm, { hostname: HOST }));
    check(`the owner's claim form posted ${who ? `with the ${who.name}'s session` : "with no session"} is refused (${expected})`, (outcome === expected || (who === null && outcome === "")) && domainRow(pageId) === null, outcome);
  }
  const claimed = await submit(owner, settings, claimForm, { hostname: `https://${HOST.toUpperCase()}/` });
  let row = domainRow(pageId);
  check("the owner claims the hostname (typed as a URL, stored as a hostname)", row?.status === "pending" && sql(`select hostname from public.profile_domains where id = '${row?.id}';`) === HOST, claimed.text.slice(0, 200));
  const pendingView = await get(owner, settings);
  check("the screen shows the TXT record to create", pendingView.text.includes("1. Comprove que o domínio é seu") && pendingView.text.includes(record) && pendingView.text.includes(row?.challenge ?? "missing"));
  check("a claim opens nothing", (await visit(HOST, "/")).status === 404 && provider.size === 0);

  step("Proof of control");
  const verifyForm = () => get(owner, settings).then((page) => formWith(page.html, "Verificar"));
  const missing = await submit(owner, settings, await verifyForm());
  check("checking before the record exists says so and changes nothing", missing.text.includes("Ainda não encontramos o registro TXT") && domainRow(pageId)?.status === "pending" && provider.size === 0);
  check("the server asked the test resolver for the TXT record", dnsQueries.includes(`16:${record}`), dnsQueries.join(","));
  zone.set(record, ["v=spf1 -all", `linkfav-verify=${"0".repeat(32)}`]);
  await submit(owner, settings, await verifyForm());
  check("somebody else's challenge in the record is not the proof", domainRow(pageId)?.status === "pending" && provider.size === 0);
  zone.set(record, ["v=spf1 -all", row?.challenge ?? ""]);
  for (const [who, expected] of [[editor, "forbidden"], [outsider, "not_found"]]) {
    const { outcome } = await outcomeOf("domains.verify", async () => submit(who, settings, await verifyForm()));
    check(`the ${who.name} cannot run the check even with the record in place (${expected})`, outcome === expected && domainRow(pageId)?.status === "pending", outcome);
  }
  providerDown = true;
  const provenOffline = await submit(owner, settings, await verifyForm());
  check("with the provider unreachable, control is still proven and the screen says what failed", domainRow(pageId)?.status === "active" && provenOffline.text.includes("não foi possível falar com o provedor"), provenOffline.text.slice(0, 300));
  providerDown = false;
  const proven = await submit(admin, settings, await get(admin, settings).then((page) => formWith(page.html, "Verificar de novo")));
  row = domainRow(pageId);
  check("an admin checks again: attached at the provider, waiting for DNS to point here", row?.status === "active" && row?.routing === "pending" && provider.has(HOST) && proven.text.includes("Controle comprovado"), `${row?.status}/${row?.routing}`);
  const routingView = await get(owner, settings);
  check("the screen shows the provider's record to create", routingView.text.includes("2. Aponte o domínio para a sua página") && routingView.text.includes("CNAME") && routingView.text.includes("qa.vercel-dns-emulator.test"));

  step("The hostname serves the page, and only the page");
  const served = await visit(HOST, "/");
  check("the root of the custom hostname is the published page", served.status === 200 && served.text.includes("Loja QA Domínios"), String(served.status));
  check("canonical and og:url are the custom domain", served.html.includes(`<link rel="canonical" href="https://${HOST}"`) && served.html.includes(`property="og:url" content="https://${HOST}"`));
  check("the Open Graph image is the product's", served.html.includes(`${BASE_URL}/${SLUG_PREFIX}loja/opengraph-image`));
  check("links to the product are absolute", served.html.includes(`href="${BASE_URL}/denunciar?pagina=${SLUG_PREFIX}loja"`));
  const productAddress = await get(null, `/${SLUG_PREFIX}loja`);
  check("the product address keeps working and names the custom domain as canonical", productAddress.status === 200 && productAddress.html.includes(`<link rel="canonical" href="https://${HOST}"`));
  for (const path of ["/entrar", "/cadastro", "/app", `/${SLUG_PREFIX}loja`, "/r/abc", "/api/health", "/api/billing/webhook", "/denunciar", "/d/outro.exemplo.test", "/privacidade"]) {
    const response = await visit(HOST, path);
    const opensProduct = response.status === 200 || (response.status >= 300 && response.status < 400 && !(response.location ?? "").includes("/entrar"));
    check(`${path} on the custom hostname serves nothing of the product`, !opensProduct && !response.text.includes("Entrar na sua conta") && !response.text.includes('"status":"ok"'), `${response.status} ${response.location ?? ""}`);
  }
  const asset = /\/_next\/static\/[^"']+\.css/.exec(served.html)?.[0];
  check("the page's own assets load from the custom hostname", Boolean(asset) && (await visit(HOST, asset ?? "/missing")).status === 200, asset ?? "no stylesheet found");
  const beacon = await visit(HOST, "/api/events", { method: "POST", body: "{}", headers: { "content-type": "text/plain", "content-length": "2" } });
  check("the analytics beacon is accepted there", beacon.status === 204, String(beacon.status));
  check("another hostname still opens nothing", (await visit("www.outro-qa-domains.test", "/")).status === 404);
  check("the product's own hosts are not custom domains", (await visit("localhost", "/")).text.includes("Criar") && (await get(null, "/")).status === 200);

  step("DNS points here");
  provider.get(HOST).pointing = true;
  const live = await submit(owner, settings, await get(owner, settings).then((page) => formWith(page.html, "Verificar de novo")));
  check("the next check reports the domain live", domainRow(pageId)?.routing === "ok" && live.text.includes("Domínio no ar"));
  check("the screen links to the domain", (await get(owner, settings)).html.includes(`href="https://${HOST}"`));

  step("Another workspace wants the same hostname");
  const otherClaim = await submit(outsider, otherSettings, formWith((await get(outsider, otherSettings)).html, "Usar este domínio"), { hostname: HOST });
  const otherRow = domainRow(otherPageId);
  check("the claim is accepted and says nothing about the hostname being in use", otherRow?.status === "pending" && !otherClaim.text.includes("já está em uso"));
  const otherVerify = () => get(outsider, otherSettings).then((page) => formWith(page.html, "Verificar"));
  await submit(outsider, otherSettings, await otherVerify());
  check("without their own record, nothing changes", domainRow(otherPageId)?.status === "pending" && domainRow(pageId)?.status === "active");
  zone.set(record, [row?.challenge ?? "", otherRow?.challenge ?? ""]);
  const inUse = await submit(outsider, otherSettings, await otherVerify());
  check("with both proofs in DNS the hostname stays with the first page", inUse.text.includes("já está em uso em outra página") && domainRow(otherPageId)?.status === "pending" && domainRow(pageId)?.status === "active");
  check("and still opens the first page", (await visit(HOST, "/")).text.includes("Loja QA Domínios"));
  zone.set(record, [otherRow?.challenge ?? ""]);
  await submit(outsider, otherSettings, await otherVerify());
  check("once only the new proof is in DNS, the hostname moves", domainRow(otherPageId)?.status === "active" && domainRow(pageId)?.status === "lapsed");
  const moved = await visit(HOST, "/");
  check("the hostname opens the new page at once (cache dropped)", moved.text.includes("Vizinha QA Domínios") && !moved.text.includes("Loja QA Domínios"), moved.cache);
  check("the first page is canonical at its product address again", (await get(null, `/${SLUG_PREFIX}loja`)).html.includes(`<link rel="canonical" href="${BASE_URL}/${SLUG_PREFIX}loja"`));
  const lapsedView = await get(owner, settings);
  check("the first owner is told what happened", lapsedView.text.includes("Este domínio não está mais ligado a esta página"));
  check("both changes are in the audit trail of the right workspaces", sql(`select (select count(*) from public.audit_events where workspace_id = '${workspaceId}' and action = 'domain.lapsed') || '/' || (select count(*) from public.audit_events where workspace_id = '${outsiderWorkspaceId}' and action = 'domain.verified');`) === "1/1");

  step("Plan and removal");
  sql(`update public.workspaces set plan_id = 'free' where id = '${outsiderWorkspaceId}';`);
  const downgraded = await get(outsider, otherSettings);
  check("without the plan the screen says the domain is suspended, and keeps it", downgraded.text.includes("não inclui mais domínio próprio") && domainRow(otherPageId)?.status === "active");
  check("the database stops answering for the hostname", sql(`select state from public.get_public_page_by_domain('${HOST}');`) === "not_found");
  sql(`update public.workspaces set plan_id = 'agency' where id = '${outsiderWorkspaceId}';`);
  check("and answers again with the plan", sql(`select state from public.get_public_page_by_domain('${HOST}');`) === "published");
  const removeForm = formWith((await get(outsider, otherSettings)).html, "Remover domínio");
  const { outcome: strangerRemove } = await outcomeOf("domains.remove", () => submit(owner, otherSettings, removeForm));
  check("another workspace's owner cannot remove it (not_found)", strangerRemove === "not_found" && domainRow(otherPageId) !== null, strangerRemove);
  await submit(outsider, otherSettings, removeForm);
  check("its owner removes it: the row is gone and the hostname is detached at the provider", domainRow(otherPageId) === null && !provider.has(HOST));
  check("the hostname opens nothing at once", (await visit(HOST, "/")).status === 404);
  await submit(owner, settings, formWith((await get(owner, settings)).html, "Remover domínio"));
  check("the lapsed claim can be removed too", domainRow(pageId) === null);

  step("Pixels");
  const pixelsForm = () => get(owner, settings).then((page) => formWith(page.html, "Salvar códigos"));
  const script = await submit(owner, settings, await pixelsForm(), { meta: "<script>alert(1)</script>", ga: "" });
  check("a script is not an identifier", script.text.includes("só números") && sql(`select count(*) from public.profile_pixels where profile_id = '${pageId}';`) === "0");
  const gtm = await submit(owner, settings, await pixelsForm(), { meta: "", ga: "GTM-ABC1234" });
  check("a Tag Manager container is refused", gtm.text.includes("começa com G-") && sql(`select count(*) from public.profile_pixels where profile_id = '${pageId}';`) === "0");
  const { outcome: editorPixels } = await outcomeOf("pixels.set", async () => submit(editor, settings, await pixelsForm(), { meta: META_ID, ga: "" }));
  check("an editor cannot set them, even with the owner's form (forbidden)", editorPixels === "forbidden", editorPixels);
  const saved = await submit(owner, settings, await pixelsForm(), { meta: META_ID, ga: GA_ID.toLowerCase() });
  check("the owner saves both identifiers", saved.text.includes("Códigos salvos") && sql(`select meta_pixel_id || '|' || ga_measurement_id from public.profile_pixels where profile_id = '${pageId}';`) === `${META_ID}|${GA_ID}`);
  const withPixels = await get(null, `/${SLUG_PREFIX}loja`);
  check("the public page carries the identifiers for the consent notice, at once", withPixels.html.includes(META_ID) && withPixels.html.includes(GA_ID));
  check("and no vendor script, image or connection in its HTML", !/connect\.facebook\.net|googletagmanager\.com|facebook\.com\/tr|google-analytics\.com/.test(withPixels.html));
  check("its Content-Security-Policy allows the two vendors", withPixels.csp.includes("https://connect.facebook.net") && withPixels.csp.includes("https://www.googletagmanager.com"));
  for (const path of ["/", "/entrar", "/cadastro", "/privacidade", "/denunciar", `/app/w/${workspaceId}`, "/r/abc", "/api/health"]) {
    const response = await get(path.startsWith("/app") ? owner : null, path);
    check(`${path} keeps the baseline policy (no vendor origin)`, response.csp.includes("script-src 'self'") && !/facebook|google/.test(response.csp), response.csp.slice(0, 120));
  }
  check("the preview does not carry the identifiers", !(await get(owner, `/app/w/${workspaceId}/paginas/${pageId}/previa`)).html.includes(META_ID));
  sql(`update public.workspaces set plan_id = 'free' where id = '${workspaceId}';`);
  check("without the plan the database stops handing the identifiers out, and keeps them", sql(`select coalesce(pixels::text, 'none') from public.get_public_page('${SLUG_PREFIX}loja');`) === "none" && sql(`select count(*) from public.profile_pixels where profile_id = '${pageId}';`) === "1");
  const suspended = await get(owner, settings);
  check("the screen says the pixels are suspended by the plan", suspended.text.includes("não inclui mais Meta Pixel e Google Analytics"));
  await submit(owner, settings, formWith(suspended.html, "Salvar códigos"), { meta: "", ga: "" });
  check("clearing is allowed without the plan", sql(`select count(*) from public.profile_pixels where profile_id = '${pageId}';`) === "0");
  sql(`update public.workspaces set plan_id = 'agency' where id = '${workspaceId}';`);
  check("the trail records which tools were on, never the identifiers", sql(`select count(*) from public.audit_events where workspace_id = '${workspaceId}' and action = 'pixels.updated' and (metadata::text like '%${META_ID}%' or metadata::text like '%${GA_ID}%');`) === "0"
    && Number(sql(`select count(*) from public.audit_events where workspace_id = '${workspaceId}' and action = 'pixels.updated';`)) === 2);
}

const password = randomBytes(18).toString("base64url");
const dns = await startDns();
const providerServer = await startProvider();
let app;
try {
  const fixtures = setupAccounts(password);
  app = await startApp(ensureVaultSecret());
  appLogs = app.logs;
  await lifecycle(fixtures, password);
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${passed} checks passed, ${failures.length} failed.`);
  for (const failure of failures) console.log(`  - ${failure}`);
  console.log(`Provider calls: ${providerCalls.length}. DNS queries: ${dnsQueries.length}.`);
  // The application's own log lines: outcome only, no hostname, challenge, identifier or token.
  const lines = app.logs.join("").split("\n").filter((line) => line.includes('"domains.') || line.includes('"pixels.') || line.includes("public_page."));
  const leaked = lines.filter((line) => line.includes(HOST) || line.includes("linkfav-verify=") || line.includes(META_ID) || line.includes(GA_ID) || line.includes(PROVIDER_TOKEN) || line.includes("example.test"));
  console.log(`Application log: ${lines.length} domain, pixel and public-page lines, ${leaked.length} with a hostname, a challenge, an identifier, a token or an address.`);
  if (leaked.length > 0) failures.push("log lines leak identifiers");
  console.log(`The accounts ${EMAIL_PREFIX}*@example.test stay in the local database; remove them with: node scripts/domains-lifecycle.mjs --cleanup`);
  if (SERVE) {
    console.log(`\nServing on ${BASE_URL} (Ctrl+C to stop). Sign in as ${EMAIL_PREFIX}owner@example.test with the password: ${password}`);
    await new Promise(() => {});
  }
} finally {
  app?.child.kill();
  providerServer.close();
  dns.close();
}
process.exit(failures.length === 0 ? 0 : 1);
