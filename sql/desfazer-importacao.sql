-- DESFAZER UMA IMPORTAÇÃO ENVIADA NA ABA ERRADA (aba Formação)
-- Antes: rode sql/prever-desfazer.sql e confira quanto vai sobrar.
-- No aviso de RLS clique "Run without RLS" (amarelo) — este arquivo liga o
-- RLS nos backups sozinho, e o verde reescreve o comando e quebra o bloco.
-- Detalhes: docs/ADMIN-E-EDICAO.md, "Enviei o CSV na aba errada".

do $$
declare
  -- Nome do arquivo, copiado da linha "Última importação" do painel. Sem
  -- esta trava, uma 2ª execução miraria na importação ANTERIOR (a certa).
  v_alvo     constant text := 'respostas_c3_bolsista.csv';

  v_stamp    timestamptz;  -- carimbo nas fichas (relógio do NAVEGADOR)
  v_em       timestamptz;  -- hora da importação (relógio do BANCO)
  v_ini      timestamptz;
  v_antes    timestamptz;
  v_imp      record;
  v_tipo     text;
  v_cri      integer := 0;
  v_alt      integer := 0;
  v_apagadas integer := 0;
  v_campos   integer := 0;
  v_hist     boolean;
  r          record;
begin
  -- Dois relógios: `importado_em` diz QUAIS fichas (vem do navegador);
  -- `importacoes.criado_em` diz QUANDO, no banco — as janelas usam este.
  select max(importado_em) into v_stamp from public.formacao;
  if v_stamp is null then
    raise notice 'Nenhuma importação carimbada na Formação. Nada a desfazer.';
    return;
  end if;

  select tipo into v_tipo from public.formacao where importado_em = v_stamp limit 1;
  select * into v_imp from public.importacoes
    where aba = 'formacao' order by criado_em desc limit 1;

  if v_imp.id is null then
    raise exception 'Não há registro em `importacoes` (rode sql/importacoes.sql). Sem ele não dá para conferir o que apagar.';
  end if;

  if coalesce(v_imp.arquivo, '') <> v_alvo then
    raise exception 'PAREI SEM MEXER EM NADA. A última importação é "%", e não "%". Se já desfez, está certo — não rode de novo.',
      coalesce(v_imp.arquivo, '(sem nome)'), v_alvo;
  end if;

  v_em  := v_imp.criado_em;
  v_ini := v_em - interval '30 minutes';

  raise notice 'Desfazendo: % · % · projeto % · registro: % nova(s), % atualizada(s)',
    to_char(v_em, 'DD/MM/YYYY HH24:MI'), v_imp.arquivo, coalesce(v_tipo, '?'),
    v_imp.criadas, v_imp.atualizadas;

  select exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'historico') into v_hist;

  -- RLS ligado + zero políticas = ninguém lê pelas chaves do painel (o SQL
  -- Editor lê, roda como dono). `if not exists`: a 2ª execução não substitui
  -- a cópia boa pela do estado já consertado.
  if to_regclass('public.backup_desfazer_formacao') is null then
    create table public.backup_desfazer_formacao as
      select f.*, v_em as desfeito_em from public.formacao f where f.importado_em = v_stamp;
    alter table public.backup_desfazer_formacao enable row level security;
  end if;

  if to_regclass('public.backup_desfazer_importacao') is null then
    create table public.backup_desfazer_importacao as
      select * from public.importacoes where id = v_imp.id;
    alter table public.backup_desfazer_importacao enable row level security;
  end if;

  -- Congelada: o conserto grava histórico novo; sem isso o laço leria o que
  -- ele mesmo escreveu.
  if v_hist and to_regclass('public.backup_desfazer_historico') is null then
    create table public.backup_desfazer_historico as
      select h.* from public.historico h
      where h.tabela = 'formacao' and h.evento = 'alterado'
        and h.em between v_ini and v_em + interval '30 minutes'
        and h.registro_id in (select id from public.formacao where importado_em = v_stamp)
        and h.campo not in ('ordem','origem','importado_em','editado','chave','email_norm');
    alter table public.backup_desfazer_historico enable row level security;
  end if;

  -- Criadas = com o carimbo e nascidas na hora (o insert é uma instrução só,
  -- então todas levam o mesmo `created_at`).
  select count(*) into v_cri from public.formacao
    where importado_em = v_stamp and created_at >= v_ini;
  select count(*) into v_alt from public.formacao
    where importado_em = v_stamp and created_at < v_ini;

  raise notice 'Eu encontrei: % criada(s), % que já existia(m)', v_cri, v_alt;

  if v_cri = 0 and v_alt = 0 then
    raise notice 'Nada carimbado com essa importação. Provavelmente já foi desfeita.';
    return;
  end if;

  -- O freio de mão: o que eu achei tem de ser o que a importação registrou.
  if v_cri <> v_imp.criadas or v_alt <> v_imp.atualizadas then
    raise exception 'PAREI SEM MEXER EM NADA. O registro diz %/% e eu achei %/% (novas/atualizadas). Confira com sql/conferir-importacao.sql.',
      v_imp.criadas, v_imp.atualizadas, v_cri, v_alt;
  end if;

  -- A PRIMEIRA alteração de cada campo é o valor de antes; um intermediário
  -- seria um estado que nunca existiu.
  if v_hist then
    for r in
      select distinct on (registro_id, campo) registro_id, campo, de
      from public.backup_desfazer_historico order by registro_id, campo, em
    loop
      execute format('update public.formacao set %I = $1, updated_at = now() where id = $2 and %I is distinct from $1',
                     r.campo, r.campo) using r.de, r.registro_id;
      if found then v_campos := v_campos + 1; end if;
    end loop;
  end if;

  with apagadas as (
    delete from public.formacao
    where importado_em = v_stamp and created_at >= v_ini returning 1
  )
  select count(*) into v_apagadas from apagadas;

  -- O carimbo não passa pelo histórico; o certo é o da importação anterior.
  select max(criado_em) into v_antes from public.importacoes
    where aba = 'formacao' and tipo = v_tipo and criado_em < v_em;
  update public.formacao set importado_em = v_antes
    where importado_em = v_stamp and v_antes is not null;

  -- Desfeita, ela não é mais "a última" do painel.
  delete from public.importacoes where id = v_imp.id;

  raise notice 'Fichas apagadas: % · campos devolvidos: %', v_apagadas, v_campos;
  if not v_hist then
    raise notice 'SEM histórico: os campos das % ficha(s) que já existiam NÃO voltaram.', v_alt;
  end if;
  raise notice 'Recarregue com Ctrl+F5. Ordem e origem só voltam reimportando o';
  raise notice 'CSV certo de formação. Backups nas tabelas backup_desfazer_*.';
end $$;

select tipo as "projeto", count(*) as "fichas",
  count(*) filter (where termo_link is not null and desligado_em is null) as "ativos",
  count(*) filter (where desligado_em is not null)                        as "desligados",
  count(*) filter (where grupo is null and regiao is null)                as "sem grupo/região"
from public.formacao group by tipo order by tipo;
