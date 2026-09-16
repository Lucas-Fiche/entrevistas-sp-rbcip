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

Todas as abas e todos os números — e **nenhum botão que grave alguma coisa**.
Não aparecem: a barra de importar CSV, o registro das importações e
sincronizações, *Convocar todos para entrevista*, *Verificar entregas*,
*Convocar cadastro* (nem o individual, nem o da fila de reserva), *Solicitar
inscrição*, *Editar*, *Editar metas*, *Supervisores* e *Sincronizar planilhas*.

**Baixar é exceção, e de propósito.** *⬇ Baixar CSV*, *⬇ Baixar Excel*,
*⬇ Baixar .xlsx*, o menu *⬇ Baixar* da Formação e o *⬇ Baixar PDF* dos Detalhes
funcionam para **todos os perfis**. O arquivo é montado no navegador com as
linhas que já estão na tela — nada é lido do banco além do que aquele perfil já
podia ler. Negar o download não protegia dado nenhum; só obrigava quem precisa
da planilha a pedir para um administrador.

> Corolário prático: quem não pode ver um dado também não o baixa. O recorte do
> arquivo é o mesmo da tela, então a permissão continua sendo decidida num lugar
> só — a leitura.

No lugar do botão de convocação, a coluna mostra o **estado** — `⏱ pendente` com
a explicação no "passe o mouse". Quem só lê precisa saber que falta convocar
alguém; não precisa poder convocar.

Em **Detalhes** de uma entrevista, o bloco **📁 Pasta de gravações / atas** segue
a mesma regra: com o link já salvo, todos os perfis o veem e podem abrir; **sem
link**, só o administrador vê o campo e o botão *Salvar link* — os demais leem
*"Nenhuma pasta registrada ainda."*.

O bloco **Metas e vagas** continua inteiro: metas, ocupação, vagas e a fila de
reserva (quem está esperando e em que ordem). O que some de dentro da fila é a
coluna de convocar.

> A checagem de permissão está **nos dois lugares**: o botão não é desenhado e a
> ação também se recusa a rodar. Se um botão escapar de alguma condição — como
> escapou o *Convocar cadastro* —, o clique não envia nada.

> **Tela escondida não é permissão.** O link das atas mostrou isso: o formulário
> aparecia para todo mundo e o JavaScript recusava o clique, mas a política do
> banco liberava aquele UPDATE para **qualquer usuário logado** — quem chamasse
> a API por fora gravava. Quem decide é sempre o banco; esconder o botão é
> cortesia com quem não pode, não a tranca. Para a tranca valer, é preciso ter
> rodado **`sql/admin.sql`** (ele substitui a política aberta que
> `sql/schema.sql` cria).

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
- a tabela com cadastro, treinamento, **antecedentes criminais** e a situação do
  termo (com o link do documento, quando existe).

As colunas seguem a ordem do caminho real — **cadastro → treinamento →
antecedentes → termo** —, então dá para ler a linha da esquerda para a direita
e ver em que etapa a pessoa parou.

Na coluna *Termo de bolsa*, **📄 Emitido** é quem já tem o documento,
**aguardando termo** (âmbar) é quem cumpriu as três etapas e só espera o termo,
e **Não apto** (vermelho) é quem ainda tem alguma pendente — passe o mouse e a
marca diz **qual** falta, para não ter de procurar nas outras colunas.

**Apto** quer dizer: cadastro de bolsista preenchido **e** treinamento
realizado **e** antecedentes criminais entregues, **sem** termo e **sem**
desligamento. É quem já pode começar assim que o termo sair — a linha ganha a
marca `★ apto` embaixo do nome.

A mesma definição vale em três lugares — o painel, a view `aptos_para_termo` no
banco e o Apps Script que manda o e-mail. Se discordassem, a tela mostraria uma
lista e o financeiro receberia outra.

Só o administrador vê os dois botões da aba: **⬇ Baixar .xlsx** e
**✉ Avisar o financeiro (N)**.

