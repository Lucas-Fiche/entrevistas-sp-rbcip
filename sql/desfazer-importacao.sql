-- ============================================================
--  DESFAZER A ÚLTIMA IMPORTAÇÃO DA ABA FORMAÇÃO
--
--  Para quando um CSV foi enviado na aba errada. O caso que deu origem a este
--  arquivo: o "respostas_c3_bolsista.csv", que é da aba *Candidatos*, foi
--  enviado na aba *Formação* — "57 linha(s): 56 nova(s), 1 atualizada(s)".
--  O resultado é sempre o mesmo: dezenas de fichas que não deviam existir, e
--  as fichas verdadeiras que coincidiram com alguma linha do arquivo ficam com
--  campos por cima.
--
--  O QUE ESTE ARQUIVO FAZ, nesta ordem:
--    1. Copia para tabelas de backup tudo o que vai tocar.
--    2. CONFERE o que encontrou contra o que o registro da importação diz. Se
--       não bater, para sem mexer em nada.
--    3. Devolve ao valor de antes os campos que a importação mudou em fichas
--       que já existiam — lendo do histórico, campo a campo.
--    4. Apaga as fichas que a importação criou.
--    5. Apaga a linha da importação errada do registro, para o painel parar de
--       anunciá-la como "última importação".
--
--  O QUE ELE NÃO DESFAZ: a ordem das linhas (`ordem`) e a cópia da linha do
--  CSV (`origem`). As duas ficam de fora do histórico de propósito — são
--  controle, não são dados da pessoa. Para devolvê-las ao normal, reimporte o
--  CSV certo de formação depois; ele reescreve as duas. Nada do que importa
--  para o funil (grupo, treinamento, cadastro, termo) depende delas.
--
--  SEGURANÇA
--    · Roda em bloco único: ou faz tudo, ou não faz nada.
--    · Antes de mexer, grava `backup_desfazer_formacao` (as fichas inteiras),
--      `backup_desfazer_historico` (as alterações desfeitas) e
--      `backup_desfazer_importacao` (a linha do registro). Nada se perde.
--    · Só apaga fichas se a contagem bater com o registro da importação.
--    · Se rodar duas vezes, a segunda não faz nada: já não há o que desfazer.
--    · Não toca em NENHUMA ficha fora da importação identificada.
--
--  COMO USAR
--    1. Rode antes `sql/conferir-importacao.sql` e confira na lista que a
--       última importação de Formação é mesmo a errada (nome do arquivo e
--       hora). Se não for, PARE: este arquivo desfaz a última, e desfazer a
--       importação certa seria trocar um problema por outro.
--    2. Cole este arquivo no SQL Editor do Supabase e clique em Run.
--
--       SE APARECER o aviso "This query creates tables without enabling Row
--       Level Security", escolha **"Run without RLS"** (o botão amarelo).
--       Parece a opção insegura, e não é: este arquivo LIGA o RLS nas três
--       tabelas de backup por conta própria, logo depois de criar cada uma —
--       procure por `enable row level security` mais abaixo. O botão verde faz
--       o editor REESCREVER o comando para enfiar o RLS por fora, e a
--       reescrita quebra o bloco no meio ("syntax error at or near if"). Ou
--       seja: o amarelo roda e protege; o verde não chega a rodar.
--    3. Leia a aba "Messages": ele diz quantas fichas apagou e quantos campos
--       devolveu.
--    4. Recarregue o painel (Ctrl+F5) e confira os números.
--
--  Depende de: sql/formacao.sql e sql/importacoes.sql. Com sql/historico.sql
--  instalado ele também devolve os campos sobrescritos; sem ele, apaga as
--  fichas criadas e avisa o que falta fazer à mão.
-- ============================================================

do $$
declare
  -- >>> O NOME DO ARQUIVO A DESFAZER. Está preenchido com o caso que deu
  -- origem a este script; para reaproveitá-lo, troque por outro nome, copiado
  -- da linha "Última importação" do painel.
  --
  -- Por que exigir o nome em vez de simplesmente desfazer "a última": porque
  -- "a última" muda depois que este arquivo roda. Numa segunda execução, sem
  -- esta trava, o alvo passaria a ser a importação ANTERIOR — a certa — e o
  -- script apagaria as fichas boas achando que estava consertando. O nome é
  -- uma coisa só para conferir, e transforma um engano possível em um engano
  -- impossível.
  v_alvo      constant text := 'respostas_c3_bolsista.csv';

  v_stamp     timestamptz;   -- carimbo da importação (relógio do NAVEGADOR)
  v_antes     timestamptz;   -- a importação legítima anterior
  v_em        timestamptz;   -- instante da importação (relógio do BANCO)
  v_ini       timestamptz;
  v_fim       timestamptz;
  v_imp       record;
  v_tipo      text;
  v_acha_cri  integer := 0;
  v_acha_alt  integer := 0;
  v_criadas   integer := 0;
  v_campos    integer := 0;
  v_fichas    integer := 0;
  v_tem_hist  boolean;
  r           record;
