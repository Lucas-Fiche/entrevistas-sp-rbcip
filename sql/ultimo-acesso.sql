-- ============================================================
--  ÚLTIMO ACESSO DE VERDADE
--
--  O problema: a coluna "Último acesso" de *Gerenciar usuários* vinha de
--  `auth.users.last_sign_in_at`, que o Supabase só atualiza quando alguém
--  DIGITA E-MAIL E SENHA. Quem já está logado continua entrando no painel por
--  meses sem passar por ali — a sessão se renova sozinha, em silêncio, e
--  `last_sign_in_at` fica parado no dia do último login.
--
--  Na prática a coluna dizia "último login", não "último acesso", e uma pessoa
--  que usou o sistema ontem aparecia sumida há semanas. Pior: é justamente a
--  coluna usada para decidir quem não usa mais e pode perder o acesso.
--
--  A correção tem três fontes, da mais precisa para a menos:
--
--    1. `public.acessos` — o painel carimba aqui toda vez que abre. É o que
--       "último acesso" deveria significar desde o começo.
--    2. `auth.sessions` — quando a pessoa ainda tem sessão viva, o Supabase
--       registra cada renovação. Conserta o passado sem esperar ninguém
--       reabrir o painel.
--    3. `auth.users.last_sign_in_at` — o valor antigo, que continua valendo
--       para quem não aparece nas duas primeiras.
--
--  A função devolve a MAIOR das três. Nunca mostra menos do que mostrava
--  antes: só corrige para cima.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente.
--
--  Depende de: sql/usuarios.sql e sql/perfil-financeiro.sql (esta função
--  substitui a `listar_usuarios` daqueles arquivos; rodar um deles de novo
--  depois deste devolve a versão antiga — é só rodar este outra vez).
-- ============================================================

-- ------------------------------------------------------------
--  0) O que precisa existir antes
--
--  A função de baixo é `language sql`: o Postgres confere o corpo dela na
--  criação. Sem estas tabelas o erro sairia como "relation ... does not
--  exist", que não diz qual arquivo rodar.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.eh_admin()') is null then
    raise exception 'Rode antes sql/admin.sql: a função eh_admin() ainda não existe.';
  end if;
  if to_regclass('public.app_supervisores') is null then
    raise exception 'Rode antes sql/perfil-supervisor.sql: a tabela app_supervisores ainda não existe.';
  end if;
  if to_regclass('public.app_financeiro') is null then
    raise exception 'Rode antes sql/perfil-financeiro.sql: a tabela app_financeiro ainda não existe.';
  end if;
end $$;

-- ------------------------------------------------------------
--  1) Onde o painel carimba a visita
-- ------------------------------------------------------------
create table if not exists public.acessos (
  email         text primary key,
  ultimo_acesso timestamptz not null default now(),
  visitas       integer not null default 1
);

comment on table public.acessos is
  'Quando cada conta abriu o painel pela última vez. Preenchida pela função registrar_acesso, chamada pelo próprio painel.';

alter table public.acessos enable row level security;
grant select on public.acessos to authenticated;

-- Ler: qualquer pessoa logada (a página de usuários é de admin, mas o dado em
-- si não é sigiloso). Gravar: ninguém direto — só pela função abaixo, que
-- carimba a própria conta e mais nenhuma.
drop policy if exists "acessos_select_auth" on public.acessos;
create policy "acessos_select_auth"
  on public.acessos for select to authenticated using (true);

-- ------------------------------------------------------------
--  2) O carimbo
--
--  Sem parâmetro nenhum de propósito: a conta vem do token de quem chamou.
--  Se recebesse um e-mail, qualquer pessoa logada poderia forjar o acesso de
--  outra — e a coluna deixaria de servir para o que existe.
-- ------------------------------------------------------------
create or replace function public.registrar_acesso()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_agora timestamptz := now();
begin
  if v_email = '' then
    return null;   -- sem login identificado: não carimba, e não é erro
  end if;

  insert into public.acessos (email, ultimo_acesso, visitas)
       values (v_email, v_agora, 1)
  on conflict (email) do update
          set ultimo_acesso = excluded.ultimo_acesso,
              visitas = public.acessos.visitas + 1;

  return v_agora;
end;
$$;

grant execute on function public.registrar_acesso() to authenticated;

comment on function public.registrar_acesso() is
  'Carimba o acesso da conta que chamou (o e-mail vem do token, não de parâmetro). O painel chama ao abrir.';

-- ------------------------------------------------------------
--  3) listar_usuarios passa a somar as três fontes
--
--  O trecho de `auth.sessions` é montado na hora: a tabela é do Supabase e
--  pode mudar de uma versão para outra. Se ela (ou a coluna `refreshed_at`)
--  não existir, a função nasce sem essa fonte em vez de quebrar a página
--  inteira de usuários.
-- ------------------------------------------------------------
do $$
declare
  v_sessoes text := 'null::timestamptz';
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'sessions' and column_name = 'refreshed_at'
  ) then
    v_sessoes := '(select max(greatest(s.refreshed_at, s.updated_at, s.created_at))'
              || '   from auth.sessions s where s.user_id = u.id)';
  end if;

  execute '
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
as $f$
  select
    u.email::text,
    u.created_at,
    -- greatest() ignora nulos: basta uma das três fontes ter valor.
    greatest(u.last_sign_in_at, ' || v_sessoes || ', ac.ultimo_acesso),
    (u.email_confirmed_at is not null) as confirmado,
    case
      when exists (select 1 from public.app_admins a
                    where lower(a.email) = lower(u.email)) then ''admin''
      when exists (select 1 from public.app_supervisores s2
                    where lower(s2.email) = lower(u.email)) then ''supervisor''
      when exists (select 1 from public.app_financeiro fi
                    where lower(fi.email) = lower(u.email)) then ''financeiro''
      else ''leitor''
    end as perfil
  from auth.users u
  left join public.acessos ac on ac.email = lower(u.email)
  where public.eh_admin()
  order by u.email;
$f$';
end $$;

grant execute on function public.listar_usuarios() to authenticated;

comment on function public.listar_usuarios() is
  'Contas do painel com perfil e último acesso real (carimbo do painel, sessão viva ou último login — o mais recente dos três).';
