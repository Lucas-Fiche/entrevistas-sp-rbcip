# Super admin e edição das fichas

Este documento explica quem pode alterar dados no painel, como editar a ficha de
um candidato e por que a edição feita no sistema não é desfeita pela próxima
importação de planilha.

---

## 1. Ligar o super admin (uma vez)

No **SQL Editor do Supabase**, rode **`sql/admin.sql`**. Ele:

- cria a tabela **`app_admins`** já com `lucas@rbcip.org`;
- cria a coluna `editado` em `candidatos` (marca o que foi corrigido à mão);
- passa a **exigir ser administrador para gravar** em `candidatos` e `formacao`.

A restrição é feita pelo próprio banco (Row Level Security), não só pela tela.
Quem não é administrador continua entrando e vendo tudo, mas em **modo somente
leitura**: sem importar CSV, sem editar fichas e sem enviar convocações.

> **Confira o e-mail do seu login.** O que vale é o e-mail com que você entra no
> painel, não o seu e-mail pessoal. Se você entra com outro endereço, inclua-o:
>
> ```sql
> insert into public.app_admins (email) values ('seu.login@rbcip.org');
> ```
>
> Para remover alguém: `delete from public.app_admins where email = '...';`

No canto superior direito do painel aparece um selo ao lado do seu e-mail:
**ADMIN**, **SUPERVISOR** ou **SOMENTE LEITURA**. É por ele que você confere se a
permissão pegou.

### O que o perfil SOMENTE LEITURA vê

Todas as abas e todos os números — e **nenhum botão de ação**. Não aparecem: a
barra de importar CSV, o registro das importações e sincronizações, *Convocar
todos para entrevista*, *Verificar entregas*, *Baixar CSV*, *Convocar cadastro*
(nem o individual, nem o da fila de reserva), *Solicitar inscrição*, *Editar*,
*Editar metas*, *Supervisores* e *Sincronizar planilhas*.

No lugar do botão de convocação, a coluna mostra o **estado** — `⏱ pendente` com
a explicação no "passe o mouse". Quem só lê precisa saber que falta convocar
alguém; não precisa poder convocar.

O bloco **Metas e vagas** continua inteiro: metas, ocupação, vagas e a fila de
reserva (quem está esperando e em que ordem). O que some de dentro da fila é a
coluna de convocar.

> A checagem de permissão está **nos dois lugares**: o botão não é desenhado e a
> ação também se recusa a rodar. Se um botão escapar de alguma condição — como
> escapou o *Convocar cadastro* —, o clique não envia nada.

---

## 1b. O perfil SUPERVISOR

Rode **`sql/perfil-supervisor.sql`** no SQL Editor do Supabase. Ele cria a lista
**`app_supervisores`** e a função `definir_grupo`. É idempotente: pode rodar de
novo sempre que o arquivo mudar, sem apagar nada.

São **dois passos**, e o SQL é só o segundo:

1. **Criar o login.** Supabase → **Authentication → Users → Add user**: e-mail e
   senha, marcando *Auto Confirm User*. A senha é definida aí — não existe
   senha guardada em nenhuma tabela, e o painel não tem cadastro nem
   "esqueci minha senha".
2. **Dar o perfil**, com o **mesmo e-mail** do login:

   ```sql
   insert into public.app_supervisores (email) values ('fulano@rbcip.org');
   ```

Para tirar o perfil: `delete from public.app_supervisores where email = '...';`
(o login continua existindo — a pessoa passa a entrar como somente leitura).

> **Se o selo aparecer como SOMENTE LEITURA**, o endereço do login não é o mesmo
> da tabela. Maiúsculas e minúsculas não importam; o endereço, sim. Confira com
> `select email from public.app_supervisores order by email;`

O que o supervisor **vê**: as abas *Candidatos*, *Entrevistas Capital*,
*Entrevistas Interior* e *Formação*, em leitura. A aba **Visualização de dados
não aparece** para ele.

O que o supervisor **altera**: uma coisa só — **definir o Grupo de um bolsista da
Capital que ainda não tem grupo**, na aba *Formação*. A linha ganha a coluna
**Ação**:

