-- ============================================================
--  REGISTRO DAS SINCRONIZAÇÕES (manuais e automáticas)
--
--  Guarda cada sincronização da aba Formação: quando, se foi manual ou
--  automática, o que foi lido da planilha-ponte e quantas fichas mudaram.
--
--  Por que registrar: uma rotina que roda sozinha, sem ninguém olhando, precisa
--  deixar rastro. Sem isto, uma sincronização que parou de funcionar (ou que
--  passou a ler a planilha errada) só apareceria semanas depois, pelos dados
--  errados — que é exatamente o problema que já tivemos.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente.
-- ============================================================

create table if not exists public.sincronizacoes (
  id           uuid primary key default gen_random_uuid(),
  criado_em    timestamptz not null default now(),
  origem       text not null check (origem in ('manual', 'automatica')),
  usuario      text,          -- quem rodou (ou a conta do robô)
  lidos        jsonb,         -- o que veio da ponte: aba, linhas, contagens
  atualizadas  integer,       -- quantas fichas mudaram
  detalhe      text           -- erro, quando houver
);

create index if not exists sincronizacoes_criado_em_idx
  on public.sincronizacoes (criado_em desc);

alter table public.sincronizacoes enable row level security;
grant select, insert on public.sincronizacoes to authenticated;

drop policy if exists "sincronizacoes_select_auth" on public.sincronizacoes;
create policy "sincronizacoes_select_auth"
  on public.sincronizacoes for select to authenticated using (true);

drop policy if exists "sincronizacoes_insert_admin" on public.sincronizacoes;
do $$
declare cond text;
begin
  cond := case when to_regprocedure('public.eh_admin()') is not null
               then 'public.eh_admin()' else 'true' end;
  execute 'create policy "sincronizacoes_insert_admin" on public.sincronizacoes '
       || 'for insert to authenticated with check (' || cond || ')';
end $$;
