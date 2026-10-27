# Linkfav — identidade visual

Criada em 27/10/2026 a pedido do founder, a partir da referência visual enviada na conversa: símbolo de conexão, contorno escuro, azul/lilás e nome em tipografia forte. Dois elos entrelaçados representam os caminhos reunidos na página; a estrela de quatro pontas representa o favorito, “fav”. A escrita visual é `linkfav`; o nome do produto continua vindo de `PRODUCT.name` (`Linkfav`).

## Arquivos

| Uso | Arquivo |
| --- | --- |
| Logo principal, transparente e escalável | `apps/web/public/brand/linkfav-logo.svg` |
| Logo para fundo escuro | `apps/web/public/brand/linkfav-logo-white.svg` |
| Logo PNG transparente, 1758 × 432 | `apps/web/public/brand/linkfav-logo.png` |
| Símbolo SVG / PNG transparente | `apps/web/public/brand/linkfav-symbol.svg`, `linkfav-symbol.png` |
| Favicon vetorial | `apps/web/src/app/icon.svg` |
| Favicon ICO, quadros 16/32/48 px | `apps/web/src/app/favicon.ico` |
| Ícone Apple, 180 × 180 | `apps/web/src/app/apple-icon.png` |
| Ícones PNG, 192 e 512 px | `apps/web/public/brand/linkfav-icon-{192,512}.png` |
| Prancha de apresentação | `docs/ux/evidence/linkfav-brand.webp` |

Os SVGs principal e do símbolo são as fontes editáveis. A tipografia do nome foi convertida em contornos a partir da Poppins Bold, já utilizada pelo renderer. Não há fonte externa ou download adicional para desenhar a marca. Fonte: [Poppins Project Authors, SIL Open Font License 1.1](https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/OFL.txt). Os arquivos entregues são ilustrações vetoriais com contornos, não arquivos de fonte.

## Aplicação

`src/ui/brand-logo.tsx` centraliza a imagem com nome acessível vindo de `PRODUCT.name`, dimensões explícitas e proporção preservada. Aplicado no cabeçalho e rodapé da home, no cabeçalho das landings de espera, na autenticação e no painel. O aviso antigo “Nome provisório” saiu da autenticação: o nome já foi escolhido pelo founder em 10/10. Os badges textuais das páginas dos clientes e dos relatórios continuam textuais.

O Next.js descobre `icon.svg`, `favicon.ico` e `apple-icon.png` pela convenção de arquivos e gera os links de metadados. O fundo claro do favicon mantém contraste em abas claras e escuras. Nenhuma nova biblioteca, variável de ambiente, serviço ou migração.

Paleta: tinta `#1d1d28`, azul `#94d5ff`, lilás `#c9b8ff`, fundo do ícone `#f2f2fd`. Preserve a proporção e deixe uma margem livre equivalente a pelo menos metade da altura do símbolo em aplicações externas. Use a versão branca sobre fundos escuros.

Para regenerar os formatos derivados, a partir da raiz:

```sh
node apps/web/scripts/build-brand-assets.mjs
```

O script usa o `sharp` já instalado, gera PNGs e um ICO com três quadros PNG e mantém os arquivos de origem SVG. A versão branca é derivada da principal.

## Verificação

- `npm run check`: exit 0; lint sem avisos, TypeScript aprovado, 1.391 testes em 61 arquivos aprovados e build de produção Next.js 16.4.1 aprovado.
- Chromium local via Playwright, contra `next start`: home em 320, 390, 768 e 1440 px sem overflow ou sobreposição da logo com o CTA; nome acessível e link da marca conferidos; logo carregada nas rotas `/entrar`, `/cadastro`, `/agencias` e `/profissionais`. Nenhum formulário foi enviado e nenhuma sessão foi criada.
- Metadados automáticos de SVG, ICO e Apple presentes e respondendo 200; três quadros PNG do ICO decodificados com 16/32/48 px; Apple PNG com 180 × 180 px. Nenhum erro de JavaScript ou console nessa navegação.
- Prancha e cabeçalhos mobile/desktop inspecionados visualmente. Evidências em `docs/ux/evidence/linkfav-brand-qa.json`, `linkfav-brand.webp` e `linkfav-header-{320,1440}.webp`.

O painel autenticado recebeu o componente compartilhado e passou pelos checks de código, mas não foi aberto numa sessão autenticada para essa conferência. Aparelhos reais, deploy e aprovação visual do founder permanecem pendentes. Esta entrega não encerra uma sprint.
