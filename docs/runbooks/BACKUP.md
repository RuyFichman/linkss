# Runbook — backup e restauração do banco

**Owner:** founder técnico. **Ferramentas:** `npm run db:backup`, `npm run db:restore-check` (scripts em `scripts/`), CLI do Supabase logada na conta dona do projeto, Docker.

**Por que existe:** por decisão do founder em 10/10/2026, o banco de produção fica no **plano Free do Supabase**, que **não tem backup gerenciado**. Não há cópia diária, nem restauração por data, do lado do Supabase. **O único backup é o que este procedimento produz.** Se ele não for feito, uma exclusão por engano, uma migração errada ou a perda do projeto não têm volta.

**Estado em 10/10/2026:** os dois scripts foram escritos e ensaiados com o **banco local** (backup de 70 tabelas e 36 arquivos de mídia; restauração numa instância descartável; todas as verificações aprovadas). **Nenhum backup do banco de produção foi feito ainda:** a CLI desta máquina estava logada em uma conta sem acesso ao projeto (erro 403). **A restauração num projeto hospedado novo nunca foi ensaiada**, nem a recarga dos arquivos de mídia.

## 1. Fazer um backup

Requisitos: Docker em execução; `npx supabase login` com a conta **dona do projeto**; projeto ligado (`npx supabase link`).

```bash
npm run db:backup
```

Cria `backups/<data e hora UTC>-production/` com:

| Arquivo | Conteúdo |
|---|---|
| `roles.sql` | papéis do banco |
| `schema.sql` | toda a estrutura dos schemas da aplicação (tabelas, funções, policies, índices) |
| `data.sql` | linhas de `public`, de `auth` (as contas) e de `storage` (a lista dos arquivos de mídia) |
| `migrations-schema.sql`, `migrations-data.sql` | histórico de migrações, para o `supabase db push` saber o que o banco restaurado já tem |
| `media/` | os arquivos do bucket público `media` (omitidos com `-- --no-media`) |
| `manifest.json` | origem, horário, linhas por tabela, SHA-256 de cada arquivo |

O script termina dizendo quantas contas, páginas, versões publicadas e contatos foram copiados. Confira se os números fazem sentido.

**O que não entra no backup:**

- **Segredos do Vault** (`media_signing_secret`, `analytics_signing_secret`, `billing_signing_secret`, `moderation_signing_secret`, `domains_signing_secret`). São cifrados com uma chave que fica no projeto. Os valores também estão nas variáveis da Vercel, que é de onde se recriam (§4).
- **Configurações do Auth hospedado** (Site URL, Redirect URLs, limites, modelos de e-mail). Estão descritas em `docs/ENVIRONMENTS.md`.
- **O que só existe nos provedores:** assinaturas e pagamentos na Stripe, domínios anexados na Vercel.

**A senha do banco nunca vai na linha de comando.** Se a CLI pedir, digite quando ela pedir, ou defina `SUPABASE_DB_PASSWORD` só naquela sessão do terminal.

## 2. Conferir que o backup restaura

Um backup só vale depois de restaurado. Logo após fazer um:

```bash
npm run db:restore-check -- backups/<pasta>
```

O script sobe uma segunda instância local **descartável** (não toca na produção nem no banco local de desenvolvimento), carrega o backup como numa restauração real, compara tabela por tabela com o `manifest.json`, lê uma página publicada pela função que o site usa e apaga a instância. Só confie no backup se terminar com `PASS`.

## 3. Quando fazer e onde guardar

- **Sempre antes de um `supabase db push` em produção**, antes de qualquer comando manual no SQL Editor que altere ou apague dados e **antes de executar uma exclusão de conta** (`ACCOUNT_DELETION.md`).
- **Depois de uma exclusão de conta**, os backups anteriores ainda contêm os dados da pessoa até vencerem: se um deles for restaurado, a exclusão precisa ser refeita.
- **Toda semana**, enquanto houver usuários de fora (sugestão; não há agendamento automático).
- **Guardar fora desta máquina.** A pasta `backups/` é ignorada pelo Git e fica só neste computador: se o disco falhar, o backup vai junto. Copie cada pasta para um local com acesso restrito e criptografia (um disco externo cifrado ou um armazenamento em nuvem privado). **O backup contém dados pessoais** (e-mails das contas, contatos enviados pelos formulários): não envie por e-mail, chat ou pasta compartilhada.
- **Quanto guardar:** sugestão de manter os quatro últimos semanais e os de antes de cada migração dos últimos 30 dias, e apagar os mais antigos. Um pedido de exclusão de dados atendido precisa valer também para os backups: o que foi apagado na produção some dos backups quando eles vencem (registrar isso na resposta ao titular).

## 4. Restaurar de verdade

**Nunca ensaiado num projeto hospedado.** O roteiro abaixo é o que o ensaio local faz, aplicado a um projeto novo; trate a primeira execução real como descoberta e corrija este arquivo.

