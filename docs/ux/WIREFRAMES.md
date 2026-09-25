# Wireframes de baixa fidelidade

Produzidos antes da interface de alta fidelidade. `[*]` indica ação primária; `[estado]` indica onde variações obrigatórias aparecem.

## 1. Índice e seleção de cenário

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌────────────────────────────────────────────────────┐
│ Protótipo           reset│       │ Protótipo                              Reiniciar    │
│                          │       │                                                    │
│ Escolha um cenário       │       │  Escolha um cenário                               │
│ ┌──────────────────────┐ │       │  ┌──────────────────┐ ┌────────────────────────┐  │
│ │ Novo usuário         │ │       │  │ Novo usuário    │ │ Agência com 3 clientes│  │
│ │ do zero até publicar│ │       │  │ Jornada J1       │ │ Jornada J2             │  │
│ │ [* Começar]          │ │       │  │ [* Começar]      │ │ [Abrir painel]         │  │
│ └──────────────────────┘ │       │  └──────────────────┘ └────────────────────────┘  │
│ ┌──────────────────────┐ │       │                                                    │
│ │ Agência com 3 clientes││       │  [estado: confirmação do cenário / dados locais]  │
│ │ [Abrir painel]       │ │       └────────────────────────────────────────────────────┘
│ └──────────────────────┘ │
└──────────────────────────┘
```

Hierarquia: cenário → propósito → ação. No mobile os cards empilham; no desktop ficam lado a lado.

## 2. Cadastro

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌────────────────────┬───────────────────────────────┐
│ ← Voltar                 │       │ Promessa: publique │ Criar seu acesso              │
│ Crie seu acesso          │       │ em menos de 10 min │ Nome [________________]       │
│ Nome [_______________]   │       │                    │ E-mail [_______________]      │
│ E-mail [_____________]   │       │                    │ Senha [________________]      │
│ Senha [______________]   │       │                    │ [erro inline + solução]       │
│ [erro inline + solução]  │       │                    │ [* Continuar] [carregando]   │
│ [* Continuar]            │       └────────────────────┴───────────────────────────────┘
│ [carregando/erro geral]  │
└──────────────────────────┘
```

Cada erro fica junto do campo e é anunciado. O erro geral usa resposta neutra. A ação primária ocupa a largura no mobile.

