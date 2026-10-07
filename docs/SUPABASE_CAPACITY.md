# Capacidade do Supabase Free — modelo para o Projeto LNK

**Referência consultada em:** 25/09/2026. Limites podem mudar; conferir a página oficial antes de decisões de custo.

## Limites oficiais relevantes

- 2 projetos Free ativos por owner/admin.
- 500 MB de tamanho de banco por projeto; acima disso o projeto pode entrar em read-only.
- 1 GB de armazenamento de arquivos.
- 5 GB de egress e 5 GB de cached egress por organização/mês.
- 50 mil usuários ativos mensais no Auth.
- 500 mil invocações de Edge Functions.
- CPU compartilhada e 500 MB de RAM.
- Projeto gratuito pode pausar após baixa atividade por sete dias.

Fontes: documentação oficial de billing, database size, MAU e project pausing do Supabase.

## Por que não existe um único número de usuários

Uma conta administrativa pode ocupar poucos KB e receber milhões de visitas em uma bio. Outra pode enviar dezenas de imagens e gerar milhões de eventos. Para este produto, os limitadores são **perfis, mídia, page views e eventos**, não apenas logins.

## Hipóteses conservadoras de planejamento

### Dados transacionais sem analytics bruto

- usuário/Auth + membership: 5–15 KB;
- perfil, tema, domínio e configurações: 5–15 KB;
- 10–20 blocos com índices: 20–40 KB;
- margem de índices, MVCC e crescimento: 2×.

Planejamento: **50–100 KB por perfil**. Reservando 30% do banco para sistema, migrações e operação, cerca de 350 MB ficam utilizáveis. Isso representa aproximadamente **3.500–7.000 perfis** se não guardarmos mídia ou eventos brutos no Postgres.

### Analytics bruto

Um evento pequeno com índices pode consumir aproximadamente 0,5–1,5 KB. Para planejar, usamos 1 KB.

Exemplo por perfil:

- 3.000 page views/mês;
- 300 cliques/ações/mês;
- 3.300 eventos × 1 KB ≈ 3,3 MB/mês.

Cem perfis nesse padrão gerariam cerca de 330 MB de eventos por mês e pressionariam o limite Free rapidamente. Por isso:

- retenção bruta inicial de 7 dias;
- agregação diária por perfil/bloco/origem;
- exclusão de bots, preview e eventos inválidos;
- migração do stream bruto para datastore analítico quando necessário.

Com sete dias de retenção, o mesmo exemplo cai para aproximadamente 77 MB brutos, além dos agregados.

#### Medido na Sprint 6 (ADR 0011)

Medido no ambiente local (Postgres 17) com 200.000 eventos sintéticos realistas (91% visitas com hash e dimensões, 20% delas com UTM; 9% cliques em bloco) e 234.000 linhas de agregado (100 páginas × 90 dias × 26 linhas), em tabelas com os mesmos índices, dentro de uma transação desfeita ao final.

| Tabela | Bytes por linha (tabela) | Bytes por linha (índices) | Total por linha |
|---|---:|---:|---:|
| `analytics_events` (bruto) | 158 | 172 | **329** |
| `analytics_daily` (agregado) | 97 | 144 | **241** |

- O evento bruto custa cerca de um terço da hipótese de 1 KB. Mais da metade é índice: a chave primária `(página, id do evento)` é um UUID aleatório.
- Uma página ativa escreve cerca de 26 linhas de agregado por dia (totais por tipo, blocos, origens, UTM, aparelhos e países): **≈ 6,3 KB por página por dia**.
- Página do exemplo acima (3.300 eventos por mês, 110 por dia): 8 dias de bruto ≈ **0,29 MB**; 100 dias de agregados ≈ **0,63 MB**. Cem páginas assim: ≈ **92 MB**, em regime permanente.
- Os agregados passam a pesar mais que o bruto. Por isso a retenção deles é de 100 dias (o maior histórico que algum plano mostra é 90); os 400 dias pensados no início custariam ≈ 2,5 MB por página ativa.
- **Teto por abuso:** a ingestão para de gravar quando a tabela bruta chega a cerca de 500 mil eventos (≈ 165 MB com índices; `analytics_settings.max_raw_events`). Somado aos agregados, o analytics fica limitado a cerca de metade dos 500 MB do plano Free mesmo sob ataque. Para tráfego legítimo, 500 mil eventos em 8 dias são cerca de 62 mil eventos por dia (≈ 570 páginas no padrão do exemplo).
- **Novo teto prático do plano Free:** com ≈ 0,1 MB de dados transacionais e ≈ 0,9 MB de analytics por página ativa, os 350 MB úteis comportam cerca de **300 a 350 páginas ativas** nesse padrão de tráfego. Páginas com pouco tráfego custam bem menos (só existem linhas de agregado para o que aconteceu).
- **Sinais de upgrade ou extração:** banco em 60% da cota (regra geral abaixo); log `analytics.ingest` com `shedding` (o teto foi atingido); job diário apagando 50.000 eventos por execução em dias seguidos (o bruto cresce mais rápido do que o purge de um dia). Passos, nesta ordem: plano Pro, particionamento por dia da tabela bruta, datastore analítico.

