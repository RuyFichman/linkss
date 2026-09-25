# Relatório da Sprint 0

**Status:** concluída com provisionamentos externos pendentes  
**Codinome:** Projeto LNK  
**Data:** 25/09/2026

## Decisões tomadas

- Brasil é o mercado inicial preferencial, não uma restrição arquitetural.
- ICP inicial de agências/social media managers permanece hipótese.
- Monólito modular com Next.js, TypeScript e Supabase.
- Workspaces e RLS sustentam multi-tenancy desde o primeiro schema.
- Draft e snapshot publicado serão separados.
- Eventos não bloqueiam a página pública; bruto tem retenção curta e agregação diária.
- Storage e pagamentos entram por adapters para evitar lock-in desnecessário.
- Supabase Free é ambiente de desenvolvimento/piloto; produção sobe para Pro antes do beta pago.

## Critérios de aceite

| Critério | Estado | Evidência |
|---|---|---|
| Commit pode chegar a staging de forma repetível | preparado | workflow `.github/workflows/ci.yml`; inicialização no host e conexão com GitHub/Vercel dependem do ambiente/contas |
| Segredos separados por ambiente | atendido | `.env.example`, `.gitignore` e `docs/ENVIRONMENTS.md` |
| Rollback sem editar banco manualmente | definido | rollback de deploy + migração forward-only em `docs/ENVIRONMENTS.md` |
| Backlog respeita fronteira do MVP | atendido | `BACKLOG.md` priorizado P0/P1 e não objetivos documentados |
| Owner/resposta para incidente e abuso | atendido no estágio | founder técnico + runbook; contatos reais antes de usuários externos |
| Arquitetura suporta workspace/publicação desacoplada | atendido | ADRs 0001–0003 e `docs/ARCHITECTURE.md` |
| Qualidade automatizada | atendido | lint, typecheck, 2 testes e build passam em `npm run check` |
| Health check | atendido | `GET /api/health` sem cache |

## Entregas

- Aplicação Next.js/React/TypeScript e Tailwind.
- Workspace npm e lockfile reproduzível.
- CI com permissões mínimas, timeout e cancelamento de execução antiga.
- Configuração de planos em centavos com teste automatizado.
- Arquitetura, ambientes, capacidade do Supabase, dados, ameaças e observabilidade.
- Backlog executável das Sprints 1–9.
- Runbook de incidente e health endpoint.

## Pendências externas

Não impedem o início da Sprint 1, mas exigem contas ou escolhas do founder:

1. Criar/conectar repositório remoto no GitHub e ativar proteção de `main`.
2. Criar projeto na Vercel e vincular preview/staging.
3. Criar projetos Supabase staging/production e cadastrar variáveis.
4. Criar projeto Sentry e monitor externo de uptime.
5. Pesquisar marca, domínio e handles antes de trocar o codinome.
6. Definir contato de segurança, suporte e substituto de incidentes.

O `git init` local não foi mantido: o Git detectou proprietários diferentes entre o workspace do usuário e o sandbox do Codex, o que bloqueava os comandos seguintes. Como o repositório estava vazio e sem commits, os metadados recém-criados foram removidos. A estrutura, `.gitignore` e CI estão prontos; o repositório deve ser inicializado pelo usuário do host ou diretamente pela conexão com o GitHub.

## Próximo gate

Sprint 1: protótipo dos fluxos críticos. O desenvolvimento do schema multi-tenant só começa depois de o fluxo cadastro → publicar e o fluxo agência → duplicar → relatório estarem visualmente definidos.
