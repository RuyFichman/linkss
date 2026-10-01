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

## Autenticação e onboarding (Sprint 2)

Fonte: `AUTH_COPY` e `APP_COPY` em `apps/web/src/content/pt-BR.ts`. O schema usa termos neutros (`workspace`, `profile`, `membership`); trocar termos da interface após o teste de usabilidade não exige migração.

| Momento | Texto |
|---|---|
| Cadastro — título | “Crie seu acesso” |
| Cadastro concluído (e-mail novo **ou** já existente) | “Se este e-mail puder ser usado, enviamos um link de confirmação. Ele expira em 1 hora. Confira também a caixa de spam.” |
| Login inválido (e-mail inexistente **ou** senha errada) | “E-mail ou senha incorretos.” |
| E-mail não confirmado (só com senha correta) | “Confirme seu e-mail para entrar. Se o link expirou, peça um novo abaixo.” |
| Recuperação (conta existente **ou** não) | “Se existir uma conta com este e-mail, enviamos um link para redefinir a senha. Ele expira em 1 hora.” |
| Link expirado/reusado | “Link expirado ou inválido” + “Este link expirou ou já foi usado. Peça um novo para continuar.” |
| Senha — dica | “Pelo menos 8 caracteres, com letras e números.” |
| Muitas tentativas | “Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.” |
| Serviço indisponível | “Não foi possível falar com o serviço de acesso agora. Tente novamente em instantes.” |
| Onboarding | “Crie sua primeira página” / “Comece pelo básico. Você poderá editar tudo depois.” |
| Endereço disponível | “Ótimo — {endereço} está disponível.” |
| Endereço protegido (retenção) | “Este endereço foi usado recentemente e ainda está protegido. Tente outra variação.” |
| Limite do plano | “Esta conta já usa sua página disponível no plano atual. Para criar outra, exclua uma página existente.” |
| Troca de endereço — aviso | “O endereço atual deixará de funcionar. Quem tiver o link antigo não encontrará sua página. O endereço antigo fica protegido para esta conta por 90 dias.” |
| Exclusão — aviso | “A página sai da sua lista e o endereço deixa de funcionar. Os dados ficam guardados por 30 dias para recuperação pelo suporte e depois são apagados.” |
| Sem acesso / inexistente | “Não encontramos este item ou você não tem acesso a ele.” (mesma resposta para ambos) |

Papéis na interface: **Proprietário** (owner), **Administrador** (admin), **Editor** (editor). O workspace pessoal aparece sempre como **Pessoal**, independentemente do nome salvo.

## Editor por blocos (Sprint 4)

Fonte: `BLOCKS_COPY` e `EDITOR_COPY` em `apps/web/src/content/pt-BR.ts`. Decisões: UX-026 a UX-032 (provisórias).

| Elemento | Texto |
|---|---|
| Tipos de bloco | Link · Texto · Redes sociais · WhatsApp · Separador, cada um com uma frase dizendo o que faz |
| Nome do bloco para leitores de tela | "bloco 3, WhatsApp" (posição + tipo), usado em "Mover … para cima", "Duplicar …", "Excluir …" |
| Selos no cartão | "Oculto: não aparece na página" · "Precisa de ajuste" (sempre em texto, nunca só cor) |
| Status do salvamento | "Salvo" · "Salvando…" · "Alterações não salvas" · "Não salvo: corrija os campos destacados." · "Sem resposta do servidor. Tentando salvar de novo…" · "Não foi possível salvar." + motivo + "Tentar novamente" · "Não salvo: a página mudou em outro lugar." |
| Publicar bloqueado | "Aguarde salvar para publicar." · "Corrija os blocos destacados para publicar." · "Resolva o conflito para publicar." · "Salve as alterações para publicar." |
| Link recusado | dizer o motivo: "Esse tipo de link não é permitido. Use um site (https://), e-mail (mailto:) ou telefone (tel:)." · "Informe o endereço completo, por exemplo exemplo.com.br." · "Links com usuário ou senha no endereço não são permitidos." · "Confira o endereço: falta o domínio (como .com ou .com.br)." |
| Aviso (não bloqueia) | "Este site não usa conexão segura (https). Se ele tiver versão https, prefira-a." |
| WhatsApp | "Informe um número válido com DDD, ex.: (11) 91234-5678. Para outro país, comece com +." |
| Desfazer | "Bloco excluído." + "Desfazer" |
| Conflito | título "Esta página foi alterada em outro lugar"; ações "Carregar a versão mais recente" / "Manter as minhas alterações", cada uma com confirmação que diz o que será perdido |
| Prévia | "Prévia do rascunho. Os links não funcionam aqui." |

Regra: erro de campo diz o que corrigir; status nunca diz "Salvo" antes da confirmação do servidor.

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
