# Design tokens mínimos

## Separação de camadas

Os tokens `--app-*` controlam navegação, editor, formulários e feedback do produto. Os tokens `--page-*` e `--btn-*` pertencem exclusivamente à página pública customizável. O renderer `BioPage` não deve depender de tokens do app.

## Escalas

- **Cores de app:** `bg`, `surface`, `surface-soft`, `text`, `muted`, `border`, `accent`, `success`, `warning`, `danger`, `focus`.
- **Tipografia:** 12, 14, 16, 18, 20, 24, 30 e 36 px; pesos 400, 700 e 800.
- **Espaçamento:** 4, 8, 12, 16, 20, 24, 32 e 40 px.
- **Raios:** controles 12 px, cards 16 px, painéis 24 px.
- **Sombras:** `soft` para cards e `raised` para dialogs/toasts.
- **Movimento:** 120 ms para interação, 200 ms para transições; easing `cubic-bezier(0.2, 0.8, 0.2, 1)`; `prefers-reduced-motion` reduz tudo a 0,01 ms.

## Contraste medido

Razões calculadas em sRGB segundo WCAG 2.x e arredondadas a duas casas.

| Uso | Frente | Fundo | Razão | Resultado |
|---|---|---|---:|---|
| Texto principal | `#171A22` | `#FFFFFF` | 17,39:1 | AAA |
| Texto secundário | `#596171` | `#FFFFFF` | 6,23:1 | AA |
| Botão primário | `#FFFFFF` | `#3156D3` | 6,17:1 | AA |
| Botão hover | `#FFFFFF` | `#2442AA` | 8,63:1 | AAA |
| Sucesso | `#176B45` | `#E8F6EF` | 5,85:1 | AA |
| Aviso | `#8A4B08` | `#FFF4DF` | 6,23:1 | AA |
| Perigo | `#B42318` | `#FFF0EE` | 5,93:1 | AA |
| Tema padrão texto | `#231F1A` | `#F5EFE5` | 14,32:1 | AAA |
| Tema padrão botão | `#FFFFFF` | `#1F5B49` | 7,92:1 | AAA |

### Contraste dos cinco templates

| Template | Texto/fundo | Secundário/fundo | CTA | Menor resultado |
|---|---:|---:|---:|---|
| Negócio local | 14,32:1 | 6,23:1 | 7,92:1 | AA |
| Criador | 17,93:1 | 11,66:1 | 11,41:1 | AAA |
| Profissional | 12,00:1 | 5,67:1 | 7,54:1 | AA |
| Loja | 14,78:1 | 6,38:1 | 4,86:1 | AA |
| Evento | 19,11:1 | 11,25:1 | 5,74:1 | AA |

A Sprint 5 deverá validar combinações livres escolhidas pelo usuário ou ajustar automaticamente o texto.

## Estados de componentes

- **Default:** contraste e borda visíveis.
- **Hover:** mudança de cor/borda e deslocamento de 1 px quando permitido.
- **Focus-visible:** anel roxo de 3 px com offset de 3 px, independente da cor do componente.
- **Active:** remove deslocamento.
- **Disabled:** opacidade de 55%, cursor bloqueado, atributo nativo `disabled`.
- **Loading:** controle desativado com `aria-busy` e rótulo “Aguarde…”.
- **Error:** borda e texto de perigo; mensagem ligada por `aria-describedby`.
- **Success:** badge e região de status com texto, nunca somente cor.

A referência visual executável está em `/proto/tokens`. Dark mode não faz parte da Sprint 1.
