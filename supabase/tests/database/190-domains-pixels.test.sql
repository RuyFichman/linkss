-- Sprint 8, part 2 (ADR 0016, ADR 0017): custom domains with proof of control and per-page pixels.
-- Covers every role against every command, the attestation, taking a hostname over, what the
-- anonymous read answers in each state, and what a plan change does to both features.
-- Mirrors apps/web/src/modules/domains and apps/web/src/modules/pixels.
begin;
select plan(106);

do $$
begin
  if exists (select 1 from vault.secrets where name = 'domains_signing_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'domains_signing_secret'), 'test-domains-signing-secret-0123456789');
  else
    perform vault.create_secret('test-domains-signing-secret-0123456789', 'domains_signing_secret');
  end if;
end;
$$;

create function pg_temp.sign(p_text text) returns text language sql
as $$ select encode(extensions.hmac(convert_to(p_text, 'UTF8'), convert_to('test-domains-signing-secret-0123456789', 'UTF8'), 'sha256'), 'hex') $$;

-- The attestation the application server signs after reading DNS.
create function pg_temp.attest(p_domain uuid, p_hostname text, p_tokens text[], p_routing text default 'ok', p_age_seconds integer default 0) returns text language sql
as $$ select jsonb_build_object('v', 1, 'domainId', p_domain, 'hostname', p_hostname, 'routing', p_routing,
  'tokens', to_jsonb(p_tokens), 'at', floor(extract(epoch from now()))::bigint - p_age_seconds)::text $$;

-- Calls confirm as whoever is authenticated, with a correctly signed attestation.
create function pg_temp.confirm(p_domain uuid, p_hostname text, p_tokens text[], p_routing text default 'ok', p_age_seconds integer default 0) returns jsonb language sql
as $$ select public.confirm_profile_domain(pg_temp.attest(p_domain, p_hostname, p_tokens, p_routing, p_age_seconds), pg_temp.sign(pg_temp.attest(p_domain, p_hostname, p_tokens, p_routing, p_age_seconds))) $$;

create function pg_temp.challenge(p_domain uuid) returns text language sql security definer
as $$ select challenge from public.profile_domains where id = p_domain $$;

create function pg_temp.domain_status(p_domain uuid) returns text language sql security definer
as $$ select status from public.profile_domains where id = p_domain $$;

select tests.remember('ana', tests.create_user('ana-dom@example.test', 'Ana'));
select tests.remember('edu', tests.create_user('edu-dom@example.test', 'Edu'));
select tests.remember('bia', tests.create_user('bia-dom@example.test', 'Bia'));
select tests.remember('fred', tests.create_user('fred-dom@example.test', 'Fred'));
select tests.remember('caio', tests.create_user('caio-dom@example.test', 'Caio'));

select tests.authenticate_as(tests.id('ana'));
select public.ensure_personal_workspace();
select tests.remember('w_ana', public.create_agency_workspace('Agência Ana'));
select tests.authenticate_as(tests.id('bia'));
select public.ensure_personal_workspace();
select tests.remember('w_bia', public.create_agency_workspace('Agência Bia'));
select tests.authenticate_as(tests.id('caio'));
select public.ensure_personal_workspace();
select tests.remember('w_caio', public.create_agency_workspace('Agência Caio'));
select tests.authenticate_as(tests.id('fred'));
select tests.remember('w_fred', public.ensure_personal_workspace());
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id in (tests.id('w_ana'), tests.id('w_bia'), tests.id('w_caio'));
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
values (tests.id('w_ana'), tests.id('edu'), 'editor', 'active', now());

insert into public.profiles (workspace_id, title, slug, bio, blocks) values
  (tests.id('w_ana'), 'Loja Ana', 'qa-dom-ana', 'Bio', '[]'::jsonb),
  (tests.id('w_ana'), 'Outra Ana', 'qa-dom-ana-2', 'Bio', '[]'::jsonb),
  (tests.id('w_bia'), 'Loja Bia', 'qa-dom-bia', 'Bio', '[]'::jsonb),
  (tests.id('w_caio'), 'Loja Caio', 'qa-dom-caio', 'Bio', '[]'::jsonb),
  (tests.id('w_fred'), 'Fred', 'qa-dom-fred', 'Bio', '[]'::jsonb);
select tests.remember('p_ana', (select id from public.profiles where slug = 'qa-dom-ana'));
select tests.remember('p_ana2', (select id from public.profiles where slug = 'qa-dom-ana-2'));
select tests.remember('p_bia', (select id from public.profiles where slug = 'qa-dom-bia'));
select tests.remember('p_caio', (select id from public.profiles where slug = 'qa-dom-caio'));
select tests.remember('p_fred', (select id from public.profiles where slug = 'qa-dom-fred'));

select tests.authenticate_as(tests.id('ana'));
select public.publish_profile(tests.id('p_ana'));
select tests.authenticate_as(tests.id('bia'));
select public.publish_profile(tests.id('p_bia'));
select tests.authenticate_as(tests.id('fred'));
select public.publish_profile(tests.id('p_fred'));
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------------
-- Catalogue and hostname rules
-- ---------------------------------------------------------------------------------------------

select is((select array_agg(plan_id || ':' || bool_value order by plan_id) from public.plan_entitlements where key = 'tracking_pixels'),
  array['agency:true', 'free:false', 'pro:true'], 'tracking_pixels is seeded per plan as in lib/product.ts');
select ok(exists (select 1 from public.reserved_slugs where slug = 'd'), 'the internal custom-domain route is a reserved address');

select ok(private.domain_hostname_is_well_formed('www.loja.com.br'), 'a subdomain is a hostname');
select ok(private.domain_hostname_is_well_formed('loja.com.br'), 'an apex is a hostname');
select ok(private.domain_hostname_is_well_formed('xn--caf-dma.com'), 'punycode is a hostname');
select ok(not private.domain_hostname_is_well_formed('loja'), 'a single label is not');
select ok(not private.domain_hostname_is_well_formed('192.168.0.1'), 'an IPv4 address is not');
select ok(not private.domain_hostname_is_well_formed('Loja.com.br'), 'uppercase is not the stored form');
select ok(not private.domain_hostname_is_well_formed('loja.com.br.'), 'a trailing dot is not');
select ok(not private.domain_hostname_is_well_formed('-loja.com.br'), 'a label cannot start with a hyphen');
select ok(not private.domain_hostname_is_well_formed('loja.com.br/pagina'), 'a path is not part of a hostname');
select ok(not private.domain_hostname_is_well_formed(null), 'null is not a hostname');
select ok(private.domain_hostname_is_blocked('linkfav.com') and private.domain_hostname_is_blocked('www.linkfav.com'), 'the product''s own domain is blocked, subdomains included');
select ok(private.domain_hostname_is_blocked('minha.vercel.app') and private.domain_hostname_is_blocked('x.supabase.co'), 'provider shared domains are blocked');
select ok(not private.domain_hostname_is_blocked('meulinkfav.com'), 'a suffix match needs a label boundary');

-- ---------------------------------------------------------------------------------------------
-- Claim
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_anon();
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_ana'), 'www.loja-ana.com.br') $$, '42501', null, 'anon cannot claim a domain');

select tests.authenticate_as(tests.id('fred'));
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_fred'), 'www.fred.com.br') $$, 'LK010', null, 'the Free plan has no custom domain');

select tests.authenticate_as(tests.id('edu'));
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_ana'), 'www.loja-ana.com.br') $$, '42501', null, 'an editor cannot claim a domain');

select tests.authenticate_as(tests.id('bia'));
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_ana'), 'www.loja-ana.com.br') $$, 'P0002', null, 'another workspace''s page is "not found"');

select tests.authenticate_as(tests.id('ana'));
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_ana'), 'not a host') $$, '22023', null, 'an invalid hostname is refused');
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_ana'), 'pagina.linkfav.com') $$, '22023', null, 'a blocked hostname is refused');
select tests.remember('d_ana', (select domain_id from public.claim_profile_domain(tests.id('p_ana'), '  WWW.Loja-Ana.com.br ')));
select is((select hostname from public.profile_domains where id = tests.id('d_ana')), 'www.loja-ana.com.br', 'the hostname is stored trimmed and lowercase');
select matches(pg_temp.challenge(tests.id('d_ana')), '^linkfav-verify=[0-9a-f]{32}$', 'the claim gets a random challenge');
select is(pg_temp.domain_status(tests.id('d_ana')), 'pending', 'a claim starts pending');
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_ana'), 'outra.com.br') $$, 'LK120', null, 'a page holds one domain');

select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w_ana') and action = 'domain.claimed' and target_id = tests.id('d_ana')), 1, 'the claim is audited');

-- A pending claim opens nothing.
select tests.authenticate_anon();
select is((select state from public.get_public_page_by_domain('www.loja-ana.com.br')), 'not_found', 'a pending claim does not answer on the hostname');
select is((select custom_domain from public.get_public_page('qa-dom-ana')), null, 'a pending claim is not the page''s domain');

-- ---------------------------------------------------------------------------------------------
-- Proof of control
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('ana'));
select is(public.confirm_profile_domain(pg_temp.attest(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))]), repeat('0', 64)) ->> 'status',
  'invalid', 'an attestation the server did not sign proves nothing');
