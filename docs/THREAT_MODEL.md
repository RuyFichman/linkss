# Modelo inicial de ameaças

| Ativo/fluxo | Ameaça | Controle inicial |
|---|---|---|
| Workspaces | acesso entre tenants | RLS, autorização servidor e testes negativos |
| Conta | credential stuffing e enumeração | rate limit, respostas neutras, verificação e MFA futuro |
| Slugs/domínios | sequestro e impersonação | unicidade, prova DNS, histórico e auditoria |
| Editor/embeds | XSS e URL perigosa | allowlist, sanitização e CSP |
| Upload | malware, bomba e custo abusivo | MIME real, tamanho, dimensões, quota e processamento isolado |
| Formulário | spam e coleta indevida | rate limit, honeypot/CAPTCHA adaptativo e consentimento |
| Analytics | fraude, replay e DDoS de eventos | assinatura/contexto, deduplicação, rate limit e filtros |
| Webhooks | spoofing e duplicação | validação de assinatura, timestamp e idempotência |
| Página pública | phishing/conteúdo ilícito | denúncia, moderação, suspensão e resposta rápida |
| Secrets | exposição no bundle/log | separação publicável/secret, redaction e rotação |
| Exclusão | dados órfãos | inventário de stores, job auditável e retenção definida |

## Requisitos antes do MVP privado

- headers de segurança e CSP;
- RLS em todas as tabelas expostas;
- testes de isolamento por workspace;
- rate limits para auth, formulário, upload e ingestão;
- trilha para publicação, domínio, papéis e suspensão;
- backup e restauração testados;
- processo de denúncia e contato de segurança.
