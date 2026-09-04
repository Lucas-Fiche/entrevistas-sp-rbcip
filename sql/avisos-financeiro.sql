-- ============================================================
--  REGISTRO DOS AVISOS AO FINANCEIRO
--
--  Guarda cada aviso de "apto, só falta o termo" que sai por e-mail: quando,
--  se foi automático ou pelo botão, para quais endereços foi e quem entrou na
--  lista.
--
--  Por que registrar: o aviso sai sozinho, de hora em hora, sem ninguém
--  olhando. Sem este registro, "não chegou nada" tem dois significados
--  indistinguíveis — "está tudo certo e não havia ninguém apto" e "parou de
--  funcionar". Com ele, a aba Termos de Bolsa mostra a data do último envio e
--  o histórico, e a diferença fica visível.
--
--  As FALHAS também entram aqui (com `detalhe` preenchido e `quantidade` 0).
--  Uma rotina automática que falha calada é o pior caso.
--
--  Cole no SQL Editor do Supabase e clique em Run. É idempotente: pode rodar
--  de novo sempre que este arquivo mudar, sem apagar nada.
--
--  Depende de: sql/perfil-financeiro.sql (a coluna `aviso_apto_em`) e, se
--  existir, de sql/admin.sql (a função `eh_admin`).
-- ============================================================

create table if not exists public.avisos_financeiro (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  origem        text not null check (origem in ('manual', 'automatica')),
  usuario       text,          -- quem clicou (ou a conta do robô)
  quantidade    integer not null default 0,   -- pessoas no aviso
  destinatarios text[],        -- e-mails do financeiro que receberam
  pessoas       jsonb,         -- nome/projeto/CPF de quem entrou na lista
  detalhe       text           -- erro, quando houver
);

-- Colunas novas, caso a tabela já exista de uma versão anterior.
alter table public.avisos_financeiro add column if not exists destinatarios text[];
alter table public.avisos_financeiro add column if not exists pessoas jsonb;
alter table public.avisos_financeiro add column if not exists detalhe text;

create index if not exists avisos_financeiro_criado_em_idx
  on public.avisos_financeiro (criado_em desc);

alter table public.avisos_financeiro enable row level security;
grant select, insert on public.avisos_financeiro to authenticated;

-- Ler: qualquer pessoa logada. O financeiro precisa ver o próprio histórico,
-- e o registro não guarda nada além do que ele já recebeu por e-mail.
drop policy if exists "avisos_financeiro_select_auth" on public.avisos_financeiro;
create policy "avisos_financeiro_select_auth"
  on public.avisos_financeiro for select to authenticated using (true);

-- Gravar: só administrador (é o robô, que está em app_admins). Enquanto
-- sql/admin.sql não tiver sido rodado, `eh_admin` não existe e a condição cai
-- para `true` — o mesmo que as outras tabelas de registro fazem.
drop policy if exists "avisos_financeiro_insert_admin" on public.avisos_financeiro;
do $$
declare cond text;
begin
  cond := case when to_regprocedure('public.eh_admin()') is not null
               then 'public.eh_admin()' else 'true' end;
  execute 'create policy "avisos_financeiro_insert_admin" on public.avisos_financeiro '
       || 'for insert to authenticated with check (' || cond || ')';
end $$;

comment on table public.avisos_financeiro is
  'Cada e-mail de "apto, aguardando o termo" enviado ao financeiro. Falhas entram com detalhe preenchido.';
