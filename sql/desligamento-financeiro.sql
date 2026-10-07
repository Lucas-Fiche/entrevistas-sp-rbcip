-- ============================================================
--  DESLIGAMENTO PELO FINANCEIRO (RH)
--
--  Hoje só o administrador desliga um bolsista. O RH, que é quem fica sabendo
--  primeiro de desistência e abandono, tinha de pedir para a coordenação fazer
--  — e o desligamento atrasava exatamente onde ele precisa ser rápido, porque
--  bolsista desligado continua ocupando vaga.
--
--  Este arquivo cria a porta para isso, com três cuidados:
--
--  1. O RLS do Postgres decide por LINHA, não por coluna. Liberar o update da
--     ficha para o financeiro liberaria a ficha inteira — nome, CPF, grupo,
--     termo. Por isso a escrita passa por uma função `security definer` que
--     mexe em quatro colunas e mais nada: o mesmo desenho de `definir_grupo`
--     (supervisor) e `definir_antecedentes` (financeiro).
--
--  2. Fica gravado QUEM desligou (`desligado_por`) e de que lado veio a
--     decisão (`desligado_origem`: 'financeiro' ou 'admin'). O e-mail sai de
--     `auth.jwt()`, nunca de um parâmetro — quem chama não escolhe de quem é
--     a assinatura.
--
--  3. `desligado_origem` é gravada no momento da ação, e não deduzida depois
--     do perfil de quem assinou. Se João sair do financeiro amanhã, os
--     desligamentos que ele fez continuam marcados como do RH: histórico que
--     muda sozinho não é histórico.
--
--  O administrador usa a MESMA função. Um caminho só, uma regra só — e assim
--  todo desligamento passa a ter assinatura, não só os do RH.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente (pode rodar
--  de novo) e não apaga nada. Se aparecer o aviso de Row Level Security,
--  escolha "Run without RLS": este arquivo não cria tabela nenhuma.
--
--  Depende de: sql/formacao.sql, sql/admin.sql (`eh_admin`) e
--  sql/perfil-financeiro.sql (`eh_financeiro`).
-- ============================================================

-- ------------------------------------------------------------
--  0) Os dois perfis precisam existir ANTES
--
--  Aqui não cabe o "se não existir, vale true" dos outros arquivos: isto
--  decide QUEM PODE DESLIGAR. Na dúvida, o certo é parar e dizer qual arquivo
--  falta, não abrir a porta.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.eh_admin()') is null then
    raise exception 'Rode antes sql/admin.sql: a função eh_admin() ainda não existe.';
  end if;
  if to_regprocedure('public.eh_financeiro()') is null then
    raise exception 'Rode antes sql/perfil-financeiro.sql: a função eh_financeiro() ainda não existe.';
  end if;
  -- As colunas do desligamento vêm de outro arquivo. Sem esta conferência o
  -- `create function` passa (o corpo PL/pgSQL não é checado contra o esquema)
  -- e a falha só aparece no primeiro desligamento de verdade, em produção,
  -- como "column desligado_em does not exist".
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'formacao' and column_name = 'desligado_em'
  ) then
    raise exception 'Rode antes sql/supervisores.sql: a coluna formacao.desligado_em ainda não existe.';
  end if;
end $$;

-- ------------------------------------------------------------
--  1) As duas colunas de assinatura
-- ------------------------------------------------------------
alter table public.formacao
  add column if not exists desligado_por    text,
  add column if not exists desligado_origem text;

comment on column public.formacao.desligado_por is
  'E-mail de quem desligou. Preenchido pela função desligar_bolsista, a partir do token de quem chamou — nunca de um parâmetro.';
comment on column public.formacao.desligado_origem is
  'De que lado veio o desligamento: financeiro (RH) ou admin (coordenação). Gravado no momento da ação, para o rótulo não mudar se a pessoa trocar de perfil depois.';

