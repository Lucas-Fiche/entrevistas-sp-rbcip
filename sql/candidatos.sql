-- ============================================================
--  TABELA: candidatos  (Fase 1 do controle central)
--
--  Guarda a FICHA DE INSCRIÇÃO de cada candidato (importada por CSV no painel)
--  + as etapas do funil até a convocação para cadastro. Cada entrevista feita
--  no sistema é casada com a ficha pelo e-mail (o "cid" que viaja no link),
--  preenchendo o resultado automaticamente.
--
--  Contém dados sensíveis (CPF, RG, endereço) → leitura/gravação SOMENTE para
--  usuários autenticados (login do painel). O público (anon) NÃO tem acesso.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo sem problema) e NÃO altera a tabela de entrevistas.
-- ============================================================

create table if not exists public.candidatos (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  tipo                     text not null check (tipo in ('capital', 'interior')),

  -- Chave de deduplicação/casamento (e-mail normalizado; se faltar, CPF; se
  -- faltar, nome). Definida na importação. Garante que reenviar o CSV ATUALIZE
  -- a linha em vez de duplicar.
  chave                    text not null,

  -- Identificação e casamento
  nome                     text,
  email                    text,
  email_norm               text,   -- lower(trim(email)) — usado para casar com a entrevista
  cpf                      text,
  regiao                   text,   -- só Interior

  -- Ficha completa da inscrição (todas as colunas do CSV, como vieram)
  inscricao                jsonb not null default '{}'::jsonb,

  -- Etapas do funil (editáveis no painel)
  convocacao_entrevista    text,   -- "Enviado" etc.
  resultado_entrevista     text,   -- SELECIONADO / SEL. C/ RESSALVA / REPROVADO / NÃO COMPARECEU
  data_entrevista          text,
  convocacao_cadastro      text,   -- "Enviado" / "Não Enviado"
  data_convocacao_cadastro text,

  -- Entrevista casada (referência à tabela entrevistas), quando houver
  entrevista_id            uuid
);

-- Uma linha por candidato dentro de cada tipo (permite upsert ao reimportar).
create unique index if not exists candidatos_tipo_chave_uidx
  on public.candidatos (tipo, chave);

-- Índices de apoio (casamento por e-mail e filtros por tipo).
create index if not exists candidatos_email_norm_idx on public.candidatos (email_norm);
create index if not exists candidatos_tipo_idx on public.candidatos (tipo);

-- ------------------------------------------------------------
--  Row Level Security — SOMENTE usuários autenticados
-- ------------------------------------------------------------
alter table public.candidatos enable row level security;

-- Nada para o público (anon): sem grant, sem policy.
grant select, insert, update, delete on public.candidatos to authenticated;

drop policy if exists "candidatos_select_auth" on public.candidatos;
create policy "candidatos_select_auth"
  on public.candidatos for select to authenticated using (true);

drop policy if exists "candidatos_insert_auth" on public.candidatos;
create policy "candidatos_insert_auth"
  on public.candidatos for insert to authenticated with check (true);

drop policy if exists "candidatos_update_auth" on public.candidatos;
create policy "candidatos_update_auth"
  on public.candidatos for update to authenticated using (true) with check (true);

drop policy if exists "candidatos_delete_auth" on public.candidatos;
create policy "candidatos_delete_auth"
  on public.candidatos for delete to authenticated using (true);
