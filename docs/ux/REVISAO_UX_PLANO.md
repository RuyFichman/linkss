# Revisão de UX e design da tela Plano

- **Data:** 28/10/2026.
- **Escopo:** a tela Plano depois do login (`/app/w/<conta>/plano`) e a seção de planos da home (`/#planos`, `/#comparar`), depois da UX-107 e da UX-108.
- **Base:** capturas da tela Plano a 320, 390, 768 e 1280 px, como dono e como administrador, nos estados de cobrança (gratuito, ativo mensal e anual, cancelando, mudando para plano menor, pagamento pendente, incompleto, carência vencida, encerrado, plano definido manualmente), e da home a 320, 390, 768 e 1280 px. O ambiente era o local, com o emulador de cobrança (`scripts/billing-lifecycle.mjs --serve`).

A tela funciona e passa nas verificações automáticas: sem rolagem lateral, sem texto menor que 12 px, sem controle menor que 44 px e sem falha no axe. Mas ainda tem seis problemas de UX, três de texto e quatro de visual com cara de modelo pronto. Parte deles foi introduzida pela própria UX-108; o texto indica quais.

## Problemas de UX (os mais graves primeiro)

### 1. Planos que não dá para contratar, sem explicar por quê

Com pagamento pendente, ou quando quem olha é administrador, os três cartões e a escolha Mensal/Anual aparecem inteiros, mas sem nenhum botão.

- **Por quê:** a escolha Mensal/Anual troca o preço de algo que a pessoa não pode comprar. São uns 900 px de vitrine sem ação.
- Para o administrador, o aviso "Só o proprietário desta conta pode contratar, alterar ou cancelar o plano." fica no cartão *Seu plano*, longe dos planos.
- Para o dono com pagamento falhando, nada perto dos cartões diz "primeiro atualize a forma de pagamento".
- **Onde mexer:** `modules/billing/components/plan-screen.tsx` (catálogo) e `modules/billing/plan-screen.ts` (o que cada estado mostra).

### 2. "Acima do limite" não diz o que acontece nem o que fazer

"Pessoas 3 de 1" aparece com barra vermelha cheia.

- **Por quê:** o vermelho sugere que algo vai ser apagado, e nada é: só ficam bloqueadas novas criações (novas páginas, novos convites). Falta uma frase com a consequência.
- Isso não depende da decisão adiada DA-001 (`DECISOES_ADIADAS.md`), que trata só do atalho para o plano que resolve.
- **Onde mexer:** `Usage` e `UsageRow` em `modules/billing/components/plan-screen.tsx`; texto em `BILLING_COPY.usage`.

### 3. Barras vazias e espaço sobrando no cartão de uso

"Páginas 0 de 1" e "0 MB de 100 MB" mostram um trilho cinza vazio. No computador, o cartão de uso estica até a altura do cartão *Seu plano* e sobram uns 90 px vazios no fim.

- **Por quê:** duas das três barras não dizem nada, e a sobra deixa o par de cartões desequilibrado.

### 4. "R$" quebra a linha longe do valor

No celular aparece "No anual você paga R$" numa linha e "29,80 a menos" na seguinte.

- **Por quê:** `formatMoney` troca o espaço inseparável por um espaço comum (`modules/billing/catalog.ts:82`). O erro já existia antes da UX-108 e vale para todo preço exibido no produto.
- **A considerar:** o espaço comum foi escolhido para o texto poder ser comparado e copiado; os testes que procuram "R$ 14,90" precisam acompanhar a mudança.

### 5. O cabeçalho do app gasta espaço e repete informação no celular

O seletor de conta mostra só "Q… ▾", e a linha logo abaixo repete "QA Cobrança" por extenso, separada por ponto ("Conta da agência • QA Cobrança").

- **Por quê:** são uns 190 px de cabeçalho antes do título da tela. O nome da conta aparece duas vezes, uma delas ilegível.
- Isso vale para todas as telas da conta, não só para a de plano.

### 6. A tabela de Pagamentos fica espalhada no computador

São quatro colunas (Data, Valor, Situação, Recibo) em 1.180 px, com o valor alinhado à esquerda.

- **Por quê:** valores em dinheiro se comparam melhor alinhados à direita, com números de largura fixa. É um ponto menor.

