// Controlled accuracy test for customer analytics (Sprint 6, AC5; ADR 0011).
//
// Sends a fixture with a known composition through the REAL ingestion path of a running local
// application (POST /api/events, and the anonymous submit_form_lead RPC for form submissions), runs
// the aggregation job, and compares the aggregated totals with the expected valid totals.
// Exit code 1 when any metric differs from its expected value by more than 5%.
//
// LOCAL STACK ONLY. It creates a QA account and a page in the database it is pointed at and
// deletes that page's analytics rows on every run; it refuses to run against anything that is not
// a local Supabase.
//
//   npm run db:start                                  (repository root)
//   npm run build --workspace=@lnk/web && npx next start -p 3100     (in apps/web)
//   node scripts/analytics-accuracy.mjs               (in apps/web)
//   node scripts/analytics-accuracy.mjs --burst       adds the burst and rate-limit measurement
//
// Reads apps/web/.env.local for the Supabase URL, the publishable key and CRON_SECRET.
// Environment: BASE_URL (default http://localhost:3100), DB_CONTAINER (default supabase_db_lnk).

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const DB_CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const BURST = process.argv.includes("--burst");
const SLUG = "precisao-analytics";
const TOLERANCE = 0.05;

const BLOCKS = {
  link: "b6000000-0000-4000-8000-000000000001",
  social: "b6000000-0000-4000-8000-000000000002",
  whatsapp: "b6000000-0000-4000-8000-000000000003",
  pix: "b6000000-0000-4000-8000-000000000004",
  embed: "b6000000-0000-4000-8000-000000000005",
  form: "b6000000-0000-4000-8000-000000000006",
  hidden: "b6000000-0000-4000-8000-000000000007",
};

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BOTS = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "WhatsApp/2.23.20.0 A",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
  "curl/8.7.1",
];

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

function setup() {
  const blocks = JSON.stringify([
    { id: BLOCKS.link, type: "link", visible: true, title: "Site", url: "https://exemplo.com.br/" },
    { id: BLOCKS.social, type: "social", visible: true, items: [{ network: "instagram", url: "https://www.instagram.com/exemplo" }] },
    { id: BLOCKS.whatsapp, type: "whatsapp", visible: true, label: "Fale comigo", phone: "5511912345678", message: "" },
    { id: BLOCKS.pix, type: "pix", visible: true, label: "Pagar", keyType: "random", key: "123e4567-e89b-42d3-a456-426614174000", paymentUrl: "https://pag.exemplo.com.br/x" },
    { id: BLOCKS.embed, type: "embed", visible: true, provider: "youtube", ref: "dQw4w9WgXcQ", title: "Vídeo" },
    { id: BLOCKS.form, type: "form", visible: true, title: "Contato", fields: ["email"], buttonLabel: "Enviar", consentText: "Aceito.", consentRequired: false },
    { id: BLOCKS.hidden, type: "link", visible: false, title: "Oculto", url: "https://exemplo.com.br/oculto" },
  ]);
  return sql(`
    do $$
    declare
      v_user uuid;
      v_workspace uuid;
      v_page uuid;
    begin
      select id into v_user from auth.users where email = 'qa-analytics-accuracy@example.test';
      if v_user is null then
        v_user := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', 'qa-analytics-accuracy@example.test', '', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"QA Precisão"}'::jsonb, now(), now(), '', '', '', '');
      end if;
      perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
      v_workspace := public.ensure_personal_workspace();
      select id into v_page from public.profiles where slug = '${SLUG}' and deleted_at is null;
      if v_page is null then
        insert into public.profiles (workspace_id, title, slug) values (v_workspace, 'Teste de precisão', '${SLUG}') returning id into v_page;
      end if;
      update public.profiles set blocks = '${blocks}'::jsonb where id = v_page;
      perform public.publish_profile(v_page);
      delete from public.analytics_events where profile_id = v_page;
      delete from public.analytics_daily where profile_id = v_page;
      delete from public.form_leads where profile_id = v_page;
      delete from public.form_submission_hits where profile_id = v_page;
    end;
    $$;
    select id from public.profiles where slug = '${SLUG}' and deleted_at is null;`);
}