- bolsista **sem grupo** → botão **+ Definir grupo**, e a janela que abre tem
  esse único campo (sem a opção "em branco": ele preenche, não apaga);
- bolsista **que já tem grupo** → um traço. **Trocar alguém de grupo é só do
  administrador**, inclusive quando foi o próprio supervisor que definiu.

No Interior não há botão nenhum: lá a lotação é a região, e região é do
administrador.

> **Por que preencher pode e trocar não.** Preencher um campo vazio é completar
> um cadastro. Trocar um grupo já definido é remanejar gente entre supervisores
> — decisão de coordenação, com efeito sobre a distribuição das equipes. São
> ações de peso diferente, e só a primeira é rotina do supervisor.

Tudo o mais continua fora do alcance dele: importar planilhas, sincronizar,
baixar as planilhas por região, enviar convocações, editar os outros campos da
ficha, desligar bolsista, mexer em metas ou em supervisores.

> **Por que uma função de banco e não uma permissão de escrita.** O Row Level
> Security do Postgres decide por **linha**, não por **coluna**: liberar a linha
> da ficha para o supervisor liberaria a ficha inteira — treinamento, termo,
> desligamento. Então a permissão de gravar continua só do administrador, e o
> supervisor grava pela função `definir_grupo`, que é a única porta e só sabe
> escrever numa coluna, em fichas da Capital. Vale mesmo que alguém tente
> contornar a tela.
>
> Enquanto `sql/perfil-supervisor.sql` não for rodado, ninguém tem o perfil e o
> painel se comporta como antes (admin e somente leitura). Se a lista existir
> mas a função não, o supervisor vê a mensagem dizendo qual arquivo falta rodar.

---

## 1d. O perfil FINANCEIRO

Rode **`sql/perfil-financeiro.sql`** no SQL Editor. Como os outros, é
idempotente e só acrescenta: nada do que já está no ar muda de comportamento.

Depois, os **dois passos de sempre** — criar o login em *Authentication →
Users* e dar o perfil, agora também pela página **Gerenciar usuários** (o
seletor da linha passa a ter *Financeiro*), ou por SQL:

```sql
insert into public.app_financeiro (email) values ('fulano@rbcip.org');
```

O financeiro **vê tudo o que um usuário de somente leitura vê** — nenhum botão
de ação, nenhuma escrita — e ganha **uma aba a mais: Termos de Bolsa**.

### A aba Termos de Bolsa

Aberta pelo financeiro e pelo administrador (é o admin quem lança o termo).
Mostra, para Capital e Interior:

- **No projeto · Com termo · Sem termo · Aptos · Aguardando etapa** em números;
- três recortes: **Sem termo**, **Aptos** e **Com termo**;
- a tabela com cadastro, treinamento, situação do termo (com o link do
  documento, quando existe) e data de entrada no projeto.

**Apto** quer dizer: cadastro de bolsista preenchido **e** treinamento
realizado, **sem** termo e **sem** desligamento. É quem já pode começar assim
que o termo sair — a linha ganha a marca `★ apto` embaixo do nome.

Só o administrador vê os dois botões da aba: **⬇ Baixar .xlsx** e
**✉ Avisar o financeiro (N)**.

### O aviso por e-mail

Quando alguém fica apto, o pessoal do financeiro recebe um e-mail dizendo que
a pessoa concluiu cadastro e treinamento e só depende do termo para atuar.

### Ligando o envio automático (uma vez)

No Apps Script, abra o editor, escolha a função **`instalarGatilhoAviso`** no
seletor do topo e clique em **Executar**. Pronto: o aviso passa a sair **de hora
em hora**, sozinho, sem ninguém abrir o painel. Para desligar, o mesmo caminho
com `removerGatilhoAviso`.

O envio acontece por três caminhos, e todos usam a mesma regra:

- **de hora em hora**, pelo gatilho acima — é o modo recomendado, porque o
  treinamento é marcado à mão no painel a qualquer momento;