### Antecedentes criminais

Rode **`sql/antecedentes.sql`** uma vez (ele exige `sql/admin.sql` e
`sql/perfil-financeiro.sql` já rodados, e avisa se faltar algum).

É a terceira etapa antes do termo, e a única que **não chega por planilha
nenhuma**: o cadastro vem sozinho na sincronização, o treinamento é marcado na
ficha, e os antecedentes são digitados aqui.

Na coluna *Antecedentes criminais* da aba *Termos de Bolsa*:

- **+ registrar** — ninguém enviou ainda. Clique e informe a data (`dd/mm/aaaa`;
  há um botão **Hoje**).
- **✓ 15/07/2026** — enviados nesse dia. Clicando de novo dá para corrigir a
  data, ou apagá-la (deixe o campo em branco e salve) se o lançamento foi na
  ficha errada.

Quem preenche é o **administrador e o financeiro** — mais ninguém. Isso não é
só a tela escondendo o botão: a gravação passa pela função
`definir_antecedentes`, que confere o perfil de quem chamou e **só sabe
escrever nessa coluna**. É o mesmo desenho do `definir_grupo` do supervisor, e
existe porque o RLS do Postgres decide por *linha*, não por *coluna*: liberar a
linha para o financeiro liberaria a ficha inteira.

A data é conferida nos dois lados (tela e banco): formato `dd/mm/aaaa`, dia que
exista no calendário e **nada no futuro** — o que costuma pegar o ano trocado.

Na aba *Formação* a coluna aparece **só para leitura** na tabela, com o que foi
registrado aqui. Para **acertar as fichas antigas** — quem entrou antes de esta
etapa existir no sistema — abra a ficha no lápis: o campo *Antecedentes
criminais (data do envio)* está lá, entre o facilitador e o link do termo.

> Mesmo vindo da ficha, a gravação passa pela **mesma** função
> `definir_antecedentes`. Uma porta só para essa coluna, venha de onde vier — é
> o que garante que a data seja conferida do mesmo jeito nos dois caminhos.

#### Isto muda quem é "apto"

Antes: cadastro + treinamento. **Agora: as três etapas.** Quem estava apto e
ainda não entregou a certidão sai da lista de *Aptos* e volta como **Não apto**,
até a data ser registrada.

`sql/antecedentes.sql` cuida da parte incômoda dessa virada: **limpa a marca de
"financeiro já avisado"** de quem tinha sido anunciado pela regra antiga e não
tem antecedentes. Sem isso, essas pessoas ficariam num limbo — o sistema as
considera já anunciadas, então no dia em que entregassem a certidão **ninguém
seria avisado**, e elas esperariam um termo que o financeiro não sabe que
precisa emitir. O e-mail que já saiu continua no *Histórico de avisos*, e a
alteração fica no histórico da ficha: nada se perde.

### O aviso por e-mail

Quando alguém fica apto, o pessoal do financeiro recebe um e-mail dizendo que
a pessoa concluiu as três etapas e só depende do termo para atuar.

### Histórico dos avisos

Rode **`sql/avisos-financeiro.sql`** uma vez. Ele cria a tabela
`avisos_financeiro`, onde **cada e-mail enviado deixa registro**: quando saiu,
se foi automático ou pelo botão, quantas pessoas entraram na lista, para quais
endereços foi — e, quando dá errado, o erro.

O bloco **Histórico de avisos ao financeiro** aparece na aba *Termos de Bolsa*,
logo abaixo da linha do envio automático, e é visto pelo administrador **e pelo
financeiro** (é ele quem recebe os avisos e quem mais precisa saber se algum
deixou de chegar). Vem recolhido: o cabeçalho já responde *"está saindo?"* com
a data do último envio, o total e um selo vermelho se houve falha.

Na tabela, a coluna *Pessoas* mostra quantas entraram no aviso e traz os nomes
no "passe o mouse"; *Enviado para* mostra o endereço (ou quantos foram, se mais
de um).

