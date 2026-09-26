-- The audit trail is append-only and never stores sensitive metadata.
begin;
select plan(16);

select tests.remember('ana', tests.create_user('ana@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia@example.test', 'Bia'));

select tests.authenticate_as(tests.id('ana'));
select public.record_auth_event('auth.sign_in',
  '{"method": "password", "email": "ana@example.test", "token": "secret", "ip": "10.0.0.1", "correlation_id": "c-123"}'::jsonb);

select is(
  (select metadata from public.audit_events where action = 'auth.sign_in'),
  '{"method": "password", "correlation_id": "c-123"}'::jsonb,
  'only allowlisted metadata keys are stored');
select is((select actor_user_id from public.audit_events where action = 'auth.sign_in'), tests.id('ana'), 'the actor is always the caller');
select ok((select workspace_id is null from public.audit_events where action = 'auth.sign_in'), 'authentication events are account-level');

select public.record_auth_event('auth.sign_out', jsonb_build_object('method', repeat('x', 65)));
select is((select metadata from public.audit_events where action = 'auth.sign_out'), '{}'::jsonb, 'oversized values are dropped');
select throws_ok($$ select public.record_auth_event('profile.deleted') $$, '42501', null, 'only auth.* actions can be recorded by clients');
select is((select count(*)::int from public.audit_events where workspace_id is null), 2, 'a person reads their own account events');

select throws_ok('update public.audit_events set action = ''auth.sign_out''', '42501', null, 'authenticated cannot update audit events');
select throws_ok('delete from public.audit_events', '42501', null, 'authenticated cannot delete audit events');
select throws_ok(
  format('insert into public.audit_events (actor_user_id, action) values (%L, %L)', tests.id('bia'), 'auth.sign_in'),
  '42501', null, 'authenticated cannot insert forged audit events');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('bia'));
select is((select count(*)::int from public.audit_events), 0, 'another person cannot read those events');
select tests.clear_authentication();

select tests.authenticate_service();
select throws_ok('update public.audit_events set metadata = ''{}''', '42501', null, 'service_role cannot update audit events');
select throws_ok('delete from public.audit_events', '42501', null, 'service_role cannot delete audit events');
select tests.clear_authentication();

select throws_ok('update public.audit_events set metadata = ''{}''', '42501', null, 'even the table owner cannot update audit events');

select tests.authenticate_anon();
select throws_ok($$ select public.record_auth_event('auth.sign_in') $$, '42501', null, 'anon cannot record events');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('ana'));
select lives_ok($$ select public.record_auth_event('auth.password_reset_completed', '[1,2]'::jsonb) $$, 'non-object metadata is tolerated');
select is((select metadata from public.audit_events where action = 'auth.password_reset_completed'), '{}'::jsonb, 'and stored as an empty object');
select tests.clear_authentication();

select * from finish();
rollback;
