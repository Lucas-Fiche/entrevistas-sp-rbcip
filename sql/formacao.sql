-- ============================================================
--  TABELA: formacao  (etapa final do funil — bolsistas em formação/trabalho)
--
--  Guarda a situação de cada BOLSISTA depois da aprovação: cadastro de bolsista,
--  supervisor, treinamentos (online/presencial) e termo de bolsa. É o espelho
--  das planilhas "formacao_capital" e "formacao_interior", importadas por CSV
--  na aba *Formação* do painel.
--
--  Ligação com o resto do sistema: pelo CPF (chave-mestra). O mesmo CPF aparece
--  na inscrição, na entrevista (pergunta "CPF do Candidato") e aqui — é o único
--  dado estável em todas as etapas.
--
--  Contém dados pessoais (CPF, telefone, e-mail) → leitura/gravação SOMENTE
--  para usuários autenticados. O público (anon) NÃO tem acesso.
--
--  Como usar: cole no SQL Editor do Supabase e clique em Run. É idempotente
--  (pode rodar de novo sem problema) e não altera nenhuma tabela existente.
-- ============================================================

create table if not exists public.formacao (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  tipo                      text not null check (tipo in ('capital', 'interior')),

  -- Chave de deduplicação: CPF (só dígitos). Sem CPF, cai no e-mail; sem
  -- e-mail, no nome normalizado. Garante que reimportar ATUALIZE a linha.
  chave                     text not null,

  -- Identificação
  nome                      text,
  cpf                       text,
  telefone                  text,
  email                     text,
  email_norm                text,

  -- Lotação
  grupo                     text,   -- Capital (Amarelo, Branco, Verde, Vermelho…)
  regiao                    text,   -- Interior (Sorocaba, Campinas…)
  supervisor                text,

  -- Etapas
  status                    text,   -- Ativo / Inativo (vem da planilha; se faltar, derivado do termo)
  cadastro_bolsista         text,   -- Realizado / Não Realizado
  treinamento_online        text,   -- Realizado / Não Realizado
  data_treinamento_online   text,
  treinamento_presencial    text,   -- Realizado / Não Realizado (na Capital, o treinamento único)
  data_treinamento_presencial text,
  termo_bolsa               text,   -- Emitido / Não Emitido
  termo_link                text,   -- link do documento no Drive

  -- Linha original do CSV (para não perder nenhuma coluna da planilha)
  origem                    jsonb not null default '{}'::jsonb
);

-- Uma linha por bolsista dentro de cada tipo (permite upsert ao reimportar).
create unique index if not exists formacao_tipo_chave_uidx
  on public.formacao (tipo, chave);

create index if not exists formacao_email_norm_idx on public.formacao (email_norm);
create index if not exists formacao_tipo_idx on public.formacao (tipo);

-- ------------------------------------------------------------
--  Row Level Security — SOMENTE usuários autenticados
-- ------------------------------------------------------------
alter table public.formacao enable row level security;

-- Nada para o público (anon): sem grant, sem policy.
grant select, insert, update, delete on public.formacao to authenticated;

drop policy if exists "formacao_select_auth" on public.formacao;
create policy "formacao_select_auth"
  on public.formacao for select to authenticated using (true);

drop policy if exists "formacao_insert_auth" on public.formacao;
create policy "formacao_insert_auth"
  on public.formacao for insert to authenticated with check (true);

drop policy if exists "formacao_update_auth" on public.formacao;
create policy "formacao_update_auth"
  on public.formacao for update to authenticated using (true) with check (true);

drop policy if exists "formacao_delete_auth" on public.formacao;
create policy "formacao_delete_auth"
  on public.formacao for delete to authenticated using (true);