> **Por que isto existe.** A linha acima diz que o **gatilho está ligado** —
> mas um gatilho pode estar instalado e falhando toda hora. Sem o histórico,
> "não chegou nada" significa ao mesmo tempo *"está tudo certo e não havia
> ninguém apto"* e *"parou de funcionar"*, e não há como distinguir. Por isso
> as **falhas também entram na lista**, e não só os envios que deram certo.

Enquanto o SQL não for rodado, o bloco diz qual arquivo falta — e **os avisos
continuam sendo enviados normalmente**, só não ficam registrados. O registro é
auditoria: uma falha ao gravar nunca derruba o envio.

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

#### “Último acesso” — o que essa data conta

Rode **`sql/ultimo-acesso.sql`** uma vez.

Sem ele, a coluna vinha de `auth.users.last_sign_in_at`, que o Supabase só
atualiza quando alguém **digita e-mail e senha**. Quem já está logado abre o
painel por meses sem passar por ali — a sessão se renova sozinha — e a data
ficava congelada no dia do último login. Na prática a coluna dizia *último
login*, não *último acesso*: gente que usou o sistema ontem aparecia sumida há
semanas. E é justamente essa coluna que serve para decidir quem não usa mais e
pode perder o acesso.

Depois do arquivo, o valor é o **mais recente de três fontes**:

| Fonte | O que é | Precisão |
|---|---|---|
| `public.acessos` | carimbo que o painel grava toda vez que abre | a melhor |
| `auth.sessions` | renovação da sessão de quem continua logado | boa |
| `auth.users.last_sign_in_at` | o valor antigo, o último login | a de sempre |

Como pega o maior dos três, **nenhuma data diminui** com a mudança: só sobe.

O carimbo é gravado pela função `registrar_acesso`, que **não recebe e-mail
nenhum como parâmetro** — a conta vem do token de quem chamou. Se recebesse,
qualquer pessoa logada poderia forjar o acesso de outra, e a coluna deixaria de
servir para o que existe.

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

### 3b. Corrigir nome, telefone e e-mail na aba Formação

Rode **`sql/editar-contato.sql`** uma vez.

Nome, telefone e e-mail chegam à ficha da Formação pela **inscrição** — é o que
a pessoa digitou no formulário de entrevista — ou pelo CSV de formação. Quando
alguém erra o próprio número ali e corrige depois em outro lugar (no *Cadastro
de Bolsista*, por exemplo), o sistema fica com o valor errado.

Agora esses três campos estão na edição da ficha, no lápis da aba *Formação*,
acima do grupo. Só o **administrador** os vê: para o supervisor, a ficha
continua tendo um campo só, o grupo.

- **Telefone** — digite com DDD, como quiser. Fica guardado no formato da casa,
  `(11) 99999-9999`, o mesmo de quem veio da inscrição. Redigitar o mesmo número
  com outra pontuação não conta como alteração.
- **E-mail** — conferido antes de gravar: endereço sem `@` é recusado ali mesmo,
  e não lá na frente, quando uma convocação falhar sem explicação. Trocar o
  e-mail aqui **não avisa ninguém** e não reenvia nada.
- **Nome** — só o nome da ficha. Não mexe na inscrição nem na entrevista.

**O CPF não está lá, de propósito.** Ele é a chave que liga a inscrição, a
entrevista e a formação; trocá-lo por esta tela deixaria a ficha solta das
outras duas. CPF errado se conserta na aba *Candidatos*.

#### A correção prevalece sobre a planilha

É a mesma regra da aba *Candidatos*: o campo corrigido fica marcado, e a
próxima importação do CSV de formação **não o sobrescreve**. Sem isso a
correção duraria até a importação seguinte e sumiria sem aviso — o pior tipo de
perda, porque ninguém fica sabendo.

Para **voltar atrás** num campo e deixar a planilha mandar nele de novo, apague
o campo e salve. O próprio formulário diz isso, logo abaixo dos três.

