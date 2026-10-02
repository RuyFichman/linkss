# Runbook — formulários e contatos recebidos (leads)

**Owner:** founder técnico. **Ferramentas:** logs filtrados por `event` (`lead.submit`, `lead.delete`, `lead.export`); tabelas `form_leads`, `form_submission_hits`, `audit_events` (`lead.deleted`, `lead.exported`); `docs/adr/0010-themes-templates-and-new-blocks.md`.

Regras gerais:

- Leads são dados pessoais de **visitantes**; o dono da página é o controlador. Nunca copiar nome, e-mail, telefone ou mensagem para ticket, log ou chat: use o id do lead e o id da página.
- Nunca ler `form_leads` com a chave secreta para "ajudar" um cliente a ver contatos de uma conta à qual ele não tem acesso.
- Os logs não carregam o conteúdo do envio, só o resultado.

## 1. "Os contatos não estão chegando"

1. **A página foi publicada depois de adicionar o formulário?** O envio só é aceito para um formulário que está na versão **no ar**. Formulário só no rascunho, oculto, removido ou de página fora do ar responde "Este formulário não está disponível agora" (`unavailable`).
2. **Onde o cliente está olhando?** Os contatos ficam em "Contatos recebidos" dentro da página (`/app/w/<conta>/paginas/<página>/contatos`). **Não há aviso por e-mail** nesta versão.
3. Procure `lead.submit` no período:
   - `ok` sem lead na lista: envio repetido idêntico em 10 minutos (gravado uma vez), honeypot preenchido (resposta de sucesso, nada gravado — é o esperado para robôs), ou lead com mais de 90 dias (já expirou).
   - `invalid` / `consent_required`: o visitante viu o erro no campo e não corrigiu. Muitos `consent_required` indicam um texto de consentimento que afasta as pessoas; vale conversar com o cliente.
   - `rate_limited`: ver §2.
   - `unavailable` em várias páginas: banco fora ou função recusando. Veja `/api/health` e o status do Supabase. Acima de 2% em 15 min é P1: clientes estão perdendo contatos e o visitante vê "Não foi possível enviar agora. Seus dados não foram guardados."
4. Sem nenhum `lead.submit`: o envio não chegou ao servidor. Teste a página publicada num celular; o formulário funciona sem JavaScript, então um bloqueador não deveria impedir.
5. `hashed=false` nos logs em produção: `VISITOR_HASH_SALT` ausente ou o proxy não está passando o IP. Os envios continuam aceitos, mas só com o limite por página.

## 2. Spam ou flood num formulário

1. Defesas atuais: campo-isca (honeypot), 5 envios por visitante por página a cada 10 minutos, 60 envios por página por hora, repetição idêntica gravada uma vez, corpo de até 4 KiB. **Não há CAPTCHA** nem limite global por IP (Sprint 9).
2. Sinal: `lead.submit` com `rate_limited` em alta, ou o cliente reclamando de contatos falsos.
3. Enquanto o limite por página está estourado, **visitantes legítimos também são recusados** (até 60 por hora). Avise o cliente.
4. Contenção imediata, pelo cliente: ocultar o bloco de formulário e publicar (o envio passa a responder "indisponível").
5. O cliente apaga os contatos falsos um a um em "Contatos recebidos" (cada exclusão gera `lead.deleted`). Não há exclusão em massa na interface; se forem centenas, registre o pedido e avalie uma limpeza por SQL com aprovação do founder, anotando a contagem no ticket.
6. Se o ataque vier de muitas origens e persistir, registre para a Sprint 9 (CAPTCHA no formulário e firewall).

## 3. Pedido de um visitante para apagar ou acessar seus dados

1. O controlador é o dono da página: encaminhe o pedido a ele e registre data e página.
2. O dono apaga o contato em "Contatos recebidos" (papel owner ou admin). A exclusão é definitiva e auditada (sem o conteúdo).
3. Sem ação, o lead expira em 90 dias: some da leitura no mesmo instante e é apagado no envio seguinte à página (ou pelo purge, ainda não agendado).
4. Exportações já feitas (CSV) estão fora do nosso alcance: lembre o dono de que a cópia dele também precisa ser tratada. `audit_events` mostra quem exportou e quando.

## 4. "Não consigo exportar / excluir contatos"

Exportar e excluir exigem papel **owner ou admin**; o papel editor só lê. `lead.export` / `lead.delete` com `forbidden` confirmam. A lista mostra os 100 contatos mais recentes; a exportação traz até os 5.000 mais recentes da página.

## 5. Suspeita de acesso indevido a leads

1. `audit_events` com `lead.exported` e `lead.deleted` mostram ator, página, contagem e horário.
2. Confira os membros do workspace no período. Leitura simples da lista não é auditada.
3. Se confirmar acesso por pessoa não autorizada: `INCIDENT.md` (P0, dados pessoais de terceiros) e avaliação de comunicação ao controlador.