Restaurar **por cima** do projeto atual não é suportado por este procedimento: o caminho é um projeto novo.

1. **Parar as escritas.** Na Vercel, pausar o projeto ou pôr no ar uma versão em manutenção, para ninguém gravar em um banco que será abandonado.
2. **Criar um projeto novo** no Supabase, na mesma região e na mesma versão do Postgres. Anotar a string de conexão.
3. **Carregar o backup**, nesta ordem (com `psql` e a string de conexão do projeto novo):

```bash
psql "<conexão>" --file backups/<pasta>/roles.sql
psql "<conexão>" --file backups/<pasta>/schema.sql --file backups/<pasta>/migrations-schema.sql
psql "<conexão>" --command "SET session_replication_role = replica" --file backups/<pasta>/data.sql --file backups/<pasta>/migrations-data.sql
```

   O terceiro comando precisa ser uma única sessão (por isso `--command` e `--file` juntos): `session_replication_role = replica` desliga gatilhos e conferência de chaves estrangeiras durante a carga.
4. **Recriar os segredos do Vault** com os **mesmos valores** que estão nas variáveis da Vercel (assim nada precisa mudar lá):

```sql
select vault.create_secret('<valor de MEDIA_SIGNING_SECRET>', 'media_signing_secret');
select vault.create_secret('<valor de ANALYTICS_SIGNING_SECRET>', 'analytics_signing_secret');
select vault.create_secret('<valor de BILLING_SIGNING_SECRET>', 'billing_signing_secret');
select vault.create_secret('<valor de MODERATION_SIGNING_SECRET>', 'moderation_signing_secret');
select vault.create_secret('<valor de DOMAINS_SIGNING_SECRET>', 'domains_signing_secret');
```

   Variáveis *Sensitive* não podem ser lidas de volta na Vercel. Se você não tiver os valores guardados em outro lugar, gere valores novos, grave no Vault **e** nas variáveis, e faça novo deploy.
5. **Mídia:** criar o bucket público `media` (a linha em `storage.buckets` vem no backup; os arquivos não) e enviar a pasta `media/` mantendo os caminhos: `npx supabase storage cp -r backups/<pasta>/media ss:///media --experimental --linked` (**comando não testado**).
6. **Auth:** aplicar o checklist de `docs/ENVIRONMENTS.md` (Site URL `https://linkfav.com`, Redirect URL `https://linkfav.com/auth/confirm`, limites, confirmação de e-mail). As contas e senhas vêm no backup; as sessões abertas deixam de valer e as pessoas entram de novo.
7. **Vercel:** trocar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` para o projeto novo; novo deploy.
8. **Conferir:** `npx supabase link` no projeto novo e `npx supabase migration list` (todas aplicadas); abrir uma página publicada; entrar com uma conta; enviar uma imagem; ver *Resultados* e *Plano*.
9. **Stripe:** nada muda lá. O job diário (`/api/jobs/billing`) relê as assinaturas e corrige o que mudou entre o backup e a restauração.
10. **O que se perde:** tudo o que foi gravado depois do backup (páginas editadas, contatos recebidos, visitas). Avisar os usuários afetados.

## 5. Riscos próprios do plano Free

- **Sem backup gerenciado e sem restauração por data** (este runbook é a mitigação).
- **Pausa por inatividade:** um projeto Free pode ser pausado depois de cerca de sete dias sem atividade. Os três jobs diários da Vercel consultam o banco todo dia, o que deve mantê-lo ativo; se o projeto pausar, o site inteiro para até alguém reativá-lo no painel.
- **500 MB de banco:** acima disso o projeto pode ficar somente leitura. O que mais cresce são os agregados de analytics e os eventos brutos de sete dias; acompanhar em *Database → Usage*. Limites e contas em `docs/SUPABASE_CAPACITY.md`.
- **1 GB de arquivos e 5 GB de tráfego por mês.**
- **Não há ambiente de staging:** toda migração é aplicada direto em produção. Antes de cada `db push`: testes de banco verdes no CI, backup feito e conferido.

## 6. Problemas conhecidos

- **`403` ao fazer o backup:** a CLI está logada em outra conta. `npx supabase logout`, `npx supabase login` com a conta dona do projeto, `npx supabase link`.
- **"media files could not be downloaded":** a linha existe em `storage.objects` e o arquivo não respondeu. Rodar de novo; se repetir para os mesmos arquivos, eles já não existem no bucket (órfãos que o job de limpeza ainda não removeu).
- **`db-restore-check` falha ao iniciar:** portas 54520 a 54529 ocupadas, ou sobrou uma instância de um ensaio interrompido: `npx supabase stop --no-backup --workdir backups/.restore-check`.
- **Erro de permissão em tabelas internas do Storage ao restaurar:** o backup já exclui `storage.buckets_vectors` e `storage.vector_indexes`; se aparecer outra tabela interna, acrescentar à lista `EXCLUDED` em `scripts/db-backup.mjs`.