const latencies = [];
const statuses = new Map();

async function post(body, { userAgent = PHONE, ip, cookie, fetchSite = "same-origin", contentType = "text/plain;charset=UTF-8" } = {}) {
  const headers = { "content-type": contentType, "user-agent": userAgent, "sec-fetch-site": fetchSite };
  if (ip) headers["x-forwarded-for"] = ip;
  if (cookie) headers.cookie = cookie;
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}/api/events`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  await response.arrayBuffer();
  latencies.push(performance.now() - startedAt);
  statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
}

async function inParallel(tasks, concurrency) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < tasks.length) await tasks[next++]();
  }));
}

const event = (type, block) => (block ? { i: randomUUID(), t: type, b: block } : { i: randomUUID(), t: type });
const batch = (events, extra = {}) => ({ v: 1, s: SLUG, e: events, ...extra });
const ip = (group, n) => `198.51.${group}.${n}`;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function settle(pageId, label) {
  // The endpoint answers before the database write, so wait until the row count stops changing.
  let previous = -1;
  let stable = 0;
  const startedAt = performance.now();
  while (stable < 3) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const count = Number(sql(`select count(*) from public.analytics_events where profile_id = '${pageId}'`));
    stable = count === previous ? stable + 1 : 0;
    previous = count;
  }
  console.log(`${label}: ${previous} raw events stored (stable after ${Math.round(performance.now() - startedAt)} ms of polling)`);
  return previous;
}

async function runJob(day = null) {
  const response = await fetch(`${BASE_URL}/api/jobs/analytics${day ? `?day=${day}` : ""}`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET ?? ""}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(`job failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function submitLead(n, email) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/submit_form_lead`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}` },
    body: JSON.stringify({ p_slug: SLUG, p_block_id: BLOCKS.form, p_fields: { email }, p_consent: false, p_honeypot: "", p_client_hash: String(n).padStart(32, "0") }),
  });
  return response.json();
}

