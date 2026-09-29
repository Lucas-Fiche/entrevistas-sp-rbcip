-- ============================================================
--  PREVER O RESULTADO DE `desfazer-importacao.sql`  (só leitura)
--
--  Uma consulta só, um resultado só: quantas fichas existem hoje, quantas vão
--  ser apagadas e quantas vão permanecer — quebradas por situação, para você
--  comparar com o que vê na tela ANTES de rodar qualquer coisa.
--
--  Ela usa EXATAMENTE as mesmas regras do arquivo de desfazer (mesmo carimbo,
--  mesma janela de tempo, mesmo corte entre "criada agora" e "já existia").
--  Então o número que aparece aqui é o número que vai acontecer — não é
--  estimativa.
--
--  Cole no SQL Editor do Supabase e clique em Run. Não altera nada: pode rodar
--  à vontade, antes e depois.
--
--  COMO LER
--    · "vão PERMANECER" é o total que sobra na aba Formação daquele projeto,
--      somando ativos, aguardando termo e desligados.
--    · Se o que você confere na tela é só a lista de ATIVOS, compare com a
--      linha "permanecem — ativas", e não com o total.
--    · A última linha repete o que o registro da importação anotou. Se ela não
--      bater com "serão APAGADAS", o arquivo de desfazer vai parar sozinho sem
--      mexer em nada — é a trava dele.
-- ============================================================

with imp as (
  -- A última importação registrada na aba Formação.
  select * from public.importacoes
  where aba = 'formacao'
  order by criado_em desc
  limit 1
),
carimbo as (
  -- O carimbo que as fichas dessa importação levam. Vem do relógio do
  -- NAVEGADOR de quem enviou o arquivo, por isso serve para dizer QUAIS
  -- fichas, nunca para comparar horas.
  select max(importado_em) as valor from public.formacao
),
alvo as (
  select
    f.*,
    -- O mesmo corte do arquivo de desfazer: tem o carimbo E nasceu na hora da
    -- importação (relógio do BANCO, que é o de `created_at` e o de
    -- `importacoes.criado_em`).
    (f.importado_em = (select valor from carimbo)
     and f.created_at >= (select criado_em from imp) - interval '30 minutes') as vai_sumir
  from public.formacao f
  where f.tipo = (select tipo from imp)
)
select 1 as "#", 'Importação a desfazer: ' || coalesce((select arquivo from imp), '(sem nome)')
       || ' · ' || to_char((select criado_em from imp), 'DD/MM/YYYY HH24:MI')
       || ' · projeto ' || coalesce((select tipo from imp), '?')          as "o que", null::bigint as "quantas"
union all
select 2, 'Fichas deste projeto HOJE',                        count(*)                             from alvo
union all
select 3, '· serão APAGADAS (a importação criou)',            count(*) filter (where vai_sumir)     from alvo
union all
select 4, '· vão PERMANECER',                                 count(*) filter (where not vai_sumir) from alvo
union all
select 5, 'Das que permanecem — ativas (com termo)',
       count(*) filter (where not vai_sumir and termo_link is not null and desligado_em is null)     from alvo
union all
select 6, 'Das que permanecem — aguardando termo',
       count(*) filter (where not vai_sumir and termo_link is null and desligado_em is null)         from alvo
union all
select 7, 'Das que permanecem — desligadas',
       count(*) filter (where not vai_sumir and desligado_em is not null)                            from alvo
union all
select 8, 'Das que permanecem — corrigidas pelo desfazer (a importação mexeu nelas)',
       count(*) filter (where not vai_sumir and importado_em = (select valor from carimbo))          from alvo
union all
select 9, 'Confere? o registro da importação anotou (novas)', (select criadas from imp)
union all
select 10, 'Confere? o registro da importação anotou (atualizadas)', (select atualizadas from imp)
order by 1;
