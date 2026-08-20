-- ============================================================
--  CORRIGIR as entrevistas pontuadas sobre 38 em vez de 36
--
--  O que aconteceu: a regra de pontuação dá 1 ponto para qualquer pergunta de
--  duas opções fora da Elegibilidade. Quando as perguntas "O candidato possui
--  inscrição no SIPE?" e "O candidato foi indicado por alguém?" entraram na
--  seção de Identificação, elas passaram a ser pontuadas sem querer: o máximo
--  virou 38 e quem respondeu "Sim" ganhou até 2 pontos indevidos.
--
--  Nem uma nem outra é critério de avaliação — ter inscrição no SIPE ou ter
--  sido indicado por alguém não é mérito. O formulário já foi corrigido; este
--  script acerta as entrevistas gravadas no período.
--
--  A correção é exata, não é estimativa: desconta 1 ponto por cada uma dessas
--  duas perguntas respondida com "Sim", exatamente como foram somadas.
--
--  Como usar: rode o bloco 1 para VER o que será alterado. Se concordar, rode
--  os blocos 2 e 3. Entrevistas de candidatos faltantes não têm pontuação e
--  não são tocadas.
-- ============================================================

-- ------------------------------------------------------------
--  1) Prévia — o que vai mudar (não altera nada)
-- ------------------------------------------------------------
select
  candidato,
  data_entrevista,
  pontuacao_total                          as total_atual,
  pontuacao_maxima                         as maximo_atual,
  respostas->>'sipe_inscricao'             as sipe,
  respostas->>'indicacao'                  as indicacao,
  pontuacao_total
    - (case when respostas->>'sipe_inscricao' = 'Sim' then 1 else 0 end)
    - (case when respostas->>'indicacao'      = 'Sim' then 1 else 0 end) as total_corrigido
from public.entrevistas
where pontuacao_maxima = 38
order by data_entrevista, candidato;

-- ------------------------------------------------------------
--  2) Cópia de segurança das linhas afetadas
-- ------------------------------------------------------------
create table if not exists public.entrevistas_pontuacao_backup as
  select id, candidato, data_entrevista, pontuacao_total, pontuacao_maxima, now() as copiado_em
  from public.entrevistas
  where pontuacao_maxima = 38;

alter table public.entrevistas_pontuacao_backup enable row level security;

-- ------------------------------------------------------------
--  3) Correção
-- ------------------------------------------------------------
update public.entrevistas
set pontuacao_total = pontuacao_total
      - (case when respostas->>'sipe_inscricao' = 'Sim' then 1 else 0 end)
      - (case when respostas->>'indicacao'      = 'Sim' then 1 else 0 end),
    pontuacao_maxima = 36
where pontuacao_maxima = 38;

-- ------------------------------------------------------------
--  4) Conferência — não deve sobrar nenhuma linha com 38
-- ------------------------------------------------------------
select
  count(*) filter (where pontuacao_maxima = 38) as ainda_com_38,
  count(*) filter (where pontuacao_maxima = 36) as com_36,
  count(*) filter (where pontuacao_maxima is null) as sem_pontuacao
from public.entrevistas;

-- Quando não precisar mais da cópia:
--   drop table if exists public.entrevistas_pontuacao_backup;
