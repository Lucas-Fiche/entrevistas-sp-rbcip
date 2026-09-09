-- ============================================================
--  ANTECEDENTES CRIMINAIS — a terceira etapa antes do termo de bolsa
--
--  O caminho até o termo tem três etapas:
--      1) Cadastro de bolsista  → chega sozinho, pela sincronização
--      2) Treinamento           → preenchido no painel
--      3) Antecedentes criminais → esta coluna
--
--  Guarda a DATA em que a pessoa enviou a certidão (texto dd/mm/aaaa, o mesmo
--  formato das outras datas da ficha). Vazio = ainda não enviou.
--
--  Quem preenche: ADMINISTRADOR e FINANCEIRO — e mais ninguém. Como o RLS do
--  Postgres decide por LINHA e não por COLUNA, liberar a linha para o
--  financeiro liberaria a ficha inteira (nome, CPF, termo, desligamento). Por
--  isso a escrita passa pela função `definir_antecedentes`, que é a única
--  porta e só sabe escrever nesta coluna — o mesmo desenho de `definir_grupo`,
--  usado pelo supervisor.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente (pode rodar
--  de novo) e não apaga nenhum dado.
--
--  Depende de: sql/formacao.sql, sql/admin.sql (`eh_admin`) e
--  sql/perfil-financeiro.sql (`eh_financeiro`).
-- ============================================================

-- ------------------------------------------------------------
--  0) As duas funções de perfil precisam existir ANTES
--
--  Aqui não cabe o "se não existir, vale true" dos outros arquivos: isso é o
--  que decide QUEM PODE ESCREVER. Na dúvida, o certo é parar e avisar qual
--  arquivo falta, não abrir a porta.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.eh_admin()') is null then
    raise exception 'Rode antes sql/admin.sql: a função eh_admin() ainda não existe.';
  end if;
  if to_regprocedure('public.eh_financeiro()') is null then
    raise exception 'Rode antes sql/perfil-financeiro.sql: a função eh_financeiro() ainda não existe.';
  end if;
end $$;

-- ------------------------------------------------------------
--  1) A coluna
-- ------------------------------------------------------------
alter table public.formacao add column if not exists antecedentes_em text;

comment on column public.formacao.antecedentes_em is
  'Data (dd/mm/aaaa) em que o bolsista enviou os antecedentes criminais. Vazio = ainda não enviou. Só admin e financeiro escrevem, pela função definir_antecedentes.';

-- ------------------------------------------------------------
--  2) A única porta de escrita
--
--  `security definer` = roda com os poderes do dono da função, passando por
--  cima do RLS. Por isso ela mesma confere quem chamou e limita o que faz:
--  uma coluna, uma linha.
--
--  A data é conferida aqui, e não só na tela: data torta gravada hoje vira
--  relatório errado depois, e o painel não é o único caminho até o banco.
-- ------------------------------------------------------------
create or replace function public.definir_antecedentes(p_id uuid, p_data text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_txt  text := nullif(btrim(coalesce(p_data, '')), '');
  v_data date;
begin
  if not (public.eh_admin() or public.eh_financeiro()) then
    raise exception 'Sem permissão: só o administrador e o financeiro registram os antecedentes criminais.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.formacao where id = p_id) then
    raise exception 'Ficha não encontrada.' using errcode = 'P0002';
  end if;

  -- Vazio é apagar (corrigir um lançamento errado), e é permitido.
  if v_txt is not null then
    if v_txt !~ '^\d{2}/\d{2}/\d{4}$' then
      raise exception 'Data inválida: use dd/mm/aaaa.' using errcode = '22007';
    end if;

    begin
      v_data := to_date(v_txt, 'DD/MM/YYYY');
    exception when others then
      raise exception 'Data inválida: % não existe no calendário.', v_txt using errcode = '22007';
    end;

    -- `to_date` é tolerante: 31/02/2026 vira 03/03/2026 sem reclamar. A volta
    -- ao texto é o que denuncia o dia que não existe.
    if to_char(v_data, 'DD/MM/YYYY') <> v_txt then
      raise exception 'Data inválida: % não existe no calendário.', v_txt using errcode = '22007';
    end if;

    -- O banco roda em UTC, que está à frente do horário de Brasília — nunca
    -- atrás. Então "hoje" digitado aqui jamais é recusado por engano; o que
    -- esta linha pega é o ano trocado (2027 no lugar de 2026).
    if v_data > current_date then
      raise exception 'A data do envio dos antecedentes não pode estar no futuro.'
        using errcode = '22007';
    end if;
  end if;

  update public.formacao
     set antecedentes_em = v_txt,
         updated_at = now()
   where id = p_id;

  return v_txt;
end;
$$;

grant execute on function public.definir_antecedentes(uuid, text) to authenticated;

comment on function public.definir_antecedentes(uuid, text) is
  'Registra (ou apaga) a data de envio dos antecedentes criminais de uma ficha. Única porta de escrita dessa coluna: só admin e financeiro, e só nela.';
