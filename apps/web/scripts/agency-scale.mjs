// Tenth-page measurement (Sprint 7, AC5; ADR 0013): does an agency workspace get perceptibly slower
// as it grows from one page to ten, and to fifty as headroom?
//
// For 1, 10 and 50 pages it measures, against a RUNNING local production build:
//   - the page list (/app/w/<id>) and the consolidated dashboard (/app/w/<id>/resultados): server
//     response time over HTTP with a real session, the number of PostgREST requests one render
//     makes, and the database time those requests took (pg_stat_statements);
//   - the create-page flow (at 1 and 10; an Agency plan allows 10): the same PostgREST requests the
//     Server Action makes (role, plan, entitlements, count, insert), timed from this script.
// Then it prints EXPLAIN for the statements behind the list, the consolidated read and the report
// lookup, with enough rows in the aggregate table for the planner to have a real choice.
//
// Threshold, stated before measuring: "no perceptible degradation" means (1) the number of
// requests per render does not grow with the number of pages, and (2) the median server time at
// ten pages stays within 2x the median at one page and under 300 ms. Exit code 1 otherwise.
//
// LOCAL STACK ONLY. It refuses to run against anything that is not a local Supabase. It creates
// the account qa-ac5-escala@example.test, two workspaces ("AC5 Escala", "AC5 Ruído") with up to 50
// pages each, and analytics rows for those pages only. It never touches other accounts; --cleanup
// removes every qa-ac5-*@example.test account. The 50-page
// stage raises the Agency plan's page limit inside ONE transaction and restores it before commit.
// It does not run the analytics job: run it first (the app's own job), so past days are final and
// the consolidated read uses the daily aggregates.
//
//   npm run db:start                                              (repository root)
//   npm run build --workspace=@lnk/web && npx next start -p 3100  (in apps/web)
//   node scripts/agency-scale.mjs                                 (in apps/web)
//   node scripts/agency-scale.mjs --cleanup                       removes everything it created
//
// Reads apps/web/.env.local for the Supabase URL and the publishable key.
// Environment: BASE_URL (default http://localhost:3100), DB_CONTAINER (default supabase_db_lnk),
// RUNS (default 20 measured renders per page and stage).

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const DB_CONTAINER = process.env.DB_CONTAINER ?? "supabase_db_lnk";
const RUNS = Math.max(5, Number(process.env.RUNS ?? 20));
const WARMUP = 3;
const CLEANUP = process.argv.includes("--cleanup");
const EMAIL_PREFIX = "qa-ac5-";
const EMAIL = `${EMAIL_PREFIX}escala@example.test`;
const WORKSPACE = "AC5 Escala";
const NOISE_WORKSPACE = "AC5 Ruído";
const SLUG_PREFIX = "qa-ac5-";
const MAX_RATIO = 2;
const MAX_MEDIAN_MS = 300;

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
  // Pages first (their analytics, publications and links cascade), then the workspaces and the account.
  // Every account under the script's prefix goes: manual checks may have added members to the workspace.
  sql(`
    delete from public.profiles where workspace_id in (select w.id from public.workspaces w join auth.users u on u.id = w.created_by where u.email like '${EMAIL_PREFIX}%@example.test');
    delete from public.slug_history where slug like '${SLUG_PREFIX}%';
    delete from public.workspaces where created_by in (select id from auth.users where email like '${EMAIL_PREFIX}%@example.test');
    delete from auth.users where email like '${EMAIL_PREFIX}%@example.test';`);
}

if (CLEANUP) {
  cleanup();
  console.log(`Removed the ${EMAIL_PREFIX}*@example.test accounts, their workspaces and their pages.`);
  process.exit(0);
}