select is(public.confirm_profile_domain(pg_temp.attest(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))]), 'not-a-signature') ->> 'status',
  'invalid', 'a malformed signature is refused');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))], 'ok', 400) ->> 'status',
  'invalid', 'a stale attestation is refused');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))], 'whatever') ->> 'status',
  'invalid', 'an unknown routing value is refused');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.outro-nome.com.br', array[pg_temp.challenge(tests.id('d_ana'))]) ->> 'status',
  'not_found', 'an attestation for another hostname does not match the claim');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array['linkfav-verify=' || repeat('0', 32)]) ->> 'status',
  'dns_missing', 'another challenge in DNS is not the proof');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[]::text[]) ->> 'status', 'dns_missing', 'an empty DNS answer is not the proof');
select is(pg_temp.domain_status(tests.id('d_ana')), 'pending', 'a failed check leaves the claim pending');

select tests.authenticate_as(tests.id('edu'));
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))]) ->> 'status', 'forbidden', 'an editor cannot confirm');
select tests.authenticate_as(tests.id('bia'));
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))]) ->> 'status', 'not_found', 'another workspace cannot confirm, even with a valid attestation');
select tests.authenticate_anon();
select throws_ok($$ select public.confirm_profile_domain('{}', repeat('0', 64)) $$, '42501', null, 'anon cannot confirm');
select is(pg_temp.domain_status(tests.id('d_ana')), 'pending', 'none of those attempts activated the domain');

