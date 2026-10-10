# Cookies e tecnologias semelhantes — minuta v0.1

**Preparada em:** 09/10/2026. **Estado:** revisão jurídica pendente; não publicada como política final. Escopo: código desta branch. Verificar tráfego do ambiente hospedado antes da publicação.

| Contexto | Tecnologia observada | Finalidade | Validade / escolha |
|---|---|---|---|
| Área autenticada | Cookies de sessão do Supabase Auth via cliente SSR | entrar, manter e renovar a sessão | necessários para a conta; nomes e duração reais devem ser conferidos na configuração hospedada |
| Convite após cadastro | `lnk_after_confirm`, `HttpOnly`, `SameSite=Lax`, caminho `/auth` | retornar ao convite após a confirmação do e-mail no mesmo aparelho | até uma hora; não serve à publicidade |
| Página pública | Coletor de eventos sem cookie, `localStorage`, `sessionStorage` ou IndexedDB | estimar visitas, cliques e ações | a página funciona sem ele |
| Protótipo `/proto` | `localStorage` no navegador | guardar estado da demonstração | rota de protótipo; avaliar remoção/acesso antes do piloto |
| Vídeo/música | Conexão direta a YouTube, Vimeo ou Spotify só após clique | carregar conteúdo solicitado | após o clique, o terceiro pode usar suas tecnologias sob regras próprias |
| Checkout, se habilitado | Redirecionamento ao provedor | pagamento e prevenção de fraude | a Stripe pode usar suas tecnologias; checkout real não está confirmado |

O analytics verificado do Projeto LNK **não usa cookies**. Não se deve publicar banner que diga o contrário. A ausência de cookie não encerra a análise: hashes diários de IP e navegador são tratados no servidor. [VALIDAR] Base legal, transparência e eventual oposição às métricas com advogado.

Apagar os cookies de autenticação no navegador encerra ou interrompe a sessão. Bloquear JavaScript ou a requisição de eventos na página pública não impede a navegação, mas pode impedir a contagem. O carregamento de embeds é iniciado pelo visitante; depois disso o provedor externo determina seu tratamento.

Antes de publicar esta política, registrar em Chrome, Edge e Safari móvel ou equivalente os cookies efetivamente inseridos por hospedagem, Auth, antispam e terceiros após clique, com nome, origem, finalidade e duração. Pixels e tags de marketing **não estão implementados nesta branch**; antes de acrescentá-los, atualizar este texto e avaliar consentimento e controles.

A rota `/cookies` existe para mostrar a versão ativada do documento. Enquanto não houver texto aprovado e ativado, informa que a revisão jurídica está pendente; esta minuta não é apresentada ali como política final.

