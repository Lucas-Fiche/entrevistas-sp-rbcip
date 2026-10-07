-- ============================================================
--  ASSINAR OS DESLIGAMENTOS ANTIGOS
--
--  Os desligamentos feitos antes de sql/desligamento-financeiro.sql ficaram
--  sem assinatura, e o painel mostra "sem registro de quem fez". Este arquivo
--  preenche as duas colunas desses casos.
--
--  Ele NÃO assume tudo: onde o histórico souber quem foi, usa o nome de lá.
--
--    1. `historico` registra, em cada alteração, o campo, o valor de antes, o
--       de depois e QUEM fez. Para toda ficha cujo desligamento tenha sido
--       registrado ali, o e-mail é recuperado — é o autor de verdade, não um
--       palpite.
--    2. Para o que é mais antigo que o próprio histórico, entra o e-mail
--       declarado abaixo. Esses são os únicos casos em que a assinatura é uma
--       afirmação sua, e o arquivo diz no fim quantos foram.
--
--  `desligado_origem` fica 'admin' em todos: antes desta semana, desligar era
--  ação exclusiva do administrador. Isso não é suposição, é como a permissão
--  funcionava.
--
--  NÃO TOCA em ficha que já tenha assinatura, nem em quem está no projeto. Se
--  rodar duas vezes, a segunda não faz nada.
--
--  Para desfazer:
--    update public.formacao set desligado_por = null, desligado_origem = null
--     where desligado_origem = 'admin';
--
--  Cole no SQL Editor do Supabase e clique em Run.
--  Depende de: sql/desligamento-financeiro.sql já rodado.
-- ============================================================

do $$
declare
  -- >>> Seu e-mail NO PAINEL (o do login, não o pessoal). É o que entra nos
  -- desligamentos antigos demais para estarem no histórico.
  v_eu       constant text := 'lucas@rbcip.org';

  v_tem_hist boolean;
  v_do_hist  integer := 0;
  v_declarado integer := 0;
  v_falta    integer;
begin
  if to_regprocedure('public.desligar_bolsista(uuid,text,text)') is null then
    raise exception 'Rode antes sql/desligamento-financeiro.sql: as colunas de assinatura ainda não existem.';
  end if;

  select count(*) into v_falta
  from public.formacao
  where desligado_em is not null and desligado_origem is null;

  if v_falta = 0 then
    raise notice 'Nenhum desligamento sem assinatura. Nada a fazer.';
    return;
  end if;
  raise notice 'Desligamentos sem assinatura: %', v_falta;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'historico'
  ) into v_tem_hist;

  -- 1) O que o histórico sabe. `distinct on (registro_id) ... order by em desc`
  --    pega a ÚLTIMA vez que alguém marcou a ficha como desligada — se houve
  --    correção depois, quem assina é quem deixou a ficha como ela está.
  if v_tem_hist then
    with autor as (
      select distinct on (h.registro_id) h.registro_id, h.quem
      from public.historico h
      where h.tabela = 'formacao'
        and h.campo = 'desligado_em'
        and h.para is not null and btrim(h.para) <> ''
        and nullif(btrim(coalesce(h.quem, '')), '') is not null
      order by h.registro_id, h.em desc
    )
    update public.formacao f
       set desligado_por = autor.quem,
           desligado_origem = 'admin',
           updated_at = now()
      from autor
     where f.id = autor.registro_id
       and f.desligado_em is not null
       and f.desligado_origem is null;
    get diagnostics v_do_hist = row_count;
    raise notice '· % recuperado(s) do histórico (autor de verdade)', v_do_hist;
  else
    raise notice '· histórico não instalado: nada a recuperar de lá';
  end if;

  -- 2) O resto: anteriores ao histórico.
  update public.formacao
     set desligado_por = v_eu,
         desligado_origem = 'admin',
         updated_at = now()
   where desligado_em is not null and desligado_origem is null;
  get diagnostics v_declarado = row_count;
  raise notice '· % assinado(s) como % (anteriores ao histórico)', v_declarado, v_eu;

  raise notice '----------------------------------------';
  raise notice 'Pronto. Recarregue o painel com Ctrl+F5: a lista de desligados';
  raise notice 'passa a mostrar "pelo admin" nesses, com o e-mail no';
  raise notice 'passe-o-mouse.';
end $$;

-- Conferência: como ficou cada desligamento.
select
  coalesce(desligado_origem, '(sem assinatura)') as "origem",
  coalesce(desligado_por, '—')                   as "assinado por",
  count(*)                                       as "fichas"
from public.formacao
where desligado_em is not null
group by 1, 2
order by 3 desc, 1, 2;
