# Projeto LNK

Codinome da plataforma brasileira de bio pages orientada a conversão, analytics e operação multi-perfil. O nome não é uma marca aprovada.

## Requisitos

- Node.js 24
- npm 11+

## Desenvolvimento

```bash
npm install
copy .env.example .env.local
npm run dev
```

A aplicação fica em `http://localhost:3000` e o health check em `http://localhost:3000/api/health`.

## Qualidade

```bash
npm run check
```

O comando executa lint, typecheck, testes e build. A mesma sequência roda no CI.

## Estrutura

```text
apps/web/           aplicação Next.js
docs/               produto, arquitetura, ADRs, segurança e operação
.github/workflows/  pipeline de CI
BACKLOG.md           backlog executável das próximas sprints
```

## Documentos principais

- `AGENTS.md`
- `CLAUDE.md` (imports `AGENTS.md` for Claude Code)
- `PLANO_DE_NEGOCIO.md`
- `PLANO_DE_EXECUCAO.md`
- `docs/ARCHITECTURE.md`
- `docs/SUPABASE_CAPACITY.md`
- `docs/SPRINT_0_REPORT.md`
