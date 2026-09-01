-- ============================================================
--  PERFIL FINANCEIRO + aviso de "apto, aguardando termo"
--
--  Quarto perfil, ao lado de ADMIN, SUPERVISOR e SOMENTE LEITURA.
--
--  O que o financeiro pode:
--    • VER tudo o que um usuário de somente leitura vê;
--    • VER uma aba a mais, "Termos de Bolsa", com os termos ativos e os
--      pendentes de Capital e Interior;
--    • RECEBER um e-mail quando alguém fica APTO — cadastro de bolsista
--      preenchido e treinamento realizado —, e só falta o termo para começar
--      a atuar.
--
--  O que o financeiro NÃO pode: nada de escrita. Nenhum botão de ação, como
--  no perfil de leitura.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo) e não apaga nenhum dado. Nada do que já está no ar
--  muda de comportamento: este arquivo só acrescenta.
--
--  Depende de: sql/admin.sql (`eh_admin`), sql/perfil-supervisor.sql,
--  sql/usuarios.sql e sql/formacao.sql.
--
--  Para dar o perfil a alguém (o e-mail precisa ter login no Supabase):
--      insert into public.app_financeiro (email) values ('fulano@rbcip.org');
--  Para tirar:
--      delete from public.app_financeiro where email = 'fulano@rbcip.org';
-- ============================================================

-- ------------------------------------------------------------
--  1) Lista do financeiro
-- ------------------------------------------------------------
create table if not exists public.app_financeiro (
  email      text primary key,
  criado_em  timestamptz not null default now()
);

comment on table public.app_financeiro is
  'E-mails com perfil FINANCEIRO: leitura de tudo, mais a aba Termos de Bolsa e o aviso de quem ficou apto.';

alter table public.app_financeiro enable row level security;
grant select on public.app_financeiro to authenticated;

drop policy if exists "app_financeiro_select_auth" on public.app_financeiro;
create policy "app_financeiro_select_auth"
  on public.app_financeiro for select to authenticated using (true);

create or replace function public.eh_financeiro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_financeiro f
    where lower(f.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.eh_financeiro() to authenticated;

-- Gatilho do histórico de perfis (criado por sql/usuarios.sql), para as
-- entradas e saídas do financeiro aparecerem em "Gerenciar usuários".
do $$
begin
  if to_regproc('public.registrar_perfil_log') is not null then
    execute 'drop trigger if exists app_financeiro_log on public.app_financeiro';
    execute 'create trigger app_financeiro_log
               after insert or delete on public.app_financeiro
               for each row execute function public.registrar_perfil_log(''financeiro'')';
  end if;
end $$;

-- ------------------------------------------------------------
--  2) Marca de que o aviso já foi enviado
--
--  Sem ela, cada rodada da sincronização mandaria o mesmo e-mail de novo, e
--  em pouco tempo ninguém mais leria o aviso.
-- ------------------------------------------------------------
alter table public.formacao add column if not exists aviso_apto_em timestamptz;

comment on column public.formacao.aviso_apto_em is
  'Quando o financeiro foi avisado de que esta pessoa está apta e só falta o termo. Vazio = ainda não avisado.';

-- ------------------------------------------------------------
--  3) Quem está apto e ainda não foi avisado
--
--  Uma VIEW para a regra morar num lugar só — o painel, o Apps Script e
--  qualquer consulta manual leem a mesma definição de "apto".
--
--  Apto = cadastro de bolsista preenchido
--         E treinamento realizado
--         E sem termo de bolsa
--         E não desligado.
-- ------------------------------------------------------------
create or replace view public.aptos_para_termo as
  select
    f.id, f.tipo, f.nome, f.cpf, f.email, f.grupo, f.regiao,
    f.data_entrada, f.aviso_apto_em
  from public.formacao f
  where coalesce(f.desligado_em, '') = ''
    and coalesce(f.termo_link, '') = ''
    and lower(coalesce(f.cadastro_bolsista, '')) = 'realizado'
    -- "Treinamento" é um campo só nos dois projetos, mas fichas antigas ainda
    -- podem trazer o valor no campo online: as duas colunas valem.
    and (lower(coalesce(f.treinamento_presencial, '')) = 'realizado'
      or lower(coalesce(f.treinamento_online, '')) = 'realizado');

comment on view public.aptos_para_termo is
  'Quem já fez cadastro e treinamento e só depende do termo de bolsa para atuar.';

grant select on public.aptos_para_termo to authenticated;

-- ------------------------------------------------------------
--  4) Perfis: a página "Gerenciar usuários" passa a conhecer o financeiro
--
--  As duas funções abaixo substituem as de sql/usuarios.sql. Rodar aquele
--  arquivo de novo depois deste devolve as versões sem financeiro — se isso
--  acontecer, é só rodar este outra vez.
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
      when exists (select 1 from public.app_financeiro fi
                    where lower(fi.email) = lower(u.email)) then 'financeiro'
      else 'leitor'
    end as perfil
  from auth.users u
  where public.eh_admin()
  order by u.email;
$$;

grant execute on function public.listar_usuarios() to authenticated;

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
  if p_perfil not in ('admin', 'supervisor', 'financeiro', 'leitor') then
    raise exception 'Perfil inválido: %. Use admin, supervisor, financeiro ou leitor.', p_perfil
      using errcode = '22023';
  end if;

  if v_email = v_eu and p_perfil <> 'admin' then
    raise exception 'Você não pode remover o próprio acesso de administrador. Peça a outro administrador.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Não existe conta com o e-mail %. Crie o login em Authentication → Users antes de dar o perfil.', v_email
      using errcode = 'P0002';
  end if;

  -- Um perfil por pessoa: entrar num significa sair dos outros.
  delete from public.app_admins       where lower(email) = v_email and p_perfil <> 'admin';
  delete from public.app_supervisores where lower(email) = v_email and p_perfil <> 'supervisor';
  delete from public.app_financeiro   where lower(email) = v_email and p_perfil <> 'financeiro';

  if p_perfil = 'admin' then
    insert into public.app_admins (email) values (v_email) on conflict (email) do nothing;
  elsif p_perfil = 'supervisor' then
    insert into public.app_supervisores (email) values (v_email) on conflict (email) do nothing;
  elsif p_perfil = 'financeiro' then
    insert into public.app_financeiro (email) values (v_email) on conflict (email) do nothing;
  end if;

  return p_perfil;
end;
$$;

grant execute on function public.definir_perfil(text, text) to authenticated;

comment on function public.definir_perfil(text, text) is
  'Troca o perfil de uma conta (admin/supervisor/financeiro/leitor). Só admin; não deixa ninguém remover o próprio acesso.';
