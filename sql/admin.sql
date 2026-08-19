-- ============================================================
--  SUPER ADMIN + EDIÇÃO NO PAINEL
--
--  Faz duas coisas:
--
--  1. Cria a lista de ADMINISTRADORES (`app_admins`). Só quem está nessa lista
--     pode ALTERAR dados (editar candidatos, importar CSV, marcar convocações).
--     Quem faz login e não está na lista continua vendo tudo, mas em modo
--     SOMENTE LEITURA. A regra é aplicada pelo próprio banco (RLS), então vale
--     mesmo que alguém tente contornar a tela.
--
--  2. Cria a coluna `editado` em `candidatos`, que guarda quais campos foram
--     corrigidos à mão no painel. A importação de CSV NÃO sobrescreve esses
--     campos — a edição feita no sistema prevalece sobre a planilha.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo) e não apaga nenhum dado.
--
--  ATENÇÃO: depois de rodar, só os e-mails da tabela `app_admins` conseguem
--  gravar. Para incluir outra pessoa depois:
--      insert into public.app_admins (email) values ('fulano@rbcip.org');
--  Para remover:
--      delete from public.app_admins where email = 'fulano@rbcip.org';
-- ============================================================

-- ------------------------------------------------------------
--  1) Lista de administradores
-- ------------------------------------------------------------
create table if not exists public.app_admins (
  email      text primary key,
  criado_em  timestamptz not null default now()
);

-- Super admin do sistema.
insert into public.app_admins (email)
values ('lucas@rbcip.org')
on conflict (email) do nothing;

alter table public.app_admins enable row level security;

-- Todo mundo logado pode LER a lista (o painel usa isso para saber se mostra
-- os botões de edição). Ninguém grava por aqui — só pelo SQL Editor.
grant select on public.app_admins to authenticated;

drop policy if exists "app_admins_select_auth" on public.app_admins;
create policy "app_admins_select_auth"
  on public.app_admins for select to authenticated using (true);

-- Função usada pelas políticas: o e-mail do usuário logado está na lista?
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.eh_admin() to authenticated;

-- ------------------------------------------------------------
--  2) Coluna que marca os campos editados à mão (candidatos)
-- ------------------------------------------------------------
alter table public.candidatos
  add column if not exists editado jsonb not null default '{}'::jsonb;

comment on column public.candidatos.editado is
  'Campos corrigidos no painel (ex.: {"email": true}). A importação de CSV não sobrescreve esses campos.';

-- ------------------------------------------------------------
--  3) Escrita restrita aos administradores
--     (leitura continua liberada para qualquer usuário logado)
-- ------------------------------------------------------------

-- candidatos
drop policy if exists "candidatos_insert_auth" on public.candidatos;
drop policy if exists "candidatos_update_auth" on public.candidatos;
drop policy if exists "candidatos_delete_auth" on public.candidatos;

create policy "candidatos_insert_admin"
  on public.candidatos for insert to authenticated with check (public.eh_admin());
create policy "candidatos_update_admin"
  on public.candidatos for update to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy "candidatos_delete_admin"
  on public.candidatos for delete to authenticated using (public.eh_admin());

-- formacao (a tabela pode ainda não existir; o bloco abaixo só age se existir)
do $$
begin
  if to_regclass('public.formacao') is not null then
    execute 'drop policy if exists "formacao_insert_auth" on public.formacao';
    execute 'drop policy if exists "formacao_update_auth" on public.formacao';
    execute 'drop policy if exists "formacao_delete_auth" on public.formacao';
    execute 'drop policy if exists "formacao_insert_admin" on public.formacao';
    execute 'drop policy if exists "formacao_update_admin" on public.formacao';
    execute 'drop policy if exists "formacao_delete_admin" on public.formacao';
    execute 'create policy "formacao_insert_admin" on public.formacao for insert to authenticated with check (public.eh_admin())';
    execute 'create policy "formacao_update_admin" on public.formacao for update to authenticated using (public.eh_admin()) with check (public.eh_admin())';
    execute 'create policy "formacao_delete_admin" on public.formacao for delete to authenticated using (public.eh_admin())';
  end if;
end $$;