> Enquanto `sql/editar-contato.sql` não for rodado, a correção **é salva do
> mesmo jeito** — só não fica protegida. O painel avisa na hora, na aba
> *Formação*, dizendo qual arquivo falta. O aviso sai no momento da correção,
> e não na importação seguinte, quando o valor já teria voltado.

Toda correção entra no **histórico da ficha** (seção 8), com quem fez e quando.

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

Dentro do bloco **Importar planilha e registros** (recolhido no fim das abas
*Candidatos* e *Formação* — veja a seção 10), logo abaixo da barra de envio,
cada aba mostra **quando foi a última importação**, qual arquivo foi enviado,
quantas linhas ele tinha, quantas fichas nasceram, quantas foram atualizadas e
quem enviou. O link *ver histórico* abre as dez últimas.

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

São as **mesmas duas chaves** que o formulário de entrevista usa no aviso da
pergunta *"O candidato possui inscrição no SIPE?"* quando a resposta é **Não**.
Se o endereço da plataforma mudar, troque só aqui: os dois lugares leem do
mesmo ponto e não têm como divergir.

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

### Região lotada NÃO reabre a convocação pelo lado errado

A coluna *Convocação cadastro* decide o que mostrar em cadeia, e **a ordem das
perguntas importa**:

1. já foi convocada? → mostra a data;
2. existe ficha do lado certo? → **→ convocar na Capital** (ou no Interior);
3. entrevista de um lado e inscrição do outro? → **✉ Solicitar inscrição**;
4. região sem vaga? → **⏸ Reserva**, com *Convocar mesmo assim*;
5. nada disso? → **✉ Convocar cadastro**.

A pergunta da vaga (4) tem de vir **depois** das duas de região (2 e 3):
*"aqui não tem vaga"* só faz sentido quando é aqui que se convoca. Com a vaga
perguntada antes, uma região lotada trocava o *Solicitar inscrição* por um
*Convocar mesmo assim* — e quem clicasse abria a ficha de formação **na região
errada**, que é exatamente o que o passo 3 existe para impedir.

Havia ainda uma segunda porta: o botão *✉ Reenviar* que aparece quando o e-mail
volta com falha. Hoje a convocação **recusa** sair por uma ficha cuja pessoa já
tem ficha do lado certo, e diz por qual aba convocar.

### Quando uma ficha já nasceu na região errada

Ela se denuncia sozinha na aba *Formação*: ao lado do nome, no lugar do discreto
*entrevista no sistema*, aparece em vermelho **⇄ entrevista: Capital** (ou
*Interior*). Quer dizer que a entrevista foi feita de um lado e a ficha está do
outro — e, enquanto estiver ali, **ela ocupa uma vaga daquela região que não é
dela**, podendo bloquear a convocação de outra pessoa.

Para consertar, na ordem:

1. **Convoque o cadastro pela ficha certa** (a aba do projeto onde a entrevista
   foi feita). Isso abre a ficha de formação no lado correto.
2. **Apague a ficha errada** no SQL Editor do Supabase — confira antes de
   apagar:

   ```sql
   -- 1) veja as duas fichas da pessoa (troque pelo CPF, só dígitos)
   select id, tipo, regiao, nome, cadastro_bolsista, termo_link, desligado_em, origem
     from public.formacao
    where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = '00000000000';

   -- 2) apague SÓ a do lado errado, pelo id que você acabou de ver
   delete from public.formacao where id = 'cole-o-id-aqui';
   ```

> **Por que apagar e não desligar.** Desligar também libera a vaga, mas registra
> uma saída que não houve: a pessoa entraria nos relatórios de desligamento e no
> histórico como alguém que deixou o projeto. Ela nunca esteve nessa região —
> a ficha é que não deveria existir.

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

Essa é a ordem **padrão**, para onde a tabela sempre volta. Para olhar a lista
de outro jeito — em ordem alfabética, por data, por região —, clique no título
da coluna; a seção 10 explica como, e por que isso não altera nada nos dados
nem nos arquivos exportados.

