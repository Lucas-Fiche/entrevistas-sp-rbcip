-- ============================================================
--  GERENCIAR USUÁRIOS  (página do menu lateral, só para admin)
--
--  Dá ao painel três coisas que ele não conseguia ter sozinho:
--
--   1. A LISTA DE CONTAS — quem tem login, quando entrou pela última vez,
--      se confirmou o e-mail. Esses dados vivem em `auth.users`, que o
--      navegador não pode ler (só a chave secreta leria, e ela nunca entra
--      no site). A função `listar_usuarios` resolve isso: roda com os
--      poderes do dono, confere que quem chamou é admin e devolve apenas
--      as colunas seguras — nunca a senha, nunca o token.
--
--   2. TROCAR O PERFIL de alguém pelo painel (`definir_perfil`), em vez de
--      abrir o SQL Editor. Só admin, e com uma trava: ninguém tira o
--      próprio acesso de administrador (é assim que se fica trancado do
--      lado de fora do próprio sistema).
--
--   3. O HISTÓRICO DE ALTERAÇÕES (`app_perfil_log`), preenchido por gatilho.
--      Vale para mudanças feitas no painel E no SQL Editor: no segundo caso
--      não há usuário logado, e o registro diz "SQL Editor" em vez de
--      inventar um autor.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo) e não apaga nenhum dado.
--
--  Depende de: sql/admin.sql (`eh_admin`) e sql/perfil-supervisor.sql
--  (`app_supervisores`, `eh_supervisor`).
-- ============================================================

-- ------------------------------------------------------------
--  1) Histórico de alterações de perfil
-- ------------------------------------------------------------
create table if not exists public.app_perfil_log (
  id     bigint generated always as identity primary key,
  em     timestamptz not null default now(),
  quem   text,                    -- e-mail de quem fez (null = SQL Editor)
  alvo   text not null,           -- e-mail afetado
  acao   text not null,           -- concedido / removido
  perfil text not null            -- admin / supervisor
);

comment on table public.app_perfil_log is
  'Quem ganhou ou perdeu perfil, quando e por quem. Preenchido por gatilho.';

create index if not exists app_perfil_log_em_idx on public.app_perfil_log (em desc);

alter table public.app_perfil_log enable row level security;
grant select on public.app_perfil_log to authenticated;

drop policy if exists "app_perfil_log_select_admin" on public.app_perfil_log;
create policy "app_perfil_log_select_admin"
  on public.app_perfil_log for select to authenticated using (public.eh_admin());

-- Um gatilho só, usado pelas duas listas. O nome do perfil vem do argumento,
-- para não depender do nome da tabela.
create or replace function public.registrar_perfil_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil text := TG_ARGV[0];
  v_quem   text := nullif(auth.jwt() ->> 'email', '');
begin
  if TG_OP = 'INSERT' then
    insert into public.app_perfil_log (quem, alvo, acao, perfil)
    values (v_quem, NEW.email, 'concedido', v_perfil);
    return NEW;
  else
    insert into public.app_perfil_log (quem, alvo, acao, perfil)
    values (v_quem, OLD.email, 'removido', v_perfil);
    return OLD;
  end if;
end;
$$;

drop trigger if exists app_admins_log on public.app_admins;
create trigger app_admins_log
  after insert or delete on public.app_admins
  for each row execute function public.registrar_perfil_log('admin');

drop trigger if exists app_supervisores_log on public.app_supervisores;
create trigger app_supervisores_log
  after insert or delete on public.app_supervisores
  for each row execute function public.registrar_perfil_log('supervisor');

-- ------------------------------------------------------------
--  2) Lista de contas (lê auth.users com segurança)
-- ------------------------------------------------------------
create or replace function public.listar_usuarios()
returns table (
  email         text,
  criado_em     timestamptz,
  ultimo_acesso timestamptz,
  confirmado    boolean,
  perfil        text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    (u.email_confirmed_at is not null) as confirmado,
    case
      when exists (select 1 from public.app_admins a
                    where lower(a.email) = lower(u.email)) then 'admin'
      when exists (select 1 from public.app_supervisores s
                    where lower(s.email) = lower(u.email)) then 'supervisor'
      else 'leitor'
    end as perfil
  from auth.users u
  where public.eh_admin()      -- não sendo admin, a lista volta vazia
  order by u.email;
$$;

grant execute on function public.listar_usuarios() to authenticated;

comment on function public.listar_usuarios() is
  'Contas do painel (e-mail, criação, último acesso, confirmação e perfil). Só devolve linhas para administradores; nunca expõe senha nem token.';

-- ------------------------------------------------------------
--  3) Trocar o perfil de alguém, pelo painel
-- ------------------------------------------------------------
create or replace function public.definir_perfil(p_email text, p_perfil text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_eu    text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.eh_admin() then
    raise exception 'Só administradores podem alterar perfis.' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'Informe o e-mail.' using errcode = '22023';
  end if;
  if p_perfil not in ('admin', 'supervisor', 'leitor') then
    raise exception 'Perfil inválido: %. Use admin, supervisor ou leitor.', p_perfil
      using errcode = '22023';
  end if;

  -- Trava contra se trancar do lado de fora: ninguém rebaixa a si mesmo.
  -- Para sair da administração, peça a outro admin — assim sempre sobra
  -- alguém que consegue entrar e desfazer.
  if v_email = v_eu and p_perfil <> 'admin' then
    raise exception 'Você não pode remover o próprio acesso de administrador. Peça a outro administrador.'
      using errcode = '42501';
  end if;

  -- O e-mail precisa ter login: perfil sem conta não deixa ninguém entrar, e
  -- a linha ficaria pendurada na lista sem nunca valer para nada.
  if not exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Não existe conta com o e-mail %. Crie o login em Authentication → Users antes de dar o perfil.', v_email
      using errcode = 'P0002';
  end if;

  if p_perfil = 'admin' then
    delete from public.app_supervisores where lower(email) = v_email;
    insert into public.app_admins (email) values (v_email) on conflict (email) do nothing;
  elsif p_perfil = 'supervisor' then
    delete from public.app_admins where lower(email) = v_email;
    insert into public.app_supervisores (email) values (v_email) on conflict (email) do nothing;
  else
    delete from public.app_admins where lower(email) = v_email;
    delete from public.app_supervisores where lower(email) = v_email;
  end if;

  return p_perfil;
end;
$$;

grant execute on function public.definir_perfil(text, text) to authenticated;

comment on function public.definir_perfil(text, text) is
  'Troca o perfil de uma conta (admin/supervisor/leitor). Só admin; não deixa ninguém remover o próprio acesso.';
