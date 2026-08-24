-- ============================================================
--  TABELA: metas  (quantos entrevistadores cada região precisa)
--
--  A meta define quando uma região está completa. Enquanto houver vaga, o
--  aprovado é convocado para o cadastro de bolsista normalmente; quando a
--  região enche, os próximos aprovados aparecem no painel como RESERVA.
--
--  Ocupa vaga quem está na Formação e NÃO foi desligado — ou seja, os Ativos
--  mais os que aguardam o termo de bolsa. Quem já recebeu a convocação e
--  espera o termo está comprometido com a região; quem é desligado devolve a
--  vaga automaticamente, sem ninguém precisar mexer na meta.
--
--  As metas mudam com o tempo: por isso ficam aqui, editáveis pelo painel
--  (Candidatos ou Formação → "Metas e vagas" → "Editar metas"), e não no
--  código. Cada alteração registra quem mudou e quando.
--
--  Região em branco (ou sem linha aqui) = sem controle de vagas: o painel se
--  comporta como antes, sem bloquear nada.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente.
-- ============================================================

create table if not exists public.metas (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),
  tipo           text not null check (tipo in ('capital', 'interior')),
  -- "Capital" no projeto da capital; o nome da região no Interior.
  regiao         text not null,
  meta           integer check (meta is null or meta >= 0),
  atualizado_em  timestamptz,
  atualizado_por text
);

create unique index if not exists metas_tipo_regiao_uidx
  on public.metas (tipo, regiao);

-- ------------------------------------------------------------
--  Segurança: leitura para quem faz login, escrita só para admin
--  (mesma regra das outras tabelas do painel).
-- ------------------------------------------------------------
alter table public.metas enable row level security;
grant select, insert, update, delete on public.metas to authenticated;

drop policy if exists "metas_select_auth" on public.metas;
create policy "metas_select_auth"
  on public.metas for select to authenticated using (true);

drop policy if exists "metas_insert_admin" on public.metas;
drop policy if exists "metas_update_admin" on public.metas;
drop policy if exists "metas_delete_admin" on public.metas;
do $$
declare cond text;
begin
  cond := case when to_regprocedure('public.eh_admin()') is not null
               then 'public.eh_admin()' else 'true' end;
  execute 'create policy "metas_insert_admin" on public.metas for insert to authenticated with check (' || cond || ')';
  execute 'create policy "metas_update_admin" on public.metas for update to authenticated using (' || cond || ') with check (' || cond || ')';
  execute 'create policy "metas_delete_admin" on public.metas for delete to authenticated using (' || cond || ')';
end $$;

-- ------------------------------------------------------------
--  Meta atual da Capital. As do Interior serão preenchidas pelo painel
--  quando os números chegarem — até lá, o Interior não bloqueia convocação.
-- ------------------------------------------------------------
insert into public.metas (tipo, regiao, meta) values
  ('capital', 'Capital', 50)
on conflict (tipo, regiao) do nothing;
