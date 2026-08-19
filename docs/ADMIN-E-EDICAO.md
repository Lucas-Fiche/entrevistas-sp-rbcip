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
**ADMIN** ou **SOMENTE LEITURA**. É por ele que você confere se a permissão pegou.

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
- **Falha de entrega** — dá para limpar a marcação de "e-mail não existe" quando
  o endereço foi corrigido.

Ao salvar, os campos alterados ficam **travados** e a ficha ganha a marca
**✎ editado** na tabela.

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

O arquivo da plataforma **não traz** as colunas de convocação, resultado e datas
— elas são do seu controle. Isso não é problema: a importação nunca apaga o que
já está preenchido na ficha. Convocações registradas pelo sistema, resultados
casados e correções manuais sobrevivem à reimportação; o mesmo vale para nome,
e-mail, CPF e região quando o arquivo vier sem eles.

---

## 5. Ordem das tabelas

As abas **Candidatos** e **Formação** são exibidas na mesma ordem do CSV
importado — a ordem em que as pessoas se inscreveram ou entraram no projeto.
Isso depende de rodar **`sql/ordem.sql`** e reimportar os arquivos uma vez;
o rodapé de cada tabela mostra qual ordem está em uso.

---

## 6. Largura da tela

No topo do painel há o botão **⛶ Tela cheia**, que faz as tabelas ocuparem toda
a largura do notebook (o padrão é uma largura mais confortável para leitura). A
escolha fica salva no navegador — quem prefere tela cheia entra sempre assim.
