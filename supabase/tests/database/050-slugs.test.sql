-- AC2: invalid, reserved, duplicate and held slugs are rejected.
begin;
select plan(24);

select tests.remember('ana', tests.create_user('ana@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia@example.test', 'Bia'));
select tests.authenticate_as(tests.id('ana'));
select tests.remember('ws_a', public.ensure_personal_workspace());
select tests.clear_authentication();
select tests.authenticate_as(tests.id('bia'));
select tests.remember('ws_b', public.ensure_personal_workspace());
select tests.clear_authentication();

-- ---- Normalization parity with apps/web/src/modules/profiles/slug.ts ------------------------
select is(private.normalize_slug('  Café da Júlia '), 'cafe-da-julia', 'accents, case and spaces are normalized');
select is(private.normalize_slug('São  Paulo--Ipê-'), 'sao-paulo-ipe', 'repeated and trailing hyphens collapse');
select is(private.normalize_slug('ÇÃO ÑANDU'), 'cao-nandu', 'cedilla and tilde are stripped');

-- ---- Format and reserved words ---------------------------------------------------------------
select tests.authenticate_as(tests.id('ana'));
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_a'), 'A', 'ab'), 'LK001', null, 'too short');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_a'), 'A', repeat('a', 41)), 'LK001', null, 'too long');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_a'), 'A', 'cafe@ipe'), 'LK001', null, 'invalid characters');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_a'), 'A', 'admin'), 'LK002', null, 'reserved word');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_a'), 'A', ' Entrar '), 'LK002', null, 'reserved route after normalization');

insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_a'), 'Café Ipê', 'Café Ipê');
select tests.remember('page_a', (select id from public.profiles where workspace_id = tests.id('ws_a')));
select is((select slug from public.profiles where id = tests.id('page_a')), 'cafe-ipe', 'the database stores the canonical slug');
select throws_ok(format('update public.profiles set slug = %L where id = %L', 'direto', tests.id('page_a')), '42501', null,
  'slug cannot be updated directly (RPC only)');
select tests.clear_authentication();

-- ---- Duplicates ------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('bia'));
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_b'), 'B', 'cafe-ipe'), '23505', null, 'exact duplicate');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_b'), 'B', 'CAFÉ-IPÊ'), '23505', null, 'duplicate differing only by case/accents');
select is((select status from public.check_slug_availability('Café Ipê')), 'taken', 'availability: taken');
select is((select status from public.check_slug_availability('admin')), 'reserved', 'availability: reserved');
select is((select status from public.check_slug_availability('x')), 'invalid', 'availability: invalid');
select is((select normalized || ':' || status from public.check_slug_availability('Livre 123')), 'livre-123:available', 'availability: available and normalized');
select tests.clear_authentication();

-- ---- Change and hold period ------------------------------------------------------------------
select tests.authenticate_as(tests.id('ana'));
select is(public.change_profile_slug(tests.id('page_a'), 'cafe-ipe-centro'), 'cafe-ipe-centro', 'owner changes the address');
select throws_ok(format('select public.change_profile_slug(%L, %L)', tests.id('page_a'), 'no'), 'LK001', null, 'RPC rejects invalid slugs');
select throws_ok(format('select public.change_profile_slug(%L, %L)', tests.id('page_a'), 'api'), 'LK002', null, 'RPC rejects reserved slugs');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.slug_history where slug = 'cafe-ipe' and reason = 'changed' and hold_until > now() + interval '89 days'),
  1, 'the released slug is on a 90-day hold');
select is(
  (select metadata from public.audit_events where target_id = tests.id('page_a') and action = 'profile.slug_changed'),
  '{"from": "cafe-ipe", "to": "cafe-ipe-centro"}'::jsonb, 'exactly one profile.slug_changed event with from/to');

select tests.authenticate_as(tests.id('bia'));
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_b'), 'B', 'cafe-ipe'), 'LK003', null,
  'another workspace cannot claim a held slug');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('ana'));
select is(public.change_profile_slug(tests.id('page_a'), 'cafe-ipe'), 'cafe-ipe', 'the releasing workspace may reclaim its held slug');
select tests.clear_authentication();

-- Expire the hold on "cafe-ipe-centro" (released by the reclaim above).
update public.slug_history set released_at = now() - interval '91 days', hold_until = now() - interval '1 day' where slug = 'cafe-ipe-centro';
select tests.authenticate_as(tests.id('bia'));
select lives_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_b'), 'B', 'cafe-ipe-centro'),
  'after the hold expires the slug can be claimed');
select tests.clear_authentication();

select * from finish();
rollback;
