# Aviso de Privacidade — minuta v0.1

**Preparada em:** 09/10/2026. **Estado:** revisão jurídica pendente; não é aviso aprovado nem parecer. **Responsável pelo produto:** [RAZÃO SOCIAL/NOME, CNPJ/CPF, ENDEREÇO E CANAL DE PRIVACIDADE PENDENTES]. Não há encarregado confirmado. O texto descreve o código desta branch; o ambiente hospedado pode ter outra versão.

## 1. Pessoas e papéis

O produto trata dados de cadastrados e convidados, visitantes de páginas, pessoas que enviam formulários, inscritos na lista de espera e, se a cobrança for ativada, pagadores. [FATO] Para conta, segurança e operação, o Linkfav decide finalidades e meios. [PROPOSTA A VALIDAR] Para conteúdo, formulários e métricas da página, o dono do workspace decide a finalidade e o produto atua como operador. Agência e cliente podem ter arranjos distintos; a classificação depende da operação concreta e dos contratos.

## 2. Dados e finalidades

| Contexto | Dados no produto | Finalidade e acesso |
|---|---|---|
| Conta e equipe | e-mail, nome, credenciais no Supabase Auth, papéis, convites e alterações | autenticação, autorização e segurança. O convite guarda e-mail e hash do token, não o token. |
| Página | título, bio, imagens otimizadas, textos, links, WhatsApp e chave Pix que o dono publica, em rascunho e versões | publicação e restauração. Qualquer visitante vê a versão no ar. CPF, telefone ou e-mail numa chave Pix podem tornar-se públicos por escolha do dono. |
| Formulário | nome, e-mail, telefone, mensagem e registro de consentimento quando exigido | entregar o contato ao dono da página; membros autorizados podem consultar, exportar e apagar leads. O dono responde pelo uso posterior. |
| Métricas | tipo e horário de evento, bloco, origem como categoria, UTM validada, aparelho, país e hash diário; depois totais | resultados aproximados por página. Links de relatório podem compartilhar totais com quem os possui; não revelam respostas do formulário. |
| Segurança e operação | auditoria, códigos de resultado, correlação e contadores de limite | prevenir fraude e investigar incidentes. Os logs da aplicação foram desenhados sem e-mail, token, IP completo ou conteúdo de lead; a retenção dos provedores precisa ser verificada. |
| Lista de espera | nome, e-mail, WhatsApp opcional, respostas profissionais, consentimento e origem | contato sobre pesquisa/piloto e avaliação do produto. |
| Cobrança, se ativada | IDs do cliente/assinatura no provedor, plano, valor, situação, datas, recibo | gestão da assinatura. Cartão, CPF/CNPJ e endereço de faturamento não são coletados pelo produto; o provedor pode pedi-los diretamente. |
| Denúncia pública | endereço da página, categoria, detalhes opcionais limitados e histórico da apuração | formulário em `/denunciar?pagina=<slug>`; investigar abuso e auditar decisões. Não há campo de contato do denunciante no formulário atual. [VALIDAR: retenção e revisão do processo.] |

## 3. Analytics da página pública sem cookies

[FATO, verificado em `apps/web/src/modules/analytics/collector.ts`] O coletor **não define cookie nem usa `localStorage`, `sessionStorage` ou IndexedDB**. Envia eventos por `sendBeacon` ou `fetch` sem bloquear o clique. Preview e editor não o montam; tráfego autenticado, interno e automatizado conhecido é filtrado. Sem script ou com bloqueio, a página funciona e a visita pode não ser contada.

IP e identificação do navegador são usados na requisição para classificação, limites e hashes HMAC diários por página; os valores originais não são gravados nas tabelas de analytics. O bruto é guardado por sete dias completos mais o dia em curso; agregados diários sem hash, por até 100 dias. Contagens são estimativas sujeitas a filtragem, perdas de rede e bloqueios. O produto não mostra “visitantes únicos” e não vende nem cruza esses dados para anúncios. [VALIDAR] O mapa propõe legítimo interesse do controlador da página; advogado deve analisar necessidade, expectativa, teste de balanceamento e transparência. O prazo analítico não equivale a eventual registro de acesso exigido pelo Marco Civil.

## 4. Bases legais propostas

[PROPOSTA A VALIDAR] Acesso e prestação do serviço: execução de contrato; segurança e prevenção de abuso: legítimo interesse ou obrigação aplicável; lista de espera: consentimento específico; formulário: base e aviso definidos pelo dono da página, com consentimento registrado quando sua configuração exige; métricas: legítimo interesse após teste; cobrança: contrato e obrigação fiscal que o advogado/contador identificarem. Não se presume consentimento pela navegação nem se mistura aceite de Termos com consentimento para todas as finalidades. O produto não pede dados sensíveis; o dono da página não deve coletá-los sem fundamento e salvaguardas próprios.