/** The account (with a random password that exists only in this process) and the two workspaces. */
function setupAccount(password) {
  cleanup();
  const out = sql(`
    do $$
    declare
      v_user uuid := gen_random_uuid();
    begin
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', '${EMAIL}', extensions.crypt('${password}', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"QA Escala"}'::jsonb, now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
      values (gen_random_uuid(), v_user, v_user::text, 'email', jsonb_build_object('sub', v_user::text, 'email', '${EMAIL}', 'email_verified', true), now(), now());
      perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
      perform public.ensure_personal_workspace();
      perform public.create_agency_workspace('${WORKSPACE}');
      perform public.create_agency_workspace('${NOISE_WORKSPACE}');
      update public.workspaces set plan_id = 'agency' where created_by = v_user and kind = 'agency';
    end;
    $$;
    select (select id from public.workspaces where name = '${WORKSPACE}' and created_by = u.id) || '|' || (select id from public.workspaces where name = '${NOISE_WORKSPACE}' and created_by = u.id) || '|' || u.id
    from auth.users u where u.email = '${EMAIL}';`);
  const [workspaceId, noiseId, userId] = out.split("|");
  return { workspaceId, noiseId, userId };
}

/**
 * Brings a workspace to `target` pages, published, backdated 100 days, and with aggregates for the
 * final days of the last 89 plus a few raw events today. Pages are inserted as the owner (triggers and validation run); only for more
 * than 10 pages the plan limit is raised, inside this one transaction, and restored before commit.
 */
function growTo(workspaceId, userId, target, tag) {
  sql(`
    begin;
    select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, true);
    update public.plan_entitlements set int_value = greatest(int_value, ${target}) where plan_id = 'agency' and key = 'max_profiles' and ${target} > 10;
    do $$
    declare
      v_have integer;
      v_page uuid;
      v_n integer;
      v_final date;
    begin
      select count(*) into v_have from public.profiles where workspace_id = '${workspaceId}' and deleted_at is null;
      select max(s.day) into v_final from public.analytics_day_status s where s.finalized_at is not null;
      for v_n in (v_have + 1)..${target} loop
        insert into public.profiles (workspace_id, title, slug) values ('${workspaceId}', 'Cliente ${tag} ' || lpad(v_n::text, 2, '0'), '${SLUG_PREFIX}${tag}-' || lpad(v_n::text, 2, '0')) returning id into v_page;
      end loop;
      for v_page, v_n in select p.id, row_number() over (order by p.created_at, p.id)::integer from public.profiles p where p.workspace_id = '${workspaceId}' and p.deleted_at is null and p.live_publication_id is null loop
        update public.profiles set blocks = jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'whatsapp', 'visible', true, 'label', 'Fale comigo', 'phone', '5511912345678', 'message', ''),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'link', 'visible', true, 'title', 'Site', 'url', 'https://exemplo.com.br/')) where id = v_page;
        perform public.publish_profile(v_page);
      end loop;
    end;
    $$;
    update public.plan_entitlements set int_value = 10 where plan_id = 'agency' and key = 'max_profiles';
    -- The history below is older than the pages; backdate them so it falls inside each page's own
    -- collection window (a report of completed days would otherwise say "before the count started").
    -- created_at is immutable by trigger, so user triggers are off for this one statement only.
    set local session_replication_role = replica;
    update public.profiles set created_at = now() - interval '100 days' where workspace_id = '${workspaceId}' and created_at > now() - interval '99 days';
    set local session_replication_role = origin;
    -- Aggregates for the final days of the last 89, and raw events for today: as postgres, the way
    -- the job and the ingestion would have written them.
    reset role;
    select set_config('request.jwt.claims', '', true);
    with pages as (
      select p.id, p.workspace_id, row_number() over (order by p.created_at, p.id)::integer as n
      from public.profiles p
      where p.workspace_id = '${workspaceId}' and p.deleted_at is null
        and not exists (select 1 from public.analytics_daily d where d.profile_id = p.id)
    ),
    days as (
      select d::date as day from generate_series(private.analytics_today() - 89, (select max(s.day) from public.analytics_day_status s where s.finalized_at is not null), interval '1 day') d
    ),
    rows as (
      select * from (values ('total', '', 'page_view', 40), ('total', '', 'whatsapp_click', 3), ('total', '', 'link_click', 6),
        ('source', 'instagram', 'page_view', 25), ('source', 'direct', 'page_view', 10), ('source', 'whatsapp', 'page_view', 5)) as r (dimension, key, event_type, base)
    )
    insert into public.analytics_daily (profile_id, workspace_id, day, dimension, event_type, count, key)
    select pg.id, pg.workspace_id, dy.day, r.dimension::public.analytics_dimension, r.event_type::public.analytics_event_type, r.base + (pg.n % 7), r.key
    from pages pg cross join days dy cross join rows r;
    insert into public.analytics_events (profile_id, event_id, workspace_id, occurred_at, day, event_type, source, device, country)
    select p.id, gen_random_uuid(), p.workspace_id, now(), private.analytics_today(), 'page_view', 'instagram', 'mobile', 'BR'
    from public.profiles p, generate_series(1, 3)
    where p.workspace_id = '${workspaceId}' and p.deleted_at is null
      and not exists (select 1 from public.analytics_events e where e.profile_id = p.id);
    commit;`);
}