## Texto: o mesmo assunto dito de dois jeitos

### 7. A economia do plano anual tem duas frases na mesma tela

- O cartão *Seu plano* diz "No anual você paga R$ 29,80 a menos por ano" (`BILLING_COPY.plans.toYearlyHint`, `content/pt-BR.ts:1366`).
- Os cartões de plano dizem "Economize R$ 29,80 por ano no plano anual" (`BILLING_COPY.yearlySaving`).
- A UX-108 mudou a segunda e não a primeira.

### 8. O mesmo plano tem descrições diferentes na home e na conta

- Pro, na home: "Para quem quer a página sem o selo e os resultados por mais tempo." Na conta: "Para quem quer acompanhar os resultados por mais tempo e tirar o selo."
- Gratuito, na home: "Tudo o que você precisa para publicar a sua página." Na conta: "Para publicar a sua página."
- **Por quê:** deveria haver uma única fonte para esse texto. Hoje uma está em `HOME_COPY.plans` e a outra em `BILLING_COPY`.

### 9. Frases que repetem o que já está na tela

- "Seu plano: Gratuito", seguido de "Esta conta está no plano Gratuito. Não há cobrança.", repete o título.
- O subtítulo da tela, "O plano define quantas páginas, pessoas e dias de resultados esta conta tem.", explica o óbvio.

## Visual com cara de modelo pronto

### 10. A vitrine de marketing foi levada para dentro da conta

A UX-108 trouxe para a tela Plano o desenho da seção de preços da home: três cartões iguais com sombra suave, selo em degradê roxo-rosa, brilho roxo no plano atual e checks verdes em círculo. É o kit genérico de página de preços.

- Na home faz sentido, porque o founder pediu a seção igual à referência.
- Dentro da conta, a tarefa é gerenciar, não vender. Nenhuma outra tela do app usa degradê, e o selo "Plano atual" em degradê é só enfeite, já que o texto diz o estado.
- **Onde mexer:** `.plan-offer*` e `--plan-badge` em `app/globals.css` (compartilhados com a home: a mudança precisa ficar restrita à conta) e `PlanCard` em `modules/billing/components/plan-screen.tsx`.

### 11. A tabela de comparação está inchada

20 das 25 linhas têm o check nos três planos. No celular são cerca de 2.000 px de rolagem para achar 5 diferenças.

- As barras coloridas dos grupos (azul, verde, roxo, amarelo) não dizem nada além do título do grupo.
- No celular, "Agência" e "500 MB" ficam colados na borda direita.
- Para quem já usa o produto, o que interessa é o que muda de um plano para outro.
- **Onde mexer:** `PlanComparisonTable` em `modules/billing/components/plan-comparison.tsx`, `COMPARISON_GROUPS` em `modules/billing/comparison.ts` e `.plan-compare*` em `app/globals.css`.

### 12. Na home, o cartão do Pro tem o botão "Começar no Gratuito"

Os botões ficam, como o founder pediu; o problema é o texto.

- O cartão fala do Pro, o botão leva ao Gratuito, e os três botões vão para o mesmo lugar (`/cadastro`).
- "Em breve" em letra grande e cinza, no lugar do preço, também pesa demais.
- **Onde mexer:** `app/(marketing)/pricing.tsx` e `HOME_COPY.plans.paidCtaNotSelling`, `HOME_COPY.plans.soon`.

### 13. O aviso de ambiente de teste parece um campo de texto

É um contorno arredondado da largura da tela.

- **Por quê:** como a produção está em modo de teste (`BILLING_MODE=sandbox`), clientes de verdade veriam esse aviso hoje.

## Ordem sugerida para corrigir

1. **Itens 1, 4, 7 e 9:** são estados sem saída, um erro de exibição e texto. Pouco risco.
2. **Itens 2 e 3:** o cartão de uso, com a consequência escrita e sem barras vazias.
3. **Itens 10 e 11:** a vitrine fica mais simples dentro da conta, sem degradê e sem brilho, e a comparação mostra só o que muda. A home fica como está.
4. **Itens 8, 12 e 13:** unificar as descrições e mexer no texto do botão da home e no aviso de teste.
5. **Itens 5 e 6:** cabeçalho e tabela de pagamentos, que pertencem à rodada das outras telas depois do login (DA-002).
