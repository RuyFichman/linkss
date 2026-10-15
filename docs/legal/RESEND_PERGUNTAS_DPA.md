# Resend — perguntas para o advogado sobre contrato e DPA

**Preparado em:** 15/10/2026. **Estado:** pauta para revisão jurídica; não é parecer nem resumo do contrato da Resend, que ainda não foi lido nem assinado.

**Contexto (fatos do repositório):** a Resend envia todos os e-mails do Linkfav desde 14/10/2026 (ADR 0021; `docs/DATA_MAP.md`, seção "E-mail transacional"; `docs/runbooks/MAIL.md`). Ela recebe endereço e nome de quem tem conta, assunto e texto dos avisos (título e endereço da página, categoria de suspensão, resposta da moderação a uma contestação, plano, datas e valor) e, nos e-mails de conta, links de uso único. Nunca recebe o que um visitante escreveu num formulário. Domínio `linkfav.com` configurado na região de São Paulo, sem rastreamento de cliques ou abertura. A empresa é dos Estados Unidos. Até haver contrato, o envio deve ficar restrito aos endereços do founder; o SMTP do Supabase já passa pela Resend, então qualquer cadastro novo também passa.

## Perguntas

1. **Aceite e partes.** O DPA da Resend vale só por aceite eletrônico dos termos no plano atual, ou precisa ser assinado à parte? Quem figura como contratante enquanto não há razão social definida?
2. **Papéis.** A Resend é operadora do Linkfav em todos os e-mails? No aviso de novo contato, que trata de dado controlado pelo dono da página, ela passa a suboperadora — e o contrato com o cliente do Linkfav precisa autorizar isso?
3. **Transferência internacional.** O DPA contém cláusulas compatíveis com a Resolução CD/ANPD 19/2024, ou só SCC europeias/DPF americano? Se só estes, basta anexar as cláusulas-padrão da ANPD sem alteração? Qual o prazo de adequação aplicável?
4. **Localização.** A "região de São Paulo" cobre só o envio, ou também armazenamento de mensagens, registros, painel, backups e suporte? O aviso de privacidade pode dizer algo além de "Estados Unidos"?
5. **Suboperadores.** Onde está a lista (por exemplo, a infraestrutura em nuvem usada), como somos avisados de mudanças e há direito de objeção?
6. **Retenção e exclusão.** Por quanto tempo a Resend guarda corpo das mensagens, endereços e registros de entrega? Dá para encurtar ou apagar sob pedido? Como responder a um titular que pediu exclusão da conta (hoje anotamos que o que está na Resend segue a retenção dela)?
7. **Incidentes.** Prazo e conteúdo da notificação de incidente pela Resend são suficientes para cumprirmos a comunicação à ANPD e aos titulares?
8. **Uso próprio dos dados.** O contrato proíbe a Resend de usar endereços e conteúdo para finalidades próprias (marketing, treino de modelos, estatística além do necessário ao serviço)? Supressão e listas de bloqueio dela tratam endereços como dado próprio?
9. **Auditoria e segurança.** Que evidência basta (relatório SOC 2, questionário) no lugar de auditoria presencial?
10. **Responsabilidade e saída.** Limite de responsabilidade, lei e foro aplicáveis, e o que acontece com os dados se trocarmos de fornecedor ou a conta for encerrada.
11. **Texto ao titular.** A seção 5 de `AVISO_DE_PRIVACIDADE_MINUTA.md` (v0.2) descreve a Resend de forma suficiente e correta? Falta algo exigido pelo art. 9º da LGPD ou pela Resolução 19/2024?
12. **Liberar o envio.** O que precisa estar pronto, no mínimo, para mandar e-mail a pessoas de fora (piloto privado): contrato assinado, aviso publicado, ambos?