- **de 6 em 6 horas**, junto com a sincronização das planilhas, se você já tinha
  instalado `instalarGatilhoSincronizacao`. Ter os dois não duplica e-mail:
  cada pessoa entra em um aviso só;
- **na hora**, pelo botão **✉ Avisar o financeiro** da aba, quando não se quer
  esperar o próximo ciclo.

**Você recebe uma cópia.** Toda vez que o aviso sai de fato, o `EMAIL_RECIBO`
recebe um recibo com quantas pessoas entraram e para quem foi. Rodada sem
ninguém apto não gera e-mail nenhum — senão a caixa encheria de "nada a fazer"
de hora em hora. Falha manda e-mail sempre.

> **A aba diz se a automação está de pé.** Abaixo dos botões, para o
> administrador, aparece `✓ Envio automático ligado` (e de quanto em quanto
> tempo) ou `⚠ Envio automático desligado — nenhum aviso sai sozinho`, com o
> que fazer para ligar. Sem essa linha, "automático" e "ninguém rodando" seriam
> a mesma tela silenciosa. O estado é reconferido a cada **Atualizar**.

Duas garantias contra o aviso virar spam ou sumir:

- **Cada pessoa entra em um aviso só.** Enviado o e-mail, a ficha recebe
  `aviso_apto_em` e não volta na rodada seguinte. Na aba, a marca muda de
  `★ apto — avisar financeiro` para `✓ apto — financeiro avisado`.
- **Sem ninguém na lista do financeiro, nada é marcado.** Se marcasse, essas
  pessoas nunca mais entrariam num aviso e o primeiro financeiro cadastrado
  começaria sem saber delas.

> O aviso depende do Apps Script publicado com a versão nova (veja
> `docs/APPS-SCRIPT-CONVOCACAO.md`). Sem ele, a aba continua funcionando
> normalmente — só o e-mail não sai.

---

## 1c. O menu lateral (☰), Gerenciar usuários e Meu perfil

O botão das três barrinhas, no canto superior **direito** (ao lado de
*Atualizar* no computador, e na linha do título no celular), abre o menu com:

- **Formulários** — volta para a página dos formulários de entrevista;
- **Gerenciar usuários** — só aparece para administradores;
- **Meu perfil**;
- **Sair**.

Fecha com o **×**, com a tecla **Esc** ou clicando fora. **Tela cheia** e
**Atualizar** continuam no alto da página, ao lado do seu e-mail.

### Gerenciar usuários

Depende de **`sql/usuarios.sql`** (rode uma vez no SQL Editor). A página mostra:

- **Resumo** — quantas contas existem, quantas de cada perfil e quantas nunca
  acessaram;
- **Contas** — e-mail, perfil, último acesso, data de criação e se o e-mail foi
  confirmado. O seletor da última coluna **troca o perfil na hora**;
- **Histórico** — quem ganhou ou perdeu acesso, quando e por quem. Mudanças
  feitas direto no SQL Editor aparecem como *SQL Editor*, porque ali não existe
  usuário logado.

Duas coisas que essa página **não** faz, de propósito:

- **Criar e apagar contas** continua no Supabase, em *Authentication → Users* —
  é lá que a senha inicial é definida. Dar perfil a um e-mail sem conta é
  recusado, com a mensagem dizendo isso.
- **Você não consegue rebaixar a si mesmo.** As opções ficam bloqueadas no
  seletor e o banco recusa a operação. É assim que se evita o clique que tranca
  o último administrador do lado de fora; para sair da administração, peça a
  outro administrador.

> **Como a lista de contas chega ao navegador.** Os dados de login vivem em
> `auth.users`, que o site não pode ler — só a chave secreta leria, e ela nunca
> entra no repositório nem no navegador. A função `listar_usuarios` resolve
> isso: roda com os poderes do dono, confere que quem chamou é admin e devolve
> apenas e-mail, datas e confirmação. Senha e token não saem de lá.

### Meu perfil

Aberta por qualquer perfil. Mostra quem está logado, **qual é o seu perfil**,
duas listas — *você pode* e *você não pode* — com as permissões daquele perfil,
e o formulário de **alterar senha** (mínimo de 8 caracteres, digitada duas vezes;
vale já no próximo login, em qualquer aparelho).

