# Termos de Uso — minuta v0.1

**Preparada em:** 09/10/2026. **Estado:** revisão jurídica pendente; não é contrato aprovado nem parecer. **Produto:** Projeto LNK (codinome). **Prestador:** [RAZÃO SOCIAL/NOME, CNPJ/CPF, ENDEREÇO E CONTATO PENDENTES]. Os campos entre colchetes exigem decisão antes da publicação e do aceite.

## 1. Serviço e contas

O Projeto LNK permite criar, editar e publicar páginas móveis com blocos, receber contatos de visitantes e acompanhar resultados aproximados. Cada página pertence a um workspace, que pode ter proprietário, administradores e editores com permissões diferentes. Quem publica deve ter autorização para agir em nome do cliente representado e para usar textos, imagens, marcas, contatos, chaves Pix e links. [VALIDAR: elegibilidade etária, representação de clientes e território da oferta.]

O usuário deve fornecer informações corretas, proteger suas credenciais e respeitar as permissões recebidas. O proprietário administra os membros da conta e o conteúdo publicado. A aplicação mantém trilha mínima de ações sensíveis para segurança e investigação.

## 2. Conteúdo e serviços externos

São proibidos phishing, fraude, personificação, malware, spam, violação de direitos, exploração de pessoas, publicação indevida de dados pessoais e conteúdo ilícito. Links, arquivos e embeds estão sujeitos às restrições técnicas do produto. Não se permite JavaScript arbitrário. [VALIDAR: categorias, gradação e reincidência da política de conteúdo.]

O dono da página responde pela oferta, atendimento, entregas e tratamento posterior dos contatos que seus visitantes lhe enviem. Pode direcionar visitantes a WhatsApp, agendas, sites de pagamento e outros serviços. O Projeto LNK não processa nem custodia o Pix exibido nas páginas. Vídeos e músicas de provedores aprovados só começam a carregar depois do clique do visitante.

## 3. Denúncias e moderação

Qualquer pessoa poderá denunciar página ou conteúdo pelo formulário público `/denunciar?pagina=<slug>`, indicando endereço, categoria e informação suficiente para apuração. Denúncias repetidas ou abusivas podem ser limitadas. O produto poderá investigar, suspender e reativar uma página, registrando motivo e responsável. Medidas urgentes podem ser tomadas diante de risco concreto. O usuário poderá pedir revisão por [CANAL PENDENTE]. [VALIDAR: critérios, aviso, contraditório, prazos, preservação mínima de provas e comunicação a autoridades.]

Ao tirar uma página do ar, o conteúdo deixa o endereço do produto após a invalidação de cache. Prévia de links ou cópias mantidas por terceiros podem persistir fora do controle do produto.

## 4. Planos e cobrança — proposta condicional

As capacidades Free, Pro e Agência têm limites de páginas, equipe, armazenamento e histórico visível dos resultados. A integração de assinatura está no código, mas `BILLING_MODE` é `off` por padrão e **não há conta Stripe real nem teste com o provedor confirmados**. Esta seção só deverá produzir efeito após revisão e ativação da venda.

**[PROPOSTA]** Antes de contratar, a interface deverá mostrar preço em BRL, periodicidade, renovação, recursos, limites e cancelamento. A cobrança ocorrerá na página do provedor, que recebe os dados do pagamento; o produto guarda apenas identificadores da assinatura, plano, valor, datas, situação e link do recibo, sem cartão. Somente o proprietário poderá contratar e mudar a assinatura. O fluxo técnico prevê aumento de plano imediato, redução e cancelamento ao fim do período já pago, e tolerância de sete dias após a primeira falha de pagamento. Redução ou cancelamento não apagam conteúdo, mas podem limitar novas criações. Cada workspace é cobrado separadamente. [VALIDAR: arrependimento e reembolso do CDC, renovação e avisos, inadimplência, contestação, documento fiscal e guarda.]

O direito legal de arrependimento e eventual estorno não se confundem com o botão técnico de cancelamento. Não ligar cobrança real antes da decisão jurídica e contábil.

## 5. Mudanças, encerramento e contato

O usuário autenticado pode consultar `/app/conta/dados` para baixar um JSON de seus dados, verificar pedidos e histórico de aceites, solicitar pacote completo e registrar pedido de exclusão da conta pessoal. O pedido de exclusão **não apaga imediatamente**. A equipe precisa verificar assinatura em curso, dados de outras pessoas em workspaces compartilhados, publicações, arquivos e obrigações de guarda antes da conclusão. O JSON da conta inclui inventário da mídia, mas não os arquivos; estes exigem pacote conferido. [VALIDAR: procedimento humano, prazo de atendimento e exceções.]

Mudanças materiais dos Termos deverão ter versão, aviso claro e novo aceite antes da continuidade do uso autenticado; o histórico do texto aceito ficará consultável em `/app/conta/dados`. A rota `/termos` mostra o texto somente quando uma versão aprovada estiver ativada; hoje mostra que o texto está em revisão. [PROPOSTA: canal e antecedência do aviso.] O serviço não promete disponibilidade ininterrupta, contagem exata de visitantes nem resultado comercial; esta frase não afasta direitos irrenunciáveis. [VALIDAR: responsabilidade, suporte, foro e solução de conflitos.]

O tratamento de dados está no [Aviso de Privacidade](./AVISO_DE_PRIVACIDADE_MINUTA.md) e na [Política de Cookies](./COOKIES_MINUTA.md). Para privacidade, denúncias, suporte e cobrança, usar [CANAIS OFICIAIS PENDENTES].