---

## 8. O histórico de alterações

Rode **`sql/historico.sql`** no SQL Editor do Supabase.

> ### O que saiu: "data de entrada no projeto" e "Entradas e saídas"
>
> Este arquivo criava também a coluna **`data_entrada`**, e sobre ela existia a
> sub-aba **Entradas e saídas** em *Visualização de dados*. **As duas foram
> removidas.**
>
> **Por quê.** A data vinha do dia em que a pessoa *preencheu o Cadastro de
> Bolsista*, e esse não é o dia em que ela passa a atuar no projeto. O quadro
> mês a mês parecia preciso e não era — e um número assim é pior do que número
> nenhum, porque ninguém desconfia dele para conferir.
>
> **O que fazer:** rode **`sql/remover-data-entrada.sql`**, e só **depois** de
> publicar o painel e republicar o Apps Script (a ordem está no cabeçalho do
> arquivo). Ele copia o conteúdo da coluna para `backup_data_entrada` antes de
> apagar — se a informação fizer falta um dia, está guardada com o id da ficha,
> o CPF e o nome.
>
> **O que NÃO foi tocado:** os desligamentos (`desligado_em` e
> `desligado_motivo`), a tabela `historico` inteira, e todos os outros campos da
> ficha. Na planilha-ponte, a **coluna F** pode continuar onde está: o script
> simplesmente não a lê mais.

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
> existe em lugar nenhum e não pode ser reconstruído.

---

## 9. Largura da tela

No topo do painel há o botão **⛶ Tela cheia**, que faz as tabelas ocuparem toda
a largura do notebook. **Todas as abas abrem na largura padrão**, que é a mais
confortável de ler; a Formação também, desde 02/09/2026 (antes ela nascia em
tela cheia por causa das muitas colunas).

A escolha fica salva no navegador **por aba**: clicar no botão vale para a aba
em que você está, e é lembrada na próxima visita. Ou seja, quem já tiver
escolhido *Tela cheia* na Formação continua entrando assim — basta clicar em
*Largura padrão* uma vez para voltar ao novo padrão.

A tabela da Formação tem **onze colunas** e a de Termos, nove. Elas cabem
inteiras em telas de **1366px para cima**, nos dois modos de largura. Abaixo
disso a tabela **rola de lado dentro do próprio quadro** (sem arrastar a página
junto) e aparece uma **sombra na borda** enquanto houver coluna escondida —
antes ela parecia simplesmente cortada, porque a barra de rolagem só existe lá
embaixo, depois da última linha.

Para caber, três coisas nessas duas tabelas: o respiro lateral de cada coluna é
menor (9px em vez de 14px), a região vem com o nome curto e o e-mail pode
quebrar — **sempre no `@`**, nunca no meio de uma palavra:

```
contatolucasfernandes103
@gmail.com
```

Endereço curto continua numa linha só. A quebra é apenas visual: copiar a
célula traz o endereço inteiro, sem hífen. É por isso que a coluna de e-mail
nunca fica mais estreita que a maior metade de um endereço — quando é essa
metade que não cabe, a tabela prefere rolar de lado a picotar o texto.

### Nomes de região nas tabelas

Na coluna *Região* das tabelas, o nome aparece **encurtado**, com o mesmo
rótulo usado no mapa: *Baixada Santista (Santos / Praia Grande / Guarujá)* vira
**Baixada Santista**, e *São José do Rio Preto (região)* vira **S.J. Rio
Preto**. Não são siglas: a coluna vinha sendo espremida até empilhar uma
palavra por linha, e o nome curto resolve sem exigir que ninguém decore código.

O **nome completo continua inteiro** onde precisa ser exato: no "passe o mouse"
da célula, no filtro de região da *Visualização de dados*, no bloco de metas e
em tudo que é exportado. A busca aceita as duas formas — procurar por *Guarujá*
ou por *S.J. Rio* encontra a mesma pessoa.

