-- ============================================================
--  CONFERIR A ÚLTIMA IMPORTAÇÃO  (só leitura — não muda nada)
--
--  Rode ESTE antes de `sql/desfazer-importacao.sql`. Ele não altera nada: só
--  mostra o que a última importação da aba *Formação* fez, para você conferir
--  que é mesmo aquela que quer desfazer antes de mexer em qualquer coisa.
--
--  Pode rodar quantas vezes quiser, inclusive depois de desfazer — aí serve
--  para conferir que o estrago saiu.
--
--  Cole no SQL Editor do Supabase e clique em Run. O resultado vem em quatro
--  blocos; role a aba "Results" para ver todos.
--
--  Sobre as horas: `importacoes.criado_em`, `formacao.created_at` e
--  `historico.em` são todos do relógio do BANCO, e é por eles que estas
--  consultas se guiam. `formacao.importado_em` vem do relógio do NAVEGADOR de
--  quem enviou o arquivo — serve para dizer QUAIS fichas são da importação,
--  nunca para comparar horas com os outros três.
-- ============================================================

-- ------------------------------------------------------------
--  1) As últimas importações registradas
--
--  Confira o nome do arquivo e a hora: é assim que você identifica a errada.
--  É esse nome que vai em `v_alvo`, no começo do arquivo de desfazer.
-- ------------------------------------------------------------
select
  to_char(criado_em, 'DD/MM/YYYY HH24:MI') as "quando",
  aba                                      as "aba",
  tipo                                     as "projeto",
  arquivo                                  as "arquivo",
  linhas                                   as "linhas do CSV",
  criadas                                  as "fichas novas",
  atualizadas                              as "fichas atualizadas",
  usuario                                  as "quem enviou"
from public.importacoes
order by criado_em desc
limit 10;

-- ------------------------------------------------------------
--  2) O que a última importação de Formação criou e mudou, de verdade
--
--  Compare com a linha de cima: se os números daqui não baterem com os de lá,
--  houve outra mexida depois da importação — e o arquivo de desfazer vai parar
--  sozinho em vez de apagar a coisa errada.
-- ------------------------------------------------------------
with imp as (
  select * from public.importacoes
  where aba = 'formacao' order by criado_em desc limit 1
), alvo as (
  select f.*, imp.criado_em as quando
  from public.formacao f, imp
  where f.importado_em = (select max(importado_em) from public.formacao)
)
select
  (select to_char(criado_em, 'DD/MM/YYYY HH24:MI') from imp)        as "importação",
  (select arquivo from imp)                                          as "arquivo",
  count(*)                                                           as "fichas com o carimbo",
  count(*) filter (where created_at >= quando - interval '30 minutes') as "criadas por ela",
  count(*) filter (where created_at <  quando - interval '30 minutes') as "já existiam"
from alvo;

-- ------------------------------------------------------------
--  3) As fichas que a última importação CRIOU
--
--  Se o arquivo foi para a aba errada, esta lista é de gente que não deveria
--  estar na Formação: em geral sem grupo, sem região, sem cadastro e sem termo.
-- ------------------------------------------------------------
with imp as (
  select criado_em from public.importacoes
  where aba = 'formacao' order by criado_em desc limit 1
)
select
  f.nome              as "nome",
  f.cpf               as "cpf",
  f.tipo              as "projeto",
  f.grupo             as "grupo",
  f.regiao            as "região",
  f.cadastro_bolsista as "cadastro",
  f.termo_link        as "termo"
from public.formacao f, imp
where f.importado_em = (select max(importado_em) from public.formacao)
  and f.created_at >= imp.criado_em - interval '30 minutes'
order by f.nome;

-- ------------------------------------------------------------
--  4) O que ela MUDOU em fichas que já existiam
--
--  Cada linha é um campo que foi por cima de um valor que havia antes. É
--  exatamente isto que o arquivo de desfazer devolve ao lugar. Vazio aqui
--  significa que nenhuma ficha verdadeira foi tocada — ou que o histórico
--  (sql/historico.sql) não estava instalado na hora.
-- ------------------------------------------------------------
with imp as (
  select criado_em from public.importacoes
  where aba = 'formacao' order by criado_em desc limit 1
)
select
  h.nome  as "ficha",
  h.campo as "campo",
  h.de    as "valor de antes",
  h.para  as "valor que entrou"
from public.historico h, imp
where h.tabela = 'formacao'
  and h.evento = 'alterado'
  and h.em between imp.criado_em - interval '30 minutes' and imp.criado_em + interval '30 minutes'
order by h.nome, h.campo;
