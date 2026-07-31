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

-- Concede ao papel anônimo (chave pública) o direito de INSERIR na tabela.
-- Necessário quando "Automatically expose new tables" está DESLIGADO no projeto
-- (recomendado pelo Supabase). Com essa linha, o formulário funciona de qualquer forma.
-- Observação: só é concedido INSERT — o público não pode ler, editar nem apagar.
grant insert on public.entrevistas to anon;

-- Permite que o formulário (chave anon public) INSIRA novas entrevistas.
drop policy if exists "entrevistas_insert_anon" on public.entrevistas;
create policy "entrevistas_insert_anon"
  on public.entrevistas
  for insert
  to anon
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
