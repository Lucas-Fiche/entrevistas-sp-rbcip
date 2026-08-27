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

---

## 1b. O perfil SUPERVISOR

Rode **`sql/perfil-supervisor.sql`** no SQL Editor do Supabase. Ele cria a lista
**`app_supervisores`** e a função `definir_grupo`. Para dar o perfil a alguém:

```sql
insert into public.app_supervisores (email) values ('fulano@rbcip.org');
```

Para tirar: `delete from public.app_supervisores where email = '...';`

O que o supervisor **vê**: as abas *Candidatos*, *Entrevistas Capital*,
*Entrevistas Interior* e *Formação*, em leitura. A aba **Visualização de dados
não aparece** para ele.

O que o supervisor **altera**: uma coisa só — o **Grupo** de um bolsista da
**Capital**, na aba *Formação*. A linha ganha a coluna **Ação** com o botão
**✎ Trocar grupo**, e a janela que abre tem esse único campo. No Interior não há
botão nenhum: lá a lotação é a região, e região é do administrador.

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

## 8. Largura da tela

No topo do painel há o botão **⛶ Tela cheia**, que faz as tabelas ocuparem toda
a largura do notebook (o padrão é uma largura mais confortável para leitura). A
escolha fica salva no navegador — quem prefere tela cheia entra sempre assim.
