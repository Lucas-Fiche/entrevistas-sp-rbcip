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

**E as entrevistas antigas?** As que foram feitas antes de a pergunta existir
não têm CPF. Elas aparecem marcadas com **"sem CPF"** ao lado do nome nas abas
*Entrevistas Capital* e *Entrevistas Interior*; é só abrir **Detalhes** e
preencher no bloco **🪪 CPF do candidato**, no topo. Ao salvar, o vínculo com a
inscrição e com a formação passa a valer na hora. Só administradores preenchem,
e é preciso ter rodado o `sql/cpf-entrevista.sql`.

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

### Baixar em Excel, por região

O botão **⬇ Baixar .xlsx por região** (por *grupo*, na Capital) abre um menu com
cada região e quantos bolsistas ela tem. Escolhendo uma, sai um arquivo `.xlsx`
só com aquela gente, no mesmo layout da planilha de controle — útil para mandar
a lista ao supervisor da região sem expor o resto do projeto. A primeira opção
do menu baixa o Interior (ou a Capital) inteiro.

O nome do arquivo sai como `formacao_bauru_2026-08-24.xlsx` e a aba da planilha
leva o nome da região.

O botão **⬇ Baixar CSV**, ao lado, continua exportando tudo em CSV.

### O que a coluna em branco quer dizer

Nas colunas **Cadastro**, **Treino online** e **Treino presencial**, em branco
significa **Não Realizado** — é assim que a planilha de controle funciona: só
quem concluiu recebe "Realizado". Por isso a tabela escreve *Não Realizado* em
vez de um traço: um traço parece "não sei", e a informação existe.

O **supervisor** não é digitado nem sincronizado: ele vem da tabela de
supervisores, pela região (Interior) ou pelo grupo (Capital). A comparação
ignora o sufixo *"(região)"*, que aparece nos dados da plataforma e não nas
planilhas — sem isso, a ficha ficava sem supervisor mesmo com o supervisor
cadastrado.

> **O que a sincronização preenche:** apenas **Cadastro de bolsista** (quem
> aparece no formulário de cadastro) e o **termo de bolsa** (link e situação).
> **Treinamento é marcado à mão**, por decisão do projeto: em *Editar*, escolha
> *Realizado*, preencha a data e o facilitador.

Marca feita à mão **não é desfeita** por reimportação: treinamento, data,
facilitador e grupo são tratados como campos do painel — o CSV atualiza o resto
da ficha e deixa esses como estão. O mesmo vale para o *Cadastro de bolsista*
marcado pela sincronização: um CSV com a coluna vazia não apaga o "Realizado".

### Sincronizar com as planilhas

O botão **🔄 Sincronizar planilhas** lê, pelo Apps Script, o formulário de
*Cadastro de Bolsista* e as duas planilhas de *Controle TB*, e atualiza as
fichas casando por **CPF**:

- quem aparece no formulário de cadastro passa a **Cadastro: Realizado**;
- quem tem link de termo na planilha de controle recebe o link, o termo vira
  **Emitido** e a situação passa a **Ativo**.

Das planilhas trafegam apenas **CPF e link do termo** — nenhum nome, telefone
ou endereço sai delas. Os IDs das planilhas ficam só no Apps Script, na sua
conta Google, nunca no repositório do sistema.

**Nada é apagado por sincronização.** Se uma planilha vier vazia (ID errado,
permissão, aba trocada), o pior que acontece é nada mudar — o sistema nunca
marca todo mundo como pendente nem remove um termo já emitido. Se um termo
precisar ser retirado, isso é feito à mão na edição da ficha.

Ao final aparece um resumo: quantos cadastros e termos foram lidos, quantas
fichas mudaram, quantas seguem sem termo e quantas não têm CPF (essas não têm
como ser casadas — preencha o CPF na ficha).

### Sincronizar sozinho, de tempo em tempo

Além do botão, a sincronização pode rodar por conta própria a cada 6 horas, no
servidor do Google, sem ninguém abrir o painel. É o mesmo procedimento e as
mesmas regras — inclusive a de nunca apagar nada.

Para ligar, no Apps Script:

1. Crie no Supabase, em **Authentication → Users**, um usuário só para isto
   (ex.: `robo@rbcip.org`) e inclua o e-mail na tabela `app_admins`.