No topo da página fica o aviso de que o sistema **apoia** a gestão do processo
seletivo e **não substitui o SIPE nem o ALOK**, que seguem como ferramentas
oficiais do projeto.

---

## 2. Editar a ficha de um candidato

Na aba **Candidatos**, cada linha tem o botão **✎ Editar** (só aparece para
administradores). O que dá para corrigir:

- **Nome, e-mail e CPF** — útil justamente quando a plataforma trouxe o dado
  errado (e-mail com erro de digitação, CPF em branco).
- **Região** (Interior).
- **Convocação para entrevista** e a data.
- **Resultado da entrevista** e a data — o resultado só é usado quando **não há**
  entrevista casada no sistema; havendo, o sistema sempre mostra o dele.
- **Convocação para cadastro** e a data.
- **Falha de entrega** — dá para limpar a marcação de "e-mail não existe" à mão,
  se for o caso.

Ao salvar, os campos alterados ficam **travados** e a ficha ganha a marca
**✎ editado** na tabela.

### E-mail corrigido: a ficha continua pedindo reenvio

Corrigir o endereço **não** apaga a falha de entrega. A falha é a prova de que
aquela convocação nunca chegou — apagá-la fazia a linha voltar a exibir
"✓ enviado em tal dia", sem botão nenhum, para alguém que não recebeu nada.

Depois da correção, a coluna *Convocação entrevista* mostra
**⏱ corrigido — reenviar**, com o botão **✉ Reenviar** ao lado; o motivo antigo
("e-mail não existe") sai de baixo do endereço, porque ele era do endereço
anterior e o novo ainda não foi testado. A marca só desaparece quando um envio
dá certo — aí a linha passa a mostrar a data do reenvio.

---

## 3. Por que a edição prevalece sobre o CSV

Cada campo que você corrige é registrado na coluna `editado` da ficha. Quando
você reimporta a planilha:

- os campos **travados** são mantidos como você os deixou;
- os demais são atualizados normalmente pela planilha;
- as etapas do funil continuam sendo preenchidas quando estão em branco.

Se quiser voltar atrás em uma ficha — deixar a planilha mandar de novo —, abra a
edição e clique em **"Voltar a seguir a planilha"**.

**Detalhe importante:** corrigir o e-mail **não muda a identidade** da ficha. A
identificação de cada pessoa é o **CPF**; a importação procura a ficha pelo CPF,
depois pela identificação já gravada e só então pelo e-mail. Assim, um endereço
corrigido — aqui ou na própria plataforma — continua caindo na mesma ficha, em
vez de criar uma duplicada.

> Se você já tem fichas duplicadas de antes desta correção (quando a identidade
> era o e-mail), rode **`sql/duplicados.sql`**. Ele junta as fichas com o mesmo
> CPF numa só, aproveitando o que estiver preenchido em cada uma, e guarda uma
> cópia da tabela antes de mexer.

---

## 4. Importar os arquivos da plataforma

A aba Candidatos aceita tanto a **planilha de controle** (com as colunas de
convocação e resultado) quanto o **arquivo cru da plataforma**, que usa a
pergunta inteira do formulário como nome da coluna. A leitura ignora acento,
asterisco, interrogação e espaços a mais, e aceita nomes parciais — "Nome"
encontra "Nome completo".

A região do Interior é o caso mais chamativo: na planilha de controle ela se
chama **"Região"**; no arquivo da plataforma, **"De qual região de SP sua
residência está mais próxima? *"**. Os dois funcionam.

### A data da inscrição (`data_envio`)

O arquivo da plataforma traz a coluna **`data_envio`** — o dia e a hora em que a
pessoa se inscreveu. O sistema guarda isso em `data_inscricao` (rode
**`sql/data-inscricao.sql`**) e usa em dois lugares:

- o gráfico **"Inscrições ao longo do tempo"**, na aba *Visualização de dados*;
- o **filtro de período** daquela aba, que agora também vale para a seção
  *Inscrições no SIPE*.

