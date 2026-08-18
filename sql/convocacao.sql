-- ============================================================
--  Coluna nova: data_convocacao_entrevista (aba Candidatos)
--
--  Registra a data em que o candidato recebeu o e-mail de convocação para a
--  ENTREVISTA (a de CADASTRO já usa a coluna data_convocacao_cadastro).
--
--  Seguro e aditivo: não altera nada existente. Cole no SQL Editor e clique Run.
-- ============================================================

alter table public.candidatos
  add column if not exists data_convocacao_entrevista text;
