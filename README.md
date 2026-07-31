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
├── css/
│   └── styles.css      # Estilos
├── js/
│   ├── config.js       # Credenciais do Supabase (preencher)
│   ├── forms-schema.js # Estrutura das perguntas dos dois formulários
│   └── app.js          # Renderiza o formulário, valida e envia ao Supabase
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

## Próximos passos

- [ ] Página de **dashboard** para acompanhar as entrevistas/candidatos
      (a tabela já guarda os campos necessários para isso).