select tests.authenticate_as(tests.id('ana'));
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array['linkfav-verify=' || repeat('1', 32), pg_temp.challenge(tests.id('d_ana'))], 'pending'),
  jsonb_build_object('status', 'active', 'routing', 'pending', 'slugs', jsonb_build_array('qa-dom-ana')), 'the owner''s proof activates the domain and names the page to refresh');
select is((select status || ':' || routing || ':' || (verified_at is not null)::text from public.profile_domains where id = tests.id('d_ana')), 'active:pending:true', 'the row is active with the routing the server reported');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))], 'ok') ->> 'routing', 'ok', 'checking again updates the routing');
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[]::text[]) ->> 'status', 'dns_missing', 'a later check without the record reports it');
select is(pg_temp.domain_status(tests.id('d_ana')), 'active', 'and an active domain stays active until somebody else proves control');

select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w_ana') and action = 'domain.verified'), 1, 'activation is audited once, repeats are not');

-- ---------------------------------------------------------------------------------------------
-- Public read
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_anon();
select is((select state || ':' || canonical_slug from public.get_public_page_by_domain('www.loja-ana.com.br')), 'published:qa-dom-ana', 'the hostname opens its page');
select is((select state from public.get_public_page_by_domain(' WWW.LOJA-ANA.COM.BR ')), 'published', 'the lookup normalizes the Host');
select is((select document ->> 'title' from public.get_public_page_by_domain('www.loja-ana.com.br')), 'Loja Ana', 'with the published snapshot');
select is((select custom_domain from public.get_public_page('qa-dom-ana')), 'www.loja-ana.com.br', 'the page read names its domain (canonical address)');
select is((select state from public.get_public_page_by_domain('www.ninguem.com.br')), 'not_found', 'an unknown hostname is not found');
select is((select state from public.get_public_page_by_domain('not a host')), 'not_found', 'a malformed hostname is not found');
select throws_ok($$ select count(*) from public.profile_domains $$, '42501', null, 'anon cannot read the domains table');
select throws_ok($$ select count(*) from public.profile_pixels $$, '42501', null, 'anon cannot read the pixels table');

