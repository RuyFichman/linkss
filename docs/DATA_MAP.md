# Mapa inicial de dados pessoais

| Categoria | Exemplos | Finalidade | Retenção inicial |
|---|---|---|---|
| Conta | e-mail, nome, identificadores de auth | acesso e comunicação operacional | vida da conta + prazo legal/segurança definido |
| Workspace | membros, papéis, convites | colaboração e autorização | vida do workspace |
| Perfil público | nome, avatar, bio, links | publicação solicitada pelo cliente | até remoção/despublicação e cache expirar |
| Leads | campos escolhidos pelo cliente | encaminhar contato ao controlador do perfil | configurável; padrão curto e exportável |
| Analytics | URL/referrer, UTM, dispositivo, região aproximada | medir desempenho | bruto 7 dias; agregados conforme plano/política |
| Cobrança | IDs do provedor, status, faturas | assinatura e obrigações legais | prazo fiscal/contratual aplicável |
| Segurança | IP truncado/hash quando necessário, logs e auditoria | fraude, abuso e incidentes | janela curta baseada em risco |
| Suporte | mensagens e anexos | atendimento | prazo publicado e minimizado |

## Regras

- Não coletar dado sem finalidade e owner.
- Não guardar cartão; usar token/ID do provedor.
- Não usar analytics do visitante para advertising por padrão.
- Separar analytics do cliente de telemetria interna.
- Permitir exportação e exclusão; registrar exceções legais.
- Formalizar controladores/operadores e transferência internacional antes do beta pago.