A data é gravada como texto `AAAA-MM-DD HH:MM`, e não como timestamp, de
propósito: assim ela ordena exatamente como veio, sem fuso horário no meio do
caminho — uma inscrição feita às 21h não corre o risco de aparecer no dia
seguinte só por causa da conversão.

Fichas importadas antes de a plataforma incluir essa coluna ficam sem data.
Elas continuam aparecendo em tudo, mas ficam de fora do gráfico e do filtro de
período; o rodapé da seção diz quantas são. Basta reimportar o CSV novo para
preenchê-las — a importação atualiza a ficha existente, não duplica.

A ordem da tabela **não** muda: continua sendo a ordem das linhas do arquivo.

### Exportar a planilha de candidatos

O botão **⬇ Baixar CSV**, na aba Candidatos, gera a planilha completa da região
selecionada (Capital ou Interior): as cinco colunas de controle já preenchidas
pelo sistema — *Convocação para Entrevista, Resultado, Data da Entrevista,
Convocação para Cadastro, Data do Envio para Convocação para Cadastro* —
seguidas de **todas** as colunas originais da inscrição, na ordem em que vieram
da plataforma.

Os dados vêm do banco, não do arquivo que você enviou: o resultado é o da
entrevista casada no sistema, e nome, e-mail, CPF e região saem com as
correções feitas no painel. Um e-mail marcado como inválido aparece como
*E-mail não encontrado* na coluna de convocação, como na sua planilha de
controle.

O arquivo sai com separador `;` e BOM (abre direto no Excel em português) e
pode ser reimportado pelo próprio sistema.

### Registro das importações

Abaixo da barra de importação, cada aba mostra **quando foi a última
importação**, qual arquivo foi enviado, quantas linhas ele tinha, quantas fichas
nasceram, quantas foram atualizadas e quem enviou. O link *ver histórico* abre
as dez últimas.

Isso vive na tabela `importacoes` e cada ficha guarda também a data em que uma
importação a tocou pela última vez (`importado_em`) — útil para achar quem
parou de aparecer nos arquivos novos. Depende de rodar `sql/importacoes.sql`;
sem ele, a importação continua funcionando, apenas sem histórico.

O arquivo da plataforma **não traz** as colunas de convocação, resultado e datas
— elas são do seu controle. Isso não é problema: a importação nunca apaga o que
já está preenchido na ficha. Convocações registradas pelo sistema, resultados
casados e correções manuais sobrevivem à reimportação; o mesmo vale para nome,
e-mail, CPF e região quando o arquivo vier sem eles.

---

## 5. Cadastro numa região e entrevista na outra

Acontece: a pessoa se cadastra na plataforma pelo link da Capital e, na
entrevista, pede para atuar no Interior. Como cada projeto tem o seu próprio
cadastro, a inscrição fica de um lado e a entrevista do outro.

O sistema **não finge que está tudo certo**. Quando não acha entrevista do
mesmo lado, ele procura no outro — só por **CPF**, a única chave forte o
bastante para cruzar as duas bases — e a linha ganha o aviso
**⇄ entrevista: Interior** na coluna *Resultado*. Assim o resultado aparece e a
pessoa não some do funil, mas fica visível que há uma divergência.

### O caminho certo: pedir a inscrição na região certa

Na coluna **Convocação cadastro**, o botão *Convocar cadastro* **não aparece**
nesse caso — no lugar dele vem **✉ Solicitar inscrição no Interior** (ou *na
Capital*). É de propósito: convocar dali criaria a ficha de formação na região
da inscrição, com o supervisor e a planilha de controle errados. Enquanto a
inscrição certa não existir, o único próximo passo possível é pedi-la.

O botão envia à pessoa um e-mail explicando a situação com o link de inscrição
da plataforma do projeto certo:

| Projeto | Link enviado |
|---|---|
| Capital | `PLATAFORMA_CADASTRO_CAPITAL` (em `js/config.js`) |
| Interior | `PLATAFORMA_CADASTRO_INTERIOR` |

