# Revisão mobile do editor — 09/10/2026

## Objetivo e escopo

Melhorar a edição pelo celular, por solicitação do founder. A implementação se limita ao editor de páginas com permissão de edição. Não encerra uma sprint. A hipótese de uso majoritariamente mobile veio do founder; não é uma medição do produto.

## Decisões e implementação

- **UX-085:** em telas menores que 1024 px, edição e prévia ocupam a tela disponível. Conteúdo, Estilos, Página e Prévia ficam na navegação inferior. Substitui o painel inferior de altura fixa da UX-072 apenas no mobile.
- O formulário permanece montado ao mostrar a prévia; conteúdo ainda incompleto, posição de rolagem, seção de estilos e envio de imagem permanecem na mesma sessão. Tocar num bloco da prévia abre sua edição.
- Campos maiores, rótulos acima dos campos, controles de pelo menos 44 px, formulário com cabeçalho fixo e botão de adicionar sempre acima da navegação.
- O editor acompanha a área visível informada pelo navegador. Quando um campo está ativo e a área encolhe com o teclado, a navegação inferior dá espaço ao formulário. A rolagem acompanha o campo dentro do painel.
- Respeita as áreas seguras e redução de movimento. Não desativa zoom. Diálogos usam o formato de painel inferior somente dentro do editor mobile.
- Durante upload, navegações que desmontariam o formulário ficam indisponíveis; prévia e retorno continuam disponíveis. Falha/cancelamento liberam os controles.
- Autosave, validação, permissões e publicação usam as regras existentes. Desktop mantém edição e prévia lado a lado.

## Arquivos para revisão

- `apps/web/src/modules/editor/components/block-editor.tsx`: navegação, foco, prévia e proteção do formulário.
- `apps/web/src/modules/editor/components/studio.css`: apresentação restrita ao editor.
- `apps/web/src/modules/editor/components/use-studio-viewport.ts`: área visível, teclado e limpeza dos listeners ao sair.
- `apps/web/src/modules/editor/components/block-card.tsx`: indisponibilidade de ações que encerrariam um upload.
- `apps/web/scripts/editor-mobile.mjs`: regressão no navegador com dados sintéticos locais, removidos ao terminar.

## Verificação

Verificado em 09/10/2026 no stack local, contra o build de produção (`next start`). Última execução de `npm run check`: **exit code 0**.

| Verificação | Resultado final |
|---|---|
| `npm run lint` | Passou, sem avisos |
| `npm run typecheck` | Passou, sem erros |
| `npm run test` | 1.136 testes passaram, 39 arquivos |
| `npm run build` | Passou, 52 rotas |
| `node scripts/editor-mobile.mjs` | 43 verificações passaram; nenhum erro de runtime no navegador |
| `git diff --check` | Passou |

As verificações no Chrome headless cobrem 320×568, 390×844, 768×1024, 844×390, 1024×768 e 1440×900; área de edição, controles de toque, entrada de 16 px, ausência de overflow horizontal, adição/reordenação/exclusão/desfazer, autosave confirmado no banco, persistência após reload, prévia e retorno, edição por toque na prévia, manutenção da seção de estilos, configurações e publicação real **no banco local**.

Casos negativos conferidos: URL inválida identifica o campo e bloqueia publicação; upload em andamento impede desmontar o formulário e publicar, mas permite prévia; falha controlada no upload libera navegação e mostra erro; queda de conexão preserva o texto local e bloqueia publicação, e tentar novamente salva quando a conexão volta. A última captura de falha de salvamento foi revista visualmente e o roteiro verifica que o cabeçalho permanece compacto.

Abertura de teclado foi simulada reduzindo a área para 390×460 com um campo ativo. Capturas de conteúdo, edição, seletor, prévia, desktop e erros foram inspecionadas. Nenhum teste de acessibilidade formal, medição de performance ou sessão com usuário foi realizado. pgTAP não foi executado nesta mudança: não há alterações no banco ou em autorização.


O roteiro de navegador exige Supabase local, `apps/web/.env.local` apontando para ele, Chrome e Playwright instalado ou disponibilizado por `PLAYWRIGHT_MODULE`. Não adiciona dependência de produção. Recusa aplicação e Supabase com hostname externo. Cria uma conta exclusiva e remove somente os dados dessa conta no `finally`. Não salva nem imprime senha ou cookies.

Reprodução, na raiz:

```text
npm run check
npm run start --workspace=@lnk/web -- --port 3100
```

Em outro terminal, a partir de `apps/web`:

```text
node scripts/editor-mobile.mjs
```

Capturas locais são geradas em `apps/web/test-results/editor-mobile/` (ignorado pelo Git). Três capturas representativas, com dados fictícios, estão versionadas em [screenshots](screenshots/): [conteúdo](screenshots/mobile-editor-content.png), [edição](screenshots/mobile-editor-edit.png) e [prévia](screenshots/mobile-editor-preview.png). O upload em andamento e sua falha usam uma resposta controlada de `/api/media`; isso testa a continuidade da interface, não a integração real com Storage. A redução de viewport simula o teclado; não equivale a testar o teclado nativo.

## Limites e continuação

- Não implantado em staging ou produção.
- Falta validação em aparelhos reais: Safari/iOS, Chrome/Android, teclado, recorte e seleção de arquivos, rotação e navegadores embutidos.
- Falta teste com leitor de tela e sessões com usuários; não há evidência de redução de tempo de edição.
- Não há gestos de arrastar para reordenar, PWA, instalação ou suporte offline durável. Reordenação continua por botões; falhas de conexão mantêm o rascunho em memória e permitem tentar novamente.
- Nenhuma migração, nova coleta de dados, serviço pago ou mudança de autorização. Não se alteraram o renderer público, o coletor, o conteúdo publicado ou as demais telas.
- Reverter os arquivos de interface devolve o layout anterior sem conversão de dados. Publicação continua explícita e limitada ao rascunho confirmado pelo servidor.
