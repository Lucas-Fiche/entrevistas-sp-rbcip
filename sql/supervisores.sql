-- ============================================================
--  SUPERVISORES + CAMPOS NOVOS DA ABA FORMAÇÃO
--
--  1. Tabela `supervisores`: quem supervisiona cada grupo (Capital) ou cada
--     região (Interior). O supervisor de um bolsista deixa de ser digitado e
--     passa a ser deduzido daqui — trocou o supervisor de um grupo, todos os
--     bolsistas daquele grupo acompanham.
--
--  2. Campos novos em `formacao`:
--     • facilitador          — quem conduziu o treinamento (hoje está
--                              misturado na data, ex.: "11/08 | F. Guilherme");
--     • desligado_em/motivo  — registro de quem saiu do projeto;
--     • candidato_id         — liga a ficha de formação ao candidato de origem.
--
--  A situação do bolsista (Aguardando termo / Ativo / Desligado) NÃO vira
--  coluna: é calculada na hora a partir do termo e do desligamento, para não
--  existir a possibilidade de o texto discordar dos fatos.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente.
-- ============================================================

-- ------------------------------------------------------------
--  1) Campos novos em formacao
-- ------------------------------------------------------------
alter table public.formacao add column if not exists facilitador      text;
alter table public.formacao add column if not exists desligado_em     text;
alter table public.formacao add column if not exists desligado_motivo text;
alter table public.formacao add column if not exists candidato_id     uuid;

comment on column public.formacao.desligado_em is
  'Data do desligamento (dd/mm/aaaa). Preenchida = pessoa fora do projeto.';

-- ------------------------------------------------------------
--  2) Supervisores por grupo (Capital) / região (Interior)
-- ------------------------------------------------------------
create table if not exists public.supervisores (
  id         uuid primary key default gen_random_uuid(),
  criado_em  timestamptz not null default now(),
  tipo       text not null check (tipo in ('capital', 'interior')),
  -- "Verde", "Amarelo"… na Capital; o nome da região no Interior.
  chave      text not null,
  nome       text not null,
  ativo      boolean not null default true
);

create unique index if not exists supervisores_tipo_chave_uidx
  on public.supervisores (tipo, chave);

alter table public.supervisores enable row level security;
grant select, insert, update, delete on public.supervisores to authenticated;

drop policy if exists "supervisores_select_auth" on public.supervisores;
create policy "supervisores_select_auth"
  on public.supervisores for select to authenticated using (true);

-- Escrita só para administradores (mesma regra do resto do painel).
drop policy if exists "supervisores_insert_admin" on public.supervisores;
drop policy if exists "supervisores_update_admin" on public.supervisores;
drop policy if exists "supervisores_delete_admin" on public.supervisores;
do $$
declare cond text;
begin
  cond := case when to_regprocedure('public.eh_admin()') is not null
               then 'public.eh_admin()' else 'true' end;
  execute 'create policy "supervisores_insert_admin" on public.supervisores for insert to authenticated with check (' || cond || ')';
  execute 'create policy "supervisores_update_admin" on public.supervisores for update to authenticated using (' || cond || ') with check (' || cond || ')';
  execute 'create policy "supervisores_delete_admin" on public.supervisores for delete to authenticated using (' || cond || ')';
end $$;

-- ------------------------------------------------------------
--  3) Situação atual (revise pelo painel sempre que mudar)
-- ------------------------------------------------------------
insert into public.supervisores (tipo, chave, nome) values
  ('capital', 'Verde',    'Guilherme'),
  ('capital', 'Amarelo',  'Thawane'),
  ('capital', 'Vermelho', 'Artur Heps'),
  ('capital', 'Branco',   'Giselle Medeiros')
on conflict (tipo, chave) do nothing;

-- Interior: extraído da planilha de formação atual. Confira no painel —
-- "Marília" está sem supervisor na planilha e ficou de fora de propósito.
insert into public.supervisores (tipo, chave, nome) values
  ('interior', 'Americana',                                          'Gisele Ruiz'),
  ('interior', 'Araçatuba',                                          'Gisele Ruiz'),
  ('interior', 'Bauru',                                              'Gisele Ruiz'),
  ('interior', 'Piracicaba',                                         'Gisele Ruiz'),
  ('interior', 'Baixada Santista (Santos / Praia Grande / Guarujá)', 'Artur Heps'),
  ('interior', 'Presidente Prudente',                                'Giselle Medeiros'),
  ('interior', 'Sorocaba',                                           'Giselle Medeiros'),
  ('interior', 'São José dos Campos / Vale do Paraíba',              'Giselle Medeiros'),
  ('interior', 'Ribeirão Preto',                                     'Guilherme'),
  ('interior', 'São José do Rio Preto',                              'Thawane')
on conflict (tipo, chave) do nothing;
