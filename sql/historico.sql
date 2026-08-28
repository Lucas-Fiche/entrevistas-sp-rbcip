-- ============================================================
--  HISTÓRICO: data de entrada + registro de tudo que muda
--
--  Resolve a pergunta que a planilha não respondia:
--  "quantos entrevistadores tínhamos em maio, junho e julho, separados por
--   Capital e Interior? quantos entraram e quantos saíram em cada mês?"
--
--  Para responder isso são precisas duas datas por pessoa: quando ENTROU e
--  quando SAIU. A saída já existia (`desligado_em`); a entrada não existia em
--  lugar nenhum — daí a coluna `data_entrada`. Com as duas, o número de
--  qualquer mês passado é uma conta, não uma lembrança:
--
--      ativos no fim do mês = entradas até o fim do mês − saídas até o fim do mês
--
--  E, para além dessas duas datas, a tabela `historico` guarda TODA alteração
--  em `formacao` e `candidatos`: qual ficha, qual campo, o valor de antes, o
--  valor de depois, quando e por quem. É gravada por gatilho, então vale para
--  o que é feito no painel, na importação de CSV, na sincronização das
--  planilhas e até no SQL Editor — não há caminho que escape do registro.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo) e não apaga nenhum dado.
--
--  Depende de: sql/admin.sql (`eh_admin`), sql/formacao.sql e
--  sql/candidatos.sql.
--
--  ATENÇÃO — o histórico começa AGORA. O que aconteceu antes de você rodar
--  este arquivo não existe em lugar nenhum e não pode ser reconstruído. Para
--  os meses já passados, preencha a `data_entrada` das fichas à mão (o painel
--  tem uma ação em lote para isso, na aba Formação).
-- ============================================================

-- ------------------------------------------------------------
--  1) Data de entrada no projeto
-- ------------------------------------------------------------
alter table public.formacao add column if not exists data_entrada text;

comment on column public.formacao.data_entrada is
  'Quando a pessoa entrou no projeto (dd/mm/aaaa). Preenchida sozinha na convocação para cadastro; nas fichas antigas, à mão.';

-- ------------------------------------------------------------
--  2) Histórico de alterações
-- ------------------------------------------------------------
create table if not exists public.historico (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  tabela      text not null,          -- formacao | candidatos
  registro_id uuid,
  tipo        text,                   -- capital | interior (da linha alterada)
  nome        text,                   -- nome no momento da alteração
  cpf         text,
  evento      text not null,          -- criado | alterado | apagado
  campo       text,                   -- só em 'alterado'
  de          text,
  para        text,
  quem        text                    -- e-mail de quem fez (null = SQL Editor / rotina)
);

comment on table public.historico is
  'Toda alteração em formacao e candidatos: campo, valor de antes, valor de depois, quando e por quem.';

create index if not exists historico_em_idx        on public.historico (em desc);
create index if not exists historico_registro_idx  on public.historico (registro_id, em desc);
create index if not exists historico_campo_idx     on public.historico (tabela, campo);

alter table public.historico enable row level security;
grant select on public.historico to authenticated;

-- Leitura para qualquer usuário logado: é o mesmo conteúdo das abas, que ele
-- já vê. Escrita ninguém tem — só o gatilho grava, e ele roda como dono.
drop policy if exists "historico_select_auth" on public.historico;
create policy "historico_select_auth"
  on public.historico for select to authenticated using (true);

-- ------------------------------------------------------------
--  3) O gatilho
--
--  Compara a linha antiga com a nova campo a campo, usando jsonb — assim a
--  mesma função serve para as duas tabelas e continua valendo quando uma
--  coluna nova for criada, sem precisar mexer aqui.
-- ------------------------------------------------------------
create or replace function public.registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Ruído: carimbos de tempo, cópias do CSV e campos de controle. Registrar
  -- isso encheria o histórico de linhas que não dizem nada a ninguém.
  v_ignorar text[] := array[
    'id', 'created_at', 'updated_at', 'importado_em', 'origem', 'ordem',
    'email_norm', 'chave', 'editado', 'inscricao', 'respostas'
  ];
  v_quem  text := nullif(auth.jwt() ->> 'email', '');
  v_velha jsonb;
  v_nova  jsonb;
  v_linha jsonb;
  k       text;
  v_de    text;
  v_para  text;
begin
  if TG_OP = 'DELETE' then
    v_linha := to_jsonb(OLD);
    insert into public.historico (tabela, registro_id, tipo, nome, cpf, evento, quem)
    values (TG_TABLE_NAME, (v_linha ->> 'id')::uuid, v_linha ->> 'tipo',
            v_linha ->> 'nome', v_linha ->> 'cpf', 'apagado', v_quem);
    return OLD;
  end if;

  v_linha := to_jsonb(NEW);

  if TG_OP = 'INSERT' then
    insert into public.historico (tabela, registro_id, tipo, nome, cpf, evento, quem)
    values (TG_TABLE_NAME, (v_linha ->> 'id')::uuid, v_linha ->> 'tipo',
            v_linha ->> 'nome', v_linha ->> 'cpf', 'criado', v_quem);
    return NEW;
  end if;

  v_velha := to_jsonb(OLD);
  v_nova  := v_linha;
  for k in select jsonb_object_keys(v_nova) loop
    if k = any(v_ignorar) then
      continue;
    end if;
    v_de   := v_velha ->> k;
    v_para := v_nova  ->> k;
    if v_de is distinct from v_para then
      insert into public.historico (tabela, registro_id, tipo, nome, cpf, evento, campo, de, para, quem)
      values (TG_TABLE_NAME, (v_nova ->> 'id')::uuid, v_nova ->> 'tipo',
              v_nova ->> 'nome', v_nova ->> 'cpf', 'alterado', k, v_de, v_para, v_quem);
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists formacao_historico on public.formacao;
create trigger formacao_historico
  after insert or update or delete on public.formacao
  for each row execute function public.registrar_historico();

do $$
begin
  if to_regclass('public.candidatos') is not null then
    execute 'drop trigger if exists candidatos_historico on public.candidatos';
    execute 'create trigger candidatos_historico
               after insert or update or delete on public.candidatos
               for each row execute function public.registrar_historico()';
  end if;
end $$;
