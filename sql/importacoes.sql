-- ============================================================
--  REGISTRO DAS IMPORTAÇÕES (auditoria)
--
--  Cria duas coisas:
--
--  1. A coluna `importado_em` em candidatos e formacao — quando aquela ficha
--     foi tocada por uma importação pela última vez. Serve para responder
--     "esta pessoa veio do arquivo de qual dia?" e para achar fichas que
--     pararam de aparecer nos arquivos novos.
--
--  2. A tabela `importacoes` — o histórico de cada envio de CSV: quando, quem
--     enviou, qual aba, qual arquivo, quantas linhas o arquivo tinha, quantas
--     fichas foram criadas e quantas foram atualizadas. É o que permite
--     investigar depois ("no dia 19 esse arquivo criou 12 fichas novas?").
--
--  Nada aqui altera dados existentes. Cole no SQL Editor do Supabase e Run.
-- ============================================================

alter table public.candidatos
  add column if not exists importado_em timestamptz;

comment on column public.candidatos.importado_em is
  'Quando esta ficha foi atualizada por uma importação de CSV pela última vez.';

do $$
begin
  if to_regclass('public.formacao') is not null then
    execute 'alter table public.formacao add column if not exists importado_em timestamptz';
  end if;
end $$;

-- ------------------------------------------------------------
--  Histórico de importações
-- ------------------------------------------------------------
create table if not exists public.importacoes (
  id           uuid primary key default gen_random_uuid(),
  criado_em    timestamptz not null default now(),
  usuario      text,                                   -- quem enviou o arquivo
  aba          text not null check (aba in ('candidatos', 'formacao')),
  tipo         text not null check (tipo in ('capital', 'interior')),
  arquivo      text,                                   -- nome do arquivo enviado
  linhas       integer,                                -- linhas válidas no CSV
  criadas      integer,                                -- fichas novas
  atualizadas  integer                                 -- fichas que já existiam
);

create index if not exists importacoes_criado_em_idx on public.importacoes (criado_em desc);

alter table public.importacoes enable row level security;

grant select, insert on public.importacoes to authenticated;

-- Qualquer usuário logado LÊ o histórico (é registro de auditoria).
drop policy if exists "importacoes_select_auth" on public.importacoes;
create policy "importacoes_select_auth"
  on public.importacoes for select to authenticated using (true);

-- Só administradores gravam — mesma regra de quem pode importar.
drop policy if exists "importacoes_insert_admin" on public.importacoes;
do $$
begin
  if to_regprocedure('public.eh_admin()') is not null then
    execute 'create policy "importacoes_insert_admin" on public.importacoes '
         || 'for insert to authenticated with check (public.eh_admin())';
  else
    execute 'create policy "importacoes_insert_admin" on public.importacoes '
         || 'for insert to authenticated with check (true)';
  end if;
end $$;
