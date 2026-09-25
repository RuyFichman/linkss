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

### Armazenamento de mídia

Com 70% do 1 GB reservado para conteúdo de clientes:

| Média otimizada por perfil | Perfis aproximados |
|---:|---:|
| 0,5 MB | 1.400 |
| 2 MB | 350 |
| 5 MB | 140 |

Sem compressão e limites, mídia vira o primeiro gargalo. O MVP deve gerar variantes otimizadas, rejeitar arquivos grandes, apagar órfãos e manter uma interface que permita mover objetos para R2.

### Egress

Se a mídia vier do Supabase Storage:

| Payload médio de mídia por visita | Page views para consumir 5 GB cached egress |
|---:|---:|
| 150 KB | ~34 mil |
| 300 KB | ~17 mil |
| 700 KB | ~7 mil |

São aproximações decimais e não incluem cache misses, API, uploads ou outros consumidores. Servir HTML no edge não elimina o egress das imagens.

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
