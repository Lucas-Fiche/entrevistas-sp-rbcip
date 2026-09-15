-- ============================================================
--  REMOVER A "DATA DE ENTRADA NO PROJETO"
--
--  Por que: a coluna guardava o dia em que a pessoa preencheu o Cadastro de
--  Bolsista, e isso NÃO é o dia em que ela passou a atuar no projeto. O número
--  parecia preciso e não era — e um dado assim é pior do que dado nenhum,
--  porque ninguém desconfia dele. Junto sai o relatório "Entradas e saídas",
--  que era construído inteiramente sobre essa data.
--
--  O QUE ESTE ARQUIVO APAGA — e só isto:
--    • a coluna `formacao.data_entrada`;
--    • a referência a ela na view `aptos_para_termo`.
--
--  O QUE NÃO É TOCADO: `desligado_em` e `desligado_motivo` (os desligamentos
--  continuam inteiros), a tabela `historico` com todas as alterações já
--  registradas, e qualquer outra coluna de `formacao`.
--
--  ANTES DE APAGAR, o conteúdo é COPIADO para `backup_data_entrada`. Se um dia
--  a informação fizer falta, ela está lá — com o id da ficha, o CPF e o nome
--  para reencontrar cada pessoa. Apagar sem rede é fácil; desfazer não é.
--
--  ORDEM IMPORTANTE. Rode este arquivo POR ÚLTIMO:
--    1. publique o painel (a versão que não usa mais a coluna);
--    2. recole e republique o Apps Script;
--    3. só então rode este SQL.
--  Ao contrário, o painel ou o robô pediriam ao banco uma coluna que já não
--  existe, e a sincronização passaria a falhar até você publicar.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempetente: rodar de
--  novo não estraga nada (o backup só é criado se ainda não existir, e o
--  `drop column if exists` não reclama se a coluna já se foi).
-- ============================================================

-- ------------------------------------------------------------
--  1) A rede de segurança: cópia antes de apagar
--
--  `if not exists` de propósito: numa segunda execução a coluna já não existe
--  e recriar a tabela vazia apagaria o backup que interessa.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.backup_data_entrada') is null
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'formacao'
          and column_name = 'data_entrada'
     )
  then
    execute '
      create table public.backup_data_entrada as
      select id, tipo, chave, cpf, nome, data_entrada, now() as copiado_em
        from public.formacao
       where coalesce(data_entrada, '''') <> ''''';
    execute 'alter table public.backup_data_entrada enable row level security';
    execute 'grant select on public.backup_data_entrada to authenticated';
    execute 'drop policy if exists "backup_data_entrada_select_auth" on public.backup_data_entrada';
    execute 'create policy "backup_data_entrada_select_auth"
               on public.backup_data_entrada for select to authenticated using (true)';
    execute 'comment on table public.backup_data_entrada is
               ''Cópia da antiga coluna formacao.data_entrada, guardada antes de ela ser removida. Só leitura; nada no painel usa.''';
  end if;
end $$;

-- ------------------------------------------------------------
--  2) A view de aptos deixa de expor a coluna
--
--  `create or replace view` não sabe REMOVER uma coluna — por isso o drop
--  antes. E sem este passo o `drop column` da seção 3 seria recusado, porque a
--  view depende dela.
--
--  A regra de quem é apto NÃO muda: cadastro de bolsista, treinamento e
--  antecedentes criminais, sem termo e sem desligamento.
-- ------------------------------------------------------------
drop view if exists public.aptos_para_termo;

create view public.aptos_para_termo as
  select
    f.id, f.tipo, f.nome, f.cpf, f.email, f.grupo, f.regiao,
    f.aviso_apto_em
  from public.formacao f
  where coalesce(f.desligado_em, '') = ''
    and coalesce(f.termo_link, '') = ''
    and lower(coalesce(f.cadastro_bolsista, '')) = 'realizado'
    and (lower(coalesce(f.treinamento_presencial, '')) = 'realizado'
      or lower(coalesce(f.treinamento_online, '')) = 'realizado')
    and coalesce(f.antecedentes_em, '') <> '';

comment on view public.aptos_para_termo is
  'Quem já fez cadastro, treinamento e entregou os antecedentes criminais, e só depende do termo de bolsa para atuar.';

grant select on public.aptos_para_termo to authenticated;

-- ------------------------------------------------------------
--  3) A coluna sai
-- ------------------------------------------------------------
alter table public.formacao drop column if exists data_entrada;

-- ------------------------------------------------------------
--  4) Conferência
--
--  Roda junto e imprime o resultado nas mensagens do SQL Editor (aba
--  "Results" pode vir vazia; a conferência aparece em "Logs"/avisos).
-- ------------------------------------------------------------
do $$
declare
  v_backup integer := 0;
begin
  if to_regclass('public.backup_data_entrada') is not null then
    execute 'select count(*) from public.backup_data_entrada' into v_backup;
  end if;
  raise notice 'Datas guardadas em backup_data_entrada: %', v_backup;
  raise notice 'Coluna data_entrada ainda existe? %',
    (exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'formacao'
                and column_name = 'data_entrada'));
  raise notice 'Fichas na formacao (nenhuma foi apagada): %',
    (select count(*) from public.formacao);
end $$;
