-- ============================================================
--  Coluna nova: data_inscricao  (aba Candidatos)
--
--  Guarda a data e a hora em que a pessoa se inscreveu na plataforma. Vem da
--  coluna `data_envio` do arquivo CSV que a plataforma emite.
--
--  Formato gravado: texto "AAAA-MM-DD HH:MM" (ex.: "2026-08-20 19:24").
--  Texto, e não timestamp, de propósito: assim a data ordena como veio, sem
--  fuso horário no meio do caminho — o risco clássico de a inscrição das 21h
--  aparecer no dia seguinte (ou anterior) só por causa da conversão.
--
--  É o que alimenta o gráfico "Inscrições ao longo do tempo" e o filtro de
--  período da seção Inscrições no SIPE, na aba Visualização de dados.
--
--  Fichas importadas antes de a plataforma incluir essa coluna ficam sem data;
--  basta reimportar o CSV novo que elas são preenchidas (a importação atualiza
--  a ficha existente, não duplica).
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente.
-- ============================================================

alter table public.candidatos
  add column if not exists data_inscricao text;

comment on column public.candidatos.data_inscricao is
  'Data/hora da inscrição na plataforma (coluna data_envio do CSV), como "AAAA-MM-DD HH:MM".';

-- Ajuda os filtros por período quando a base crescer.
create index if not exists candidatos_data_inscricao_idx
  on public.candidatos (data_inscricao);
