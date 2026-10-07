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

## Mídia, aparência e novos blocos (Sprint 5)

Textos em `apps/web/src/content/pt-BR.ts`; o que o **visitante** lê fica em `apps/web/src/content/public-page.ts` (é o único arquivo de texto enviado ao navegador de quem visita).

| Elemento | Texto |
|---|---|
| Tipos de bloco novos | Imagem · Vídeo ou música · Pix · Formulário, cada um com uma frase dizendo o que faz |
| Recusa de imagem | sempre o motivo + a saída: "Esse tipo de arquivo não é aceito. Use uma imagem JPG, PNG ou WebP." · "Imagens animadas não são aceitas. Envie uma imagem estática." · "Esse arquivo é maior que 15 MB. Escolha uma imagem menor." · "Essa imagem é pequena demais. Use uma com pelo menos 200 pixels de largura e 100 de altura." · "Essa imagem é estreita ou larga demais. Recorte para uma proporção menos extrema." |
| Cota | "Sua conta chegou ao limite de espaço para imagens. Tire imagens que você não usa mais e tente de novo." |
| Aparência → Leitura | explica a cor derivada em vez de pedir uma: "O texto usa branco, escolhido automaticamente para dar contraste de 12,6:1 com o fundo." Aviso (não bloqueia) quando o botão se confunde com o fundo |
| Modelos | "Um modelo muda só a aparência. Nome, apresentação, foto e blocos continuam como estão." A confirmação lista "O que muda" e "O que não muda"; depois: "Modelo <nome> aplicado." + "Desfazer" |
| Vídeo ou música (visitante) | botão "Tocar para carregar no YouTube" + "Ao carregar, o YouTube recebe dados da sua visita." |
| Pix (visitante) | "Chave Pix (celular)" + a chave em texto · "Copiar chave" → "Chave copiada." · falha: "Não foi possível copiar. Selecione a chave e copie manualmente." · aviso fixo: "O pagamento acontece no app do seu banco. Confira o nome de quem recebe antes de confirmar." |
| Formulário (visitante) | rótulos "Nome", "E-mail", "Telefone com DDD", "Mensagem (opcional)" · sucesso: "Recebemos seus dados. Obrigado!" · erro de campo diz o que corrigir · falha: "Não foi possível enviar agora. Seus dados não foram guardados. Tente novamente." · limite: "Recebemos muitos envios em pouco tempo. Aguarde alguns minutos e tente de novo." |
| Contatos recebidos | "Dados enviados pelos formulários desta página. Cada contato fica disponível por 90 dias e depois é apagado." · vazio: "Nenhum contato recebido ainda." |

Regras: nunca prometer que o Pix foi pago ou confirmado (o produto só mostra a chave); nunca dizer "seus dados estão seguros" no formulário — dizer quem recebe e por quanto tempo; a falha de envio diz explicitamente que nada foi guardado.

## Resultados (Sprint 6)

Fonte: `ANALYTICS_COPY` em `apps/web/src/content/pt-BR.ts`. Decisões: UX-043 a UX-050 (provisórias). O coletor da página pública não tem texto nenhum: nada novo entra em `content/public-page.ts`.

| Elemento | Texto |
|---|---|
| Nome da tela | "Resultados" (nunca "analytics" ou "métricas") |
| Números | "Visitas" (com "estimativa" embaixo) · "Resultados" · "Resultados a cada 100 visitas" · "Cliques em links" |
| Linha de contexto | "De 26/09/2026 a 02/10/2026. Inclui hoje, que ainda está em andamento. Os dias seguem o horário de Brasília (America/Sao_Paulo). Atualizado em …. Os números são estimativas. Como contamos" |
| Período fora do plano | "30 dias: não disponível no plano desta conta" (texto visível, sem cadeado sozinho) |
| Ainda não disponível | "A contagem de visitas ainda não está ativa neste ambiente. Sua página pública funciona normalmente…" |
| Página não publicada | "Só uma página publicada recebe visitas. Publique a página para começar a contar." |
| Sem dados ainda | "A página está no ar, mas nenhuma visita foi registrada até agora. Compartilhe o link para começar." |
| Zero no período | "A página já teve visitas em outros períodos, mas nenhuma visita e nenhum clique neste." |
| Antes do início da contagem | "A contagem desta página começou em 02/10/2026. Antes disso não há dados, o que é diferente de zero visitas." Na tabela: "sem dado" e "Sem contagem: antes do início" |
| Consolidação atrasada | começa com "Aviso:" e diz o que fazer ("Se este aviso continuar amanhã, fale com o suporte.") |
| Bloco que saiu da página | "Link (bloco removido da página)" |
| Origens | "Direto ou sem origem", "Instagram", "WhatsApp", "Google", "Outros buscadores", "Outros sites" |
| Não identificado | país e aparelho desconhecidos aparecem como "Não identificado", nunca como código (`ZZ`, `unknown`) |

Regras:

- Nunca escrever "visitantes únicos", "pessoas" ou "usuários" para um número: só "visitas".
- Nunca escrever "taxa de conversão" nem um percentual de resultado: "resultados a cada 100 visitas".
- "Sem dados" e "zero" nunca usam a mesma frase; zero só é dito quando a contagem estava ativa.
- Não prometer exatidão: toda tela de números tem "estimativas" e o link "Como contamos".
- Em "Como contamos", dizer o que **não** é contado (quem bloqueia scripts, robôs, a própria pessoa com a conta aberta) e o que não é guardado (IP, cookies, endereço de origem completo).

## Várias páginas, membros e convites (Sprint 7)

Textos em `content/pt-BR.ts` (`APP_COPY.pages`, `APP_COPY.archive`, `APP_COPY.duplicate`, `TEAM_COPY`). Nada disto vai para `content/public-page.ts`.

