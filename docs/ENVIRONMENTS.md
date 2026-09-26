# Ambientes e entrega

## Ambientes

| Ambiente | Aplicação | Dados | Uso |
|---|---|---|---|
| local | Next.js local | Supabase local ou projeto descartável | desenvolvimento e testes |
| preview | deploy por pull request | staging, sem dados pessoais reais | revisão visual/funcional |
| staging | URL estável | projeto Supabase Free | QA, migrações e demos |
| production | URL pública | projeto separado; Pro antes do beta pago | clientes reais |

O limite de dois projetos Free permite staging e uma produção inicial privada. Desenvolvimento local não consome projeto hospedado. Produção será promovida para Pro antes de depender de receita.

## Pipeline

1. Branch curta e pull request.
2. CI executa lint, typecheck, testes e build.
3. Preview deploy usa variáveis do ambiente de preview.
4. Merge em `main` promove staging automaticamente.
5. Produção exige aprovação manual até o processo provar estabilidade.
6. Migração de banco roda separadamente e antes do código que depende dela.

## Segredos

- Somente chaves publicáveis usam prefixo `NEXT_PUBLIC_`.
- Secret/service key existe apenas no runtime servidor.
- Ambientes nunca compartilham secrets ou webhooks.
- `.env.example` documenta nomes, não valores.
- Rotação obrigatória após vazamento ou saída de colaborador.

## Rollback

- Aplicação: promover o último deploy saudável.
- Banco: migrações expansivas e compatíveis; correções via nova migração.
- Publicação: snapshot anterior por perfil.
- Feature arriscada: flag/entitlement desligável sem novo deploy quando necessário.

## Supabase local (Sprint 2)

- Requisitos: Docker em execução. A CLI é devDependency fixada (`supabase@2.118.0`).
- `npm run db:start` sobe Postgres 17, Auth, PostgREST, Studio e Mailpit; `npm run db:stop` encerra.
- `npm run db:reset` reaplica `supabase/migrations/` e `supabase/seed.sql` (sem dados pessoais).
- `npm run test:db` executa os testes pgTAP; `npm run db:types` regenera `apps/web/src/lib/database.types.ts`.
- `apps/web/.env.local` recebe `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` a partir de `npx supabase status`.
- E-mails locais aparecem no Mailpit em `http://127.0.0.1:54324`.
- Tabelas nunca são expostas implicitamente (`auto_expose_new_tables = false`); cada migração faz `REVOKE`/`GRANT` explícitos.

## Checklist de Auth para projetos hospedados (não aplicado)

Configurar em staging e produção **antes** de convidar usuários externos, espelhando `supabase/config.toml`. Nenhuma destas mudanças foi aplicada em projeto hospedado nesta sprint.

| Área | Configuração |
|---|---|
| URLs | Site URL = URL pública do ambiente; Redirect URLs exatas: `<APP_URL>/auth/confirm` (sem curingas em produção) |
| E-mail | Confirmação de e-mail obrigatória; "Secure password change" ligado; frequência mínima de 60 s entre e-mails; OTP/link com validade de 3600 s |
| Senha | Mínimo 8 caracteres, requisito "letters and digits"; ativar proteção contra senhas vazadas quando o plano permitir |
| Templates | Confirmação, recuperação e troca de e-mail com links `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…` (conteúdo em `supabase/templates/`). Projetos Free com SMTP padrão não permitem customizar templates desde 2026-06-03: **SMTP próprio é pré-requisito** (decisão de provedor + atualização do `DATA_MAP.md`) |
| Rate limits | Sign-in/sign-up e verificações por IP iguais ou mais estritos que o local (30 por 5 min); envio de e-mails conforme o SMTP contratado |
| CAPTCHA | Ativar Turnstile no Auth antes do piloto externo (fecha a enumeração direta por `/auth/v1/recover`) |
| API | Data API expondo apenas `public`; conferir que novas tabelas não são auto-expostas |
| Migrações | Aplicar `supabase/migrations/` em ordem via pipeline, nunca pelo dashboard |
| Segredos | `SUPABASE_SECRET_KEY` apenas no runtime servidor; publishable key em `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

## Endereço público e domínio (Sprint 3)

`NEXT_PUBLIC_APP_URL` é a única origem pública: canonical, `og:url`, `metadataBase`, `robots.txt`, endereços exibidos no app e links de e-mail. Como é `NEXT_PUBLIC_*`, o valor entra no build; trocar de domínio exige novo deploy.

| Ambiente | Valor |
|---|---|
| local | `http://localhost:3000` (ou a porta usada) |
| preview/staging | URL `*.vercel.app` estável do ambiente até existir domínio |
| produção | domínio comprado (previsto para o próximo mês) |

Checklist ao comprar o domínio:

1. Apontar DNS para a Vercel e aguardar o certificado.
2. Atualizar `NEXT_PUBLIC_APP_URL` em produção e fazer novo deploy.
3. Atualizar Site URL e Redirect URLs do Auth (`<APP_URL>/auth/confirm`).
4. Conferir `view-source` de uma página publicada (canonical e `og:url` com o domínio novo) e `robots.txt`.
5. Prévias antigas no WhatsApp/Instagram ficam no cache deles; não há como forçar atualização.

## Cache das páginas públicas

- `/[slug]` e `/[slug]/opengraph-image` usam ISR sob demanda (`revalidate = 60`). A publicação invalida os caminhos na hora; os 60 s são só o fallback.
- Na Vercel o cache é compartilhado entre instâncias. Self-hosting com várias instâncias exige `cacheHandler` compartilhado.
- O cache de arquivos do `next start` local não diferencia maiúsculas no Windows/macOS; o proxy redireciona grafias não canônicas antes do cache.
- Para verificar localmente: `npm run build && npx next start` e observar `x-nextjs-cache`; `NEXT_PRIVATE_DEBUG_CACHE=1` detalha hits/misses.
