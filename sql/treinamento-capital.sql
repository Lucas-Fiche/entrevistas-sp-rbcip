-- ============================================================
--  Conserto: treinamento da Capital gravado no campo errado
--
--  A Capital tem UM treinamento só — na planilha de controle ele é a coluna
--  "Treinamento Presencial/Online", que o sistema guarda em
--  `treinamento_presencial`. Só que o formulário de edição oferecia o campo
--  "Treinamento online" (`treinamento_online`): o que era marcado à mão ia
--  para um campo, e a tabela lia o outro. Resultado: salvava e continuava
--  aparecendo "Não Realizado".
--
--  O painel já foi corrigido (edita e mostra o mesmo campo, e ainda exibe o
--  que estiver no campo antigo). Este script move de uma vez o que ficou no
--  lugar errado, para os dois campos pararem de discordar.
--
--  Só preenche o que está VAZIO — nada é sobrescrito. É idempotente: rodar de
--  novo não muda nada.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run.
-- ============================================================

-- 1) Confira antes o que vai ser movido (opcional):
-- select nome, treinamento_online, treinamento_presencial,
--        data_treinamento_online, data_treinamento_presencial
--   from public.formacao
--  where tipo = 'capital'
--    and coalesce(treinamento_online, '') <> ''
--    and coalesce(treinamento_presencial, '') = '';

update public.formacao
   set treinamento_presencial = treinamento_online,
       data_treinamento_presencial =
         coalesce(nullif(data_treinamento_presencial, ''), data_treinamento_online),
       treinamento_online = null,
       data_treinamento_online = null,
       updated_at = now()
 where tipo = 'capital'
   and coalesce(treinamento_online, '') <> ''
   and coalesce(treinamento_presencial, '') = '';

-- 2) Sobrou alguém com os dois campos preenchidos e diferentes? Aparece aqui
--    (nesse caso, confira na planilha e ajuste pela ficha, em Editar).
-- select nome, treinamento_online, treinamento_presencial
--   from public.formacao
--  where tipo = 'capital' and coalesce(treinamento_online, '') <> '';