-- ---------------------------------------------------------------------------------------------
-- Tenancy and direct writes
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('bia'));
select is((select count(*)::int from public.profile_domains), 0, 'another workspace sees no domain rows');
select throws_ok($$ update public.profile_domains set status = 'active' $$, '42501', null, 'a client role cannot write the domains table');
select throws_ok($$ insert into public.profile_domains (workspace_id, profile_id, hostname, challenge, status, verified_at) values (tests.id('w_bia'), tests.id('p_bia'), 'www.loja-ana.com.br', 'linkfav-verify=' || repeat('a', 32), 'active', now()) $$,
  '42501', null, 'nor insert an active domain');
select throws_ok($$ insert into public.profile_pixels (profile_id, workspace_id, meta_pixel_id) values (tests.id('p_bia'), tests.id('w_bia'), '1234567890123456') $$, '42501', null, 'nor write pixels around the RPC');
select tests.authenticate_as(tests.id('edu'));
select is((select count(*)::int from public.profile_domains where id = tests.id('d_ana')), 1, 'an editor of the workspace sees the domain');

-- ---------------------------------------------------------------------------------------------
-- Taking a hostname over
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('bia'));
select tests.remember('d_bia', (select domain_id from public.claim_profile_domain(tests.id('p_bia'), 'www.loja-ana.com.br')));
select isnt(tests.id('d_bia'), null, 'claiming a hostname that is active elsewhere is accepted and reveals nothing');
select is(pg_temp.confirm(tests.id('d_bia'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana'))]) ->> 'status', 'dns_missing', 'the other page''s proof is not this claim''s proof');
select is(pg_temp.confirm(tests.id('d_bia'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana')), pg_temp.challenge(tests.id('d_bia'))]) ->> 'status',
  'in_use', 'while the first proof is still in DNS the hostname stays where it is');
select is(pg_temp.domain_status(tests.id('d_ana')) || '/' || pg_temp.domain_status(tests.id('d_bia')), 'active/pending', 'nothing changed');
select is(pg_temp.confirm(tests.id('d_bia'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_bia'))]) -> 'slugs',
  jsonb_build_array('qa-dom-ana', 'qa-dom-bia'), 'once only the new proof is in DNS the hostname moves, and both pages are refreshed');
select is(pg_temp.domain_status(tests.id('d_ana')) || '/' || pg_temp.domain_status(tests.id('d_bia')), 'lapsed/active', 'the previous claim lapsed in the same transaction');
select tests.authenticate_anon();
select is((select canonical_slug from public.get_public_page_by_domain('www.loja-ana.com.br')), 'qa-dom-bia', 'the hostname now opens the new page');
select is((select custom_domain from public.get_public_page('qa-dom-ana')), null, 'and is no longer the first page''s domain');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w_ana') and action = 'domain.lapsed' and target_id = tests.id('d_ana')), 1, 'the lapse is audited in the workspace that lost the hostname');
select is((select count(*)::int from public.profile_domains where hostname = 'www.loja-ana.com.br' and status = 'active'), 1, 'one active row per hostname');

-- The lapsed owner cannot take it back by asking: the old proof is not in DNS.
select tests.authenticate_as(tests.id('ana'));
select is(pg_temp.confirm(tests.id('d_ana'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_bia'))]) ->> 'status', 'dns_missing', 'a lapsed claim needs its own proof again');

-- ---------------------------------------------------------------------------------------------
-- Plan changes and page states
-- ---------------------------------------------------------------------------------------------

select tests.clear_authentication();
update public.workspaces set plan_id = 'free' where id = tests.id('w_bia');
select tests.authenticate_anon();
select is((select state from public.get_public_page_by_domain('www.loja-ana.com.br')), 'not_found', 'without custom_domain in the plan the hostname stops answering');
select is((select state || ':' || coalesce(custom_domain, '-') from public.get_public_page('qa-dom-bia')), 'published:-', 'the page stays on the air at its product address');
select tests.authenticate_as(tests.id('bia'));
select is(pg_temp.confirm(tests.id('d_bia'), 'www.loja-ana.com.br', array[pg_temp.challenge(tests.id('d_bia'))]) ->> 'status', 'not_in_plan', 'and cannot be confirmed');
select tests.clear_authentication();
select is(pg_temp.domain_status(tests.id('d_bia')), 'active', 'nothing was deleted');
update public.workspaces set plan_id = 'agency' where id = tests.id('w_bia');
select tests.authenticate_anon();
select is((select state from public.get_public_page_by_domain('www.loja-ana.com.br')), 'published', 'the hostname answers again when the plan comes back');

select tests.authenticate_as(tests.id('bia'));
select public.unpublish_profile(tests.id('p_bia'));
select tests.authenticate_anon();
select is((select state from public.get_public_page_by_domain('www.loja-ana.com.br')), 'unpublished', 'a page off the air is off the air on its hostname too');

-- ---------------------------------------------------------------------------------------------
-- Remove
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('edu'));
select throws_ok($$ select * from public.remove_profile_domain(tests.id('d_ana')) $$, '42501', null, 'an editor cannot remove a domain');
select tests.authenticate_as(tests.id('bia'));
select throws_ok($$ select * from public.remove_profile_domain(tests.id('d_ana')) $$, 'P0002', null, 'another workspace''s domain is "not found"');
select is((select hostname || ':' || slug || ':' || was_active::text from public.remove_profile_domain(tests.id('d_bia'))), 'www.loja-ana.com.br:qa-dom-bia:true', 'the owner removes the domain and learns what to refresh');
select tests.clear_authentication();
select is((select count(*)::int from public.profile_domains where id = tests.id('d_bia')), 0, 'the row is gone');
select is((select metadata ->> 'hostname' from public.audit_events where action = 'domain.removed' and target_id = tests.id('d_bia')), 'www.loja-ana.com.br', 'the removal is audited');
select tests.authenticate_anon();
select is((select state from public.get_public_page_by_domain('www.loja-ana.com.br')), 'not_found', 'a removed domain opens nothing');

-- A deleted page releases its hostname to whoever proves control next.
select tests.authenticate_as(tests.id('ana'));
select public.remove_profile_domain(tests.id('d_ana'));
select tests.remember('d_ana2', (select domain_id from public.claim_profile_domain(tests.id('p_ana2'), 'loja-ana.com.br')));
select is(pg_temp.confirm(tests.id('d_ana2'), 'loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana2'))]) ->> 'status', 'active', 'an apex can be proven like a subdomain');
select public.soft_delete_profile(tests.id('p_ana2'));
select tests.authenticate_anon();
select is((select state from public.get_public_page_by_domain('loja-ana.com.br')), 'not_found', 'the hostname of a deleted page opens nothing');
select tests.authenticate_as(tests.id('caio'));
select tests.remember('d_caio', (select domain_id from public.claim_profile_domain(tests.id('p_caio'), 'loja-ana.com.br')));
select is(pg_temp.confirm(tests.id('d_caio'), 'loja-ana.com.br', array[pg_temp.challenge(tests.id('d_ana2')), pg_temp.challenge(tests.id('d_caio'))]) ->> 'status',
  'active', 'and the deleted page''s leftover proof does not hold the hostname');

-- Claims are limited per workspace per day (removed claims count: the trail is the counter).
select tests.authenticate_as(tests.id('caio'));
do $$
begin
  for i in 1..19 loop
    perform public.remove_profile_domain((select id from public.profile_domains where profile_id = tests.id('p_caio')));
    perform public.claim_profile_domain(tests.id('p_caio'), 'loja' || i || '.caio.com.br');
  end loop;
  perform public.remove_profile_domain((select id from public.profile_domains where profile_id = tests.id('p_caio')));
end;
$$;
select throws_ok($$ select * from public.claim_profile_domain(tests.id('p_caio'), 'mais-uma.caio.com.br') $$, 'LK121', null, 'the 21st claim in 24 hours is refused');

-- ---------------------------------------------------------------------------------------------
-- Pixels
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('edu'));
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), '1234567890123456', null) $$, '42501', null, 'an editor cannot set pixels');
select tests.authenticate_as(tests.id('bia'));
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), '1234567890123456', null) $$, 'P0002', null, 'another workspace''s page is "not found"');
select tests.authenticate_as(tests.id('fred'));
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_fred'), '1234567890123456', null) $$, 'LK010', null, 'the Free plan has no pixels');
select tests.authenticate_anon();
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), '1234567890123456', null) $$, '42501', null, 'anon cannot set pixels');

