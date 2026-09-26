# Registro de decisões de UX

| ID | Decisão | Alternativas consideradas | Racional | Como validar | Status |
|---|---|---|---|---|---|
| UX-001 | Usar “página” na interface e “perfil” somente no domínio técnico | perfil, bio page, mini-site | Funciona para agência, creator, profissional e negócio local | Entrevistas + teste de compreensão | Provisória — founder confirmar |
| UX-002 | Chamar ação de valor de “resultado” | conversão, ação, ação de valor | Menos técnico e conecta visita a consequência compreensível | Perguntar o significado após editor e analytics | Provisória — founder confirmar |
| UX-003 | Mostrar workspace como “Pessoal” ou nome da “conta da agência” | espaço, workspace, equipe | Evita jargão mantendo o contexto explícito | T2, observando escolha da conta | Provisória — founder confirmar |
| UX-004 | Aplicar template completo apenas a página vazia; com conteúdo, trocar somente tema | mesclar seed; substituir tudo; perguntar sempre | Nunca apaga nem duplica conteúdo inesperadamente | Teste unitário + T1/T2 | Provisória — founder confirmar |
| UX-005 | Cinco templates por intenção, não por profissão rígida | galeria por nicho; um template | Mantém ICP aberto e enfatiza o próximo resultado | Entrevistas e seleção no onboarding | Provisória — founder confirmar |
| UX-006 | Ausência de resultado gera aviso, não bloqueio | bloquear; ocultar aviso | Página informativa ainda pode ser válida | Observar checklist de publicação | Provisória — founder confirmar |
| UX-007 | Free deixa 30/90 dias visíveis com explicação de limite | esconder; venda agressiva | Ensina hierarquia sem criar checkout falso | Teste de compreensão | Provisória — founder confirmar |
| UX-008 | Duplicação copia blocos/tema e exclui analytics, domínio, pixels e relatórios | cópia total; template compartilhado | Evita vazamento e conteúdo mutável compartilhado | T2 + teste de cópia profunda | Alinhada à arquitetura; founder confirmar copy |
| UX-009 | Relatório padrão usa 30 dias e expiração explícita | sem expiração; 7/90 dias | Corresponde à prestação mensal e reduz exposição | Entrevistas com agências | Provisória — founder confirmar |
| UX-010 | Protótipo persiste só em `lnk-proto:v1` no navegador | backend descartável; sem persistência | Teste realista sem antecipar schema da Sprint 2 | QA de reinício/retomada | Aceita para Sprint 1 |
| UX-011 | `Projeto LNK` vem de `PRODUCT.codename` e aparece como provisório | inventar marca; esconder identidade | Evita consolidar marca sem pesquisa | Revisão de conteúdo | Aceita para Sprint 1 |
| UX-012 | Landing neutra e variantes de agência/profissional | somente agência; somente individual | ICP permanece hipótese e viabiliza Experimento B | Conversão e qualidade por variante | Provisória — founder confirmar |
| UX-013 | Cadastro pede nome, e-mail e senha; confirmação por e-mail antes de qualquer página | login social; magic link; confirmar depois | Segurança da conta e anti-abuso; social login adiado (ADR 0005) | Funil cadastro → confirmação → primeira página | Provisória — founder confirmar |
| UX-014 | Onboarding real cria a página em rascunho com nome, endereço sugerido a partir do nome, bio opcional e iniciais no lugar do avatar; objetivo/template do protótipo ficam para o editor | reproduzir o onboarding completo do protótipo | Sem editor/templates persistidos nesta sprint; evita coletar escolhas sem uso | Tempo até a primeira página e abandono | Provisória — revisar após o teste de usabilidade |
| UX-015 | Endereço liberado fica protegido por 90 dias; só a mesma conta pode retomá-lo | liberar imediatamente; 30 dias; 1 ano | Evita sequestro/impersonação de links ainda divulgados | Tickets de suporte sobre endereço | Provisória — founder confirmar prazo |
| UX-016 | Páginas excluídas ficam 30 dias recuperáveis pelo suporte antes do purge | exclusão imediata; lixeira self-service | Protege contra erro sem criar fluxo novo | Pedidos de recuperação | Provisória — founder confirmar prazo |
| UX-017 | Editor não cria páginas nem troca endereço; edita conteúdo e (Sprint 3) publica | editor com criação; papel único | Página consome entitlement pago; troca de endereço quebra links públicos | Entrevistas com agências (T2) | Provisória — founder confirmar |
| UX-018 | Uma pessoa pode ter até 3 contas de agência ativas | ilimitado; 1 | Sem limite, contas Free multiplicariam páginas gratuitas | Revisar com a cobrança (Sprint 8) | Provisória — founder confirmar |
| UX-019 | Páginas arquivadas contam no limite do plano | não contar arquivadas | Impede burlar o limite arquivando/desarquivando | Revisar com o fluxo de arquivamento (Sprint 7) | Provisória — founder confirmar |
| UX-020 | Durante os 90 dias de retenção, o endereço antigo redireciona (307) para o novo enquanto a página estiver publicada | 404 imediato; página "endereço mudou" | Mantém funcionando os links já divulgados em bios e cartões | Tickets de "link quebrado" após troca de endereço | Provisória — founder confirmar |
| UX-021 | Página não publicada responde o mesmo 404 de endereço inexistente | mensagem "ainda não publicada" | Não revela que um rascunho existe; status HTTP correto | Dúvidas de clientes que compartilham antes de publicar | Provisória — founder confirmar |
| UX-022 | Página de workspace suspenso mostra "Página indisponível", sem motivo | 404; mensagem com o motivo | Informa o visitante sem expor processo de moderação | Revisar com a política de moderação (Sprint 9) | Provisória — founder confirmar |
| UX-023 | Publicar é explícito; rollback restaura uma das 10 últimas versões sem alterar o rascunho; "Tirar do ar" mantém as versões | publicação automática; rollback que sobrescreve o rascunho | Segurança do que vai ao ar e recuperação rápida de erro | Observar uso de restaurar/tirar do ar no piloto | Provisória — founder confirmar |
| UX-024 | Links e redes sociais editados em formulários simples nas configurações da página (adicionar, editar, remover, ordenar; redes aceitam @usuário) até o editor da Sprint 4 | antecipar o editor de blocos | Permite a primeira página real sem puxar o escopo da Sprint 4 | Substituído pelo editor na Sprint 4 | Aceita para a Sprint 3 |
| UX-025 | Selo "Criado com Projeto LNK" no rodapé de planos sem `remove_badge` | sem selo | Aquisição orgânica; resolvido pelo entitlement, sem nome de plano | Cliques no selo (analytics da Sprint 6) | Provisória — founder confirmar |

## Gate de usabilidade da Sprint 1 → Sprint 2

- **Decisão:** (b) *founder override* — iniciar a Sprint 2 antes do teste com cinco pessoas.
- **Data e autor:** 25/09/2026, founder.
- **Motivo:** construir a fundação de identidade/tenancy agora e executar as sessões de usabilidade depois.
- **Risco aceito:** achados estruturais do teste podem exigir retrabalho em onboarding e vocabulário. Mitigação aplicada: textos e ordem do onboarding isolados em `apps/web/src/content/pt-BR.ts` e componentes de apresentação; banco com vocabulário neutro (`workspace`, `profile`, `membership`), independente de UX-001 a UX-003.
- **UX_DECISIONS confirmadas/alteradas pelo founder:** nenhuma até o momento.

Depois dos cinco testes, atualizar o status e anexar evidência resumida; preferência interna nunca vira decisão “validada” sem dados.
