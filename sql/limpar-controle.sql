-- ============================================================
--  LIMPAR as tabelas de controle (candidatos e formacao)
--
--  Apaga SOMENTE o que é reconstruído por importação de CSV.
--  A tabela `entrevistas` NÃO é tocada por este script — as entrevistas já
--  realizadas (respostas, pontuações, CPFs preenchidos, links de ata) ficam
--  exatamente como estão. Não existe chave estrangeira entre as tabelas, então
--  apagar candidatos/formacao não tem como afetar as entrevistas.
--
--  ANTES DE RODAR, leia: o que se perde além do CSV
--  ------------------------------------------------
--  Estes dados NÃO vêm da plataforma — foram criados aqui dentro:
--    • datas e status de CONVOCAÇÃO (quem já recebeu e-mail de entrevista/cadastro);
--    • marcações de FALHA DE ENTREGA ("e-mail não existe");
--    • correções feitas à mão no painel (coluna `editado`).
--
--  Por isso o script começa fazendo uma CÓPIA de segurança das duas tabelas.
--  Se depois da reimportação faltar alguma coisa, dá para consultar a cópia.
--
--  RISCO PRÁTICO MAIS IMPORTANTE: se o CSV que você reimportar não trouxer a
--  coluna "Convocação para Entrevista" com "Enviado", o sistema vai achar que
--  ninguém foi convocado — e o botão "Convocar todos" reenviaria e-mail para
--  gente que já recebeu. Confira essa coluna no arquivo antes de convocar.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run.
-- ============================================================

-- ------------------------------------------------------------
--  1) Cópia de segurança (fica só no banco, sem acesso pela API)
-- ------------------------------------------------------------
create table if not exists public.candidatos_backup as
  select * from public.candidatos;

alter table public.candidatos_backup enable row level security;

do $$
begin
  if to_regclass('public.formacao') is not null then
    execute 'create table if not exists public.formacao_backup as select * from public.formacao';
    execute 'alter table public.formacao_backup enable row level security';
  end if;
end $$;

-- ------------------------------------------------------------
--  2) Limpeza das tabelas de controle
-- ------------------------------------------------------------
delete from public.candidatos;

do $$
begin
  if to_regclass('public.formacao') is not null then
    execute 'delete from public.formacao';
  end if;
end $$;

-- ------------------------------------------------------------
--  3) Conferência — as entrevistas continuam lá
-- ------------------------------------------------------------
select
  (select count(*) from public.entrevistas)                            as entrevistas_preservadas,
  (select count(*) from public.entrevistas where cpf is not null)      as entrevistas_com_cpf,
  (select count(*) from public.candidatos)                             as candidatos_agora,
  (select count(*) from public.candidatos_backup)                      as candidatos_no_backup;

-- ------------------------------------------------------------
--  Depois, quando não precisar mais das cópias:
--    drop table if exists public.candidatos_backup;
--    drop table if exists public.formacao_backup;
-- ------------------------------------------------------------