async function accuracy(pageId) {
  const tasks = [];
  const retries = [];
  const visitors = [];

  // ---- Valid: 120 visitors, one visit each ---------------------------------------------------
  for (let n = 1; n <= 120; n += 1) {
    const visitor = { ip: ip(1, n), userAgent: n <= 90 ? PHONE : DESKTOP };
    const context = n <= 60 ? { r: "l.instagram.com" } : n <= 90 ? {} : n <= 110 ? { r: "www.google.com.br" } : { u: ["whatsapp", "status", "outubro"] };
    visitors.push({ ...visitor, context });
    const body = batch([event("page_view")], context);
    tasks.push(() => post(body, visitor));
    // 30 of these batches are sent again, byte for byte (a client retry).
    if (n <= 30) retries.push(() => post(body, visitor));
  }
  // ---- Valid actions --------------------------------------------------------------------------
  const actions = [["link_click", BLOCKS.link, 40], ["whatsapp_click", BLOCKS.whatsapp, 25], ["pix_copy", BLOCKS.pix, 10], ["pix_pay_click", BLOCKS.pix, 5], ["social_click", BLOCKS.social, 8], ["embed_load", BLOCKS.embed, 6]];
  const actionTasks = [];
  for (const [type, block, count] of actions) {
    for (let n = 0; n < count; n += 1) {
      const visitor = visitors[(n * 7 + type.length) % visitors.length];
      const body = batch([event(type, block)], visitor.context);
      actionTasks.push(() => post(body, visitor));
      // 10 link clicks are retried.
      if (type === "link_click" && n < 10) retries.push(() => post(body, visitor));
    }
  }
  // ---- Not valid: reloads inside the visit window ---------------------------------------------
  const reloads = visitors.slice(0, 20).map((visitor) => () => post(batch([event("page_view")], visitor.context), visitor));
  // ---- Not valid: bots and link previews ------------------------------------------------------
  const bots = Array.from({ length: 25 }, (_, n) => () => post(batch([event("page_view"), event("link_click", BLOCKS.link)]), { ip: ip(2, n + 1), userAgent: BOTS[n % BOTS.length] }));
  // ---- Not valid: signed-in people and visits that came from the editor -----------------------
  const internal = [
    ...Array.from({ length: 10 }, (_, n) => () => post(batch([event("page_view"), event("whatsapp_click", BLOCKS.whatsapp)]), { ip: ip(3, n + 1), cookie: "sb-127-auth-token=base64-fake" })),
    ...Array.from({ length: 5 }, (_, n) => () => post(batch([event("page_view")], { a: true, r: "localhost" }), { ip: ip(3, n + 50) })),
  ];
  // ---- Not valid: malformed, forged and cross-site --------------------------------------------
  const malformed = [
    () => post("{not json", { ip: ip(4, 1) }),
    () => post({ ...batch([event("page_view")]), v: 2 }, { ip: ip(4, 2) }),
    () => post(batch([{ i: "not-a-uuid", t: "page_view" }]), { ip: ip(4, 3) }),
    () => post(batch([{ i: randomUUID(), t: "purchase" }]), { ip: ip(4, 4) }),
    () => post(batch([{ i: randomUUID(), t: "form_submit", b: BLOCKS.form }]), { ip: ip(4, 5) }),
    () => post(batch([event("link_click", "b6000000-0000-4000-8000-0000000000ff")]), { ip: ip(4, 6) }),
    () => post(batch([event("link_click", BLOCKS.hidden)]), { ip: ip(4, 7) }),
    () => post(batch([event("whatsapp_click", BLOCKS.link)]), { ip: ip(4, 8) }),
    () => post({ v: 1, s: "pagina-que-nao-existe", e: [event("page_view")] }, { ip: ip(4, 9) }),
    () => post(batch([event("page_view")]), { ip: ip(4, 10), contentType: "application/x-www-form-urlencoded" }),
    ...Array.from({ length: 5 }, (_, n) => () => post(batch([event("page_view")]), { ip: ip(4, n + 20), fetchSite: "cross-site" })),
  ];
  // ---- Bounded: one address floods link clicks; the per-address limit keeps 60 events ---------
  const flooder = { ip: ip(5, 1), userAgent: PHONE };
  const flood = [() => post(batch([event("page_view")]), flooder), ...Array.from({ length: 6 }, () => () => post(batch(Array.from({ length: 10 }, () => event("link_click", BLOCKS.link))), flooder))];

  await inParallel(tasks, 8);
  await settle(pageId, "visits");
  await inParallel([...actionTasks, ...reloads, ...bots, ...internal, ...malformed, ...retries], 8);
  // The endpoint writes after it answers, so writes of consecutive requests are not ordered. Each
  // step waits for the previous write: the limit is then reached in a known order (1 view + 59 clicks).
  for (const task of flood) {
    await task();
    await settle(pageId, "flood step");
  }

  // ---- Form submissions: 7 leads, 3 of them submitted twice -----------------------------------
  for (let n = 1; n <= 7; n += 1) {
    await submitLead(n, `qa-precisao-${n}@example.test`);
    if (n <= 3) await submitLead(n, `qa-precisao-${n}@example.test`);
  }

  // ---- Out of the window: 15 views dated yesterday (the only rows not sent over HTTP) ---------
  sql(`
    insert into public.analytics_events (profile_id, event_id, workspace_id, occurred_at, day, event_type, source, device, country)
    select p.id, gen_random_uuid(), p.workspace_id, private.analytics_day_start(private.analytics_today()) - interval '1 hour', private.analytics_today() - 1, 'page_view', 'direct', 'mobile', 'ZZ'
    from public.profiles p, generate_series(1, 15) where p.id = '${pageId}';`);

  // Yesterday may already be final (a final day is not rebuilt by the nightly run), so it is
  // re-aggregated by hand, the way the runbook does it.
  await runJob(sql("select private.analytics_today() - 1"));
  const job = await runJob();
  console.log(`job: ${JSON.stringify(job)}`);

  const expected = {
    "total page_view": 121, "total link_click": 99, "total whatsapp_click": 25, "total pix_copy": 10, "total pix_pay_click": 5,
    "total social_click": 8, "total embed_load": 6, "total form_submit": 7,
    "source instagram": 60, "source direct": 31, "source google": 20, "source whatsapp": 10,
    "device mobile": 91, "device desktop": 30,
    "utm whatsapp|status|outubro": 10,
  };
  const rows = sql(`
    select dimension::text || ' ' || case when dimension = 'total' then event_type::text else key end, sum(count)
    from public.analytics_daily
    where profile_id = '${pageId}' and day = private.analytics_today() and dimension in ('total', 'source', 'device', 'utm')
    group by 1 order by 1;`);
  const actual = Object.fromEntries(rows.split("\n").filter(Boolean).map((line) => { const [key, value] = line.split(/\|(?=\d+$)/); return [key, Number(value)]; }));

  console.log("\nmetric                              expected  aggregated  difference");
  let failed = false;
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const want = expected[key] ?? 0;
    const have = actual[key] ?? 0;
    const difference = want === 0 ? (have === 0 ? 0 : 1) : Math.abs(have - want) / want;
    if (difference > TOLERANCE) failed = true;
    console.log(`${key.padEnd(34)}  ${String(want).padStart(8)}  ${String(have).padStart(10)}  ${(difference * 100).toFixed(1).padStart(9)}%${difference > TOLERANCE ? "  <-- over 5%" : ""}`);
  }
  const yesterday = sql(`select coalesce(sum(count), 0) from public.analytics_daily where profile_id = '${pageId}' and day = private.analytics_today() - 1 and dimension = 'total' and event_type = 'page_view'`);
  console.log(`\nout-of-window views (yesterday): 15 inserted, ${yesterday} aggregated on yesterday, 0 on today`);

  const again = await runJob();
  const repeated = sql(`select dimension::text || ' ' || case when dimension = 'total' then event_type::text else key end, sum(count) from public.analytics_daily where profile_id = '${pageId}' and day = private.analytics_today() and dimension in ('total', 'source', 'device', 'utm') group by 1 order by 1;`);
  console.log(`job run twice gives identical rows: ${repeated === rows} (${JSON.stringify({ aggregatedDays: again.aggregatedDays })})`);
  if (repeated !== rows) failed = true;

  console.log(`\nHTTP: ${latencies.length} requests, statuses ${JSON.stringify(Object.fromEntries(statuses))}, latency p50 ${percentile(latencies, 50).toFixed(1)} ms, p95 ${percentile(latencies, 95).toFixed(1)} ms, max ${Math.max(...latencies).toFixed(1)} ms`);
  return failed;
}

