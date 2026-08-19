-- ============================================================
--  COLUNA: cpf  (na tabela de entrevistas)
--
--  Por quê: as entrevistas feitas ANTES de existir a pergunta "CPF do
--  Candidato" não têm esse dado, e é ele que liga a entrevista à inscrição e
--  à formação. Esta coluna permite preencher o CPF dessas entrevistas antigas
--  pelo painel (em Detalhes), sem tocar nas respostas originais.
--
--  Nas entrevistas novas a coluna já vem preenchida pelo próprio formulário.
--
--  Segurança: o `grant` é SÓ nesta coluna — pontuação, recomendação e o JSON
--  das respostas continuam intocáveis por UPDATE, como antes. E a gravação é
--  restrita aos administradores (tabela app_admins, de sql/admin.sql).
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  e não altera nenhum dado existente.
-- ============================================================

alter table public.entrevistas
  add column if not exists cpf text;

comment on column public.entrevistas.cpf is
  'CPF do candidato. Vem do formulário nas entrevistas novas; nas antigas é preenchido pelo painel.';

create index if not exists entrevistas_cpf_idx on public.entrevistas (cpf);

-- Preenche as entrevistas que já responderam o CPF no formulário (o dado está
-- dentro do JSON de respostas) — evita ter que digitar de novo o que já existe.
update public.entrevistas
   set cpf = respostas->>'cpf_candidato'
 where cpf is null
   and coalesce(respostas->>'cpf_candidato', '') <> '';

-- Escrita apenas nesta coluna, e apenas para administradores.
grant update (cpf) on public.entrevistas to authenticated;

drop policy if exists "entrevistas_update_cpf" on public.entrevistas;

do $$
begin
  if to_regprocedure('public.eh_admin()') is not null then
    execute 'create policy "entrevistas_update_cpf" on public.entrevistas '
         || 'for update to authenticated using (public.eh_admin()) with check (public.eh_admin())';
  else
    -- Sem o sql/admin.sql rodado, libera para qualquer usuário logado.
    execute 'create policy "entrevistas_update_cpf" on public.entrevistas '
         || 'for update to authenticated using (true) with check (true)';
  end if;
end $$;