A ideia é justamente **não remendar a inscrição por dentro do sistema**: ela
nasce certa na origem, e daí para frente todas as etapas — região, supervisor,
planilha de controle e termo de bolsa — seguem sozinhas pelo lado correto.

O e-mail avisa que **não é preciso repetir a entrevista** — é só a inscrição.

Depois do envio, a coluna *Resultado* ganha a marca **✉ inscrição solicitada em
dd/mm/aaaa** (com quem enviou no "passe o mouse") e o botão passa a ser
*Reenviar solicitação*. Quando a pessoa se inscrever e você importar o CSV
daquela região, a linha antiga mostra **✓ inscrição feita no Interior** e o
botão dá lugar a **→ convocar no Interior**: a convocação sai pela ficha nova,
para a pessoa não entrar duas vezes na Formação.

Para o registro do pedido ficar gravado, rode **`sql/regiao-divergente.sql`**.
Sem ele o e-mail continua sendo enviado; só não fica a marca (o painel avisa
quando é esse o caso).

### A ficha nova não volta para a fila de convocação

A ficha que nasce do recadastro não tem registro do convite de entrevista —
ele saiu pela ficha anterior. Para o sistema isso não é "pendente": como existe
entrevista casada (pelo CPF), a coluna *Convocação entrevista* mostra
**✓ entrevista realizada** e a pessoa **não entra** no botão *Convocar todos
para entrevista*. Uma etapa vencida não pode reabrir só porque o cadastro é
novo — o efeito seria convidar de novo quem já foi entrevistado.

A mesma regra vale para qualquer ficha nessa situação: se há entrevista casada,
a convocação está vencida, com ou sem registro.

### Quando a nova inscrição não é o caminho

Se a pessoa não vai se inscrever de novo, dá para resolver à mão: em **✎ Editar**
há o campo **Região de atuação** (Capital / Interior). Mudando ali, a ficha
inteira muda de aba, a divergência deixa de existir e o botão *Convocar
cadastro* volta — com a ficha de formação nascendo do lado certo. A importação
reconhece pelo CPF as fichas movidas assim, então o CSV da região original
**não** recria a pessoa do lado antigo.

Esse é o único jeito de convocar o cadastro de quem está com a inscrição
divergente — e é honesto: você está declarando que a pessoa mudou de região, em
vez de mandar uma convocação que criaria a ficha na região errada.

---

## 6. Metas por região, vagas e reserva

Cada região precisa de um número de entrevistadores. Enquanto houver vaga, o
aprovado é convocado normalmente; quando a região enche, os próximos aparecem
como **reserva** em vez de receberem a convocação de cadastro.

Rode **`sql/metas.sql`** uma vez. Ele já cria a meta da **Capital: 50**; as do
Interior você preenche no painel quando os números chegarem.

### O que ocupa uma vaga

Quem está na Formação e **não** foi desligado — ou seja, **Ativos + Aguardando
termo**. Quem recebeu a convocação e espera o termo já está comprometido com a
região; quem é desligado **devolve a vaga sozinho**, sem ninguém mexer na meta.

O bloco **Metas e vagas** (nas abas *Candidatos*, *Formação* e na sub-aba
*Formação* da Visualização de dados) vem **fechado**: o cabeçalho já responde
"tem vaga?" com os selos de *vagas em aberto* e *regiões sem vaga*, e um clique
abre a tabela por região. Ela mostra a conta aberta — `3 (2 ativos + 1 aguardando)` — para o número ser sempre conferível.
Regiões sem meta, sem bolsista e sem fila ficam fora da tabela; o rodapé diz
quantas são. No celular a tabela vira **um cartão por região**, com o nome no
topo e *Meta / Ocupadas / Vagas / Reserva* em pares rótulo-valor — as cinco
colunas não cabem na tela do telefone.

### Editar as metas

Botão **⚙ Editar metas**, dentro do bloco (só administradores). Todas as
regiões aparecem na lista, inclusive as que ainda não têm meta. Deixar em
branco significa **sem controle de vagas** naquela região: nada é bloqueado, o
painel se comporta como antes. Cada alteração guarda quem mudou e quando.

### Reserva