async function burst(pageId) {
  console.log("\n--- burst: 300 batches of 10 events from 300 addresses, 50 at a time ---");
  sql(`delete from public.analytics_events where profile_id = '${pageId}'; delete from public.analytics_daily where profile_id = '${pageId}';`);
  latencies.length = 0;
  statuses.clear();
  const startedAt = performance.now();
  await inParallel(Array.from({ length: 300 }, (_, n) => () => post(batch(Array.from({ length: 10 }, () => event("link_click", BLOCKS.link))), { ip: ip(10 + Math.floor(n / 250), (n % 250) + 1) })), 50);
  const elapsed = performance.now() - startedAt;
  const stored = await settle(pageId, "burst");
  console.log(`3000 events sent in ${Math.round(elapsed)} ms (${Math.round(300 / (elapsed / 1000))} requests/s); stored ${stored}, the page limit is 2000 per hour`);
  console.log(`HTTP: statuses ${JSON.stringify(Object.fromEntries(statuses))}, latency p50 ${percentile(latencies, 50).toFixed(1)} ms, p95 ${percentile(latencies, 95).toFixed(1)} ms, max ${Math.max(...latencies).toFixed(1)} ms`);
  const page = await fetch(`${BASE_URL}/${SLUG}`);
  console.log(`public page during and after the burst: HTTP ${page.status}`);
  return stored !== 2000;
}

const pageId = setup();
console.log(`fixture page ${SLUG} (${pageId}) published; base ${BASE_URL}`);
let failed = await accuracy(pageId);
if (BURST) failed = (await burst(pageId)) || failed;
console.log(failed ? "\nFAILED" : "\nOK: every metric is within 5% of the expected valid total");
process.exit(failed ? 1 : 0);