2. Preencha `ROBO_EMAIL` e `ROBO_SENHA` no script.
3. Rode a função **`instalarGatilhoSincronizacao`** uma vez, pelo editor.

Para desligar, rode `removerGatilhoSincronizacao` — o botão manual continua
funcionando.

> **Por que um usuário de robô e não a chave `service_role`.** A chave
> service_role ignora todas as regras de segurança do banco e só pode ser
> revogada trocando a chave do projeto inteiro. O usuário de robô tem
> exatamente os poderes de um admin do painel, continua sujeito ao RLS e, se a
> senha vazar, basta apagar o usuário.

Cada sincronização — manual ou automática — fica registrada na tabela
`sincronizacoes` (rode `sql/sincronizacoes.sql`), e a aba mostra a última:
quando foi, se foi automática, quantas fichas mudaram e o que veio da ponte.
Quando a automática falha, ela envia e-mail e registra o erro: uma rotina que
roda sem ninguém olhando não pode falhar em silêncio.

### Desligar um bolsista (e para onde ele vai)

O desligamento deixou de ser "preencher dois campos" no meio da edição: virou
uma **ação própria**. No fim da ficha (**✎ Editar**) há a faixa vermelha com o
botão **⛔ Desligar bolsista**, que abre uma tela só para isso:

- **Data do desligamento** — já vem com a data de hoje;
- **Motivo** — lista de motivos comuns (desistência, abandono, baixo
  desempenho, indisponibilidade, mudança de região, fim da participação) ou
  *Outro*, com campo livre. O motivo é **obrigatório**: é ele que explica, três
  meses depois, por que aquela vaga abriu.

A confirmação diz quantas vagas a região passa a ter. Nada é apagado.

**Para onde a pessoa vai:** a aba Formação tem duas listas — **No projeto** e
**Desligados**. Ao confirmar, a ficha sai da primeira e aparece na segunda, que
mostra duas colunas a mais: *Desligado em* e *Motivo*. O painel já muda para
essa lista, para você ver o resultado do que acabou de fazer.

O efeito em cadeia é o esperado: a região **libera uma vaga**, quem estava na
fila de reserva pode ser convocado, e a pessoa continua contando nos gráficos
de *Desligamentos por motivo* e no histórico. Os arquivos exportados (CSV e
.xlsx) continuam trazendo todo mundo, com as colunas de desligamento — é o
mesmo layout da sua planilha de controle.

Errou? **↩ Reverter desligamento**, na mesma faixa, devolve a pessoa para a
lista de quem está no projeto (e a vaga volta a ser ocupada). Para só corrigir a
data ou o motivo, use **Corrigir desligamento**.

### A Formação na aba Visualização de dados

A aba **Visualização de dados** tem três sub-abas — *Inscrições no SIPE*,
*Entrevistas* e *Formação* —, uma por etapa do funil. A de Formação mostra:

- **Indicadores:** no projeto, ativos (com termo), aguardando termo, desligados
  e a **ocupação das metas** em porcentagem;
- **Metas e vagas** por região (o mesmo bloco das outras abas);
- **Ocupação da meta por região** — barra que se enche até a meta, com o número
  aberto (`3/3`, `1/4`); verde quando a região fecha;
- **Situação dos bolsistas** — ativos, aguardando termo, desligados;
- **Etapas concluídas** — cadastro, treinamento online, presencial e termo;
- **Pendências** — sem cadastro, sem treinamento, sem termo e sem CPF na ficha;
- **Distribuição** por grupo (Capital) ou região (Interior) e **por supervisor**;
- **Desligamentos por motivo**, quando houver.

Os filtros de **tipo** e **região** valem nessa sub-aba; o de **período** não —
a ficha de formação não tem uma data única que sirva de referência, e filtrar
por uma data qualquer daria um número que não significa nada.

### Ordem da lista

A tabela aparece na **mesma ordem do arquivo importado** — que é a ordem em que
as pessoas entraram no projeto (nas inscrições, a ordem em que se cadastraram).
Cada importação grava a posição de cada linha.

Para isso funcionar, rode uma vez o **`sql/ordem.sql`** e reimporte os CSVs. Até
lá, as fichas antigas não têm posição definida e ficam no fim da lista — o
rodapé da tabela avisa quando é esse o caso.

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