begin
  -- ----------------------------------------------------------
  --  1) Qual importação desfazer — e em que instante ela aconteceu
  --
  --  Duas âncoras, porque são dois relógios diferentes:
  --
  --  · `formacao.importado_em` diz QUAIS fichas: o carimbo é idêntico em todas
  --    as fichas de uma mesma importação, então delimita o estrago com
  --    precisão — nem uma a mais, nem uma a menos. Só que ele vem do relógio
  --    do NAVEGADOR de quem enviou o arquivo.
  --
  --  · `importacoes.criado_em` diz QUANDO, no relógio do BANCO — é o `now()`
  --    do servidor ao registrar a importação, segundos depois do envio.
  --
  --  Toda janela de tempo daqui para baixo usa a SEGUNDA, porque `created_at`
  --  e `historico.em` também são do banco. Misturar os dois relógios foi o
  --  primeiro jeito que eu tentei, e ele não acha nada quando o computador de
  --  quem enviou está alguns minutos adiantado ou atrasado — que é o caso
  --  normal, não a exceção.
  -- ----------------------------------------------------------
  select max(importado_em) into v_stamp from public.formacao;

  if v_stamp is null then
    raise notice 'Nenhuma importação carimbada na Formação. Nada a desfazer.';
    return;
  end if;

  select tipo into v_tipo from public.formacao where importado_em = v_stamp limit 1;

  select * into v_imp
  from public.importacoes
  where aba = 'formacao'
  order by criado_em desc limit 1;

  if v_imp.id is null then
    raise exception
      'Não há registro da importação em `importacoes` (rode sql/importacoes.sql). Sem ele não dá para conferir o que apagar, e apagar às cegas não é opção.';
  end if;

  if coalesce(v_imp.arquivo, '') <> v_alvo then
    raise exception
      'PAREI SEM MEXER EM NADA. A última importação da Formação é "%" (de %), e não "%". Se já desfez esta importação, está tudo certo — não rode de novo. Se quer desfazer outra, troque `v_alvo` no começo deste arquivo.',
      coalesce(v_imp.arquivo, '(sem nome)'), to_char(v_imp.criado_em, 'DD/MM/YYYY HH24:MI'), v_alvo;
  end if;

  v_em  := v_imp.criado_em;
  v_ini := v_em - interval '30 minutes';
  v_fim := v_em + interval '30 minutes';

  raise notice '--------------------------------------------------------';
  raise notice 'Importação a desfazer: % · % · projeto %',
    to_char(v_em, 'DD/MM/YYYY HH24:MI'), coalesce(v_imp.arquivo, '(sem nome)'), coalesce(v_tipo, '?');
  raise notice 'O registro diz: % linha(s), % nova(s), % atualizada(s)',
    v_imp.linhas, v_imp.criadas, v_imp.atualizadas;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'historico'
  ) into v_tem_hist;

  -- ----------------------------------------------------------
  --  2) Backup ANTES de qualquer mudança
  --
  --  `if not exists` nas três: se este arquivo rodar uma segunda vez, a cópia
  --  boa (a da primeira vez, de antes do conserto) não pode ser substituída
  --  por uma cópia do estado já consertado.
  --
  --  RLS LIGADO E SEM NENHUMA POLÍTICA em todas elas. Estas tabelas guardam
  --  CPF, telefone e e-mail de gente de verdade — a mesma coisa que a tabela
  --  `formacao` protege. Com o RLS ligado e nenhuma política escrita, a regra
  --  que vale é "ninguém": nem a chave `anon`, nem a `authenticated` enxergam
  --  uma linha sequer. Só o SQL Editor, que roda como dono do banco e passa
  --  por cima do RLS — que é justamente quem precisa ler isto.
  --
  --  Sem estas três linhas o Supabase abre um aviso ("This query creates
  --  tables without enabling Row Level Security") e deixa a proteção na mão de
  --  quem clica. Backup de dado pessoal não pode depender de qual botão a
  --  pessoa apertou às pressas no meio de um conserto.
  -- ----------------------------------------------------------
  if to_regclass('public.backup_desfazer_formacao') is null then
    create table public.backup_desfazer_formacao as
      select f.*, v_em as desfeito_em from public.formacao f where f.importado_em = v_stamp;
    alter table public.backup_desfazer_formacao enable row level security;
    raise notice 'Backup das fichas tocadas  → public.backup_desfazer_formacao';
  else
    raise notice 'Backup das fichas já existia (execução anterior) — mantido.';
  end if;

  if to_regclass('public.backup_desfazer_importacao') is null then
    create table public.backup_desfazer_importacao as
      select * from public.importacoes where id = v_imp.id;
    alter table public.backup_desfazer_importacao enable row level security;
    raise notice 'Backup do registro         → public.backup_desfazer_importacao';
  end if;

  -- As alterações a desfazer, congeladas numa tabela: o próprio conserto grava
  -- histórico novo, e sem congelar a lista o laço passaria a ler o que ele
  -- mesmo acabou de escrever.
  --
  -- `create table ... as select` direto, com as variáveis no meio: dentro de
  -- PL/pgSQL isso funciona sem `execute`. A primeira versão montava o comando
  -- com `execute format`, e a aspa-cifrão aninhada que isso exigia fazia o
  -- editor do Supabase picar o arquivo no lugar errado e reclamar de
  -- "syntax error at or near if". Nenhuma aspa-cifrão aninhada aqui, nem
  -- sequer escrita por extenso num comentário, para não repetir a dose.
  if v_tem_hist and to_regclass('public.backup_desfazer_historico') is null then
    create table public.backup_desfazer_historico as
      select h.*
      from public.historico h
      where h.tabela = 'formacao'
        and h.evento = 'alterado'
        and h.em between v_ini and v_fim
        and h.registro_id in (select id from public.formacao where importado_em = v_stamp)
        -- Campos que o painel de fato usa. `ordem` e `origem` nem chegam ao
        -- histórico; os demais ficam de fora porque restaurá-los às cegas
        -- poderia desfazer uma correção feita à mão DEPOIS da importação.
        and h.campo in ('nome', 'cpf', 'telefone', 'email', 'supervisor', 'status',
                        'grupo', 'regiao', 'cadastro_bolsista',
                        'treinamento_presencial', 'data_treinamento_presencial',
                        'treinamento_online', 'data_treinamento_online',
                        'termo_bolsa', 'termo_link', 'antecedentes_em');
    alter table public.backup_desfazer_historico enable row level security;
    raise notice 'Backup das alterações      → public.backup_desfazer_historico';
  end if;

  -- ----------------------------------------------------------
  --  3) Conferir o que encontramos contra o que o registro diz
  --
  --  As fichas CRIADAS por esta importação são as que têm o carimbo e nasceram
  --  agora: o `insert` do painel é uma instrução só, então todas elas levam
  --  exatamente o mesmo `created_at`. As fichas que já existiam guardam o
  --  `created_at` antigo, de dias ou meses atrás.
  --
  --  A conferência contra `importacoes.criadas` é o freio de mão: se o número
  --  que eu achei não for o número que a importação registrou, alguma coisa
  --  não é o que parece — e aí o certo é parar, não apagar.
  -- ----------------------------------------------------------
  select count(*) into v_acha_cri
  from public.formacao
  where importado_em = v_stamp and created_at >= v_ini;

  select count(*) into v_acha_alt
  from public.formacao
  where importado_em = v_stamp and created_at < v_ini;

  raise notice 'Eu encontrei:    % ficha(s) criada(s), % que já existia(m)', v_acha_cri, v_acha_alt;

  if v_acha_cri = 0 and v_acha_alt = 0 then
    raise notice 'Nada carimbado com essa importação. Provavelmente já foi desfeita.';
    return;
  end if;

  if v_acha_cri <> v_imp.criadas or v_acha_alt <> v_imp.atualizadas then
    raise exception
      'PAREI SEM MEXER EM NADA. O registro diz % nova(s) e % atualizada(s), mas encontrei % e %. Isso acontece quando houve outra importação ou edição depois desta. Confira com sql/conferir-importacao.sql antes de seguir.',
      v_imp.criadas, v_imp.atualizadas, v_acha_cri, v_acha_alt;
  end if;

  -- ----------------------------------------------------------
  --  4) Devolver cada campo ao valor de antes
  --
  --  `distinct on (registro_id, campo) ... order by em` pega a PRIMEIRA
  --  alteração de cada campo na janela: é o valor que existia antes de a
  --  importação começar. Se o mesmo campo mudou duas vezes, voltar para o
  --  valor intermediário deixaria a ficha num estado que nunca existiu.
  -- ----------------------------------------------------------
  if v_tem_hist then
    for r in
      select distinct on (registro_id, campo) registro_id, campo, de
      from public.backup_desfazer_historico
      order by registro_id, campo, em
    loop
      execute format(
        'update public.formacao set %I = $1, updated_at = now() where id = $2 and %I is distinct from $1',
        r.campo, r.campo) using r.de, r.registro_id;
      if found then v_campos := v_campos + 1; end if;
    end loop;
    select count(distinct registro_id) into v_fichas from public.backup_desfazer_historico;
  end if;

  -- ----------------------------------------------------------
  --  5) Apagar as fichas que a importação criou
  -- ----------------------------------------------------------
  with criadas as (
    delete from public.formacao
    where importado_em = v_stamp and created_at >= v_ini
    returning 1
  )
  select count(*) into v_criadas from criadas;

  -- ----------------------------------------------------------
  --  5b) Tirar o carimbo errado das fichas que sobreviveram
  --
  --  `importado_em` fica de fora do histórico, então o passo 4 não o devolve —
  --  e a ficha ficaria marcada como "veio daquela importação" depois de a
  --  importação ter sido desfeita. Pior: `max(importado_em)` continuaria
  --  apontando para um carimbo de uma importação que não existe mais.
  --
  --  O valor certo é o da importação legítima anterior: foi ela que trouxe
  --  estas fichas, e é dela que vêm também a `ordem` e a `origem` que ainda
  --  estão lá.
  -- ----------------------------------------------------------
  select max(criado_em) into v_antes
  from public.importacoes
  where aba = 'formacao' and tipo = v_tipo and criado_em < v_em;

  update public.formacao
  set importado_em = v_antes
  where importado_em = v_stamp and v_antes is not null;

  -- ----------------------------------------------------------
  --  6) Tirar a importação errada do registro
  --
  --  O painel mostra a última importação como "Última importação: ...". Depois
  --  de desfeita, deixá-la ali seria a tela anunciando um passo que não existe
  --  mais — e a linha de antes (a importação certa de formação) volta a ser a
  --  última, que é a verdade. A cópia fica em backup_desfazer_importacao.
  -- ----------------------------------------------------------
  delete from public.importacoes where id = v_imp.id;

  raise notice '--------------------------------------------------------';
  raise notice 'Fichas apagadas (as que a importação criou): %', v_criadas;
  if v_tem_hist then
    raise notice 'Campos devolvidos ao valor de antes: % (em % ficha(s))', v_campos, v_fichas;
  else
    raise notice 'SEM histórico instalado: os campos sobrescritos nas % ficha(s) que já', v_acha_alt;
    raise notice 'existiam NÃO foram devolvidos. Reimporte o CSV certo de formação —';
    raise notice 'telefone, supervisor, status, ordem e origem saem todos de lá.';
  end if;
  raise notice 'Registro da importação errada removido do painel.';
  raise notice '';
  raise notice 'Agora: recarregue o painel com Ctrl+F5 e confira os números.';
  raise notice 'A ordem das linhas e a cópia do CSV não voltam por aqui:';
  raise notice 'reimporte o CSV certo de formação para acertar as duas.';
  raise notice 'As cópias de segurança ficam em backup_desfazer_formacao,';
  raise notice 'backup_desfazer_historico e backup_desfazer_importacao —';
  raise notice 'apague-as quando estiver tranquilo.';
end $$;

-- ------------------------------------------------------------
--  Conferência: como ficou
-- ------------------------------------------------------------
select
  tipo                                            as "projeto",
  count(*)                                        as "fichas",
  count(*) filter (where desligado_em is null)    as "no projeto",
  count(*) filter (where termo_link is not null and desligado_em is null) as "ativos",
  count(*) filter (where grupo is null and regiao is null) as "sem grupo/região"
from public.formacao
group by tipo
order by tipo;
