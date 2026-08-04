# Entrevistas SP — Processo Seletivo RBCIP

Sistema para conduzir e acompanhar as **entrevistas estruturadas** do processo
seletivo da RBCIP (perfil **Avaliador / Entrevistador**), em substituição ao
Google Forms.

- **Formulários** (Capital e Interior) que o entrevistador preenche durante a entrevista.
- **Dashboard** (com login) para acompanhar candidatos, pontuações, filtros, gráficos, mapa e exportação.
- **Banco de dados** no Supabase.

Feito com **HTML + CSS + JavaScript puro** (sem framework, sem etapa de build) e
**Supabase**. É um site estático: os arquivos são servidos como estão.

---

## Índice

1. [Como funciona (arquitetura)](#como-funciona-arquitetura)
2. [Estrutura de arquivos](#estrutura-de-arquivos)
3. [Onde ficam salvas as respostas](#onde-ficam-salvas-as-respostas)  ← leia se procurou os campos no Supabase
4. [Modelo de dados](#modelo-de-dados)
5. [Os formulários](#os-formulários)
6. [O dashboard](#o-dashboard)
7. [Segurança (RLS)](#segurança-rls)
8. [Configurar o Supabase (passo a passo)](#configurar-o-supabase-passo-a-passo)
9. [Rodar localmente](#rodar-localmente)
10. [Publicar (Vercel)](#publicar-vercel)
11. [Como alterar coisas comuns](#como-alterar-coisas-comuns)
12. [Solução de problemas](#solução-de-problemas)
13. [Boas práticas operacionais](#boas-práticas-operacionais)

---

## Como funciona (arquitetura)

```
  Entrevistador                        Você (gestor)
      │                                     │
      ▼                                     ▼
 [ Formulário ] --insere--> [ Supabase ] <--lê (login)-- [ Dashboard ]
  (site, anon)              (Postgres +                    (site, autenticado)
                             RLS + Auth)
```

- **Formulário** e **Dashboard** são páginas estáticas hospedadas na Vercel.
- Os dados são gravados e lidos no **Supabase** (banco Postgres gerenciado).
- O formulário grava como **visitante (anon)**; o dashboard só lê após **login**.
- Não há servidor próprio nem etapa de build.

---

## Estrutura de arquivos

```
.
├── index.html            # Página inicial: escolha entre Capital e Interior
├── formulario.html       # Formulário (?tipo=capital | ?tipo=interior)
├── dashboard.html        # Dashboard (login + abas + gráficos)
├── vercel.json           # Cabeçalhos de cache (revalidação) na Vercel
├── css/
│   ├── styles.css        # Estilos dos formulários e base (variáveis de cor)
│   └── dashboard.css     # Estilos do dashboard
├── js/
│   ├── config.js         # Credenciais do Supabase (URL + publishable key)
│   ├── forms-schema.js   # Estrutura das perguntas dos dois formulários
│   ├── app.js            # Renderiza o formulário, valida, pontua e envia
│   ├── dashboard.js      # Login, tabelas, filtros, gráficos, mapa, exportação
│   └── export.js         # Geração de CSV e XLSX no navegador (sem biblioteca)
├── sql/
│   ├── schema.sql        # Cria a tabela + segurança (RLS) + permissões
│   └── view_respostas.sql# VIEW que mostra as respostas em colunas (opcional)
├── assets/
│   ├── logo-rbcip.png    # Logo (barra superior)
│   └── bandeira-sp.png   # Bandeira de SP (canto do mapa)
└── docs/
    └── GUIA-ENTREVISTADORES.md  # Guia simples para quem faz as entrevistas
```

---

## Onde ficam salvas as respostas

**Todas as respostas ficam no Supabase, na tabela `entrevistas`.**

O ponto que costuma confundir: as respostas **não** aparecem como uma coluna para
cada pergunta. Existem duas partes:

1. **Colunas "promovidas"** (para facilitar filtros e ranking): `candidato`,
   `data_entrevista`, `entrevistador`, `pontuacao_total`, `recomendacao`, etc.
2. **A coluna `respostas`** — do tipo **JSONB** — que guarda **todas** as
   respostas do formulário, uma por chave. É aqui que estão os textos das
   perguntas. No Table Editor, essa célula aparece "cortada"; **clique nela**
   para ver o JSON inteiro.

Exemplo do conteúdo de `respostas`:

```json
{
  "nome_candidato": "Amanda Campos",
  "regiao_atuacao": "Presidente Prudente (região)",
  "exp_entrevistas": "Já fiz entrevistas presenciais e online...",
  "exp_entrevistas_nota": "5",
  "recomendacao_final": "Aprovado - Forte Recomendação",
  "justificativa_recomendacao": "Ótima candidata."
}
```

### Como ver as respostas de forma legível

- **No dashboard:** clique em **Detalhes** na linha do candidato → mostra todas
  as perguntas e respostas com os rótulos certos. Há também **Baixar PDF** e
  **Baixar CSV/Excel** (que já transformam cada resposta em coluna).
- **No Supabase, como planilha:** rode `sql/view_respostas.sql` uma vez. Ele cria
  a view **`entrevistas_detalhado`**, que expõe cada resposta em uma coluna
  separada. Depois é só abrir essa view no Table Editor ou rodar
  `select * from entrevistas_detalhado;`.
- **Por SQL, um campo específico:** `select candidato, respostas->>'exp_entrevistas' from entrevistas;`

> Por que guardar tudo em JSON? Os dois formulários têm ~30 campos e variam entre
> si (Capital x Interior). Um único JSON deixa a tabela flexível e simples de
> manter, sem precisar de dezenas de colunas fixas — e os campos principais ficam
> duplicados em colunas próprias para o dashboard.

---

## Modelo de dados

Tabela `public.entrevistas` (criada por `sql/schema.sql`):

| Coluna                  | Tipo        | Descrição                                            |
|-------------------------|-------------|-----------------------------------------------------|
| `id`                    | uuid        | Gerado automaticamente                              |
| `created_at`            | timestamptz | Data/hora do registro (automático)                  |
| `tipo`                  | text        | `capital` ou `interior`                             |
| `perfil`                | text        | Sempre `Avaliador (Entrevistador)`                  |
| `candidato`             | text        | Nome do candidato                                   |
| `data_entrevista`       | text        | Data informada na entrevista                        |
| `entrevistador`         | text        | Nome do entrevistador                               |
| `nao_compareceu`        | boolean     | Marcado como candidato faltante                     |
| `nao_cumpre_requisitos` | boolean     | Marcado como reprovado por requisitos               |
| `recomendacao`          | text        | Recomendação final                                  |
| `pontuacao_total`       | integer     | Pontuação obtida (para ranking)                     |
| `pontuacao_maxima`      | integer     | Pontuação máxima possível (36)                      |
| `respostas`             | jsonb       | **Todas** as respostas do formulário                |

---

## Os formulários

Ambos os formulários referem-se **apenas ao perfil Avaliador (Entrevistador)**.

- **Compartilham** os mesmos blocos de avaliação (Blocos 1 a 4 + observação final),
  definidos **uma única vez** em `js/forms-schema.js`. Diferem apenas na seção de
  **Elegibilidade** (a Capital confirma residência na região central; o Interior
  pergunta a cidade e a **região de atuação**).
- **Pontuação automática** (para ranquear) — o bloco de *Elegibilidade* não pontua:
  - Bloco 1 (STAR): 6 notas de 1 a 5 → até **30 pontos**;
  - "Adequado/Inadequado" (Blocos 2 e 3): 1 ponto por "Adequado" → até **5**;
  - "Sim/Não" do Conflito de Interesses: 1 ponto para "Sim" → até **1**;
  - **Total máximo: 36 pontos**, exibido ao vivo enquanto se preenche.
- **Marcadores de saída rápida:** *"candidato faltante"* e *"não cumpre requisitos"*
  ocultam as seções não aplicáveis e ajustam a validação. Faltante/reprovado **não
  pontuam**.
- **Rascunho automático:** o formulário é salvo no navegador a cada alteração e
  recuperado se a página for fechada/recarregada. O rascunho só é apagado após um
  envio bem-sucedido.
- **Envio sempre como visitante (anon):** o formulário não usa a sessão de login do
  dashboard (evita erro de sessão), então qualquer pessoa com o link consegue enviar.
- **Data da entrevista** já vem preenchida com a data atual.

---

## O dashboard

`dashboard.html` — **acesso restrito por login** (Supabase Auth). Três abas:

- **Capital** e **Interior:** tabela das entrevistas com busca, ordenação por
  coluna (padrão: ranking por pontuação), **Recomendação colorida** (verde =
  aprovado, vermelho = reprovado), botão **Detalhes** (com **Baixar PDF**) e
  **Baixar CSV / Baixar Excel**.
- **Visualização de dados:** filtros (**Tipo**, **Período** e **Região**),
  indicadores (KPIs), gráficos (inscritos por região, recomendação, entrevistas e
  **nota média por entrevistador**) e um **mapa de São Paulo** com o número de
  inscritos por região.

---

## Segurança (RLS)

O acesso é controlado pelo **Row Level Security** do Postgres (definido em
`sql/schema.sql`):

- **Papel `anon`** (chave pública / formulário): **só INSERT**. Não lê, não edita,
  não apaga.
- **Papel `authenticated`** (login no dashboard): **SELECT**. Lê os dados após login.
- A **publishable key** pode ficar exposta no front-end (`js/config.js`) — quem
  controla o acesso é o RLS. **Nunca** use a chave *secret*/*service_role* no site.

---

## Configurar o Supabase (passo a passo)

1. Crie um projeto em <https://app.supabase.com> (pode ser na mesma organização de
   outros sistemas — cada projeto é isolado).
2. **SQL Editor → New query →** cole e rode o conteúdo de **`sql/schema.sql`**
   (cria a tabela, o RLS e as permissões). É idempotente (pode rodar de novo).
3. *(Opcional, recomendado para consultar)* rode também **`sql/view_respostas.sql`**
   para ver as respostas como colunas.
4. **Settings → API:** copie a **Project URL** e a **Publishable key** (formato
   novo) ou a chave **anon public** (formato antigo). Cole as duas em
   **`js/config.js`**.
5. **Authentication → Users → Add user:** crie o(s) usuário(s) do dashboard
   (e-mail + senha, marque *Auto Confirm User*). Recomendado desativar
   *"Allow new users to sign up"* em Authentication → Sign In / Providers.

> A leitura do dashboard exige o `grant select ... to authenticated` + a policy de
> select, que já estão no `schema.sql`.

---

## Rodar localmente

Use um servidor estático (por causa dos parâmetros de URL e do carregamento dos
scripts). **Não** abra o `.html` direto do disco (`file://`) — o formulário bloqueia
esse modo de propósito.

```bash
python3 -m http.server 8000
# depois abra http://localhost:8000
```

---

## Publicar (Vercel)

O projeto é estático — sem build.

1. Vercel → **Add New → Project** → importe o repositório do GitHub.
2. **Framework Preset:** `Other`. **Build Command** e **Output Directory:** deixe
   **vazios**. **Root Directory:** `/`.
3. **Deploy.** A cada `git push` na branch de produção, a Vercel publica sozinha.

O arquivo **`vercel.json`** define `Cache-Control: must-revalidate`, para que os
arquivos `.js`/`.css` sejam sempre revalidados e as atualizações apareçam sem
precisar limpar o cache.

---

## Como alterar coisas comuns

- **Adicionar/editar uma pergunta:** edite `js/forms-schema.js`. Cada pergunta é um
  objeto com `id`, `tipo`, `label`, `ajuda`, `obrigatorio`. Blocos comuns ficam em
  `secaoAvaliador()` (valem para os dois formulários).
- **Regiões do Interior:** edite `REGIOES_INTERIOR` em `js/forms-schema.js`. Para o
  ponto no mapa, ajuste `REGIOES` em `js/dashboard.js` (lon/lat e posição do rótulo).
- **Entrevistadores:** edite `ENTREVISTADORES` em `js/forms-schema.js`.
- **Cores / identidade:** variáveis no topo de `css/styles.css` (`--cor-primaria`
  etc.).
- **Logo / bandeira:** troque os arquivos em `assets/`.

> ⚠️ Ao remover uma pergunta que pontua, a pontuação máxima muda. Registros antigos
> mantêm a pontuação com que foram gravados — ajuste-os no Supabase se quiser
> comparabilidade.

---

## Solução de problemas

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| `permission denied for table entrevistas` ao enviar | Faltou a permissão de INSERT (ou a pessoa está logada e o papel `authenticated` não tinha INSERT) | Rode o `sql/schema.sql` atualizado (concede INSERT a `anon` e `authenticated`) |
| `JWT expired` **no dashboard** | Sessão de login expirou | O dashboard tenta renovar sozinho; se não, cai no login. Basta entrar de novo |
| `JWT expired` **no formulário** | Já corrigido: o formulário envia sempre como `anon`. Se aparecer, recarregue com Ctrl+Shift+R | Recarregar; o rascunho é restaurado |
| Formulário "recarrega em branco" ao enviar | A página foi aberta como **arquivo salvo** (`file://`), não pelo site | Usar sempre o **link** do site, nunca "Salvar página como". O formulário já bloqueia o modo arquivo |
| Vejo uma versão antiga após um deploy | Cache do navegador | Ctrl+Shift+R uma vez (o `vercel.json` evita recorrência) |
| "Baixar PDF" não abre | Pop-up bloqueado | Permitir pop-ups para o site |

---

## Boas práticas operacionais

- **Sempre acessar pelo link do site** (favorito no navegador), nunca por um arquivo
  `.html` salvo no computador. Veja `docs/GUIA-ENTREVISTADORES.md`.
- Os entrevistadores **não** precisam de login (só preenchem o formulário). O login
  é apenas para o gestor acessar o dashboard.
- Compartilhe com a equipe o guia em `docs/GUIA-ENTREVISTADORES.md`.
