-- ============================================================
--  JUNTAR fichas duplicadas de candidatos (mesmo CPF)
--
--  Por que existem duplicadas: até agora a identidade da ficha era o E-MAIL.
--  Quando um endereço mudava (corrigido no painel ou na própria plataforma), a
--  importação seguinte não reconhecia a pessoa e criava uma segunda ficha.
--  O sistema já foi corrigido para identificar pelo CPF; este script limpa o
--  que ficou para trás.
--
--  O que ele faz: em cada grupo de fichas com o MESMO CPF, escolhe a ficha
--  mais recente como principal, COPIA para ela tudo o que estiver vazio (datas
--  de convocação, resultado, região, marcas de edição…) e só então apaga as
--  outras. Nada é descartado sem antes ser aproveitado, e uma cópia completa da
--  tabela é guardada antes de qualquer alteração.
--
--  Como usar, na ordem:
--    1. Rode o PASSO 1 e olhe o resultado (é só consulta, não muda nada).
--    2. Rode o PASSO 2 para juntar de fato.
--    3. Rode o PASSO 3 para conferir.
--  Pode rodar tudo de uma vez; os passos 1 e 3 só mostram informação.
-- ============================================================

-- ------------------------------------------------------------
--  PASSO 1 — o que está duplicado hoje (não altera nada)
-- ------------------------------------------------------------
select
  tipo,
  regexp_replace(coalesce(cpf, ''), '\D', '', 'g') as cpf_digitos,
  count(*)                                          as fichas,
  string_agg(distinct nome, ' | ')                  as nomes,
  string_agg(distinct email, ' | ')                 as emails
from public.candidatos
where length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) = 11
group by 1, 2
having count(*) > 1
order by 1, 3 desc;

-- Fichas SEM CPF não entram na junção automática (não há como ter certeza de
-- que são a mesma pessoa). Esta consulta mostra se existe alguma repetição de
-- nome entre elas, para você conferir à mão no painel.
select tipo, nome, count(*) as fichas, string_agg(distinct email, ' | ') as emails
from public.candidatos
where length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) <> 11
group by 1, 2
having count(*) > 1
order by 1, 2;

-- ------------------------------------------------------------
--  PASSO 2 — juntar (com cópia de segurança antes)
-- ------------------------------------------------------------
create table if not exists public.candidatos_backup_duplicados as
  select * from public.candidatos;
alter table public.candidatos_backup_duplicados enable row level security;

do $$
declare
  g  record;
  s  public.candidatos%rowtype;
  o  public.candidatos%rowtype;
  juntadas int := 0;
begin
  for g in
    select tipo, regexp_replace(coalesce(cpf, ''), '\D', '', 'g') as cpfd
    from public.candidatos
    where length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) = 11
    group by 1, 2
    having count(*) > 1
  loop
    -- Ficha principal: a mexida mais recentemente (é a que tem as correções
    -- e os reenvios); em caso de empate, a mais antiga do banco.
    select * into s
      from public.candidatos
     where tipo = g.tipo
       and regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = g.cpfd
     order by updated_at desc nulls last, created_at asc
     limit 1;

    for o in
      select * from public.candidatos
       where tipo = g.tipo
         and regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = g.cpfd
         and id <> s.id
    loop
      update public.candidatos set
        nome                       = coalesce(nome, o.nome),
        email                      = coalesce(email, o.email),
        email_norm                 = coalesce(email_norm, o.email_norm),
        regiao                     = coalesce(regiao, o.regiao),
        ordem                      = coalesce(ordem, o.ordem),
        convocacao_entrevista      = coalesce(convocacao_entrevista, o.convocacao_entrevista),
        data_convocacao_entrevista = coalesce(data_convocacao_entrevista, o.data_convocacao_entrevista),
        resultado_entrevista       = coalesce(resultado_entrevista, o.resultado_entrevista),
        data_entrevista            = coalesce(data_entrevista, o.data_entrevista),
        convocacao_cadastro        = coalesce(convocacao_cadastro, o.convocacao_cadastro),
        data_convocacao_cadastro   = coalesce(data_convocacao_cadastro, o.data_convocacao_cadastro),
        entrevista_id              = coalesce(entrevista_id, o.entrevista_id),
        -- A falha de entrega NÃO é copiada de propósito: a ficha principal é a
        -- mais recente, então o estado dela é o atual. Copiar poderia
        -- ressuscitar um "e-mail não existe" já resolvido por reenvio.
        inscricao                  = case when inscricao = '{}'::jsonb then o.inscricao else inscricao end,
        -- Marcas de campo editado das duas fichas (a principal prevalece).
        editado                    = coalesce(o.editado, '{}'::jsonb) || coalesce(editado, '{}'::jsonb),
        updated_at                 = now()
      where id = s.id;

      delete from public.candidatos where id = o.id;
      juntadas := juntadas + 1;
    end loop;
  end loop;

  raise notice 'Fichas duplicadas removidas apos a juncao: %', juntadas;
end $$;

-- Passa a identificar as fichas pelo CPF (é o que a importação usa agora).
-- Só é seguro depois da junção acima, que garante um CPF por ficha.
update public.candidatos
   set chave = regexp_replace(cpf, '\D', '', 'g')
 where length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) = 11
   and chave is distinct from regexp_replace(cpf, '\D', '', 'g');

-- ------------------------------------------------------------
--  PASSO 3 — conferência
-- ------------------------------------------------------------
select
  (select count(*) from public.candidatos where tipo = 'capital')  as candidatos_capital,
  (select count(*) from public.candidatos where tipo = 'interior') as candidatos_interior,
  (select count(*) from public.candidatos_backup_duplicados)       as fichas_antes_da_juncao,
  (select count(*) from (
      select 1 from public.candidatos
      where length(regexp_replace(coalesce(cpf, ''), '\D', '', 'g')) = 11
      group by tipo, regexp_replace(coalesce(cpf, ''), '\D', '', 'g')
      having count(*) > 1) d)                                      as duplicadas_restantes;

-- Quando estiver tudo certo, a cópia pode ser descartada:
--   drop table if exists public.candidatos_backup_duplicados;
