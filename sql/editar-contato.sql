-- ============================================================
--  CORRIGIR CONTATO NA FICHA DE FORMAÇÃO
--
--  Nome, telefone e e-mail chegam à ficha pela inscrição (o que a pessoa
--  digitou no formulário de entrevista) ou pelo CSV de formação. Quando a
--  pessoa erra o número ali e corrige depois em outro lugar — no Cadastro de
--  Bolsista, por exemplo — o sistema fica com o valor errado e não havia como
--  consertar: a edição da ficha só mexia em grupo, etapas e termo.
--
--  Agora o administrador corrige esses três campos na própria aba Formação.
--  Este arquivo cria a única coisa que falta no banco: a coluna que MARCA o
--  que foi corrigido à mão.
--
--  Por que a marca é necessária: a importação do CSV de formação sobrescreve
--  nome, telefone e e-mail com o que vier do arquivo. Sem a marca, a correção
--  duraria até a próxima importação e sumiria sem aviso — o pior tipo de
--  perda, porque ninguém fica sabendo. Com ela, o painel reconhece o campo
--  corrigido e a importação passa por cima sem tocar nele.
--
--  É a MESMA coluna que a aba Candidatos já usa (criada em sql/candidatos.sql
--  e em sql/admin.sql). Aqui ela ganha o gêmeo na tabela de formação — um
--  desenho só para as duas abas, em vez de dois jeitos de lembrar a mesma
--  coisa.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente (pode rodar
--  de novo à vontade), não apaga nada e não mexe em nenhuma política de RLS:
--  quem já podia editar a ficha continua podendo, nem mais nem menos.
--
--  Depende de: sql/formacao.sql (a tabela `formacao`).
-- ============================================================

-- ------------------------------------------------------------
--  1) A coluna
--
--  `not null default '{}'` para nunca haver ficha com a marca "indefinida":
--  o painel lê isto em toda importação, e um nulo no meio viraria um `if` a
--  mais em vez de um mapa vazio.
-- ------------------------------------------------------------
alter table public.formacao
  add column if not exists editado jsonb not null default '{}'::jsonb;

comment on column public.formacao.editado is
  'Campos corrigidos à mão no painel, no formato {"telefone": true}. '
  'A importação do CSV de formação NÃO sobrescreve um campo marcado aqui. '
  'Preenchido pela edição da ficha na aba Formação; o gatilho de histórico '
  'ignora esta coluna de propósito (é controle, não é dado da pessoa).';

-- ------------------------------------------------------------
--  2) Conferência
--
--  Roda sozinha e imprime o resultado na aba "Messages" do SQL Editor. Se a
--  linha não aparecer, a coluna não foi criada — e aí o painel continua
--  salvando a correção, mas sem proteção contra a próxima importação.
-- ------------------------------------------------------------
do $$
declare
  v_tem boolean;
  v_marcadas integer;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'formacao' and column_name = 'editado'
  ) into v_tem;

  if not v_tem then
    raise exception 'A coluna formacao.editado NÃO foi criada. Rode sql/formacao.sql antes deste arquivo.';
  end if;

  select count(*) into v_marcadas
  from public.formacao
  where editado is not null and editado <> '{}'::jsonb;

  raise notice 'OK: formacao.editado existe. Fichas já com alguma correção à mão: %', v_marcadas;
  raise notice 'A partir de agora, corrigir nome, telefone ou e-mail na aba Formação marca o campo,';
  raise notice 'e a importação do CSV de formação deixa de sobrescrever esse campo nessa ficha.';
end $$;
