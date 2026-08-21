-- ============================================================
--  Coluna nova: pedido_regiao  (aba Candidatos)
--
--  Registra o pedido enviado a quem se cadastrou na plataforma de uma região
--  e foi entrevistado na outra: em vez de o sistema remendar o cadastro por
--  dentro, o painel manda a pessoa refazer o cadastro no link do projeto certo.
--
--  Guarda quando o pedido saiu, para qual região e quem enviou. Exemplo:
--    {"em": "21/08/2026", "tipo": "interior", "por": "lucas@rbcip.org"}
--
--  Sem esta coluna o botão continua enviando o e-mail — só não fica o registro
--  de que ele já foi enviado (o painel avisa quando isso acontece).
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente.
-- ============================================================

alter table public.candidatos
  add column if not exists pedido_regiao jsonb;

comment on column public.candidatos.pedido_regiao is
  'Pedido de recadastro na plataforma da região correta: {"em","tipo","por"}.';
