-- ============================================================
--  COLUNA: ordem  (posição da linha no arquivo CSV)
--
--  As tabelas de controle passam a ser exibidas na MESMA ordem do arquivo
--  importado — que é a ordem em que as pessoas se inscreveram (Candidatos) ou
--  entraram no projeto (Formação). Sem isso, a listagem sai em ordem
--  alfabética, que não corresponde a nada do processo.
--
--  Como usar:
--  1. Cole no SQL Editor do Supabase e clique em Run (é idempotente).
--  2. Reimporte os CSVs nas abas Candidatos e Formação uma vez. É a
--     importação que grava a posição de cada linha.
--
--  Enquanto a reimportação não acontece, as fichas antigas ficam no fim da
--  lista (em ordem alfabética) e o painel avisa isso no rodapé da tabela.
-- ============================================================

alter table public.candidatos
  add column if not exists ordem integer;

comment on column public.candidatos.ordem is
  'Posição da linha no CSV de inscrições (1 = primeira). Define a ordem de exibição.';

create index if not exists candidatos_tipo_ordem_idx
  on public.candidatos (tipo, ordem);

do $$
begin
  if to_regclass('public.formacao') is not null then
    execute 'alter table public.formacao add column if not exists ordem integer';
    execute 'comment on column public.formacao.ordem is ''Posição da linha no CSV de formação (1 = primeira). Define a ordem de exibição.''';
    execute 'create index if not exists formacao_tipo_ordem_idx on public.formacao (tipo, ordem)';
  end if;
end $$;
