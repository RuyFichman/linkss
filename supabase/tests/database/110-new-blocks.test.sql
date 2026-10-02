-- Sprint 5: image, embed, pix and form blocks, the theme, media references, and the additive
-- snapshot (still schema version 2). Mirrors apps/web/src/modules/blocks and modules/themes (ADR 0010).
begin;
select plan(72);

select tests.remember('owner', tests.create_user('owner6@example.test', 'Olívia'));
select tests.remember('editor', tests.create_user('editor6@example.test', 'Enzo'));
select tests.remember('outsider', tests.create_user('outsider6@example.test', 'Otávio'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Blocos Novos'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Studio Novo', 'studio-novo');
select tests.remember('page', (select id from public.profiles where slug = 'studio-novo'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Segunda Página', 'segunda-pagina-nova');
select tests.remember('page2', (select id from public.profiles where slug = 'segunda-pagina-nova'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Sem Tema', 'pagina-sem-tema');
select tests.remember('plain', (select id from public.profiles where slug = 'pagina-sem-tema'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Página Antiga', 'pagina-antiga-s5');
select tests.remember('old_page', (select id from public.profiles where slug = 'pagina-antiga-s5'));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select tests.remember('ws_out', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_out'), 'Otávio', 'otavio-novo');
select tests.remember('page_out', (select id from public.profiles where slug = 'otavio-novo'));
select tests.clear_authentication();

-- Assets as the upload pipeline leaves them (120-media.test.sql covers how they get there).
insert into public.media_assets (id, workspace_id, profile_id, kind, status, width, height, bytes, variants, created_by, activated_at) values
  ('9c000000-0000-4000-8000-000000000001', tests.id('ws'), tests.id('page'), 'image', 'ready', 896, 672, 3333, '[{"w": 448, "h": 336, "bytes": 1111}, {"w": 896, "h": 672, "bytes": 2222}]', tests.id('owner'), now()),
  ('9c000000-0000-4000-8000-000000000002', tests.id('ws'), tests.id('page'), 'avatar', 'ready', 288, 288, 2900, '[{"w": 96, "h": 96, "bytes": 500}, {"w": 192, "h": 192, "bytes": 900}, {"w": 288, "h": 288, "bytes": 1500}]', tests.id('owner'), now()),
  ('9c000000-0000-4000-8000-000000000003', tests.id('ws'), tests.id('page'), 'image', 'pending', 300, 200, 100, '[{"w": 300, "h": 200, "bytes": 100}]', tests.id('owner'), null),
  ('9c000000-0000-4000-8000-000000000004', tests.id('ws'), tests.id('page2'), 'image', 'ready', 300, 200, 100, '[{"w": 300, "h": 200, "bytes": 100}]', tests.id('owner'), now()),
  ('9c000000-0000-4000-8000-000000000005', tests.id('ws_out'), tests.id('page_out'), 'image', 'ready', 300, 200, 100, '[{"w": 300, "h": 200, "bytes": 100}]', tests.id('outsider'), now()),
  ('9c000000-0000-4000-8000-000000000006', tests.id('ws_out'), tests.id('page_out'), 'avatar', 'ready', 288, 288, 2900, '[{"w": 96, "h": 96, "bytes": 500}, {"w": 192, "h": 192, "bytes": 900}, {"w": 288, "h": 288, "bytes": 1500}]', tests.id('outsider'), now());

-- ---- Every new block type, the theme and the avatar, written by an editor --------------------
select tests.authenticate_as(tests.id('editor'));
select lives_ok(
  format($f$update public.profiles set
    avatar_path = '9c000000-0000-4000-8000-000000000002',
    theme = '{"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"}',
    blocks = '[
      {"id":"7d000000-0000-4000-8000-000000000001","type":"image","visible":true,"mediaId":"9c000000-0000-4000-8000-000000000001","width":896,"height":672,"alt":"Vitrine da loja","decorative":false},
      {"id":"7d000000-0000-4000-8000-000000000002","type":"embed","visible":true,"provider":"youtube","ref":"dQw4w9WgXcQ","title":"Conheça o estúdio"},
      {"id":"7d000000-0000-4000-8000-000000000003","type":"embed","visible":true,"provider":"vimeo","ref":"123456789","title":"Bastidores"},
      {"id":"7d000000-0000-4000-8000-000000000004","type":"embed","visible":false,"provider":"spotify","ref":"playlist/4uLU6hMCjMI75M1A2tKUQC","title":"Playlist"},
      {"id":"7d000000-0000-4000-8000-000000000005","type":"pix","visible":true,"label":"Pague com Pix","keyType":"cpf","key":"52998224725","paymentUrl":""},
      {"id":"7d000000-0000-4000-8000-000000000006","type":"pix","visible":true,"label":"Empresa","keyType":"cnpj","key":"11222333000181","paymentUrl":"https://pagamento.exemplo.com.br/abc"},
      {"id":"7d000000-0000-4000-8000-000000000007","type":"pix","visible":true,"label":"Celular","keyType":"phone","key":"+5511912345678","paymentUrl":""},
      {"id":"7d000000-0000-4000-8000-000000000008","type":"pix","visible":true,"label":"E-mail","keyType":"email","key":"ana@exemplo.com.br","paymentUrl":""},
      {"id":"7d000000-0000-4000-8000-000000000009","type":"pix","visible":true,"label":"Aleatória","keyType":"random","key":"123e4567-e89b-42d3-a456-426614174000","paymentUrl":""},
      {"id":"7d000000-0000-4000-8000-00000000000a","type":"form","visible":true,"title":"Peça um orçamento","fields":["name","email","message"],"buttonLabel":"Enviar","consentText":"Aceito ser contatado.","consentRequired":true},
      {"id":"7d000000-0000-4000-8000-00000000000b","type":"image","visible":true,"mediaId":"9c000000-0000-4000-8000-000000000001","width":896,"height":672,"alt":"","decorative":true},
      {"id":"7d000000-0000-4000-8000-00000000000c","type":"link","visible":true,"title":"Site","url":"https://exemplo.com.br/"}
    ]' where id = %L$f$, tests.id('page')),
  'an editor saves image, embed, pix and form blocks together with a theme and an avatar');
select is((select draft_revision from public.profiles where id = tests.id('page')), 2::bigint, 'blocks, theme and avatar in one save bump draft_revision once');
select lives_ok(
  format($f$update public.profiles set theme = '{"background": "#17142b", "button": "#f2cf4a", "buttonStyle": "outline", "corners": "pill", "spacing": "relaxed", "font": "poppins"}' where id = %L$f$, tests.id('plain')),
  'a theme alone is a draft change');
select is((select draft_revision from public.profiles where id = tests.id('plain')), 2::bigint, 'a theme change bumps draft_revision');
select lives_ok(format('update public.profiles set theme = null where id = %L', tests.id('plain')), 'the theme can go back to the classic look (null)');

-- ---- Embeds: allowlist of provider + id, nothing else ----------------------------------------
create temporary table malicious_embeds (label text, value text) on commit drop;
insert into malicious_embeds values
  ('pasted iframe', convert_from(decode('3c696672616d65207372633d2268747470733a2f2f7777772e796f75747562652e636f6d2f656d6265642f6451773477395767586351223e3c2f696672616d653e', 'hex'), 'UTF8')),
  ('pasted script', convert_from(decode('3c736372697074207372633d2268747470733a2f2f6576696c2e6578616d706c652f782e6a73223e3c2f7363726970743e', 'hex'), 'UTF8')),
  ('unknown host', convert_from(decode('68747470733a2f2f6576696c2e6578616d706c652f77617463683f763d6451773477395767586351', 'hex'), 'UTF8')),
  ('lookalike suffix', convert_from(decode('68747470733a2f2f796f75747562652e636f6d2e6576696c2e6578616d706c652f77617463683f763d6451773477395767586351', 'hex'), 'UTF8')),
  ('lookalike prefix', convert_from(decode('68747470733a2f2f6576696c796f75747562652e636f6d2f77617463683f763d6451773477395767586351', 'hex'), 'UTF8')),
  ('lookalike short host', convert_from(decode('68747470733a2f2f796f7574752e62652e6576696c2e6578616d706c652f6451773477395767586351', 'hex'), 'UTF8')),
  ('provider as userinfo', convert_from(decode('68747470733a2f2f7777772e796f75747562652e636f6d406576696c2e6578616d706c652f77617463683f763d6451773477395767586351', 'hex'), 'UTF8')),
  ('javascript scheme', convert_from(decode('6a6176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('data URL', convert_from(decode('646174613a746578742f68746d6c2c3c7363726970743e616c6572742831293c2f7363726970743e', 'hex'), 'UTF8')),
  ('protocol-relative', convert_from(decode('2f2f7777772e796f75747562652e636f6d2f77617463683f763d6451773477395767586351', 'hex'), 'UTF8')),
  ('markup in the id', convert_from(decode('68747470733a2f2f7777772e796f75747562652e636f6d2f77617463683f763d223e3c7363726970743e616c6572742831293c2f7363726970743e', 'hex'), 'UTF8')),
  ('path traversal in the id', convert_from(decode('68747470733a2f2f7777772e796f75747562652e636f6d2f656d6265642f2e2e2f2e2e2f7265646972656374', 'hex'), 'UTF8')),
  ('redirect endpoint', convert_from(decode('68747470733a2f2f7777772e796f75747562652e636f6d2f72656469726563743f713d68747470733a2f2f6576696c2e6578616d706c65', 'hex'), 'UTF8')),
  ('attribution link', convert_from(decode('68747470733a2f2f7777772e796f75747562652e636f6d2f6174747269627574696f6e5f6c696e6b3f753d2f77617463683f763d6451773477395767586351', 'hex'), 'UTF8')),
  ('id with extra parameters', convert_from(decode('64517734773957675863513f6175746f706c61793d31', 'hex'), 'UTF8')),
  ('id with a second path', convert_from(decode('64517734773957675863512f2e2e2f2e2e2f78', 'hex'), 'UTF8')),
  ('vimeo id with markup', convert_from(decode('68747470733a2f2f76696d656f2e636f6d2f313233343536226f6e6c6f61643d22616c657274283129', 'hex'), 'UTF8')),
  ('vimeo non-numeric id', convert_from(decode('68747470733a2f2f76696d656f2e636f6d2f6368616e6e656c732f73746166667069636b73', 'hex'), 'UTF8')),
  ('spotify user page', convert_from(decode('68747470733a2f2f6f70656e2e73706f746966792e636f6d2f757365722f6576696c', 'hex'), 'UTF8')),
  ('spotify id with markup', convert_from(decode('68747470733a2f2f6f70656e2e73706f746966792e636f6d2f747261636b2f3c696d67207372633d78206f6e6572726f723d616c6572742831293e', 'hex'), 'UTF8')),
  ('spotify lookalike', convert_from(decode('68747470733a2f2f6f70656e2e73706f746966792e636f6d2e6576696c2e6578616d706c652f747261636b2f34754c5536684d436a4d4937354d314132744b555143', 'hex'), 'UTF8'));
grant select on malicious_embeds to authenticated;

select tests.clear_authentication();
select is(
  (select array_agg(provider || ': ' || label order by provider, label)
   from malicious_embeds, unnest(array['youtube', 'vimeo', 'spotify']) provider
   where private.is_valid_embed_ref(provider, value)),
  null, 'no malicious input is a valid id for any provider');
select is(
  (select array_agg(provider || ' ' || ref) from (values
    ('youtube', 'dQw4w9WgXcQ'), ('youtube', 'a-b_c-d_e-f'), ('vimeo', '123456'), ('vimeo', '123456789012'),
    ('spotify', 'track/4uLU6hMCjMI75M1A2tKUQC'), ('spotify', 'episode/4uLU6hMCjMI75M1A2tKUQC'), ('spotify', 'artist/4uLU6hMCjMI75M1A2tKUQC')
  ) v(provider, ref) where not private.is_valid_embed_ref(provider, ref)),
  null, 'ids in each provider''s format are accepted');
select is(
  (select array_agg(provider || ' ' || ref) from (values
    ('youtube', 'dQw4w9WgXc'), ('youtube', 'dQw4w9WgXcQQ'), ('vimeo', 'dQw4w9WgXcQ'), ('vimeo', '12345'), ('spotify', 'track/short'),
    ('spotify', 'user/4uLU6hMCjMI75M1A2tKUQC'), ('instagram', 'dQw4w9WgXcQ'), ('', 'dQw4w9WgXcQ'), ('youtube', E'dQw4w9WgXcQ\n'), ('youtube', null)
  ) v(provider, ref) where private.is_valid_embed_ref(provider, ref)),
  null, 'wrong formats, unknown providers and trailing characters are refused');

-- The same table through the trigger, as a signed-in editor bypassing the UI.
select tests.authenticate_as(tests.id('editor'));
do $$
declare
  v_case record;
  v_provider text;
  v_accepted text[] := '{}';
begin
  for v_case in select label, value from malicious_embeds loop
    foreach v_provider in array array['youtube', 'vimeo', 'spotify'] loop
      begin
        update public.profiles
        set blocks = jsonb_build_array(jsonb_build_object('id', '7d000000-0000-4000-8000-0000000000aa', 'type', 'embed', 'visible', true, 'provider', v_provider, 'ref', v_case.value, 'title', 'x'))
        where id = tests.id('page2');
        v_accepted := v_accepted || (v_provider || ': ' || v_case.label);
      exception when sqlstate 'LK040' then
        null;
      end;
    end loop;
  end loop;
  perform set_config('tests.accepted_embeds', array_to_string(v_accepted, ','), true);
end;
$$;
select is(current_setting('tests.accepted_embeds'), '', 'the draft validator refuses every malicious embed, even without the UI');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000b1","type":"embed","visible":true,"provider":"evil","ref":"dQw4w9WgXcQ","title":"x"}]' where id = %L$f$, tests.id('page2')),
  'LK040', null, 'a provider outside the allowlist is rejected');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000b2","type":"embed","visible":true,"provider":"youtube","ref":"dQw4w9WgXcQ","title":"x","html":"<script>alert(1)</script>"}]' where id = %L$f$, tests.id('page2')),
  'LK040', null, 'an embed cannot carry markup in an extra key');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000b3","type":"embed","visible":true,"provider":"youtube","ref":"dQw4w9WgXcQ","title":""}]' where id = %L$f$, tests.id('page2')),
  'LK040', null, 'an embed needs a title');
select lives_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7d000000-0000-4000-8000-0000000000b4','type','embed','visible',true,'provider','youtube','ref','dQw4w9WgXcQ','title','<img src=x onerror=alert(1)>')) where id = %L$f$, tests.id('page2')),
  'markup typed in a title is stored as plain text (it is never interpreted)');

-- ---- Pix -----------------------------------------------------------------------------------------
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7d000000-0000-4000-8000-0000000000c1','type','pix','visible',true,'label','Pix','keyType',%L,'key',%L,'paymentUrl','')) where id = %L$f$, v.key_type, v.key, tests.id('page2')),
  'LK040', null, 'invalid Pix key is rejected: ' || v.key_type || ' ' || v.key)
from (values
  ('cpf', '52998224724'), ('cpf', '529.982.247-25'), ('cpf', '11111111111'), ('cnpj', '11222333000182'), ('phone', '5511912345678'), ('phone', '+12025550100'),
  ('email', 'Ana@exemplo.com.br'), ('email', 'ana@'), ('random', 'not-a-uuid'), ('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), ('cnpj', '52998224725')
) v(key_type, key);
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7d000000-0000-4000-8000-0000000000c2','type','pix','visible',true,'label','Pix','keyType','email','key','ana@exemplo.com.br','paymentUrl',%L)) where id = %L$f$, v.url, tests.id('page2')),
  'LK040', null, 'payment link is rejected: ' || v.url)
from (values ('http://pagamento.exemplo.com.br/'), ('javascript:alert(1)'), ('mailto:ana@exemplo.com.br'), ('pagamento.exemplo.com.br')) v(url);

-- ---- Form definition -------------------------------------------------------------------------------
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7d000000-0000-4000-8000-0000000000d1','type','form','visible',true,'title','Contato','fields',%L::jsonb,'buttonLabel','Enviar','consentText','Aceito.','consentRequired',true)) where id = %L$f$, v.fields, tests.id('page2')),
  'LK040', null, 'form fields are rejected: ' || v.fields)
from (values ('["name"]'), ('["email","name"]'), ('["email","email"]'), ('["email","cpf"]'), ('[]'), ('"email"'), ('["name","email","phone","message","email"]'), ('[1]')) v(fields);
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000d2","type":"form","visible":true,"title":"Contato","fields":["email"],"buttonLabel":"Enviar","consentText":"","consentRequired":true}]' where id = %L$f$, tests.id('page2')),
  'LK040', null, 'a form needs a consent text');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000d3","type":"form","visible":true,"title":"Contato","fields":["email"],"buttonLabel":"Enviar","consentText":"Aceito.","consentRequired":"true"}]' where id = %L$f$, tests.id('page2')),
  'LK040', null, 'consentRequired must be a boolean');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000d4","type":"form","visible":true,"title":"Contato","fields":["email"],"buttonLabel":"Enviar","consentText":"Aceito.","consentRequired":true,"action":"https://evil.example"}]' where id = %L$f$, tests.id('page2')),
  'LK040', null, 'a form cannot carry its own destination');

-- ---- Theme: closed token set ------------------------------------------------------------------------
do $$
declare
  v_theme jsonb;
  v_accepted text[] := '{}';
begin
  for v_theme in select value from jsonb_array_elements('[
    {"background": "#F5EFE5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"},
    {"background": "red", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"},
    {"background": "#fff", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"},
    {"background": "#f5efe5", "button": "url(javascript:alert(1))", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"},
    {"background": "#f5efe5", "button": "#1f5b49;}body{display:none", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"},
    {"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "gradient", "corners": "rounded", "spacing": "regular", "font": "serif"},
    {"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "9999px", "spacing": "regular", "font": "serif"},
    {"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": 12, "font": "serif"},
    {"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "https://evil.example/font.woff2"},
    {"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif", "css": "body{display:none}"},
    {"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif", "backgroundImage": "https://evil.example/x.png"},
    {"background": "#f5efe5", "button": "#1f5b49"},
    []
  ]'::jsonb) loop
    begin
      update public.profiles set theme = v_theme where id = tests.id('page2');
      v_accepted := v_accepted || v_theme::text;
    exception when sqlstate 'LK040' or sqlstate '23514' then
      null;
    end;
  end loop;
  perform set_config('tests.accepted_themes', array_to_string(v_accepted, ' | '), true);
end;
$$;
select is(current_setting('tests.accepted_themes'), '', 'only the closed token set is accepted as a theme: no CSS, no URLs, no free values');

-- ---- Media references -------------------------------------------------------------------------------
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7d000000-0000-4000-8000-0000000000e1','type','image','visible',true,'mediaId',%L,'width',%s,'height',%s,'alt','x','decorative',false)) where id = %L$f$, v.media, v.width, v.height, tests.id('page')),
  'LK040', null, 'image reference is rejected: ' || v.label)
from (values
  ('asset of another workspace', '9c000000-0000-4000-8000-000000000005', 300, 200),
  ('asset of another page of the same workspace', '9c000000-0000-4000-8000-000000000004', 300, 200),
  ('asset still pending', '9c000000-0000-4000-8000-000000000003', 300, 200),
  ('avatar used as an image', '9c000000-0000-4000-8000-000000000002', 288, 288),
  ('unknown asset', '9c000000-0000-4000-8000-0000000000ff', 300, 200),
  ('dimensions that are not the asset''s', '9c000000-0000-4000-8000-000000000001', 4000, 10)
) v(label, media, width, height);
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000e2","type":"image","visible":true,"mediaId":"https://evil.example/x.png","width":896,"height":672,"alt":"x","decorative":false}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'an image block cannot point at a URL');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000e3","type":"image","visible":true,"mediaId":"9c000000-0000-4000-8000-000000000001","width":896,"height":672,"alt":"x","decorative":false,"src":"data:image/png;base64,AAAA"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'an image block cannot carry inline data');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000e4","type":"image","visible":true,"mediaId":"9c000000-0000-4000-8000-000000000001","width":896,"height":672,"alt":"","decorative":false}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'an image needs a description unless it is decorative');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7d000000-0000-4000-8000-0000000000e5","type":"image","visible":true,"mediaId":"9c000000-0000-4000-8000-000000000001","width":896,"height":672,"alt":"descrição","decorative":true}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'a decorative image has no description');
select throws_ok(
  format($f$update public.profiles set avatar_path = %L where id = %L$f$, v.media, tests.id('page')),
  'LK040', null, 'avatar reference is rejected: ' || v.label)
from (values
  ('avatar of another workspace', '9c000000-0000-4000-8000-000000000006'),
  ('image used as an avatar', '9c000000-0000-4000-8000-000000000001'),
  ('a URL', 'https://evil.example/avatar.png'),
  ('a storage path', 'media/9c000000-0000-4000-8000-000000000002/96.webp')
) v(label, media);
select tests.clear_authentication();

-- ---- Other tenants and anon --------------------------------------------------------------------
select tests.authenticate_as(tests.id('outsider'));
with forged as (
  update public.profiles set theme = null, avatar_path = null where id = tests.id('page') returning 1
)
select is((select count(*)::int from forged), 0, 'another workspace cannot change the theme or avatar with a forged page id');
select throws_ok(
  format($f$update public.profiles set avatar_path = '9c000000-0000-4000-8000-000000000002' where id = %L$f$, tests.id('page_out')),
  'LK040', null, 'another workspace cannot use this page''s avatar on its own page');
select tests.clear_authentication();
select tests.authenticate_anon();
select throws_ok(format($f$update public.profiles set theme = null where id = %L$f$, tests.id('page')), '42501', null, 'anon cannot write the theme');
select tests.clear_authentication();

-- ---- Publishing: additive snapshot, still schema version 2 --------------------------------------
select tests.authenticate_as(tests.id('editor'));
select results_eq(format('select version, created from public.publish_profile(%L, 2)', tests.id('page')), $$values (1, true)$$, 'the editor publishes the page with media and a theme');
select public.publish_profile(tests.id('plain'));
select tests.clear_authentication();
select tests.remember('pub', (select live_publication_id from public.profiles where id = tests.id('page')));
select is((select schema_version from public.profile_publications where id = tests.id('pub')), 2::smallint, 'the snapshot stays at schema version 2');
select is(
  (select pp.document -> 'theme' from public.profile_publications pp where pp.id = tests.id('pub')),
  '{"background": "#f5efe5", "button": "#1f5b49", "buttonStyle": "filled", "corners": "rounded", "spacing": "regular", "font": "serif"}'::jsonb,
  'the snapshot copies the theme');
select is((select pp.document ->> 'avatarPath' from public.profile_publications pp where pp.id = tests.id('pub')), '9c000000-0000-4000-8000-000000000002', 'the snapshot copies the avatar reference');
select is(
  (select array_agg(b ->> 'id' order by ord) from public.profile_publications pp, jsonb_array_elements(pp.document -> 'blocks') with ordinality t(b, ord) where pp.id = tests.id('pub')),
  array['7d000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000003', '7d000000-0000-4000-8000-000000000005',
        '7d000000-0000-4000-8000-000000000006', '7d000000-0000-4000-8000-000000000007', '7d000000-0000-4000-8000-000000000008', '7d000000-0000-4000-8000-000000000009',
        '7d000000-0000-4000-8000-00000000000a', '7d000000-0000-4000-8000-00000000000b', '7d000000-0000-4000-8000-00000000000c'],
  'the snapshot keeps draft order and drops the hidden block');
select is(
  (select pp.document -> 'blocks' -> 0 from public.profile_publications pp where pp.id = tests.id('pub')),
  '{"id": "7d000000-0000-4000-8000-000000000001", "type": "image", "mediaId": "9c000000-0000-4000-8000-000000000001", "width": 896, "height": 672, "alt": "Vitrine da loja"}'::jsonb,
  'a published image carries the media id and its dimensions, and no visible or decorative flag');
select is(
  (select pp.document -> 'blocks' -> 1 from public.profile_publications pp where pp.id = tests.id('pub')),
  '{"id": "7d000000-0000-4000-8000-000000000002", "type": "embed", "provider": "youtube", "ref": "dQw4w9WgXcQ", "title": "Conheça o estúdio"}'::jsonb,
  'a published embed is a provider and an id');
select is(
  (select pp.document -> 'blocks' -> 4 from public.profile_publications pp where pp.id = tests.id('pub')),
  '{"id": "7d000000-0000-4000-8000-000000000006", "type": "pix", "label": "Empresa", "keyType": "cnpj", "key": "11222333000181", "paymentUrl": "https://pagamento.exemplo.com.br/abc"}'::jsonb,
  'a published Pix block carries the key and the payment link');
select is(
  (select pp.document -> 'blocks' -> 8 from public.profile_publications pp where pp.id = tests.id('pub')),
  '{"id": "7d000000-0000-4000-8000-00000000000a", "type": "form", "title": "Peça um orçamento", "fields": ["name", "email", "message"], "buttonLabel": "Enviar", "consentText": "Aceito ser contatado.", "consentRequired": true}'::jsonb,
  'a published form carries its definition');
select is(
  (select pp.document ? 'theme' from public.profile_publications pp join public.profiles p on p.live_publication_id = pp.id where p.id = tests.id('plain')),
  false, 'a page without a theme publishes the same document shape as before Sprint 5');
select is(
  (select pp.document ?| array['workspaceId', 'workspace_id', 'profileId', 'profile_id', 'createdBy'] from public.profile_publications pp where pp.id = tests.id('pub')),
  false, 'the snapshot still carries no tenant or user identifiers');

select tests.authenticate_anon();
select results_eq(
  $$select state, (document ->> 'schemaVersion')::int, document -> 'theme' ->> 'font', jsonb_array_length(document -> 'blocks') from public.get_public_page('studio-novo')$$,
  $$values ('published'::text, 2, 'serif'::text, 11)$$,
  'visitors get the theme and the new blocks through get_public_page');
select tests.clear_authentication();

-- ---- Pre-Sprint-5 snapshots stay readable (versions 1 and 2) -------------------------------------
insert into public.profile_publications (profile_id, workspace_id, version, schema_version, document, source_revision) values
  (tests.id('old_page'), tests.id('ws'), 1, 1,
   '{"schemaVersion": 1, "title": "Página Antiga", "bio": "", "avatarPath": null, "socialLinks": [{"network": "instagram", "url": "https://www.instagram.com/antiga"}], "blocks": [{"id": "7d000000-0000-4000-8000-0000000000f1", "type": "link", "title": "Site", "url": "https://exemplo.com.br/"}]}', 1),
  (tests.id('old_page'), tests.id('ws'), 2, 2,
   '{"schemaVersion": 2, "title": "Página Antiga", "bio": "", "avatarPath": null, "blocks": [{"id": "7d000000-0000-4000-8000-0000000000f2", "type": "whatsapp", "label": "Zap", "phone": "5511912345678", "message": ""}]}', 1);
update public.profiles
set live_publication_id = (select id from public.profile_publications where profile_id = tests.id('old_page') and version = 2), status = 'published', published_at = now()
where id = tests.id('old_page');
select tests.authenticate_anon();
select results_eq(
  $$select state, (document ->> 'schemaVersion')::int, document ? 'theme', document -> 'blocks' -> 0 ->> 'type' from public.get_public_page('pagina-antiga-s5')$$,
  $$values ('published'::text, 2, false, 'whatsapp'::text)$$,
  'a version 2 snapshot published before Sprint 5 is served unchanged (no theme, no media)');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('editor'));
select is(
  public.restore_profile_publication(tests.id('old_page'), (select id from public.profile_publications where profile_id = tests.id('old_page') and version = 1)),
  1, 'rollback to a version 1 snapshot still works');
select tests.clear_authentication();
select tests.authenticate_anon();
select results_eq(
  $$select state, (document ->> 'schemaVersion')::int, document -> 'socialLinks' -> 0 ->> 'network' from public.get_public_page('pagina-antiga-s5')$$,
  $$values ('published'::text, 1, 'instagram'::text)$$,
  'a version 1 snapshot is still served to visitors');
select tests.clear_authentication();

select * from finish();
rollback;