Sem vaga, a coluna *Convocação cadastro* mostra **⏸ Reserva** no lugar do botão,
com o número da região no "passe o mouse". Ao lado fica **Convocar mesmo
assim** — você continua podendo, e a confirmação diz `Bauru já está com 12 de
12`. É aviso, não bloqueio.

Quem se inscreveu de novo na região certa **sai da fila da região antiga**: a
ficha velha vira histórico e a pessoa passa a ser acompanhada — e contada — só
do lado em que vai atuar. Isso vale também para o funil da aba *Visualização de
dados*, que assim não conta a mesma pessoa como duas selecionadas; o rodapé da
seção diz quantas fichas ficaram de fora por esse motivo.

O botão **N na fila**, na coluna *Reserva*, abre a fila daquela região:
aprovados ainda não convocados, **do maior para o menor desempenho na
entrevista**, cada um com o botão de convocar. Quando alguém é desligado, a
vaga abre e o próximo nome já está na frente — sem garimpar a tabela.

---

## 7. Ordem das tabelas

As abas **Candidatos** e **Formação** são exibidas na mesma ordem do CSV
importado — a ordem em que as pessoas se inscreveram ou entraram no projeto.
Isso depende de rodar **`sql/ordem.sql`** e reimportar os arquivos uma vez;
o rodapé de cada tabela mostra qual ordem está em uso.

---

## 8. Histórico e o quadro de entradas e saídas

Rode **`sql/historico.sql`** no SQL Editor do Supabase. Ele faz duas coisas.

### A data de entrada

Cria a coluna **`data_entrada`** em `formacao` — quando a pessoa passou a
atuar. A saída (`desligado_em`) já existia; faltava a entrada, e sem as duas
não há como dizer quantos entrevistadores havia num mês passado.

**De onde vem a data: do próprio Cadastro de Bolsista.** É o dia em que a
pessoa *preencheu* o formulário — não o dia em que você a convocou. Convocar é
convidar; entre o convite e o preenchimento passam dias ou semanas, e carimbar
a convocação daria uma data adiantada.

Para isso, a **planilha-ponte ganha a coluna F: "Data do Cadastro de
Bolsista"** — o carimbo de data/hora do formulário, puxado pelo mesmo
`IMPORTRANGE` da coluna A (mesma linha = mesma pessoa). Republique o Apps
Script depois de acrescentá-la (veja `docs/APPS-SCRIPT-CONVOCACAO.md`).

Com a coluna no lugar, **🔄 Sincronizar planilhas** passa a preencher a data
sozinha, e isso vale também **retroativamente**: quem já está marcado como
"Cadastro Realizado" mas sem data recebe a data do dia em que preencheu. Na
prática, a maior parte do preenchimento das fichas antigas acontece sozinha, na
primeira sincronização depois da mudança.

Três regras de segurança:

- **Data já preenchida nunca é sobrescrita** — nem à mão, nem por outra
  sincronização. Quem corrigiu tinha um motivo.
- Se o mesmo CPF aparecer duas vezes na ponte, vale a **data mais antiga**: se
  a pessoa preencheu o formulário de novo, quem marca a entrada é a primeira
  vez.
- Célula vazia ou ilegível vira **nada**, nunca uma data inventada.

**O que a sincronização não alcança** — cadastro feito fora do formulário, CPF
que não casa, ficha importada de um controle antigo — fica para o botão
**📅 Datas de entrada (N)** na aba *Formação* (dentro do menu **⚙ Mais**):
lista quem está sem data, com um
campo por pessoa e um atalho "preencher todas com", útil quando a turma inteira
começou no mesmo dia. Datas fora do formato `dd/mm/aaaa` são recusadas antes de
gravar, porque uma data errada aqui vira número errado no relatório sem ninguém
perceber.

O resumo da sincronização passa a dizer quantas datas vieram da coluna F e
quantas entradas foram preenchidas naquela rodada — se o número vier zerado, o
problema está no `IMPORTRANGE`, e aparece ali em vez de nos dados.

### Entradas e saídas mês a mês