---

## 10. O desenho das abas

As abas juntavam, na mesma altura da página, coisas de uso diário e coisas de
uso raro — e a troca **Capital ⇄ Interior** ficava no meio, com o mesmo desenho
dos filtros secundários. **Nenhuma informação e nenhuma ação saíram**; elas
foram reordenadas por frequência de uso, e as quatro abas passaram a seguir a
mesma sequência:

> **Projeto → resumo → ações → blocos de consulta → lista → importação**

### O seletor de projeto

Em *Candidatos*, *Formação*, *Termos de Bolsa* e *Visualização de dados*, a
escolha do projeto é a **primeira coisa da tela**: um bloco com o rótulo
`PROJETO` ao lado e, dentro de cada opção, quantas pessoas ela tem. É maior e
tem desenho próprio de propósito — os recortes secundários (*No projeto /
Desligados*, *Sem termo / Aptos / Com termo*) ficam em pastilhas menores, no
cabeçalho da lista, para as duas coisas não se confundirem.

O bloco **ocupa a largura da página**, e as opções dividem esse espaço com o
nome e a contagem centralizados. No celular ficam duas por linha.

### Aba Candidatos

1. **Projeto** (Capital / Interior).
2. **Ações** (só administradores): **✉ Convocar todos para entrevista (N)** e
   **⬇ Baixar CSV** à vista, e um menu **⚙ Mais** com *🔎 Verificar entregas* e
   *📥 Importar planilha (CSV)*.
3. **Metas e vagas**, fechado.
4. **Candidatos — Capital/Interior**: busca e tabela.
5. **Importar planilha e registros**, recolhido no fim.

### Aba Formação

1. **Projeto** (Capital / Interior), com a contagem de bolsistas.
2. **Resumo** — No projeto, Ativos, Aguardando termo, Cadastro pendente, Sem
   treinamento, Desligados. *Ativos* aparece em verde e *Desligados* em
   vermelho; os três do meio são **botões**: clicar filtra a tabela para
   exatamente as pessoas que o cartão conta, e um chip acima da lista diz por
   que ela encolheu. No celular os cartões ficam compactos, para a lista não
   começar longe demais.
3. **Ações** (só administradores) — três controles no lugar de seis botões:
   - **🔄 Sincronizar planilhas**, que é a rotina, continua à vista;
   - **⬇ Baixar**, um menu com a planilha inteira (CSV com desligados, Excel só
     com quem está no projeto) e, embaixo, uma linha por grupo/região;
   - **⚙ Mais**, com *Supervisores por grupo/região*, *🧩 Completar pela
     inscrição (N)* e *📥 Importar planilha (CSV)*. O do meio só aparece quando
     há o que fazer, e o número diz quanto.
4. **Metas e vagas**, fechado como antes.
5. **Bolsistas — Capital/Interior**, com o recorte *No projeto / Desligados*, a
   busca e a tabela. Esse recorte é um **interruptor de duas posições**: as duas
   metades dividem um trilho só, e quando a posição escolhida é *Desligados* o
   botão fica **vermelho** — dá para ver de longe que a lista na tela não é a de
   quem está trabalhando.
6. **Importar planilha e registros**, recolhido no fim.

### Aba Termos de Bolsa

1. **Projeto** (Capital e Interior / Capital / Interior) e a explicação do que
   é "apto".
2. **Resumo** — No projeto, Com termo, Sem termo, Aptos, Aguardando etapa.
3. **Ações** (só administradores): **✉ Avisar o financeiro (N)**, **⬇ Baixar
   .xlsx** e a linha que diz se o envio automático está ligado.
4. **Termos — …**, com o recorte *Sem termo / Aptos / Com termo*, a busca e a
   tabela.

Na coluna *Termo de bolsa*, quem ainda não pode receber o termo aparece como
**Não apto**, em vermelho — falta o cadastro de bolsista ou o treinamento.
Quem já cumpriu as duas etapas aparece como **aguardando termo**, em âmbar: é a
vez dele.

