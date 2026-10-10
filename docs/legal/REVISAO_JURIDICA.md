# Pauta de revisão jurídica — Sprint 9

**Fontes oficiais consultadas em 09/10/2026.** Este registro contém premissas e questões, não um parecer. As minutas em `docs/legal/` não devem substituir o aviso provisório em produção nem receber aceite como textos finais antes da revisão do advogado.

## Premissas verificadas

- O nome do produto é Linkfav e o domínio escolhido é `linkfav.com` (decisão do fundador em 10/10/2026; disponibilidade e registro da marca não foram verificados). Razão social, endereço, canal de privacidade e encarregado não foram definidos.
- `modules/analytics/collector.ts` não grava cookie ou armazenamento local. Usa `sendBeacon`/`fetch` e hashes diários no servidor. Supabase Auth usa cookies de sessão; `lnk_after_confirm` dura até uma hora. O protótipo usa `localStorage`.
- O código de billing existe, mas `BILLING_MODE=off` é o padrão. ADR 0014 e `docs/ENVIRONMENTS.md` registram ausência de conta Stripe e de teste real com o provedor. Domínio próprio e pixels não estão implantados nesta branch.
- Supabase, Vercel e embeds de YouTube/Vimeo/Spotify constam do código/desenho. SMTP próprio, Sentry e monitor externo estão pendentes. Stripe só recebe dados quando a cobrança é ligada. O mapa de dados contém retenções provisórias. Na Sprint 9, `/denunciar?pagina=<slug>` recebe denúncias; `/app/conta/dados` oferece JSON, pedidos e histórico; `/termos` e `/cookies` só mostram texto quando aprovado e ativado; `/privacidade` ainda traz o aviso provisório. O JSON contém inventário de mídia, mas o pacote de arquivos depende de solicitação e conferência. Os testes de banco da Sprint 9 passaram no stack local em 09/10/2026; expurgos agendados e a execução da exclusão não existem.

## Questões para advogado e fundador

1. Identificar prestador, endereço e canais de privacidade, suporte, denúncia, revisão de moderação e cobrança; avaliar indicação ou dispensa de encarregado conforme enquadramento real.
2. Classificar controlador e operador por operação (conta, convites, conteúdo, leads, métricas, denúncias, cobrança), inclusive agência–cliente; decidir DPA e instruções ao operador.
3. Validar a base legal e eventual teste de legítimo interesse para analytics sem cookies, hashes, segurança e convites; definir transparência e oposição. Conferir consentimento de formulários por finalidade do dono.
4. Avaliar aplicação do Marco Civil, art. 15, ao prestador real e qual store atenderia eventual registro de acesso. A retenção analítica de sete dias **não substitui** eventual obrigação distinta de seis meses. **Pendência de lançamento:** advogado avaliar aplicabilidade e, se aplicável, operação implementar store segregado, retenção, acesso, segurança e expurgo antes de convidar usuários externos.
5. Aprovar ou corrigir cada retenção provisória: conta/purge de 30 dias; lead 90; analytics bruto 7 e agregados 100; convites 30; relatórios 90 após fim; auditoria um ano; slug hold + um ano; lista de espera até 12 meses; logs e denúncias. Prazo fiscal depende também do contador.
6. Confirmar subprocessadores contratados, localização, DPA e mecanismo de transferência internacional para Supabase, Vercel, eventual Stripe e fornecedores futuros. Revisar comunicação sobre terceiros que recebem dados após o clique em embed.
7. Definir regras de conteúdo, procedimento de denúncia, urgência, suspensão, reativação, aviso, contestação e preservação mínima de prova; revisar a relação com o Marco Civil, arts. 19 e 20, sem presumir dever de remoção ou imunidade genérica.
8. Para venda futura: aplicar CDC art. 49 à assinatura online com acesso imediato; definir arrependimento/reembolso, renovação automática, aviso, cancelamento, inadimplência, chargeback, tolerância de sete dias, documento fiscal e guarda. Não ligar `BILLING_MODE=live` até concluir.
9. Definir mudanças materiais que exigem novo aceite, prova do texto exato, histórico consultável e efeito da recusa. Não misturar aceite dos Termos com consentimento para tratamentos independentes.
10. Revisar política de cookies depois de captura de rede do ambiente com Auth, CAPTCHA e provedores após clique; avaliar pixels antes de implementá-los.
11. Aprovar atendimento dos direitos dos titulares, verificação de identidade, dados de terceiros em workspaces compartilhados, leads controlados pelo cliente e exceções documentadas de exclusão.

## Fontes oficiais

- [Lei 13.709/2018, LGPD, texto compilado — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm): princípios, bases, direitos, agentes, segurança, retenção e transferências.
- [Lei 12.965/2014, Marco Civil — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm): especialmente arts. 15 e 16; aplicação concreta pendente.
- [Decreto 7.962/2013, comércio eletrônico — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm): informação do fornecedor, atendimento e arrependimento nas ofertas online.
- [Lei 8.078/1990, CDC, texto compilado — Planalto](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm): informação ao consumidor e art. 49.
- [Guia Cookies e Proteção de Dados Pessoais — ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/processo-guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf): transparência, finalidade, bases e escolha; orientativo.
- [Guia para definição dos agentes e encarregado — ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-para-definicoes-dos-agentes-de-tratamento-de-dados-pessoais-e-do-encarregado): papéis analisados por operação.
- [Guia de Legítimo Interesse — ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse): modelo de teste de finalidade, necessidade, balanceamento e salvaguardas.
- [Resolução CD/ANPD 2/2022 — ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022): eventual dispensa de encarregado para agentes de pequeno porte não elimina o dever de canal de comunicação.
- [Direitos dos titulares — ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados): atendimento e papéis.
- [Resolução CD/ANPD 19/2024 — ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024): transferência internacional e cláusulas padrão.
- [Comunicação de incidente de segurança — ANPD](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis): dever de comunicação de incidente de risco ou dano relevante.




