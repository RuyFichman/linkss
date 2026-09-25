# Plano de teste de usabilidade — Sprint 1

## Objetivo e participantes

Validar se as jornadas são compreensíveis sem instrução verbal e medir tempo até a primeira publicação.

- 5 participantes.
- Pelo menos 3 do ICP provisório de agência/social media.
- Pelo menos 1 profissional individual.
- Preferir quem usou uma ferramenta semelhante nos últimos 90 dias.

## Preparação

1. Rodar `npm run dev` e abrir `http://localhost:3000/proto`.
2. Usar janela/perfil de navegador dedicado ao teste.
3. Em `/proto`, clicar **Reiniciar protótipo** antes de cada sessão.
4. Manter o painel oculto para o participante. O facilitador abre com `Alt+Shift+D` ou adiciona `?debug=1`.
5. Conferir que erros forçados estão desligados e analytics está “Com dados”, salvo na sessão específica de estados.
6. Iniciar gravação somente após consentimento.

## Script do facilitador

> Obrigado por participar. Estamos testando a interface, não você. Algumas ações são simuladas e os dados ficam apenas neste navegador. Pense em voz alta: diga o que está procurando e o que espera que aconteça. Eu não vou explicar onde clicar, mas posso repetir a tarefa. Você pode parar a qualquer momento.

Prompts neutros permitidos:

- “O que você está pensando agora?”
- “O que esperava que acontecesse?”
- “O que faria se estivesse sozinho?”
- “Pode me dizer o que este texto significa para você?”

Não apontar elementos, definir termos ou confirmar se uma ação é correta.

## T1 — criar e publicar a própria página

> Imagine que você quer reunir seus principais caminhos online e levar visitantes a uma ação importante. Partindo desta tela, crie sua página, confira como ela ficará e publique. Quando entender que terminou, diga “terminei”.

Observar: entendimento dos cenários, campos, objetivo, template, endereço, blocos, “resultado”, estados de salvamento, preview, checklist, confirmação, URL e próximo passo.

## T2 — operação de agência

Apenas participantes que administram clientes:

> Agora imagine que o Café Ipê é um cliente da Agência Aurora. Crie uma nova página reaproveitando uma estrutura existente ou um modelo, publique e gere um link de relatório para enviar ao cliente. Abra o link como se fosse o cliente e diga o que ele entenderia.

Observar: switcher de conta, busca, escolha entre branco/modelo/duplicar, escopo da cópia, retorno ao painel, relatório, expiração e isolamento de informações.

## Teste dos estados

Após a tarefa principal, o facilitador pode abrir o painel e demonstrar um estado por vez: erro de salvamento e nova tentativa; salvamento lento; erro de publicação; analytics sem dados; analytics com zero; carregamento e erro. Perguntar “o que você faria agora?”, sem explicar a solução.

## Métricas

- Sucesso da tarefa sem ajuda verbal.
- Tempo de `session_started` até primeiro `publish_succeeded`.
- Número e tipo de erros.
- Retornos, hesitações acima de 5 segundos e termos incompreendidos.
- Confiança após publicar (escala 1–5).
- Para T2: sucesso em criar cópia independente e relatório correto.

Gate: 5/5 publicam; pelo menos 4/5 publicam em menos de 10 minutos.

## Exportar evidência

1. Abrir o painel com `Alt+Shift+D`.
2. Conferir “Tempo até publicar”.
3. Clicar **Copiar timeline em JSON**.
4. Colar o JSON no registro da sessão, sem nome/e-mail do participante.
5. Anotar observações separadamente e identificar apenas por `P01`–`P05`.

## Severidade

| Grau | Definição | Resposta |
|---|---|---|
| S0 | Cosmético; não afeta compreensão ou tarefa | Backlog futuro |
| S1 | Fricção recuperável; participante segue sozinho | Corrigir se recorrente |
| S2 | Bloqueia ou causa erro relevante em parte dos participantes | Corrigir antes da Sprint 2 se recorrente ou estrutural |
| S3 | Impede publicação, gera falsa confiança, perda de conteúdo ou risco de privacidade | Corrigir e repetir teste antes da Sprint 2 |

## Tabela de resultados

| Participante | Segmento | T1 sucesso | Tempo T1 | T2 sucesso | Erros | Hesitações | Severidade máxima | Evidência/nota |
|---|---|---|---:|---|---:|---:|---|---|
| P01 |  |  |  |  |  |  |  |  |
| P02 |  |  |  |  |  |  |  |  |
| P03 |  |  |  |  |  |  |  |  |
| P04 |  |  |  |  |  |  |  |  |
| P05 |  |  |  |  |  |  |  |  |

## Regras de decisão antes da Sprint 2

- Qualquer S3 interrompe o gate e exige correção + novo teste da tarefa afetada.
- Dois ou mais participantes bloqueados no mesmo ponto exigem mudança estrutural, não apenas microcopy.
- Se menos de 5 publicarem, revisar onboarding/editor/publicação e repetir com pelo menos as pessoas afetadas.
- Se menos de 4 concluírem em 10 minutos, localizar a etapa dominante pela timeline e remover passos ou melhorar orientação antes do schema.
- Confusão entre “salvo” e “publicado” exige mudança de hierarquia/status antes de modelar estados no banco.
- Confusão com “resultado” em 2+ sessões exige testar uma alternativa de termo no protótipo.
- Exposição percebida de dados de outros clientes no relatório é S3.
- Achados apenas visuais que não afetam tarefa podem seguir ao backlog sem bloquear Sprint 2.