### Aba Visualização de dados

O **Relatório** (*Inscrições no SIPE*, *Entrevistas*, *Formação*, *Entradas e
saídas*) e o **Projeto** viraram dois seletores iguais, lado a lado no topo —
antes um ficava acima e o outro abaixo da barra de filtros, com desenhos
diferentes. *Período* e *Região* continuam logo abaixo, junto com **Limpar
filtros**.

### O bloco de importação

*Candidatos* e *Formação* têm, recolhido no fim da página, o bloco **Importar
planilha e registros**: o envio do CSV, a última importação (com o histórico) e,
na Formação, a última sincronização. É tarefa ocasional; um clique abre, e o
item *📥 Importar planilha* do menu **⚙ Mais** abre e rola até ele. Ele vem
**aberto** quando o projeto ainda não tem nenhuma ficha (é o que falta fazer) e
quando há uma mensagem de importação para ler — uma confirmação ou um erro nunca
nasce escondido.

Quem tem perfil de leitura, supervisor ou financeiro vê as abas sem as ações e
sem o bloco de importação: o seletor de projeto, o resumo, as metas e a lista.

### Ordenar pelo título da coluna

Nas tabelas de *Candidatos*, *Formação* e *Termos de Bolsa*, **clicar no título
de uma coluna ordena a lista por ela**. Cada título passa por três estados:

1. **1º clique** — crescente (▲): A→Z, do menor para o maior, da data mais
   antiga para a mais recente;
2. **2º clique** — decrescente (▼);
3. **3º clique** — volta à **ordem do arquivo importado**.

Ninguém fica preso numa ordenação sem saber como desfazer: o terceiro clique
sempre devolve a lista ao normal, e o rodapé da tabela diz em que ordem ela
está ("*ordenado por Nome (crescente)*" ou "*na mesma ordem do arquivo
importado*").

**Isso não bagunça nada.** Ordenar é só uma forma de olhar a mesma lista:

- nada muda no banco de dados — nenhuma ficha é gravada ou alterada;
- os arquivos **exportados** (CSV e .xlsx) saem sempre na **ordem do arquivo
  importado**, não na ordem da tela;
- a escolha vale só para o seu navegador, naquela sessão. Ninguém mais vê a
  lista reordenada;
- trocar de projeto, buscar ou recarregar a aba mantém a ordenação escolhida,
  porque é uma preferência de leitura — não um dado.

Algumas colunas ordenam por **etapa**, não por texto, porque é isso que se
procura ao clicar nelas: *Convocação entrevista*, *Convocação cadastro*,
*Cadastro*, *Treinamento* e *Termo de bolsa* colocam **quem está pendente
primeiro**. As colunas de ação (*Editar*, *Ação*) não ordenam — não têm o que
comparar.

Quem estiver **sem o dado** (sem CPF, sem grupo, sem data) vai para o **fim da
lista nos dois sentidos**. Se fosse ao contrário, a lista decrescente começaria
com um bloco de traços e esconderia justamente quem tem a informação.

No **celular** a tabela vira cartão e o cabeçalho some, então não há título para
clicar: aparece o seletor **"Ordenar por:"** logo acima da lista, com as mesmas
opções e a entrada *Ordem do arquivo* para voltar ao normal. É o mesmo controle
que as abas de *Entrevistas Capital* e *Entrevistas Interior* já tinham.

### A coluna "Editar"

Nas tabelas de *Candidatos* e *Formação*, o botão de edição é só o **lápis**
(✎). O texto "Editar" repetido em toda linha custava uma coluna inteira de
largura e era o que empurrava a tabela para fora da tela; o nome da ação
continua no cabeçalho da coluna, no "passe o mouse" e para quem usa leitor de
tela. Para o supervisor, que define grupo em vez de editar, o botão continua
escrito: **+ Definir grupo**.
