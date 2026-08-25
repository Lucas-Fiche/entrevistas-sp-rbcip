-- ============================================================
--  Treinamento: dois campos viram um só
--
--  O projeto passou a considerar UM treinamento — qualquer treinamento
--  realizado conta, online ou presencial. No banco, o valor fica em
--  `treinamento_presencial` (a coluna que as planilhas de controle chamam de
--  "Treinamento Presencial/Online"); `treinamento_online` deixa de ser usado.
--
--  Este script move para o campo único o que estiver no campo antigo, nos dois
--  projetos. O painel já lê os dois, então nada aparece errado enquanto isto
--  não roda — mas com os dois campos preenchidos o dado fica dividido, e é
--  isso que o script encerra.
--
--  Só preenche o que está VAZIO — nada é sobrescrito. É idempotente.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run.
-- ============================================================

-- 1) Confira antes o que será movido (opcional):
-- select tipo, nome, treinamento_online, treinamento_presencial,
--        data_treinamento_online, data_treinamento_presencial
--   from public.formacao
--  where coalesce(treinamento_online, '') <> ''
--     or coalesce(data_treinamento_online, '') <> '';

-- 2) Move o que está só no campo antigo.
update public.formacao
   set treinamento_presencial = coalesce(nullif(treinamento_presencial, ''), treinamento_online),
       data_treinamento_presencial =
         coalesce(nullif(data_treinamento_presencial, ''), data_treinamento_online),
       treinamento_online = null,
       data_treinamento_online = null,
       updated_at = now()
 where coalesce(treinamento_online, '') <> ''
    or coalesce(data_treinamento_online, '') <> '';

-- 3) Confirmação: deve voltar zero linhas.
-- select count(*) from public.formacao where coalesce(treinamento_online, '') <> '';
