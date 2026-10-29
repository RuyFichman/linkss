# Decisões adiadas

Decisões de produto e UX que ficaram para depois, com o contexto necessário para retomá-las. Quando uma delas for tomada, registre a decisão em `UX_DECISIONS.md` (ou na ADR correspondente) e tire-a daqui.

## DA-001 — Atalho para o plano que resolve, no cartão de uso

- **Origem:** refino da tela Plano (UX-108), em 28/10/2026.
- **Hoje:** o cartão *Uso desta conta* (`/app/w/<conta>/plano`) mostra páginas, pessoas e espaço para imagens frente aos limites do plano, com *No limite* ou *Acima do limite*. Os planos aparecem logo abaixo, sem atalho a partir do cartão.
- **Pergunta:** quando uma conta chega a um limite (por exemplo, *Páginas 1 de 1*), o cartão deve levar direto ao plano que resolve?
- **Opções:**
  1. Manter como está, com os planos logo abaixo.
  2. Um link para o catálogo na própria tela ("Ver planos").
  3. Nomear o plano que resolve ("O plano Agência tem 10 páginas") com o caminho para assinar ou mudar.
- **A considerar:** só o proprietário assina ou muda o plano, então para um administrador o atalho não teria ação. Com a cobrança desligada não há o que oferecer. A opção 3 precisa escolher o menor plano que cobre o uso, a partir dos direitos dos planos (`modules/billing/comparison.ts`), sem nome de plano escrito à mão.
- **Onde mexer:** `modules/billing/plan-screen.ts` (linhas de uso) e `modules/billing/components/plan-screen.tsx` (`Usage`).

## DA-002 — Próxima página depois do login a refinar

- **Origem:** pedido do founder em 28/10/2026: todas as páginas depois do login precisam de refino de UX e design, começando pela tela Plano (UX-106 e UX-108).
- **Pergunta:** qual página vem depois?
- **Sugestão registrada:**
  1. A lista de Páginas (`/app/w/<conta>`), a primeira tela depois do login.
  2. Resultados (`/app/w/<conta>/resultados`).
  3. Membros (`/app/w/<conta>/membros`).
- **A considerar:** o editor de páginas já passou por duas rodadas próprias (UX-072 e UX-085) e tem uma regressão de iPhone ainda sem reteste em aparelho real. A home e a tela Plano agora compartilham cartões, escolha de intervalo e tabela (`globals.css`, `PlanComparisonTable`); as próximas telas podem partir dos mesmos tokens e componentes.