Latência da ingestão (local, `next start`, 336 requisições com 8 em paralelo): p50 15–17 ms, p95 26–36 ms, máximo 46–78 ms. Rajada de 300 lotes de 10 eventos com 50 em paralelo (≈ 450 requisições por segundo): p50 100–109 ms, p95 110–125 ms, máximo 128–203 ms; todas responderam 204; o banco terminou de gravar 2,5 a 4 s depois da última resposta e guardou exatamente 2.000 eventos (o limite por página); a página pública respondeu 200 durante e depois.

### Armazenamento de mídia

Com 70% do 1 GB reservado para conteúdo de clientes:

| Média otimizada por perfil | Perfis aproximados |
|---:|---:|
| 0,5 MB | 1.400 |
| 2 MB | 350 |
| 5 MB | 140 |

Sem compressão e limites, mídia vira o primeiro gargalo. O MVP deve gerar variantes otimizadas, rejeitar arquivos grandes, apagar órfãos e manter uma interface que permita mover objetos para R2.

#### Medido na Sprint 5 (variantes WebP, qualidade 80)

Cada imagem de bloco guarda até três variantes (448, 896 e 1344 px de largura) e cada avatar três (96, 192 e 288 px). Medido no ambiente local com imagens sintéticas; fotos reais devem ficar entre os dois extremos.

| Imagem | 448 px | 896 px | 1344 px | Total guardado |
|---|---:|---:|---:|---:|
| Foto 16:9 (peso típico) | 22 KB | 61 KB | 108 KB | 191 KB |
| Foto 4:3 (peso típico) | 28 KB | 80 KB | 140 KB | 249 KB |
| Foto 1:1 (peso típico) | 39 KB | 110 KB | 197 KB | 347 KB |
| Pior caso (ruído puro, 4:5) | 117 KB | 292 KB | 462 KB | 871 KB |
| Avatar, pior caso (ruído) | 5 KB (96) | 18 KB (192) | 33 KB (288) | 57 KB |

- **Por página:** avatar + 3 fotos típicas ≈ 0,8 MB guardados. A cota Free de 20 MB por workspace comporta cerca de 60 a 100 fotos típicas (ou 23 no pior caso); 700 MB úteis do projeto Free comportam cerca de 850 páginas com esse perfil, **desde que a limpeza de órfãos rode** (cada troca de imagem deixa a anterior ocupando espaço enquanto alguma das 10 versões publicadas a usar).
- **Por visita (celular, tela 2x):** avatar 192 px + três fotos de 896 px ≈ 270 KB de egress de mídia (medido: 264,7 KB). 5 GB de cached egress ≈ 18 mil visitas por mês a páginas assim; páginas só com avatar custam ≈ 18 KB.
- As cotas por plano (`storage_mb`: Free 20, Pro 100, Agência 500) são hipóteses e somam mais que 1 GB com poucas dezenas de contas cheias: o gatilho de upgrade (60% do storage) continua sendo o controle real.

### Egress

Se a mídia vier do Supabase Storage:

| Payload médio de mídia por visita | Page views para consumir 5 GB cached egress |
|---:|---:|
| 150 KB | ~34 mil |
| 300 KB | ~17 mil |
| 700 KB | ~7 mil |

São aproximações decimais e não incluem cache misses, API, uploads ou outros consumidores. Servir HTML no edge não elimina o egress das imagens.

## Painel consolidado e links de relatório (Sprint 7)

- **Sem tabela de agregados nova.** O consolidado lê `analytics_daily`, que já existia. Medido no stack local (`apps/web/scripts/agency-scale.mjs`): com 50 páginas e 30 dias a leitura agrega 8.700 linhas em cerca de 29 ms de banco; com 10 páginas, cerca de 8 ms. Três requisições por tela em qualquer tamanho.
- **`report_links`:** uma linha por link, da ordem de 300 bytes com índices. No teto de 100 links ativos por conta mais 90 dias de terminados, fica abaixo de 100 KB por conta. Irrelevante para a cota.
- **`report_lookup_failures`:** no máximo 5.000 linhas por 10 minutos e 24 horas de retenção: teto teórico de 720 mil linhas (cerca de 60 MB) sob ataque contínuo o dia inteiro. É o motivo do teto por janela; o limite global da Sprint 9 reduz isso na origem.
- **Egress:** o relatório é HTML renderizado no servidor, sem imagens.

## Faixa prática

- **Desenvolvimento:** confortável.
- **MVP privado:** aproximadamente 50–200 contas e até algumas centenas de perfis, com mídia limitada e analytics agregado.
- **Piloto mais amplo:** 200–500 perfis pode funcionar se tráfego for moderado e objetos/eventos forem controlados.
- **Milhares de perfis:** os dados transacionais podem caber, mas compute, egress, mídia, backups e confiabilidade tornam o Pro a escolha responsável.

O Auth Free suportar 50 mil MAU não significa que o projeto completo suporta 50 mil criadores. Em nosso caso, storage/egress e eventos chegarão ao limite muito antes.

## Política de upgrade

Fazer upgrade da produção para Pro antes do beta pago ou antes, se qualquer um ocorrer:

- banco ≥ 60% de 500 MB;
- storage ≥ 60% de 1 GB;
- egress projetado ≥ 60% da quota mensal;
- compute apresenta latência/saturação recorrente;
- necessidade de backups automáticos e suporte de produção;
- receita ou reputação passa a depender da disponibilidade.

O Pro inclui, na referência atual, 8 GB de disco por projeto, 100 GB de arquivos, 250 GB de egress, backups diários por sete dias e 100 mil MAU antes de overage. O custo começa em US$ 25/mês e deve entrar no custo normal do beta pago.