select tests.authenticate_as(tests.id('ana'));
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), '<script>alert(1)</script>', null) $$, '22023', null, 'a script is not a Meta Pixel id');
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), null, 'GTM-ABC1234') $$, '22023', null, 'a Tag Manager container is refused');
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), null, 'UA-12345-1') $$, '22023', null, 'a Universal Analytics id is refused');
select is((select slug || ':' || is_live::text from public.set_profile_pixels(tests.id('p_ana'), ' 1234567890123456 ', 'g-ab12cd34ef')), 'qa-dom-ana:true', 'the owner sets both identifiers and learns what to refresh');
select tests.authenticate_anon();
select is((select pixels from public.get_public_page('qa-dom-ana')), '{"ga": "G-AB12CD34EF", "meta": "1234567890123456"}'::jsonb, 'the public read carries the normalized identifiers');
select is((select pixels from public.get_public_page('qa-dom-fred')), null, 'a page without pixels carries none');

select tests.authenticate_as(tests.id('ana'));
select public.set_profile_pixels(tests.id('p_ana'), '', 'G-AB12CD34EF');
select tests.authenticate_anon();
select is((select pixels from public.get_public_page('qa-dom-ana')), '{"ga": "G-AB12CD34EF"}'::jsonb, 'clearing one identifier removes only that key');