-- ------------------------------------------------------------
--  2) A função
--
--  `p_data` vazia = reverter o desligamento (limpa as quatro colunas).
--
--  O financeiro só mexe em ficha que esteja no projeto ou que ele mesmo tenha
--  desligado. Desfazer um desligamento da coordenação seria derrubar uma
--  decisão que não é dele; corrigir o próprio engano, sim, é dele.
-- ------------------------------------------------------------
create or replace function public.desligar_bolsista(p_id uuid, p_data text, p_motivo text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_txt    text := nullif(btrim(coalesce(p_data, '')), '');
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_data   date;
  v_quem   text := nullif(auth.jwt() ->> 'email', '');
  v_admin  boolean := public.eh_admin();
  v_fin    boolean := public.eh_financeiro();
  v_origem text;
  v_atual  record;
begin
  if not (v_admin or v_fin) then
    raise exception 'Sem permissão: só o administrador e o financeiro desligam um bolsista.'
      using errcode = '42501';
  end if;

  select desligado_em, desligado_origem into v_atual
  from public.formacao where id = p_id;

  if not found then
    raise exception 'Ficha não encontrada.' using errcode = 'P0002';
  end if;

  -- Quem assina. O admin assina como admin mesmo que também esteja na lista do
  -- financeiro: o perfil mais forte é o que responde pela decisão.
  v_origem := case when v_admin then 'admin' else 'financeiro' end;

  -- O financeiro não desfaz nem reescreve o que a coordenação decidiu.
  if v_fin and not v_admin
     and v_atual.desligado_em is not null
     and coalesce(v_atual.desligado_origem, 'admin') <> 'financeiro' then
    raise exception 'Este desligamento foi feito pela coordenação. Só o administrador pode alterá-lo.'
      using errcode = '42501';
  end if;

  if v_txt is null then
    -- Reverter: a pessoa volta para a lista de quem está no projeto, e a
    -- assinatura sai junto — ela era do desligamento, não da ficha.
    update public.formacao
       set desligado_em = null, desligado_motivo = null,
           desligado_por = null, desligado_origem = null,
           updated_at = now()
     where id = p_id;
    return null;
  end if;

  if v_txt !~ '^\d{2}/\d{2}/\d{4}$' then
    raise exception 'Data inválida: use dd/mm/aaaa.' using errcode = '22007';
  end if;

  begin
    v_data := to_date(v_txt, 'DD/MM/YYYY');
  exception when others then
    raise exception 'Data inválida: % não existe no calendário.', v_txt using errcode = '22007';
  end;

  -- `to_date` é tolerante: 31/02/2026 vira 03/03/2026 sem reclamar. A volta ao
  -- texto é o que denuncia o dia que não existe.
  if to_char(v_data, 'DD/MM/YYYY') <> v_txt then
    raise exception 'Data inválida: % não existe no calendário.', v_txt using errcode = '22007';
  end if;

  -- O banco roda em UTC, à frente de Brasília — nunca atrás. Então "hoje"
  -- digitado aqui jamais é recusado por engano; o que esta linha pega é o ano
  -- trocado (2027 no lugar de 2026).
  if v_data > current_date then
    raise exception 'A data do desligamento não pode estar no futuro.' using errcode = '22007';
  end if;

  update public.formacao
     set desligado_em = v_txt,
         desligado_motivo = v_motivo,
         desligado_por = v_quem,
         desligado_origem = v_origem,
         updated_at = now()
   where id = p_id;

  return v_txt;
end;
$$;

grant execute on function public.desligar_bolsista(uuid, text, text) to authenticated;

comment on function public.desligar_bolsista(uuid, text, text) is
  'Desliga (ou reverte o desligamento de) um bolsista, assinando quem fez e de que lado. Única porta dessas quatro colunas: admin e financeiro, e só nelas. O financeiro não altera desligamento feito pela coordenação.';

-- ------------------------------------------------------------
--  3) Conferência
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.desligar_bolsista(uuid,text,text)') is null then
    raise exception 'A função desligar_bolsista NÃO foi criada.';
  end if;
  raise notice 'OK: desligar_bolsista criada, e formacao ganhou desligado_por e desligado_origem.';
  raise notice 'O financeiro passa a ver o botão de desligar na aba Formação.';
  raise notice 'Desligamentos antigos ficam sem assinatura (foram feitos antes disto existir)';
  raise notice 'e o painel mostra "—" no lugar do nome, em vez de inventar um.';
end $$;
