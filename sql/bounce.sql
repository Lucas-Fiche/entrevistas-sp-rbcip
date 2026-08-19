-- ============================================================
--  Coluna nova: email_bounce (aba Candidatos)
--
--  Guarda o motivo da FALHA DE ENTREGA do e-mail do candidato, quando o Gmail
--  devolve um aviso de erro (ex.: "E-mail não existe"). Preenchida pelo botão
--  "Verificar entregas" no painel. NULL = sem falha conhecida.
--
--  Seguro e aditivo. Cole no SQL Editor do Supabase e clique Run.
-- ============================================================

alter table public.candidatos
  add column if not exists email_bounce text;
