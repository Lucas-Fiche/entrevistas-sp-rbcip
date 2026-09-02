-- ============================================================
--  VIEW: entrevistas_detalhado
--  "Abre" as respostas (que ficam no JSON da coluna `respostas`) em COLUNAS,
--  para visualizar como uma planilha no Table Editor / SQL Editor do Supabase.
--
--  Por que isso é necessário?
--  As respostas de cada entrevista NÃO ficam em colunas soltas na tabela.
--  Elas ficam todas dentro de UMA coluna chamada `respostas`, do tipo JSONB.
--  Esta view lê cada campo desse JSON (com o operador ->>) e expõe como coluna.
--
--  Como usar:
--  1. Cole este script no SQL Editor do Supabase e clique em Run.
--  2. Depois, em Table Editor, aparece a view "entrevistas_detalhado".
--     (Ou rode: select * from public.entrevistas_detalhado;)
-- ============================================================

create or replace view public.entrevistas_detalhado as
select
  e.id,
  e.created_at,
  e.tipo,
  e.candidato,
  e.data_entrevista,
  e.entrevistador,
  e.perfil,                                                        -- "Avaliador (Entrevistador)" ou "Supervisor"
  e.nao_compareceu,
  e.nao_cumpre_requisitos,
  e.recomendacao,
  e.pontuacao_total,
  e.pontuacao_maxima,
  e.ata_link,

  -- Identificação (perguntas extras)
  e.respostas->>'cpf_candidato'           as cpf_candidato,        -- chave que liga inscrição → entrevista → formação
  e.respostas->>'sipe_inscricao'          as sipe_inscricao,       -- Sim/Não
  e.respostas->>'indicacao'               as indicacao,            -- Sim/Não (foi indicado?)
  e.respostas->>'indicacao_nome'          as indicacao_nome,       -- nome de quem indicou (se Sim)

  -- Elegibilidade (alguns campos existem só na Capital ou só no Interior)
  e.respostas->>'residencia'               as residencia_capital,   -- Capital (Sim/Não)
  e.respostas->>'residencia_cidade'        as residencia_cidade,    -- Interior (cidade)
  e.respostas->>'regiao_atuacao'           as regiao,               -- Interior (região)
  e.respostas->>'cnh'                      as cnh,
  e.respostas->>'disponibilidade_horaria'  as disponibilidade_horaria,   -- Capital
  e.respostas->>'inicio_imediato'          as inicio_imediato,           -- Capital
  e.respostas->>'disponibilidade_formacao' as disponibilidade_formacao,  -- Interior
  e.respostas->>'disponibilidade_horario'  as disponibilidade_horario,   -- Interior
  e.respostas->>'perfil_avaliado'          as perfil_avaliado,           -- qual roteiro foi aplicado

  -- ==========================================================
  --  PERFIL AVALIADOR (ENTREVISTADOR) — só preenchido quando
  --  perfil_avaliado = 'Avaliador (Entrevistador)'
  -- ==========================================================
  -- Bloco 1 (STAR) — texto + nota (1 a 5)
  e.respostas->>'exp_entrevistas'              as exp_entrevistas,
  e.respostas->>'exp_entrevistas_nota'         as exp_entrevistas_nota,
  e.respostas->>'exp_publico_v1'               as exp_publico,
  e.respostas->>'exp_publico_v1_nota'          as exp_publico_nota,
  e.respostas->>'exp_organizacao_dados'        as exp_organizacao_dados,
  e.respostas->>'exp_organizacao_dados_nota'   as exp_organizacao_dados_nota,
  e.respostas->>'comprometimento'              as comprometimento,
  e.respostas->>'comprometimento_nota'         as comprometimento_nota,
  e.respostas->>'tolerancia_rotina'            as tolerancia_rotina,
  e.respostas->>'tolerancia_rotina_nota'       as tolerancia_rotina_nota,
  e.respostas->>'postura_neutralidade'         as postura_neutralidade,
  e.respostas->>'postura_neutralidade_nota'    as postura_neutralidade_nota,

  -- Bloco 2 (Apto/Não Apto — até 02/09/2026, Adequado/Inadequado)
  e.respostas->>'beneficio_proprio'        as beneficio_proprio,
  e.respostas->>'beneficio_proprio_aval'   as beneficio_proprio_aval,
  e.respostas->>'agilizar_coleta'          as agilizar_coleta,
  e.respostas->>'agilizar_coleta_aval'     as agilizar_coleta_aval,
  e.respostas->>'postura_profissional'     as postura_profissional,
  e.respostas->>'postura_profissional_aval' as postura_profissional_aval,

  -- Bloco 3 (Ética e LGPD)
  e.respostas->>'conflito_interesses'      as conflito_interesses,
  e.respostas->>'conflito_interesses_aval' as conflito_interesses_aval,
  e.respostas->>'lgpd_etica'               as lgpd_etica,
  e.respostas->>'lgpd_etica_aval'          as lgpd_etica_aval,

  -- ==========================================================
  --  PERFIL SUPERVISOR — só preenchido quando
  --  perfil_avaliado = 'Supervisor'
  -- ==========================================================
  -- Bloco 1 (STAR) — texto + nota (1 a 5)
  e.respostas->>'sup_gestao_equipes'             as sup_gestao_equipes,
  e.respostas->>'sup_gestao_equipes_nota'        as sup_gestao_equipes_nota,
  e.respostas->>'sup_relatorios'                 as sup_relatorios,
  e.respostas->>'sup_relatorios_nota'            as sup_relatorios_nota,
  e.respostas->>'sup_processos_avaliativos'      as sup_processos_avaliativos,
  e.respostas->>'sup_processos_avaliativos_nota' as sup_processos_avaliativos_nota,
  e.respostas->>'sup_treinamento'                as sup_treinamento,
  e.respostas->>'sup_treinamento_nota'           as sup_treinamento_nota,
  e.respostas->>'sup_conflitos'                  as sup_conflitos,
  e.respostas->>'sup_conflitos_nota'             as sup_conflitos_nota,
  e.respostas->>'sup_organizacao_dados'          as sup_organizacao_dados,
  e.respostas->>'sup_organizacao_dados_nota'     as sup_organizacao_dados_nota,
  e.respostas->>'sup_metodologia'                as sup_metodologia,
  e.respostas->>'sup_metodologia_nota'           as sup_metodologia_nota,

  -- Bloco 2 (Apto/Não Apto)
  e.respostas->>'sup_alteracao_respostas'        as sup_alteracao_respostas,
  e.respostas->>'sup_alteracao_respostas_aval'   as sup_alteracao_respostas_aval,
  e.respostas->>'sup_desgaste_parceiros'         as sup_desgaste_parceiros,
  e.respostas->>'sup_desgaste_parceiros_aval'    as sup_desgaste_parceiros_aval,
  e.respostas->>'sup_decisao_dificil'            as sup_decisao_dificil,
  e.respostas->>'sup_decisao_dificil_aval'       as sup_decisao_dificil_aval,

  -- Bloco 3 (Ética e LGPD)
  e.respostas->>'sup_conflito_interesses'        as sup_conflito_interesses,
  e.respostas->>'sup_conflito_interesses_aval'   as sup_conflito_interesses_aval,
  e.respostas->>'sup_lideranca_lgpd'             as sup_lideranca_lgpd,
  e.respostas->>'sup_lideranca_lgpd_aval'        as sup_lideranca_lgpd_aval,

  -- ==========================================================
  --  Comuns aos dois perfis
  -- ==========================================================
  -- Bloco 4 (Anuência e Conformidade) — ciências, não pontuam
  e.respostas->>'anuencia_antecedentes'      as anuencia_antecedentes,
  e.respostas->>'anuencia_transporte'        as anuencia_transporte,
  e.respostas->>'anuencia_lgpd_codigo_etica' as anuencia_lgpd_codigo_etica,
  e.respostas->>'anuencia_pesquisa'          as anuencia_pesquisa,
  e.respostas->>'anuencia_bolsista'          as anuencia_bolsista,

  -- Bloco 5 (Fechamento) e observação
  e.respostas->>'recomendacao_final'        as recomendacao_final,
  e.respostas->>'justificativa_recomendacao' as justificativa_recomendacao,
  e.respostas->>'observacao_adicional'      as observacao_adicional
from public.entrevistas e;

-- Leitura da view para usuários autenticados (mesma regra da tabela).
grant select on public.entrevistas_detalhado to authenticated;