select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w_ana') and action = 'pixels.updated'
  and (metadata::text ~ '1234567890123456' or metadata::text ~ 'AB12CD34EF')), 0, 'the trail says which tools are on, never the identifiers');
select is((select metadata from public.audit_events where workspace_id = tests.id('w_ana') and action = 'pixels.updated' order by id desc limit 1),
  '{"ga": true, "meta": false}'::jsonb, 'and it records each change');

-- Duplicating a page copies neither its pixels nor its domain (ADR 0012).
select tests.authenticate_as(tests.id('ana'));
select tests.remember('p_copy', public.duplicate_profile(tests.id('p_ana'), 'Cópia', 'qa-dom-ana-copia'));
select tests.clear_authentication();
select is((select count(*)::int from public.profile_pixels where profile_id = tests.id('p_copy')) + (select count(*)::int from public.profile_domains where profile_id = tests.id('p_copy')), 0, 'a duplicated page starts with no pixels and no domain');

-- Losing the plan turns the pixels off without deleting them; clearing stays possible.
update public.workspaces set plan_id = 'free' where id = tests.id('w_ana');
select tests.authenticate_anon();
select is((select state || ':' || coalesce(pixels::text, '-') from public.get_public_page('qa-dom-ana')), 'published:-', 'without tracking_pixels in the plan the page carries no identifiers');
select tests.authenticate_as(tests.id('ana'));
select throws_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), '1234567890123456', null) $$, 'LK010', null, 'identifiers cannot be set without the plan');
select tests.clear_authentication();
select is((select ga_measurement_id from public.profile_pixels where profile_id = tests.id('p_ana')), 'G-AB12CD34EF', 'the stored identifier is kept');
select tests.authenticate_as(tests.id('ana'));
select lives_ok($$ select * from public.set_profile_pixels(tests.id('p_ana'), null, null) $$, 'clearing is allowed on any plan');
select tests.clear_authentication();
select is((select count(*)::int from public.profile_pixels where profile_id = tests.id('p_ana')), 0, 'clearing both removes the row');

-- Without the secret nothing can be confirmed.
delete from vault.secrets where name = 'domains_signing_secret';
select tests.authenticate_as(tests.id('caio'));
select is(public.confirm_profile_domain('{}', repeat('0', 64)) ->> 'status', 'not_configured', 'an environment without the signing secret confirms nothing');

select * from finish();
rollback;