## 5. Destinatários e transferências

Supabase fornece Auth, Postgres e Storage; Vercel hospeda a aplicação e as páginas. Esses serviços podem envolver dados fora do Brasil: local, contrato, suboperadores e mecanismo de transferência devem ser confirmados antes da publicação. YouTube, Vimeo e Spotify só recebem a requisição de embed depois do clique do visitante. Abrir WhatsApp, agenda, site ou link de pagamento externo leva ao serviço escolhido pelo dono da página. O dono também pode compartilhar a página e links de relatório.

O código da integração Stripe existe, mas está desligado por padrão, sem conta real ou sandbox verificado. Se ativado, o nome e ID do workspace, plano e URLs de retorno são enviados; dados digitados no checkout vão diretamente ao provedor. SMTP próprio, Sentry e monitor externo constam como pendentes, **não como fornecedores já contratados**. [VALIDAR: contratos/DPA, local de processamento, mecanismo da Resolução ANPD 19/2024 e informação ao titular.]

## 6. Retenção e exclusão

| Store | Regra documentada ou situação atual |
|---|---|
| Conta, workspace e página | ciclo da conta; exclusão lógica com janela de purge de 30 dias, ainda sujeita à conclusão do fluxo da Sprint 9. Até dez versões publicadas por página. Cache próprio invalidado ao tirar do ar; caches externos não são controlados. |
| Imagens | variantes no bucket público enquanto referenciadas; órfãs entram na limpeza após 24 horas. O original e EXIF não são guardados. |
| Leads | 90 dias provisórios; há exclusão individual e CSV por membro autorizado. Conferir o purge agendado da Sprint 9. |
| Analytics | bruto: sete dias completos mais o atual; agregados: até 100 dias; hashes de limite: até dois dias. |
| Convites | até 30 dias depois do fim; purge periódico de contas sem convite novo depende da Sprint 9. |
| Links de relatório | expiram em até 90 dias; metadados por 90 dias provisórios após o fim; token só em hash. Falha de consulta: hash por até 24 horas. |
| Auditoria, endereços e logs | um ano para auditoria e reserva de endereço por 90 dias mais um ano são propostas técnicas; retenção de logs de fornecedores não confirmada. |
| Cobrança | registros locais durante a vida da conta; eventual guarda fiscal no provedor e exceção à exclusão dependem de advogado/contador. Ledger de webhook: 90 dias no desenho. |
| Lista de espera | durante pesquisa/piloto; revisão de inativos em até 12 meses, prazo final a validar. |

A tela autenticada `/app/conta/dados` oferece JSON dos dados da pessoa e, apenas para proprietários, JSON de workspaces administrados (rascunhos, publicações, leads, agregados, convites, relatórios e cobrança). O JSON contém inventário da mídia, **não os arquivos**; o pacote completo exige solicitação e conferência. A tela registra pedido de acesso ou exclusão pessoal com estado e histórico auditável. O pedido de exclusão não executa apagamento imediato: assinatura em curso, dados de terceiros em workspace compartilhado, publicações e retenções aplicáveis exigem revisão humana. Cada exceção deve ser justificada ao titular. Não anunciar exportação de mídia nem purge integral como automático ou concluído.

## 7. Direitos

Titulares podem pedir confirmação, acesso, correção, portabilidade quando aplicável, informação sobre compartilhamentos e demais medidas da LGPD, além de oposição ou revogação de consentimento quando cabível. Pedidos autenticados podem ser registrados em `/app/conta/dados`; [CANAL PARA VISITANTES SEM CONTA, PRAZO OPERACIONAL E VERIFICAÇÃO DE IDENTIDADE PENDENTES]. Sobre dado enviado a uma página, o titular pode contatar o dono; o produto deve cooperar com ele. Eventos de visitante não têm identificador que permita localizar com segurança a linha de uma pessoa; o bruto é eliminado na janela curta. Isso não significa que hashes pseudonimizados fiquem fora da LGPD.

## 8. Segurança, incidentes e mudanças

Há autenticação, permissões por workspace, RLS, validação de uploads e URLs, auditoria e limites em algumas superfícies. Controles de borda e monitoramento ainda estão em implantação. Incidentes de risco ou dano relevante serão avaliados conforme obrigação aplicável. Mudanças materiais neste aviso terão versão e data; consentimentos específicos deverão ser renovados quando necessário. A tela `/app/conta/dados` exibe o histórico de aceites. `/privacidade` ainda serve o aviso provisório; esta minuta só deverá substituí-lo após revisão e ativação aprovada.

