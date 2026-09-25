# ADR 0001 — monólito modular

- **Status:** aceito
- **Data:** 25/09/2026

## Contexto

O produto precisa chegar ao mercado com equipe pequena, mas possui caminhos de alto volume: renderer público, mídia e analytics.

## Decisão

Usar um monólito modular em Next.js. Banco e deploy podem ser compartilhados, enquanto domínios mantêm contratos explícitos. Renderer usa snapshots; ingestão de eventos é assíncrona; mídia e pagamentos usam adapters.

## Consequências

- Menor custo operacional e entrega mais rápida.
- Transações e mudanças de schema são simples no começo.
- Disciplina modular e testes de autorização são obrigatórios.
- Analytics/renderer podem ser extraídos quando métricas, não antecipação, justificarem.