## 3. Onboarding: objetivo, template e endereço

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌───────────────┬────────────────────────────────────┐
│ Etapa 1 de 3             │       │ 1 Objetivo    │ O que sua página deve gerar?       │
│ O que deseja gerar?      │       │ 2 Modelo      │ ( ) Conversas no WhatsApp         │
│ ( ) WhatsApp             │       │ 3 Endereço    │ ( ) Contatos  ( ) Agendamentos   │
│ ( ) Contatos             │       │               │                                    │
│ ( ) Conteúdo             │       │               │ Sugestões de modelo               │
│ ( ) Agendamentos         │       │               │ [card] [card] [card]              │
│                          │       │               │                                    │
│ Modelo sugerido [card]   │       │               │ projeto.test/ [endereço____]       │
│ Endereço [___________]   │       │               │ [disponível/reservado/inválido]    │
│ [validação ao vivo]      │       │               │ [* Abrir editor]                  │
│ [* Abrir editor]         │       └───────────────┴────────────────────────────────────┘
└──────────────────────────┘
```

No mobile as etapas são uma sequência vertical curta; no desktop a navegação lateral mantém o contexto. O status do endereço sempre inclui próximo passo.

## 4. Editor

```text
MOBILE ~390                         DESKTOP ≥1280
┌──────────────────────────┐       ┌──────────────────────┬────────────────┬─────────────┐
│ Página • Rascunho        │       │ Blocos               │ Preview        │ Tema        │
│ [Editar] [Visualizar]    │       │ [+ Adicionar bloco]  │ ┌────────────┐ │ Modelos     │
│                          │       │ ┌──────────────────┐ │ │  Página    │ │ Cor [■]     │
│ [+ Adicionar bloco]      │       │ │ WhatsApp [edita]│ │ │ [CTA]      │ │ Fonte       │
│ ┌──────────────────────┐ │       │ │ ↑ ↓ duplicar    │ │ │ [CTA]      │ │ Botão       │
│ │ WhatsApp             │ │       │ │ ocultar excluir │ │ │            │ │ Fundo       │
│ │ [campos]             │ │       │ └──────────────────┘ │ └────────────┘ │ “não apaga” │
│ │ ↑ ↓ dup. ocultar     │ │       │ [erro/salvo]        │                │             │
│ └──────────────────────┘ │       └──────────────────────┴────────────────┴─────────────┘
│                          │
│ [Salvando…] [* Publicar] │ ← barra sticky; [salvo/erro/pendente]
└──────────────────────────┘
```

Desktop mantém preview visível e tema separado. Mobile alterna editar/visualizar, sem esconder o estado de salvamento. Operações de ordem têm botões com rótulo acessível. Exclusão abre toast “Desfazer”.

## 5. Preview e publicação

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌────────────────────────────────────────────────────┐
│ ← Voltar ao editor       │       │ ← Editor            Preview em tela cheia          │
│ ┌──────────────────────┐ │       │                 ┌──────────────────┐               │
│ │ Página como visitante│ │       │                 │ página/CTAs      │               │
│ │ [CTA] [CTA]          │ │       │                 └──────────────────┘               │
│ └──────────────────────┘ │       │                                                    │
│ [* Publicar]             │       │ Checklist [✓ slug] [✓ bloco] [! resultado]         │
│ Checklist                │       │ [* Confirmar publicação]                           │
│ ✓ endereço ✓ bloco       │       │ [publicando / erro / sucesso + URL + copiar]       │
│ ! resultado (aviso)      │       └────────────────────────────────────────────────────┘
│ [publicando/erro/sucesso]│
└──────────────────────────┘
```

Slug e bloco visível bloqueiam; ausência de resultado apenas avisa. Sucesso só aparece após a transição simulada concluir.

## 6. Página pública e resultados

```text
MOBILE ~390                         DESKTOP ~1280 (conteúdo central limitado)
┌──────────────────────────┐       ┌────────────────────────────────────────────────────┐
│ avatar  Nome             │       │             ┌──────────────────────┐               │
│ bio                      │       │             │ avatar  Nome         │               │
│ [WhatsApp]               │       │             │ bio                  │               │
│ [Agenda]                 │       │             │ [CTA] [CTA]          │               │
│ ícones                   │       │             │ Criado com…          │               │
│ Criado com…              │       │             └──────────────────────┘               │
└──────────────────────────┘       └────────────────────────────────────────────────────┘

RESULTADOS
┌──────────────────────────┐       ┌────────────────────────────────────────────────────┐
│ 7 dias [30🔒] [90🔒]     │       │ Resultados  [7 dias] [30🔒] [90🔒] TZ             │
│ Visitas | Resultados | % │       │ ┌KPI┐ ┌KPI┐ ┌KPI┐                                │
│ Funil ███ → ██ → █       │       │ Funil                  Blocos mais usados          │
│ Blocos mais usados       │       │ █████ visitas          WhatsApp █████              │
│ Origens                  │       │ ███ clicks             Agenda ███                 │
│ [sem dados/zero/erro]     │       │ ██ resultados          Origens/UTM                │
└──────────────────────────┘       └────────────────────────────────────────────────────┘
```

Public page usa só tokens do tema. Analytics distingue carregando, erro, sem histórico e zero no filtro atual.