/** A signed-in session the way the browser holds it: the cookies @supabase/ssr sets. */
async function signIn(password) {
  const jar = new Map();
  const supabase = createServerClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => { for (const { name, value } of cookies) (value ? jar.set(name, value) : jar.delete(name)); },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return { supabase, cookie: () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/** PostgREST requests and their execution time so far (every PostgREST statement starts with this CTE). */
function restCounters() {
  const [calls, ms] = sql(`select coalesce(sum(calls), 0), coalesce(sum(total_exec_time), 0) from extensions.pg_stat_statements where query like 'WITH pgrst_source%'`).split("|");
  return { calls: Number(calls), ms: Number(ms) };
}

async function measurePage(session, path, marker) {
  const get = async () => {
    const startedAt = performance.now();
    const response = await fetch(`${BASE_URL}${path}`, { headers: { cookie: session.cookie() }, redirect: "manual" });
    const body = await response.text();
    const elapsed = performance.now() - startedAt;
    if (response.status !== 200 || !body.includes(marker)) throw new Error(`${path}: expected 200 with "${marker}", got ${response.status}`);
    return elapsed;
  };
  for (let run = 0; run < WARMUP; run += 1) await get();
  const before = restCounters();
  const times = [];
  for (let run = 0; run < RUNS; run += 1) times.push(await get());
  const after = restCounters();
  return {
    medianMs: percentile(times, 50), p95Ms: percentile(times, 95),
    requests: (after.calls - before.calls) / RUNS, dbMs: (after.ms - before.ms) / RUNS,
  };
}

/** The requests createProfile makes (modules/profiles/service.ts), in order, as the signed-in user. */
async function createFlow(session, workspaceId, userId, slug) {
  const startedAt = performance.now();
  const before = restCounters();
  const { supabase } = session;
  const role = await supabase.from("workspace_memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).eq("status", "active").maybeSingle();
  const plan = await supabase.from("workspaces").select("plan_id").eq("id", workspaceId).single();
  const entitlements = await supabase.from("plan_entitlements").select("key, int_value, bool_value").eq("plan_id", plan.data?.plan_id ?? "");
  const count = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  const inserted = await supabase.from("profiles").insert({ workspace_id: workspaceId, title: `Cliente ${slug}`, bio: "", slug }).select("id").single();
  const elapsed = performance.now() - startedAt;
  for (const step of [role, plan, entitlements, count, inserted]) if (step.error) throw new Error(`create flow failed: ${step.error.code} ${step.error.message}`);
  const after = restCounters();
  return { ms: elapsed, requests: after.calls - before.calls, dbMs: after.ms - before.ms, id: inserted.data.id };
}

/** Median of five creations of the page that takes the workspace from `count - 1` to `count`; the last one stays. */
async function measureCreate(session, workspaceId, userId, count, tag) {
  const samples = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const slug = `${SLUG_PREFIX}${tag}-nova-${count}-${attempt}`;
    const sample = await createFlow(session, workspaceId, userId, slug);
    samples.push(sample);
    if (attempt < 5) sql(`delete from public.profiles where id = '${sample.id}'; delete from public.slug_history where slug = '${slug}';`);
  }
  return { medianMs: percentile(samples.map((sample) => sample.ms), 50), p95Ms: percentile(samples.map((sample) => sample.ms), 95), requests: samples[0].requests, dbMs: percentile(samples.map((sample) => sample.dbMs), 50) };
}

function explain(title, statement, settings = "") {
  const plan = sql(`${settings} explain (analyze, costs off, timing off, summary off, buffers off) ${statement};`);
  console.log(`\n-- ${title}\n${plan}`);
  return plan;
}

const fmt = (value) => value.toFixed(1).padStart(8);

async function main() {
  const finalDay = sql(`select coalesce(max(day)::text, '') from public.analytics_day_status where finalized_at is not null`);
  if (!finalDay) {
    console.error("No final analytics day in this database. Run the analytics job first (POST /api/jobs/analytics with CRON_SECRET), then run this script again.");
    process.exit(2);
  }
  const password = randomBytes(24).toString("base64url");
  const { workspaceId, noiseId, userId } = setupAccount(password);
  // Another tenant with as many rows, so "this workspace" is a real filter for the planner.
  growTo(noiseId, userId, 50, "ruido");
  const session = await signIn(password);
  const results = [];

  for (const pages of [1, 10, 50]) {
    let create = null;
    if (pages <= 10) {
      growTo(workspaceId, userId, pages - 1, "escala");
      create = await measureCreate(session, workspaceId, userId, pages, "escala");
    }
    growTo(workspaceId, userId, pages, "escala");
    const have = Number(sql(`select count(*) from public.profiles where workspace_id = '${workspaceId}' and deleted_at is null`));
    if (have !== pages) throw new Error(`expected ${pages} pages, found ${have}`);
    const list = await measurePage(session, `/app/w/${workspaceId}`, `${pages} de 10`);
    const consolidated = await measurePage(session, `/app/w/${workspaceId}/resultados?periodo=30d`, "Resultados da conta");
    results.push({ pages, list, consolidated, create });
  }

  console.log(`\nAC5: server time and requests per render, ${RUNS} renders after ${WARMUP} warm-up (production build at ${BASE_URL}, local Supabase)`);
  console.log("pages | surface               | median ms |   p95 ms | PostgREST requests | DB ms per render");
  for (const { pages, list, consolidated, create } of results) {
    console.log(`${String(pages).padStart(5)} | page list             | ${fmt(list.medianMs)}  | ${fmt(list.p95Ms)} | ${String(list.requests).padStart(18)} | ${fmt(list.dbMs)}`);
    console.log(`${String(pages).padStart(5)} | consolidated (30 d)   | ${fmt(consolidated.medianMs)}  | ${fmt(consolidated.p95Ms)} | ${String(consolidated.requests).padStart(18)} | ${fmt(consolidated.dbMs)}`);
    if (create) console.log(`${String(pages).padStart(5)} | create page (5 runs)  | ${fmt(create.medianMs)}  | ${fmt(create.p95Ms)} | ${String(create.requests).padStart(18)} | ${fmt(create.dbMs)}`);
  }

  console.log("\nEXPLAIN (the statements inside the functions, with this fixture's ids)");
  const rows = sql(`select (select count(*) from public.analytics_daily) || '|' || (select count(*) from public.analytics_daily where workspace_id = '${workspaceId}') || '|' || (select count(*) from public.profiles)`);
  console.log(`analytics_daily rows: total|this workspace|profiles in the database = ${rows}`);
  const asMember = `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, true);`;
  const plans = [
    explain("consolidated read: final days from the aggregate (get_workspace_analytics)",
      `select d.profile_id, d.day, d.dimension, d.key, d.event_type, d.count from public.analytics_daily d where d.workspace_id = '${workspaceId}' and d.day between private.analytics_today() - 29 and private.analytics_today() and d.dimension in ('total', 'source')`, "begin;"),
    explain("consolidated read: open days from raw events (private.analytics_workspace_counts)",
      `select ev.profile_id, ev.day, ev.event_type, ev.source from public.analytics_events ev where ev.workspace_id = '${workspaceId}' and ev.occurred_at >= private.analytics_day_start(private.analytics_today()) and ev.day between private.analytics_today() and private.analytics_today()`, "begin;"),
    explain("report link lookup (private.resolve_report_link)",
      `select l.id from public.report_links l where l.token_hash = repeat('0', 64)`, "begin; set local enable_seqscan = off;"),
    explain("page list: the workspace's pages, as a member under RLS, planner's own choice (list_workspace_profiles)",
      `select p.id, p.title, p.slug, p.status from public.profiles p where p.workspace_id = '${workspaceId}' and p.deleted_at is null order by p.created_at desc limit 20`, `begin; ${asMember}`),
    explain("page list: the same statement with sequential scans disabled (shows the supporting index)",
      `select p.id, p.title, p.slug, p.status from public.profiles p where p.workspace_id = '${workspaceId}' and p.deleted_at is null order by p.created_at desc limit 20`, `begin; ${asMember} set local enable_seqscan = off;`),
  ];

  const [one, ten, fifty] = results;
  const failures = [];
  for (const surface of ["list", "consolidated"]) {
    if (!(one[surface].requests === ten[surface].requests && ten[surface].requests === fifty[surface].requests)) failures.push(`${surface}: requests per render change with the number of pages (${one[surface].requests}, ${ten[surface].requests}, ${fifty[surface].requests})`);
    if (ten[surface].medianMs > MAX_MEDIAN_MS) failures.push(`${surface}: median at 10 pages is ${ten[surface].medianMs.toFixed(1)} ms (limit ${MAX_MEDIAN_MS})`);
    if (ten[surface].medianMs > one[surface].medianMs * MAX_RATIO) failures.push(`${surface}: median at 10 pages is more than ${MAX_RATIO}x the median at 1 page`);
  }
  if (one.create.requests !== ten.create.requests) failures.push(`create: requests change with the number of pages (${one.create.requests}, ${ten.create.requests})`);
  if (ten.create.medianMs > one.create.medianMs * MAX_RATIO && ten.create.medianMs > 50) failures.push("create: the tenth creation is not within the same order of time as the first");
  if (!/Index/.test(plans[0]) || /Seq Scan on analytics_daily/.test(plans[0])) failures.push("the aggregate read does not use an index");
  if (/Seq Scan on analytics_events/.test(plans[1])) failures.push("the raw read scans the whole events table");
  if (!/report_links_token_hash_key/.test(plans[2])) failures.push("the report lookup does not use the token-hash index");
  if (!/Index/.test(plans[4])) failures.push("no index supports the page list");

  console.log(`\nThreshold: requests per render constant from 1 to 50 pages; median at 10 pages within ${MAX_RATIO}x of the median at 1 page and under ${MAX_MEDIAN_MS} ms; index use as shown above.`);
  if (failures.length > 0) {
    console.log(`RESULT: FAIL\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log("RESULT: PASS");
  }
  console.log(`\nThe fixture stays in the database (${EMAIL}; workspaces "${WORKSPACE}" and "${NOISE_WORKSPACE}"). Remove it with: node scripts/agency-scale.mjs --cleanup`);
}

await main();