| Situação | Texto | Regra |
|---|---|---|
| Uso do plano | "3 de 10 páginas" + "Páginas arquivadas contam neste total." | A segunda frase só aparece quando existe página arquivada |
| Situação da página | Rascunho · Publicada · Arquivada · "Alterações não publicadas" | Sempre em palavras, nunca só cor |
| Busca sem resultado | "Nenhuma página encontrada" + "Não há páginas com “<termo>” no nome ou no endereço." + "Limpar busca" | Limpar a busca mantém o filtro de situação |
| Arquivar página publicada | "A página sai do ar agora: quem abrir <endereço> verá “página não encontrada”." | A confirmação diz o que acontece com o endereço público; depois, o que fica guardado |
| Arquivar rascunho | "A página não está no ar, então nada muda para os visitantes." | |
| Desarquivar | "A página volta como rascunho. Ela não volta ao ar sozinha: publique de novo quando estiver pronta." | |
| Duplicar | "O que é copiado" / "O que não é copiado" antes do formulário | Listas curtas; "As duas ficam independentes: mudar uma não muda a outra." |
| Rascunho copiado | "Revise antes de publicar" + lista (Número do WhatsApp, Chave Pix, Link de pagamento do Pix, Texto de consentimento do formulário) | Some na primeira publicação; não bloqueia |
| Lugares | "4 de 5 lugares" + "Convites pendentes reservam um lugar." | "Lugar", não "assento" nem "licença" |
| Convite criado | "Convite criado. Copie o link agora: ele não será mostrado de novo." | Sempre dizer que **nós não enviamos e-mail** |
| Convite inválido | "Este convite não é válido" + "O link pode ter expirado, sido cancelado ou já ter sido usado. Peça um novo convite a quem enviou." | **Um só texto** para desconhecido, expirado, cancelado e usado. Nunca dizer qual foi |
| Convite para outro e-mail | "Este convite é para outro e-mail" | Não mostrar o nome da conta, quem convidou nem o e-mail convidado |
| Remover pessoa | "<Nome> perde o acesso a todas as páginas desta conta imediatamente. O que essa pessoa fez continua aqui." | |
| Último proprietário | "A conta precisa de pelo menos um proprietário. Torne outra pessoa proprietária antes." | |
| Recurso antes da migração | "Este recurso ainda não está disponível nesta conta. Tente novamente mais tarde." | Sem prometer data |

Vocabulário: **membros** (pessoas com acesso), **convite**, **papel** (Proprietário, Administrador, Editor), **lugar**, **arquivar/desarquivar**, **duplicar** (o resultado é uma **cópia**). "Cancelar convite", não "revogar". Sem botão de compra nem preço nas telas de limite: a cobrança é da Sprint 8.

## Resultados da conta e relatório do cliente (Sprint 7)

Textos do produto em `content/pt-BR.ts` (`WORKSPACE_ANALYTICS_COPY`, `REPORTS_COPY`); os rótulos de número vêm de `ANALYTICS_COPY`, para a mesma coisa ter o mesmo nome nas três telas. O relatório que o cliente lê fica em `content/shared-report.ts` e não usa vocabulário do produto. Nada disto vai para `content/public-page.ts`.

| Situação | Texto | Regra |
|---|---|---|
| Linha sem número | "sem dado" + a situação ("Sem dados ainda: no ar, sem nenhuma visita registrada") | Nunca 0 para o que não foi contado |
| Caso misto | "12 páginas tiveram visitas ou cliques no período; 3 não têm dados para mostrar (veja a situação de cada uma)." | Só aparece quando há página sem dados |
| Páginas omitidas | "2 páginas não aparecem nesta lista porque estão fora do ar e não tiveram visitas no período." | Diz o motivo, não só a contagem |
| Taxa | "Resultados a cada 100 visitas"; sem visitas, "—" | Nunca "taxa de conversão" nem percentual (UX-047) |
| Criar link | "Quem tiver o link vê os números sem precisar de conta, e não vê mais nada desta conta." | Dizer o alcance antes do botão |
| Link criado | "Link criado. Copie agora: por segurança, ele não será mostrado de novo." | Mesmo padrão do convite |
| Situação do link | "Ativo: funciona até <data>" · "Expirado em <data>" · "Cancelado em <data>" | Em palavras, com data |
| Cancelar link | "O link para de funcionar imediatamente. Quem abrir o endereço verá que o relatório não está disponível. Esta ação não pode ser desfeita." | "Cancelar", não "revogar" |
| Sem o recurso no plano | "Relatórios compartilháveis não estão disponíveis no plano desta conta." | Sem preço, sem botão de compra |
| Relatório: frase principal | "Neste período a página recebeu 1.240 visitas e gerou 87 resultados." | Singular e plural corretos; sem adjetivos |
| Relatório: período | "De 06/09/2026 a 05/10/2026 (30 dias completos)." | Sempre dias completos |
| Relatório: rodapé | "Relatório somente leitura. Este link funciona até 9 de novembro de 2026." | A data por extenso |
| Link que não abre | "Relatório não disponível" + "Este link não abre um relatório. Ele pode ter expirado ou sido cancelado, ou o endereço pode estar incompleto. Peça um novo link a quem enviou." | **Um só texto** para todo motivo |

Vocabulário: **resultados da conta** (o painel de todas as páginas), **relatório** (o que o cliente lê), **link de relatório**, **anotação** (o rótulo interno do link), **cancelar** um link. Para o cliente: "visitas", "resultados", "cliques"; nunca "eventos", "token", "conta de agência" ou "plano".

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
- "Pagamento confirmado", "Pix recebido" ou QR code de Pix: o bloco só mostra a chave e um link.
- Chamar `Projeto LNK` de marca definitiva.
