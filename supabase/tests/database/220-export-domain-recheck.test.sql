-- Sprints 8 and 9 gaps: export reaches domains, pixels, suspensions and appeals; active custom
-- domains are verified again by the daily job.
begin;
select plan(36);

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

create function pg_temp.recheck_text(p_domain uuid, p_hostname text, p_found boolean, p_age_seconds integer default 0) returns text language sql
as $$ select jsonb_build_object('v', 1, 'kind', 'recheck', 'domainId', p_domain, 'hostname', p_hostname, 'found', p_found,
  'at', floor(extract(epoch from now()))::bigint - p_age_seconds)::text $$;

create function pg_temp.recheck(p_domain uuid, p_hostname text, p_found boolean) returns jsonb language sql
as $$ select public.record_domain_recheck(pg_temp.recheck_text(p_domain, p_hostname, p_found), pg_temp.sign(pg_temp.recheck_text(p_domain, p_hostname, p_found))) $$;

select tests.remember('own', tests.create_user('own-rc@example.test', 'Dona'));
select tests.remember('oth', tests.create_user('oth-rc@example.test', 'Outra'));
select tests.remember('adm', tests.create_user('adm-rc@example.test', 'Adm'));
select tests.authenticate_as(tests.id('oth'));
select tests.remember('ws_oth', public.ensure_personal_workspace());
select tests.authenticate_as(tests.id('adm'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('own'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Recheck'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id in (tests.id('ws'), tests.id('ws_oth'));
insert into public.platform_admins (user_id) values (tests.id('adm'));
insert into public.profiles (workspace_id, title, slug) values
  (tests.id('ws'), 'Loja', 'qa-rc-loja'), (tests.id('ws'), 'Outra loja', 'qa-rc-loja2'), (tests.id('ws_oth'), 'Vizinha', 'qa-rc-vizinha');
select tests.remember('p1', (select id from public.profiles where slug = 'qa-rc-loja'));
select tests.remember('p2', (select id from public.profiles where slug = 'qa-rc-loja2'));
select tests.remember('po', (select id from public.profiles where slug = 'qa-rc-vizinha'));
select tests.remember('d1', gen_random_uuid());
select tests.remember('d2', gen_random_uuid());
select tests.remember('do', gen_random_uuid());
insert into public.profile_domains (id, workspace_id, profile_id, hostname, challenge, status, routing, verified_at, last_checked_at) values
  (tests.id('d1'), tests.id('ws'), tests.id('p1'), 'www.qa-rc-loja.example', 'linkfav-verify=' || md5('1'), 'active', 'ok', now() - interval '10 days', now() - interval '2 days'),
  (tests.id('d2'), tests.id('ws'), tests.id('p2'), 'www.qa-rc-loja2.example', 'linkfav-verify=' || md5('2'), 'pending', 'unknown', null, null),
  (tests.id('do'), tests.id('ws_oth'), tests.id('po'), 'www.qa-rc-vizinha.example', 'linkfav-verify=' || md5('3'), 'active', 'ok', now() - interval '10 days', now() - interval '1 hour');
insert into public.profile_pixels (workspace_id, profile_id, meta_pixel_id, ga_measurement_id) values
  (tests.id('ws'), tests.id('p1'), '1234567890123456', 'G-QARC123456'), (tests.id('ws_oth'), tests.id('po'), '6543210987654321', null);

-- A suspension with an appeal, to be exported.
select tests.authenticate_as(tests.id('adm'));
select public.set_profile_moderation(tests.id('p2'), true, 'Suspensa para o teste de exportação.');
select tests.authenticate_as(tests.id('own'));
select public.submit_moderation_appeal(tests.id('p2'), 'Contestação que deve aparecer na exportação da conta.');

-- ---------------------------------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------------------------------
select set_config('tests.export', public.export_workspace_data(tests.id('ws'))::text, true);
select is(jsonb_array_length(current_setting('tests.export')::jsonb -> 'domains'), 2, 'the export lists the domains of the workspace');
select ok(current_setting('tests.export')::jsonb -> 'domains' @> '[{"hostname":"www.qa-rc-loja.example","status":"active"}]'::jsonb, 'with hostname and status');
select ok(current_setting('tests.export')::text not like '%linkfav-verify=%', 'and without the challenge');
select is(current_setting('tests.export')::jsonb -> 'pixels' -> 0 ->> 'ga_measurement_id', 'G-QARC123456', 'the export has the pixel identifiers');
select is(jsonb_array_length(current_setting('tests.export')::jsonb -> 'moderationSuspensions'), 1, 'the suspension');
select is(current_setting('tests.export')::jsonb -> 'moderationAppeals' -> 0 ->> 'message', 'Contestação que deve aparecer na exportação da conta.', 'and the appeal with its text');
select ok(current_setting('tests.export')::text not like '%qa-rc-vizinha%' and current_setting('tests.export')::text not like '%6543210987654321%',
  'nothing of another workspace is in the export');
select ok(current_setting('tests.export')::jsonb ? 'leads' and current_setting('tests.export')::jsonb ? 'audit' and (current_setting('tests.export')::jsonb ->> 'schemaVersion') = '1',
  'the keys that already existed are still there');
select tests.authenticate_as(tests.id('oth'));
select throws_ok(format('select public.export_workspace_data(%L)', tests.id('ws')), 'P0002', null, 'another tenant still cannot export the workspace');

-- ---------------------------------------------------------------------------------------------
-- Re-verification
-- ---------------------------------------------------------------------------------------------
select tests.clear_authentication();
select ok(not has_function_privilege('authenticated', 'public.record_domain_recheck(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.record_domain_recheck(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.list_domains_for_recheck(integer)', 'execute')
  and has_function_privilege('service_role', 'public.record_domain_recheck(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.list_domains_for_recheck(integer)', 'execute'),
  'only the service role lists and records re-verifications');
select tests.authenticate_as(tests.id('own'));
select throws_ok(format('select public.record_domain_recheck(%L, %L)', 'x', 'y'), '42501', null, 'the owner cannot record a re-verification');

select tests.authenticate_service();
select is((select array_agg(hostname order by hostname) from public.list_domains_for_recheck(50) where hostname like 'www.qa-rc-%'),
  array['www.qa-rc-loja.example'], 'the job lists active domains not looked at for most of a day, and no pending or recent one');

select is(public.record_domain_recheck(pg_temp.recheck_text(tests.id('d1'), 'www.qa-rc-loja.example', false), repeat('0', 64)) ->> 'status', 'invalid', 'a wrong signature is refused');
select is(public.record_domain_recheck(pg_temp.recheck_text(tests.id('d1'), 'www.qa-rc-loja.example', false, 400), pg_temp.sign(pg_temp.recheck_text(tests.id('d1'), 'www.qa-rc-loja.example', false, 400))) ->> 'status',
  'invalid', 'a stale attestation is refused');
select is(public.record_domain_recheck('{"v":1,"at":1,"domainId":"x"}', pg_temp.sign('{"v":1,"at":1,"domainId":"x"}')) ->> 'status', 'invalid', 'a malformed attestation is refused');
-- A correctly signed confirmation (other key set) is not a re-verification, and the reverse.
select set_config('tests.confirm_text', jsonb_build_object('v', 1, 'domainId', tests.id('d1'), 'hostname', 'www.qa-rc-loja.example', 'routing', 'ok', 'tokens', '[]'::jsonb, 'at', floor(extract(epoch from now()))::bigint)::text, true);
select is(public.record_domain_recheck(current_setting('tests.confirm_text'), pg_temp.sign(current_setting('tests.confirm_text'))) ->> 'status', 'invalid',
  'a signed confirmation cannot be replayed as a re-verification');
select tests.authenticate_as(tests.id('own'));
select is(public.confirm_profile_domain(pg_temp.recheck_text(tests.id('d2'), 'www.qa-rc-loja2.example', true), pg_temp.sign(pg_temp.recheck_text(tests.id('d2'), 'www.qa-rc-loja2.example', true))) ->> 'status',
  'invalid', 'and a signed re-verification cannot activate a domain');
select tests.authenticate_service();
select is(pg_temp.recheck(gen_random_uuid(), 'www.qa-rc-loja.example', false) ->> 'status', 'not_found', 'an unknown domain is not found');
select is(pg_temp.recheck(tests.id('d1'), 'www.outro-nome.example', false) ->> 'status', 'not_found', 'a hostname that does not match the row is not found');
select is(pg_temp.recheck(tests.id('d2'), 'www.qa-rc-loja2.example', false) ->> 'status', 'skipped', 'a domain that is not active is skipped');

select is(pg_temp.recheck(tests.id('d1'), 'www.qa-rc-loja.example', false), '{"status":"missing","misses":1}'::jsonb, 'a first miss is counted');
select is(pg_temp.recheck(tests.id('d1'), 'www.qa-rc-loja.example', false), '{"status":"missing","misses":2}'::jsonb, 'and a second');
select tests.clear_authentication();
select is((select status || '/' || recheck_misses from public.profile_domains where id = tests.id('d1')), 'active/2', 'the domain stays active while misses add up');
select tests.authenticate_service();
select is(pg_temp.recheck(tests.id('d1'), 'www.qa-rc-loja.example', true) ->> 'status', 'ok', 'finding the proof again');
select tests.clear_authentication();
select is((select recheck_misses::int from public.profile_domains where id = tests.id('d1')), 0, 'resets the count');

-- Seven consecutive misses lapse the domain.
select tests.authenticate_service();
select pg_temp.recheck(tests.id('d1'), 'www.qa-rc-loja.example', false) from generate_series(1, 6);
select tests.clear_authentication();
select is((select status || '/' || recheck_misses from public.profile_domains where id = tests.id('d1')), 'active/6', 'six misses are not enough');
select is((select state from public.get_public_page_by_domain('www.qa-rc-loja.example')), 'unpublished', 'the hostname still resolves to its page');
select tests.authenticate_service();
select is(pg_temp.recheck(tests.id('d1'), 'www.qa-rc-loja.example', false) - 'hostname', '{"status":"lapsed","slug":"qa-rc-loja"}'::jsonb, 'the seventh lapses the domain and names the page to refresh');
select is(pg_temp.recheck(tests.id('d1'), 'www.qa-rc-loja.example', false) ->> 'status', 'skipped', 'a lapsed domain is not counted again');
select tests.clear_authentication();
select is((select status || '/' || lapse_reason || '/' || routing from public.profile_domains where id = tests.id('d1')), 'lapsed/recheck/unknown', 'it is lapsed, with the reason');
select is((select state from public.get_public_page_by_domain('www.qa-rc-loja.example')), 'not_found', 'and the hostname opens nothing');
select is((select metadata ->> 'reason' from public.audit_events where action = 'domain.lapsed' and target_id = tests.id('d1')), 'recheck', 'the lapse is in the audit trail with its reason');
select is((select status from public.profile_domains where id = tests.id('do')), 'active', 'another workspace''s domain is untouched');

-- The owner proves it again: active, and clean.
select tests.authenticate_as(tests.id('own'));
select set_config('tests.again', jsonb_build_object('v', 1, 'domainId', tests.id('d1'), 'hostname', 'www.qa-rc-loja.example', 'routing', 'ok', 'tokens', jsonb_build_array('linkfav-verify=' || md5('1')), 'at', floor(extract(epoch from now()))::bigint)::text, true);
select is(public.confirm_profile_domain(current_setting('tests.again'), pg_temp.sign(current_setting('tests.again'))) ->> 'status', 'active', 'the owner can prove the domain again');
select tests.clear_authentication();
select is((select status || '/' || recheck_misses || '/' || coalesce(lapse_reason, 'none') from public.profile_domains where id = tests.id('d1')), 'active/0/none', 'which clears the count and the reason');
select is((select last_run_at is not null from public.job_runs where job = 'domains'), true, 'the new job has a heartbeat row');

select * from finish();
rollback;