## 7. Conta da agência e nova página

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌───────────────┬────────────────────────────────────┐
│ [Agência Aurora ▾]       │       │ Agência Aurora│ Páginas dos clientes     3 de 10  │
│ Páginas       3 de 10    │       │ Pessoal       │ [buscar____________] [+ Nova]     │
│ [buscar____________]     │       │               │ Nome       Status  Visitas Result.│
│ [+ Nova página]          │       │               │ Café Ipê   Pub.     1.240   87    │
│ ┌──────────────────────┐ │       │               │ Estúdio... Pend.      830   42    │
│ │ Café Ipê            │ │       │               │ Feira...   Rasc.        0    0    │
│ │ Publicado 1240 / 87 │ │       │               │                                    │
│ └──────────────────────┘ │       │               │ [vazio / busca sem resultado]      │
│ [vazio/busca sem result.]│       └───────────────┴────────────────────────────────────┘
└──────────────────────────┘

MODAL NOVA PÁGINA
┌────────────────────────────────────┐
│ Em branco | Modelo | Duplicar      │
│ Origem [Café Ipê____________]      │
│ Copia: blocos e tema               │
│ Não copia: dados, domínio, pixels, │
│ relatórios                         │
│ [Cancelar] [* Criar cópia]         │
└────────────────────────────────────┘
```

Mobile transforma linhas em cards. O modal devolve foco ao gatilho. Arquivar é secundário e mantém recuperação conceitual.

## 8. Relatório do cliente

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌────────────────────────────────────────────────────┐
│ Relatório • Agência Aurora│      │ Agência Aurora • Relatório para Café Ipê           │
│ Café Ipê                 │       │ 1–30 set 2026                                     │
│ 1–30 set 2026            │       │                                                    │
│ “1.240 visitas e 87      │       │  Sua página recebeu 1.240 visitas e gerou          │
│ conversas no WhatsApp”   │       │  87 conversas no WhatsApp.                         │
│ Visitas | Resultados     │       │  [visitas] [resultados] [taxa]                     │
│ Blocos | Origens         │       │  Blocos com mais resultado | Origens               │
│ [expirado/revogado]      │       │  [expirado/revogado substitui todo o conteúdo]     │
└──────────────────────────┘       └────────────────────────────────────────────────────┘
```

Não há navegação interna, configurações ou dados de outras páginas. Tokens inválidos, expirados e revogados recebem estados seguros.

## 9. Landing e lista de espera

```text
MOBILE ~390                         DESKTOP ~1280
┌──────────────────────────┐       ┌──────────────────────────┬─────────────────────────┐
│ Projeto LNK • piloto     │       │ Hub de conversão mobile │ Entrar na lista         │
│ Transforme visitas em    │       │ em construção           │ Nome / e-mail / WhatsApp│
│ próximos passos claros.  │       │                          │ Segmento / perfis       │
│ [* Entrar na lista]      │       │ Multi-perfil + resultados│ Ferramenta / faixa valor│
│ Benefícios do MVP        │       │ WhatsApp, Pix, agenda    │ Interesse no piloto     │
│                          │       │ Planos em reais          │ □ consentimento LGPD    │
│ Formulário               │       │                          │ [* Quero participar]    │
│ [sucesso/validação/indisp]│      │                          │ [estados]               │
└──────────────────────────┘       └──────────────────────────┴─────────────────────────┘
```

Variantes `/agencias` e `/profissionais` mudam a promessa, não fecham o produto a um segmento. Consentimento inicia desmarcado.

## 10. Painel de depuração e tokens

```text
DEBUG (oculto por padrão)           TOKENS
┌──────────────────────────────┐    ┌──────────────────────────────────────────────┐
│ Estado forçado              │    │ Cor / tipo / espaço / raio / sombra / motion│
│ □ erro save □ save lento    │    │ [Button estados] [Field estados] [Switch]   │
│ □ erro publish              │    │ [Dialog] [Toast] [Badge] [SaveStatus]       │
│ Analytics: real/sem/zero    │    │ [EmptyState] [Skeleton]                     │
│ Timeline                    │    └──────────────────────────────────────────────┘
│ [Copiar JSON] [Fechar]      │
└──────────────────────────────┘
```

Debug abre por `?debug=1` ou `Alt+Shift+D`; não interfere na tarefa do participante. `/proto/tokens` documenta todos os estados visuais.
