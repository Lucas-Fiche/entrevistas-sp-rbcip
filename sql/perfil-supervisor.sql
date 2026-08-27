-- ============================================================
--  PERFIL SUPERVISOR
--
--  Hoje existem dois perfis: ADMIN (tabela `app_admins`, criada por
--  sql/admin.sql) e SOMENTE LEITURA (qualquer outro usuário logado).
--  Este arquivo cria o terceiro: SUPERVISOR.
--
--  O que o supervisor pode:
--    • VER as abas Candidatos, Entrevistas Capital, Entrevistas Interior e
--      Formação (leitura, como qualquer usuário logado);
--    • DEFINIR o GRUPO de um bolsista da CAPITAL que ainda **não tem grupo**.
--
--  O que o supervisor NÃO pode: TROCAR um grupo já definido (nem apagá-lo) —
--  isso é só do administrador. Também não pode importar planilhas, enviar
--  convocações, editar qualquer outro campo, desligar bolsista, mexer em metas
--  ou supervisores, nem ver a aba Visualização de dados.
--
--  Preencher um campo vazio é completar um cadastro; trocar um grupo já
--  definido é remanejar gente entre supervisores — decisão de coordenação.
--
--  Por que uma FUNÇÃO e não uma política: o RLS do Postgres decide por LINHA,
--  não por COLUNA — uma política de update que deixasse o supervisor gravar na
--  ficha deixaria ele gravar em TODOS os campos dela. A permissão de escrita
--  continua só do admin; o supervisor grava pela função `definir_grupo`, que é
--  a única porta e só sabe escrever em uma coluna.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo) e não apaga nenhum dado.
--
--  Depende de: sql/admin.sql (função `eh_admin`) e sql/formacao.sql.
--
--  Para incluir um supervisor depois:
--      insert into public.app_supervisores (email) values ('fulano@rbcip.org');
--  Para remover:
--      delete from public.app_supervisores where email = 'fulano@rbcip.org';
-- ============================================================

-- ------------------------------------------------------------
--  1) Lista de supervisores
-- ------------------------------------------------------------
create table if not exists public.app_supervisores (
  email      text primary key,
  criado_em  timestamptz not null default now()
);

comment on table public.app_supervisores is
  'E-mails com perfil SUPERVISOR: veem tudo e só alteram o grupo dos bolsistas da Capital.';

alter table public.app_supervisores enable row level security;

-- Todo mundo logado pode LER a lista (o painel usa isso para saber que perfil
-- mostrar). Ninguém grava por aqui — só pelo SQL Editor.
grant select on public.app_supervisores to authenticated;

drop policy if exists "app_supervisores_select_auth" on public.app_supervisores;
create policy "app_supervisores_select_auth"
  on public.app_supervisores for select to authenticated using (true);

-- Função usada abaixo: o e-mail logado está na lista de supervisores?
create or replace function public.eh_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_supervisores s
    where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.eh_supervisor() to authenticated;

-- ------------------------------------------------------------
--  2) A única escrita do supervisor: o grupo de um bolsista da Capital
--
--  `security definer` = roda com os poderes do dono da função, passando por
--  cima do RLS. Por isso ela mesma confere quem está chamando e limita o que
--  faz: uma coluna, uma linha, só em fichas da Capital — e, para o supervisor,
--  só quando o grupo ainda está vazio.
-- ------------------------------------------------------------
create or replace function public.definir_grupo(p_id uuid, p_grupo text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tipo  text;
  v_atual text;
  v_grupo text;
begin
  if not (public.eh_admin() or public.eh_supervisor()) then
    raise exception 'Sem permissão: só administradores e supervisores podem definir o grupo.'
      using errcode = '42501';
  end if;

  select tipo, nullif(btrim(coalesce(grupo, '')), '')
    into v_tipo, v_atual
    from public.formacao
   where id = p_id;

  if v_tipo is null then
    raise exception 'Ficha não encontrada.' using errcode = 'P0002';
  end if;
  if v_tipo <> 'capital' then
    raise exception 'O grupo só existe na Capital; no Interior a lotação é a região.'
      using errcode = '22023';
  end if;

  -- Espaços em branco viram NULL: "sem grupo" é ausência, não string vazia.
  v_grupo := nullif(btrim(coalesce(p_grupo, '')), '');

  -- O supervisor PREENCHE o que está vazio; TROCAR (ou apagar) é do admin.
  if not public.eh_admin() then
    if v_atual is not null then
      raise exception 'Este bolsista já está no grupo %. Trocar de grupo é ação do administrador.', v_atual
        using errcode = '42501';
    end if;
    if v_grupo is null then
      raise exception 'Escolha um grupo: o supervisor não pode deixar o campo em branco.'
        using errcode = '22023';
    end if;
  end if;

  update public.formacao
     set grupo = v_grupo,
         updated_at = now()
   where id = p_id;

  return v_grupo;
end;
$$;

grant execute on function public.definir_grupo(uuid, text) to authenticated;

comment on function public.definir_grupo(uuid, text) is
  'Única porta de escrita do perfil SUPERVISOR: preenche o grupo de uma ficha da Capital que ainda não tem grupo. O admin usa a mesma função para trocar ou apagar.';
