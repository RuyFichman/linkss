# Guia de conteúdo do produto

## Voz e tom

- Português do Brasil, direto e humano.
- Falar com “você”; usar verbos de ação nos botões.
- Explicar benefício antes de detalhe técnico.
- Em erros: dizer o que aconteceu e o que fazer a seguir, sem culpar a pessoa.
- Nunca prometer resultado comercial, disponibilidade futura ou funcionalidade ainda não entregue.

## Glossário

| Conceito interno | Termo na interface | Decisão |
|---|---|---|
| profile / bio page | **página** | “Página” é compreensível fora do mercado de creators; “perfil” fica para código e documentação técnica. |
| block | **bloco** | Curto e já reconhecível no editor; cada seletor também descreve a função. |
| publish | **publicar** | Verbo direto. O status diferencia rascunho, publicado e alterações não publicadas. |
| draft | **rascunho** | Indica que visitantes ainda não veem o conteúdo. |
| value action | **resultado** | Mais claro que “ação de valor” e menos técnico que “conversão”. Ajuda contextual explica exemplos. |
| workspace | **conta** / **conta da agência** | Evita o jargão “workspace”; o switcher mostra “Pessoal” e o nome da agência. |
| report link | **relatório para o cliente** | Explicita público e finalidade. |
| analytics | **resultados** | A tela pode usar “Dados da página” em explicações, sem depender do anglicismo. |
| slug | **endereço da página** | “Slug” permanece apenas no código. |

## Microcopy compartilhada

| Estado | Texto recomendado |
|---|---|
| Vazio | “Você ainda não criou nenhuma página.” |
| Carregando | “Carregando…” |
| Salvando | “Salvando…” |
| Salvo | “Salvo” |
| Erro ao salvar | “Não foi possível salvar — tentar novamente.” |
| Alterações pendentes | “Alterações não publicadas” |
| Publicando | “Publicando sua página…” |
| Publicado | “Página publicada” |
| Erro ao publicar | “Não foi possível publicar. Revise sua conexão e tente novamente.” |
| Sem dados | “Sem dados ainda — compartilhe seu link para começar.” |
| Zero | “Nenhuma visita neste período.” |
| Expirado | “Este relatório expirou. Peça um novo link à agência.” |
| Revogado | “Este relatório não está mais disponível. Fale com a agência.” |
| Erro genérico | “Algo não saiu como esperado. Tente novamente.” |

O módulo `src/content/pt-BR.ts` é a fonte compartilhada desses textos. Textos específicos de uma tela podem ficar próximos à tela.

## Padrões de erro

1. **O que ocorreu:** “Este endereço já está em uso.”
2. **Próximo passo:** “Tente acrescentar sua cidade ou especialidade.”

Autenticação e lista de espera usam respostas neutras: nunca confirmar se determinado e-mail já existe. Não mostrar detalhes de infraestrutura, stack traces ou identificadores internos.

## Formatação

- Moeda: `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`.
- Números: separador de milhar brasileiro (`1.240`).
- Datas: dia/mês/ano; períodos por extenso quando ajudam compreensão.
- Horários analíticos: exibir `America/Sao_Paulo` junto do período.
- Telefone: aceitar formatação humana, gerar destino WhatsApp com país `55`.

## Afirmações proibidas

- “Exclusivo para agências” ou qualquer mensagem que feche o ICP.
- Resultados garantidos, aumento de vendas ou ROI sem evidência.
- Depoimentos, clientes, logos ou métricas fictícias.
- Preços como compromisso antes da validação.
- Checkout próprio, custódia de Pix, CRM, IA central, app nativo ou outras funções fora do MVP.
- Chamar `Projeto LNK` de marca definitiva.
