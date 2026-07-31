# Entrevistas SP — RBCIP

Formulários de Entrevista Estruturada do Processo Seletivo RBCIP (perfil
**Avaliador / Entrevistador**), em substituição ao Google Forms.

Feito com **HTML + CSS + JavaScript puro** e **Supabase** para armazenamento —
sem framework, sem build, fácil de manter.

## Estrutura

```
.
├── index.html          # Página inicial: escolha entre Capital e Interior
├── formulario.html     # Página do formulário (?tipo=capital | ?tipo=interior)
├── dashboard.html      # Dashboard (login + abas Capital/Interior/Dados)
├── css/
│   ├── styles.css      # Estilos dos formulários e base
│   └── dashboard.css   # Estilos do dashboard
├── js/
│   ├── config.js       # Credenciais do Supabase (preencher)
│   ├── forms-schema.js # Estrutura das perguntas dos dois formulários
│   ├── app.js          # Renderiza o formulário, valida e envia ao Supabase
│   └── dashboard.js    # Login, tabelas e gráficos do dashboard
└── sql/
    └── schema.sql      # Criação da tabela + políticas de segurança (RLS)
```

Os dois formulários são quase idênticos: compartilham os blocos de avaliação
(Blocos 1 a 4 + observação final) e diferem apenas na seção de **Elegibilidade**.
Por isso, a parte comum é definida uma única vez em `forms-schema.js`.

## Funcionalidades

- **Pontuação automática do candidato** (para ranquear no dashboard). O bloco de
  *Elegibilidade* não pontua. Somam pontos:
  - Bloco 1 (STAR): 7 notas de 1 a 5 → até **35 pontos**;
  - "Adequado/Inadequado" (Blocos 2 e 3): 1 ponto para cada "Adequado" → até **5**;
  - "Sim/Não" do Conflito de Interesses: 1 ponto para "Sim" → até **1**;
  - **Total máximo: 41 pontos**, exibido ao vivo enquanto se preenche.
- **Rascunho automático:** o formulário é salvo no navegador a cada alteração e
  recuperado se a página for fechada/recarregada, evitando perda de dados.
- **Marcadores de saída rápida:** ao marcar *"candidato faltante"* ou *"não cumpre
  requisitos"*, as seções não aplicáveis são ocultadas e a validação se ajusta.
- **Entrevistador por lista** (Christiane Borges, Fabiola Seabra, Luiz Rocha),
  mantendo o dado padronizado. Edite a lista `ENTREVISTADORES` em `forms-schema.js`.
- **Data da entrevista** já vem preenchida com a data atual.

## Como configurar o Supabase

1. Crie um projeto em <https://app.supabase.com>.
2. No **SQL Editor**, cole e execute o conteúdo de `sql/schema.sql`.
3. Em **Settings → API**, copie:
   - **Project URL** → `SUPABASE_URL`
   - Chave **anon public** → `SUPABASE_ANON_KEY`
4. Cole os dois valores em `js/config.js`.

A chave *anon public* pode ficar no front-end: o acesso é controlado pelas
políticas de **Row Level Security** do `schema.sql` (o público só pode
**inserir** entrevistas, não ler).

> **Modo de teste:** enquanto `js/config.js` estiver em branco, o formulário
> funciona normalmente, mas salva as respostas apenas no navegador
> (`localStorage`). Útil para validar a experiência antes de conectar o banco.

## Como rodar localmente

Basta um servidor estático (por causa dos parâmetros de URL e do carregamento
dos scripts). Por exemplo:

```bash
python3 -m http.server 8000
```

Depois abra <http://localhost:8000>.

## Como publicar

Qualquer hospedagem de site estático serve (GitHub Pages, Netlify, Vercel,
Cloudflare Pages). Não há etapa de build — publique os arquivos como estão.

## Modelo de dados

Cada envio grava uma linha na tabela `entrevistas`:

| Coluna                  | Descrição                                              |
|-------------------------|--------------------------------------------------------|
| `tipo`                  | `capital` ou `interior`                                |
| `perfil`                | Sempre `Avaliador (Entrevistador)`                     |
| `candidato`             | Nome do candidato                                      |
| `data_entrevista`       | Data informada                                         |
| `entrevistador`         | Nome do entrevistador                                  |
| `nao_compareceu`        | Marcado como candidato faltante                        |
| `nao_cumpre_requisitos` | Marcado como reprovado por requisitos                  |
| `recomendacao`          | Recomendação final                                     |
| `pontuacao_total`       | Pontuação obtida (para ranking)                        |
| `pontuacao_maxima`      | Pontuação máxima possível (41)                         |
| `respostas`             | JSON com **todas** as respostas do formulário          |

Manter os campos principais em colunas próprias (além do JSON) facilita o
**dashboard** que será feito na próxima etapa.

## Dashboard

`dashboard.html` mostra as entrevistas em três abas: **Capital**, **Interior**
(tabelas com busca, ordenação por coluna e detalhe de cada entrevista) e
**Visualização de dados** (indicadores e gráficos).

O acesso é **restrito por login** (Supabase Auth): só usuários autenticados
conseguem ler os dados. O público continua podendo apenas **inserir** pelo
formulário.

### Liberar a leitura para autenticados
O `sql/schema.sql` já inclui a política de `select` para o papel `authenticated`.
Se você rodou uma versão anterior do script, rode este trecho no SQL Editor:

```sql
grant select on public.entrevistas to authenticated;

drop policy if exists "entrevistas_select_auth" on public.entrevistas;
create policy "entrevistas_select_auth"
  on public.entrevistas for select to authenticated using (true);
```

### Criar o(s) usuário(s) de acesso
No painel do Supabase:

1. Menu **Authentication → Users → Add user** (*Create new user*).
2. Informe **e-mail** e **senha** e marque **Auto Confirm User**.
3. Repita para cada pessoa que terá acesso (ou crie um único login compartilhado).

Recomendado: em **Authentication → Providers/Sign In → Email**, **desative
"Allow new users to sign up"**, já que os usuários são criados manualmente.

Pronto — acesse `dashboard.html`, faça login e os dados aparecem.

## Próximos passos

- [ ] (Opcional) Exportar entrevistas para CSV/Excel a partir do dashboard.
