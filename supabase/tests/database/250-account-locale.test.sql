-- Account language chosen at sign-up (migration 202610300001, ADR 0022): what the sign-up metadata
-- can store, what it cannot, that an existing account keeps its language, and that a person can
-- change only their own row to a supported value.
begin;
select plan(11);

select tests.remember('ana', tests.create_user('ana-locale@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia-locale@example.test', 'Bia'));
select tests.remember('caio', tests.create_user('caio-locale@example.test', 'Caio'));
select tests.remember('dani', tests.create_user('dani-locale@example.test', 'Dani'));

-- What the sign-up form sends as Auth user metadata.
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"locale":"es-ES"}' where id = tests.id('ana');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"locale":"fr-FR"}' where id = tests.id('bia');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"locale":"es-ES''; drop table x; --"}' where id = tests.id('caio');

select tests.authenticate_as(tests.id('ana'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('bia'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('caio'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('dani'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

select is((select locale from public.user_accounts where id = tests.id('ana')), 'es-ES', 'a Spanish sign-up creates a Spanish account');
select is((select locale from public.user_accounts where id = tests.id('bia')), 'pt-BR', 'an unsupported language gives the default');
select is((select locale from public.user_accounts where id = tests.id('caio')), 'pt-BR', 'arbitrary metadata gives the default');
select is((select locale from public.user_accounts where id = tests.id('dani')), 'pt-BR', 'no language in the metadata gives the default');

-- Chosen once: later metadata does not change an existing account.
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"locale":"es-ES"}' where id = tests.id('dani');
select tests.authenticate_as(tests.id('dani'));
select public.ensure_personal_workspace();
select tests.clear_authentication();
select is((select locale from public.user_accounts where id = tests.id('dani')), 'pt-BR', 'an existing account keeps its language');

select throws_ok(
  $$ insert into public.user_accounts (id, locale) values (gen_random_uuid(), 'en-US') $$,
  '23514', null, 'the table refuses an unsupported language'
);

-- A person changes only their own row, and only to a supported value.
select tests.authenticate_as(tests.id('dani'));
select lives_ok($$ update public.user_accounts set locale = 'es-ES' where id = tests.id('dani') $$, 'a person can change their own language');
select is((select locale from public.user_accounts where id = tests.id('dani')), 'es-ES', 'the change is stored');
select throws_ok(
  $$ update public.user_accounts set locale = 'de-DE' where id = tests.id('dani') $$,
  '23514', null, 'a person cannot store an unsupported language'
);
update public.user_accounts set locale = 'pt-BR' where id = tests.id('ana');
select tests.clear_authentication();
select is((select locale from public.user_accounts where id = tests.id('ana')), 'es-ES', 'nobody changes another person''s language');

select is((select reason from public.reserved_slugs where slug = 'es'), 'route', 'the Spanish home address is reserved');

select * from finish();
rollback;