Nova sub-aba em *Visualização de dados* → **Entradas e saídas**. Para cada mês:
quantas pessoas entraram, quantas saíram, o saldo e **quantas estavam no
projeto no fim do mês**. Respeita os filtros de **tipo** (Capital/Interior) e
**região**; o filtro de período não se aplica, porque a tabela já é mês a mês.
Tem botão de **baixar .xlsx**, para responder pedidos por e-mail sem redigitar
nada.

A conta é simples e conferível:

```
no projeto no fim do mês = entrou até o fim do mês
                           E (não saiu, ou saiu depois do fim do mês)
```

> **Quem não tem data de entrada fica de fora de todas as contas** — e o
> relatório diz quantas fichas são, com todas as letras. Um quadro com gente
> faltando e sem aviso é pior do que quadro nenhum.

### O registro de tudo

A tabela **`historico`** guarda **toda** alteração em `formacao` e
`candidatos`: qual ficha, qual campo, o valor de antes, o de depois, quando e
por quem. É gravada por **gatilho no banco**, então vale para o painel, para a
importação de CSV, para a sincronização das planilhas e até para o SQL Editor —
não existe caminho de alteração que escape.

Cada ficha mostra o seu histórico no fim da janela de edição (**Histórico desta
ficha**). Alterações feitas direto no banco aparecem como *SQL Editor*, porque
ali não há usuário logado.

> **O histórico começa quando você roda o arquivo.** O que aconteceu antes não
> existe em lugar nenhum e não pode ser reconstruído; para os meses já
> passados, o caminho é preencher a data de entrada das fichas à mão.

---

## 9. Largura da tela

No topo do painel há o botão **⛶ Tela cheia**, que faz as tabelas ocuparem toda
a largura do notebook (o padrão é uma largura mais confortável para leitura). A
escolha fica salva no navegador — quem prefere tela cheia entra sempre assim.

---

## 10. A aba Formação por dentro

A aba juntava, na mesma altura da página, coisas de uso diário e coisas de uso
raro — e a troca **Capital ⇄ Interior** ficava no meio, com o mesmo desenho do
filtro *No projeto / Desligados*. **Nenhuma informação e nenhuma ação saíram**;
elas foram reordenadas por frequência de uso.

A ordem agora é:

1. **Projeto** — Capital ou Interior, no topo, com o rótulo `PROJETO` ao lado e
   a contagem de bolsistas embaixo de cada nome. É a primeira decisão de quem
   abre a aba, então é a primeira coisa da tela. No celular as duas opções
   dividem a largura, uma ao lado da outra.
2. **Resumo** — os cartões (Bolsistas, Ativos, Aguardando termo, Cadastro
   pendente, Sem treinamento, Desligados) do projeto escolhido. No celular eles
   ficam compactos, para a lista não começar longe demais.
3. **Ações** (só administradores) — três controles no lugar de seis botões:
   - **🔄 Sincronizar planilhas**, que é a rotina, continua à vista;
   - **⬇ Baixar**, um menu com a planilha inteira (CSV com desligados, Excel só
     com quem está no projeto) e, embaixo, uma linha por grupo/região;
   - **⚙ Mais**, com *Supervisores por grupo/região*, *📅 Datas de entrada (N)*,
     *🧩 Completar pela inscrição (N)* e *📥 Importar planilha (CSV)*. Os dois
     do meio só aparecem quando há o que fazer, e o número diz quanto.
4. **Metas e vagas**, fechado como antes.
5. **Bolsistas — Capital/Interior**, com o recorte *No projeto / Desligados* em
   pastilhas menores (para não se confundir com o seletor de projeto), a busca e
   a tabela.
6. **Importar planilha e registros**, recolhido no fim: o envio do CSV, a última
   importação e a última sincronização. É tarefa ocasional; um clique abre, e o
   item *📥 Importar planilha* do menu **⚙ Mais** abre e rola até ele. Quando o
   projeto ainda não tem nenhum bolsista, esse bloco vem **aberto** — é o que
   falta fazer.

Quem tem perfil de leitura, supervisor ou financeiro vê a aba sem os itens 3 e
6: o seletor de projeto, o resumo, as metas e a lista.
