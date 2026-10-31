-- Language of a public page and of the e-mails (migrations 202610300002 and 202610300003,
-- ADR 0022): the default a new page takes, who may change it (and who may not, across workspaces
-- and anonymously), that an archived page is frozen, what the anonymous public read and the
-- shared report return, and that claiming an e-mail returns the recipient's language.
begin;
select plan(16);

select tests.remember('ana', tests.create_user('ana-page-locale@example.test', 'Ana'));
select tests.remember('edu', tests.create_user('edu-page-locale@example.test', 'Edu'));
select tests.remember('olga', tests.create_user('olga-page-locale@example.test', 'Olga'));

update auth.users set raw_user_meta_data = raw_user_meta_data || '{"locale":"es-ES"}' where id = tests.id('ana');
select tests.authenticate_as(tests.id('ana'));
select tests.remember('ws_ana', public.ensure_personal_workspace());
select tests.clear_authentication();
select tests.authenticate_as(tests.id('edu'));
select public.ensure_personal_workspace();
select tests.clear_authentication();
select tests.authenticate_as(tests.id('olga'));
select tests.remember('ws_olga', public.ensure_personal_workspace());
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws_ana');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
  values (tests.id('ws_ana'), tests.id('edu'), 'editor', tests.id('ana'), now());

-- The default: the language of the account that creates the page.
select tests.authenticate_as(tests.id('ana'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_ana'), 'Taller Ana', 'taller-ana');
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_ana'), 'Archivo', 'archivo-ana');
select tests.remember('page', (select id from public.profiles where slug = 'taller-ana'));
select tests.remember('archived', (select id from public.profiles where slug = 'archivo-ana'));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('olga'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_olga'), 'Loja Olga', 'loja-olga-idioma');
select tests.remember('olga_page', (select id from public.profiles where slug = 'loja-olga-idioma'));
select tests.clear_authentication();

select is((select locale from public.profiles where id = tests.id('page')), 'es-ES', 'a page created by a Spanish account starts in Spanish');
select is((select locale from public.profiles where id = tests.id('olga_page')), 'pt-BR', 'a page created by a Portuguese account starts in Portuguese');
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_ana'), 'Sin sesión', 'sem-conta-idioma');
select is((select locale from public.profiles where slug = 'sem-conta-idioma'), 'pt-BR', 'a page written without a session starts in Portuguese');
select throws_ok(
  format('update public.profiles set locale = %L where id = %L', 'en-US', tests.id('page')),
  '23514', null, 'the table refuses an unsupported language'
);

-- Who may change it.
select tests.authenticate_as(tests.id('edu'));
update public.profiles set locale = 'pt-BR' where id = tests.id('page');
select tests.clear_authentication();
select is((select locale from public.profiles where id = tests.id('page')), 'pt-BR', 'an editor of the workspace changes the page language');

select tests.authenticate_as(tests.id('olga'));
update public.profiles set locale = 'es-ES' where id = tests.id('page');
select tests.clear_authentication();
select is((select locale from public.profiles where id = tests.id('page')), 'pt-BR', 'a member of another workspace cannot change it');

select tests.authenticate_anon();
select throws_ok(
  format('update public.profiles set locale = %L where id = %L', 'es-ES', tests.id('page')),
  '42501', null, 'anon cannot change it'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.id('edu'));
select throws_ok(
  format('update public.profiles set locale = %L, status = %L where id = %L', 'es-ES', 'archived', tests.id('page')),
  '42501', null, 'the grant covers the language, not the status'
);
select tests.clear_authentication();

select tests.authenticate_as(tests.id('ana'));
select public.archive_profile(tests.id('archived'));
update public.profiles set locale = 'pt-BR' where id = tests.id('archived');
select tests.clear_authentication();
select is((select locale from public.profiles where id = tests.id('archived')), 'es-ES', 'an archived page keeps its language until it is unarchived');

-- What visitors and report readers get: read live, never from the snapshot.
select tests.authenticate_as(tests.id('ana'));
update public.profiles set locale = 'es-ES' where id = tests.id('page');
select public.publish_profile(tests.id('page'));
select tests.clear_authentication();

select tests.authenticate_anon();
select is((select locale from public.get_public_page('taller-ana')), 'es-ES', 'the public read returns the page language');
select is((select state from public.get_public_page('taller-ana')), 'published', 'the page is published');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('ana'));
update public.profiles set locale = 'pt-BR' where id = tests.id('page');
select tests.clear_authentication();
select tests.authenticate_anon();
select is((select locale from public.get_public_page('taller-ana')), 'pt-BR', 'a change shows without a new publication');
select ok(not ((select document from public.get_public_page('taller-ana')) ? 'locale'), 'the language is not in the published snapshot');
select tests.clear_authentication();

select ok(has_function_privilege('anon', 'public.get_public_page(text)', 'execute')
  and has_function_privilege('anon', 'public.get_public_page_by_domain(text)', 'execute'), 'anon may still read public pages');

select tests.authenticate_as(tests.id('ana'));
select set_config('tests.link', (select link_id from public.create_report_link(tests.id('page'), encode(extensions.digest('pageLocaleToken_LLLLLLLLLLLLLLLLLLLLLLLLLLL', 'sha256'), 'hex'), 7, 7))::text, true);
select tests.clear_authentication();
select tests.authenticate_anon();
select is(public.get_shared_report('pageLocaleToken_LLLLLLLLLLLLLLLLLLLLLLLLLLL') ->> 'locale', 'pt-BR', 'the shared report returns the page language');
select tests.clear_authentication();

-- E-mails: the claim returns the recipient's language with the address.
insert into public.mail_outbox (kind, recipient_user_id, workspace_id, dedupe_key, payload, expires_at) values
  ('new_lead', tests.id('ana'), tests.id('ws_ana'), 'locale-test-ana', '{}', now() + interval '1 day'),
  ('new_lead', tests.id('olga'), tests.id('ws_olga'), 'locale-test-olga', '{}', now() + interval '1 day');
select tests.authenticate_service();
select is(
  (select string_agg(c.locale, ',' order by c.locale) from public.claim_mail_outbox(10) c where c.id in (select o.id from public.mail_outbox o where o.dedupe_key like 'locale-test-%')),
  'es-ES,pt-BR', 'claiming an e-mail returns the language of each recipient'
);
select tests.clear_authentication();

select * from finish();
rollback;
