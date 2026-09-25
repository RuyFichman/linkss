# Projeto LNK

Codinome da plataforma brasileira de conversão mobile orientada a páginas profissionais, resultados compreensíveis e operação multi-perfil. O nome ainda não é uma marca aprovada.

## Requisitos e execução

- Node.js 24
- npm 11+

```bash
npm install
copy .env.example .env.local
npm run dev
```

A aplicação fica em `http://localhost:3000`; health check em `/api/health`.

## Rotas da Sprint 1

### Marketing e pesquisa

- `/` — landing neutra e lista do piloto.
- `/agencias` — variante para agência/social media.
- `/profissionais` — variante para profissionais e pequenos negócios.
- `/privacidade` — aviso provisório da lista.

### Protótipo

- `/proto` — cenários, reset e entradas J1/J2.
- `/proto/cadastro` — cadastro simulado.
- `/proto/onboarding` — objetivo, template e endereço.
- `/proto/editor/[profileId]` — editor, preview e publicação simulada.
- `/proto/p/[slug]` — página pública simulada.
- `/proto/analytics/[profileId]` — resultados mockados.
- `/proto/w/agencia-aurora/perfis` — operação multi-perfil.
- `/proto/r/[token]` — relatório somente leitura.
- `/proto/tokens` — tokens e estados dos componentes.

Todas as rotas `/proto` são `noindex, nofollow`, mostram o selo **Protótipo** e persistem somente em `localStorage` sob `lnk-proto:v1`. A landing não contém link para o protótipo.

## Painel de depuração

Abra qualquer rota do protótipo com `?debug=1` ou pressione `Alt+Shift+D`. O painel pode forçar erro/lentidão de salvamento, erro de publicação e estados de analytics; também mostra a timeline e copia JSON da sessão.

## Sessão de usabilidade

1. Abra `/proto` em um perfil de navegador dedicado.
2. Clique **Reiniciar protótipo**.
3. Mantenha o debug oculto do participante.
4. Aplique T1 e, para agências, T2 de `docs/research/USABILITY_TEST_PLAN.md` sem instrução verbal.
5. Abra o debug ao final e copie a timeline JSON.

Os cinco testes humanos ainda não foram executados; portanto, os gates de 5/5 publicarem e 4/5 em menos de 10 minutos permanecem preparados, não atendidos.

## Lista de espera

Em desenvolvimento/teste, `WAITLIST_STORE=memory`. Para uso real, configure `WAITLIST_STORE=supabase`, `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SECRET_KEY`, e aplique de forma controlada a migração em `supabase/migrations/`. Se storage não estiver configurado em produção, o formulário falha de modo visível e nunca mostra falso sucesso.

## Qualidade

```bash
npm run check
```

Executa lint com zero warnings, typecheck, testes Vitest e build de produção — a mesma sequência do CI.

## Estrutura

```text
apps/web/src/app/(marketing)/  landing e privacidade
apps/web/src/app/proto/        rotas descartáveis do protótipo
apps/web/src/prototype/        store local, cenários e instrumentação
apps/web/src/ui/               componentes acessíveis que graduam
apps/web/src/modules/          modelo, renderer e waitlist
docs/ux/                       jornadas, wireframes, tokens e decisões
docs/research/                 entrevistas e teste de usabilidade
supabase/migrations/           migrações versionadas não executadas
```

## Documentos principais

- `AGENTS.md` e `CLAUDE.md`
- `PLANO_DE_NEGOCIO.md`
- `PLANO_DE_EXECUCAO.md`
- `docs/ARCHITECTURE.md`
- `docs/SPRINT_0_REPORT.md`
- `docs/SPRINT_1_REPORT.md`
