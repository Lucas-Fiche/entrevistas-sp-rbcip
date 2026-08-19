# Aba Formação + o CPF como chave do sistema

Este documento explica a última etapa do funil (a aba **Formação**) e a decisão
que a sustenta: **o CPF passou a ser a chave que liga todas as etapas.**

---

## 1. Por que o CPF

O sistema acompanha a mesma pessoa em quatro momentos diferentes:

| Etapa | Onde nasce o dado |
|---|---|
| Inscrição | plataforma SIPE → CSV importado na aba *Candidatos* |
| Entrevista | formulário do próprio sistema |
| Cadastro de bolsista | formulário Google (Cadastro de Bolsista) |
| Termo de bolsa / formação | planilhas `formacao_capital` e `formacao_interior` |

Para juntar tudo é preciso um dado que **não mude** entre as etapas. O e-mail
não serve: nos dados reais aparecem erros de digitação (`@gamil.com`,
`hotmaIl.com`) e até e-mails de terceiros. O nome também não: vem escrito de
formas diferentes em cada planilha (com/sem acento, tudo em maiúsculas, nomes do
meio abreviados).

O CPF é único, obrigatório para receber a bolsa e aparece em todas as etapas.
Por isso ele virou a chave-mestra.

**O que mudou na prática:** os dois formulários de entrevista agora têm a
pergunta **"CPF do Candidato"**, logo abaixo do nome. O campo aceita só números
e se formata sozinho (`000.000.000-00`). É obrigatório — exceto quando a
entrevista é marcada como *candidato faltante*, aí não faz sentido exigir.

**Ordem de casamento** (quando o sistema procura a entrevista de alguém):

1. **CPF** (11 dígitos, comparados só pelos números);
2. **e-mail** (o `cid` que viaja no link do formulário);
3. **nome** (normalizado, sem acentos).

Ou seja: o e-mail e o nome continuam funcionando como antes. O CPF só entrou na
frente — nada do que já existe deixou de casar.

---

## 2. A aba Formação

Espelha as planilhas `formacao_capital` e `formacao_interior` e mostra, por
bolsista:

- **Status** — Ativo / Inativo. Vem da planilha; se vier vazio, o sistema deduz
  pelo termo de bolsa (só é *Ativo* quem já tem o documento emitido).
- **Grupo** (Capital) ou **Região** (Interior) e o **Supervisor**.
- **CPF, telefone e e-mail** — vindos do formulário *Cadastro de Bolsista*.
- **Cadastro** — se o formulário de cadastro foi preenchido.
- **Treinamento** — a Capital tem um treinamento só; o Interior tem *online* e
  *presencial*, cada um com sua data.
- **Termo de bolsa** — quando existe o documento, vira um link direto para o
  arquivo no Drive.

No topo há um resumo (bolsistas, ativos, termo emitido, cadastro pendente, sem
treinamento) e uma busca por nome, CPF, e-mail, supervisor ou região.

Ao lado do nome aparece o selo **"entrevista no sistema"** quando aquele
bolsista foi casado com uma entrevista feita aqui — é o CPF fazendo o trabalho.

### Antes de usar: rode o SQL

No **SQL Editor do Supabase**, cole e rode **`sql/formacao.sql`** uma vez. Ele
cria a tabela `formacao` com acesso **só para quem faz login** (o público não
enxerga nada — são dados pessoais). É idempotente e não mexe em nenhuma tabela
existente.

### Como importar

1. Baixe a planilha de formação como **CSV**.
2. Na aba **Formação**, escolha *Capital* ou *Interior*, selecione o arquivo e
   clique em **Enviar CSV**.

O sistema entende os dois formatos de cabeçalho (o da Capital tem *Grupo* e uma
coluna de treinamento; o do Interior tem *Região* e duas). O separador pode ser
vírgula ou ponto e vírgula — é detectado automaticamente.

Reimportar **atualiza** as linhas existentes em vez de duplicar: a
identificação é feita pelo CPF (sem CPF, pelo e-mail; sem e-mail, pelo nome).

---

## 3. O próximo passo (automação)

Hoje a aba Formação é alimentada por CSV. O caminho para ela se alimentar
sozinha, sem upload manual, é um **Apps Script com gatilho por tempo** que:

1. lê as respostas do formulário *Cadastro de Bolsista* e a planilha de termos;
2. grava direto na tabela `formacao` do Supabase (mesma chamada REST já usada
   pelo Web App das convocações), casando pelo CPF.

Como o CPF já está em todas as pontas — inscrição, entrevista, cadastro e termo
— essa automação não exige nenhuma mudança no que foi construído até aqui: é só
trocar quem escreve na tabela.
