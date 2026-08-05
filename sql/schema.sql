-- ============================================================
--  Estrutura da tabela de entrevistas — Processo Seletivo RBCIP
--  Execute este script no SQL Editor do Supabase.
-- ============================================================

create table if not exists public.entrevistas (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  tipo                  text not null check (tipo in ('capital', 'interior')),
  perfil                text,
  candidato             text,
  data_entrevista       text,
  entrevistador         text,
  nao_compareceu        boolean not null default false,
  nao_cumpre_requisitos boolean not null default false,
  recomendacao          text,
  -- Pontuação do candidato (bloco de Elegibilidade não pontua).
  pontuacao_total       integer,
  pontuacao_maxima      integer,
  -- Todas as respostas do formulário (inclui os campos promovidos acima).
  respostas             jsonb not null default '{}'::jsonb
);

-- Caso a tabela já exista de uma versão anterior, garante as colunas novas.
alter table public.entrevistas add column if not exists perfil text;
alter table public.entrevistas add column if not exists pontuacao_total integer;
alter table public.entrevistas add column if not exists pontuacao_maxima integer;

-- Índices úteis para o dashboard (filtros por tipo, ordenação por data e ranking).
create index if not exists entrevistas_tipo_idx on public.entrevistas (tipo);
create index if not exists entrevistas_created_at_idx on public.entrevistas (created_at desc);
create index if not exists entrevistas_pontuacao_idx on public.entrevistas (pontuacao_total desc);

-- ------------------------------------------------------------
--  Row Level Security (RLS)
-- ------------------------------------------------------------
alter table public.entrevistas enable row level security;

-- Concede o direito de INSERIR na tabela tanto ao visitante (anon) quanto ao
-- usuário logado (authenticated). Isso é importante porque o formulário e o
-- dashboard ficam no mesmo domínio e COMPARTILHAM a sessão de login no navegador:
-- se a pessoa estiver logada no dashboard, o envio do formulário vai como
-- "authenticated" — então ambos os papéis precisam poder inserir.
-- Observação: o público (anon) só pode INSERIR (não lê, edita nem apaga).
grant insert on public.entrevistas to anon, authenticated;

-- Permite que o formulário INSIRA novas entrevistas (logado ou não).
drop policy if exists "entrevistas_insert_anon" on public.entrevistas;
drop policy if exists "entrevistas_insert" on public.entrevistas;
create policy "entrevistas_insert"
  on public.entrevistas
  for insert
  to anon, authenticated
  with check (true);

-- Leitura (para o dashboard): liberada APENAS para usuários autenticados
-- (que fazem login via Supabase Auth). O público (anon) continua SEM acesso
-- de leitura — só consegue inserir.
grant select on public.entrevistas to authenticated;

drop policy if exists "entrevistas_select_auth" on public.entrevistas;
create policy "entrevistas_select_auth"
  on public.entrevistas
  for select
  to authenticated
  using (true);

-- ------------------------------------------------------------
--  Link da pasta de gravações/atas (Google Drive)
-- ------------------------------------------------------------
-- Coluna nova, opcional. As entrevistas já existentes ficam com o campo vazio
-- (NULL) — nada é alterado ou perdido.
alter table public.entrevistas add column if not exists ata_link text;

-- Permite que o usuário logado (gestor) GRAVE o link das atas pelo dashboard,
-- porém de forma restrita e segura:
--   • grant só na coluna ata_link  -> não dá para alterar nenhuma outra coluna
--     (pontuação, recomendação, respostas etc. continuam intocáveis por UPDATE);
--   • policy "write-once" (using ata_link is null) -> só é possível gravar quando
--     o link ainda está vazio. Depois de salvo, fica somente-leitura, como um
--     registro de auditoria. (Se precisar corrigir, faça direto no Table Editor
--     do Supabase.)
grant update (ata_link) on public.entrevistas to authenticated;

drop policy if exists "entrevistas_update_ata" on public.entrevistas;
create policy "entrevistas_update_ata"
  on public.entrevistas
  for update
  to authenticated
  using (ata_link is null)
  with check (ata_link is not null);
