# Envio automático das convocações (Google Apps Script + Gmail)

Este guia liga os botões de **Convocação** (aba *Candidatos* do painel) ao envio
real de e-mails. Os e-mails são enviados **pelo seu Gmail** (saem do seu próprio
endereço), por um pequeno *Web App* do Google Apps Script. **Sem custo** e sem
serviço de e-mail externo.

Você faz isto **uma vez**. Depois, todo clique de convocação envia sozinho.

---

## Como funciona (resumo)

1. No painel, você clica em **Convocar** (geral para entrevista, ou individual
   para cadastro).
2. O painel chama o Web App do Apps Script, enviando o texto do e-mail **e o seu
   token de login** do painel.
3. O Apps Script **confere que o pedido veio de alguém logado** no painel e então
   envia os e-mails pelo seu Gmail.
4. O painel registra a **data** da convocação em cada candidato.

---

## Passo 1 — Criar o script

1. Acesse **https://script.google.com** (logado na conta Google que vai enviar os
   e-mails — de preferência a conta oficial da RBCIP).
2. Clique em **Novo projeto**.
3. Apague o conteúdo de exemplo e **cole o código abaixo** inteiro:

```javascript
// ===== Configuração =====
var SUPABASE_URL = "https://gnqzcmzyupetpvlhsfsu.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_MEhaRpgmqmEW8wkh39N3Wg_brzS5bX_";

// >>> COLOQUE AQUI o e-mail que deve receber o RECIBO de cada envio. <<<
var EMAIL_RECIBO = "lucas@rbcip.org";

// ===== Planilhas lidas pela aba Formação =====
// Os IDs ficam SÓ AQUI, na sua conta Google — nunca no repositório do sistema.
// O ID é o trecho da URL entre /d/ e /edit.
var PLANILHA_CADASTROS = "";        // Cadastro de Bolsistas Geral (respostas) — CPF na coluna K
var PLANILHA_TERMOS_CAPITAL = "";   // Controle TB Entrevistadores_SP_Capital  — CPF na R, link na AL
var PLANILHA_TERMOS_INTERIOR = "";  // Controle TB Entrevistadores_SP_Interior — CPF na R, link na AL

// Health-check simples (abrir a URL no navegador deve mostrar {"ok":true}).
function doGet() {
  return json({ ok: true, servico: "convocacoes RBCIP" });
}

function doPost(e) {
  try {
    // Lê o corpo com segurança (se não vier, mensagens fica vazio e o recibo avisa).
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    var body = {};
    try { body = JSON.parse(raw); } catch (pe) { body = {}; }

    // 1) Confere que quem chamou está logado no painel (token do Supabase).
    if (!body.token || !usuarioValido(body.token)) {
      return json({ ok: false, error: "Não autorizado (faça login no painel)." });
    }

    // 1b) Verificação de entregas (bounces): devolve os e-mails que falharam.
    if (body.acao === "bounces") {
      return json({ ok: true, falhas: checarBounces(body.dias || 14) });
    }

    // 1c) Sincronização da aba Formação: lê as planilhas e devolve os dados.
    if (body.acao === "sincronizar") {
      return json({ ok: true, dados: dadosFormacao() });
    }

    // 2) Envia cada mensagem pelo Gmail.
    var mensagens = body.mensagens || [];
    var recebidas = mensagens.length;
    var enviados = 0;
    var erros = [];
    var destinatarios = [];
    for (var i = 0; i < mensagens.length; i++) {
      var m = mensagens[i];
      if (!m || !m.para) { erros.push("mensagem " + i + " sem destinatário"); continue; }
      try {
        GmailApp.sendEmail(m.para, m.assunto || "(sem assunto)", m.corpo || "");
        enviados++;
        destinatarios.push(m.para);
      } catch (errEnvio) {
        erros.push(m.para + ": " + errEnvio);
      }
    }

    // 3) Recibo/diagnóstico SEMPRE para você — confirma o que ocorreu.
    var recibo = "";
    try {
      var paraRecibo = EMAIL_RECIBO || Session.getEffectiveUser().getEmail();
      if (!paraRecibo) {
        recibo = "sem endereço definido (preencha EMAIL_RECIBO no script)";
      } else {
        // GmailApp (e não MailApp): usa a MESMA permissão já autorizada para
        // enviar as convocações. Com MailApp o Google pede uma permissão extra
        // (script.send_mail) e o recibo falha mesmo com os e-mails saindo.
        GmailApp.sendEmail(
          paraRecibo,
          "RBCIP — convocacoes: recebidas " + recebidas + ", enviadas " + enviados,
          "Recebidas: " + recebidas + "\nEnviadas: " + enviados +
            "\n\nDestinatarios:\n" + (destinatarios.join("\n") || "(nenhum)") +
            (erros.length ? "\n\nFalhas:\n" + erros.join("\n") : "")
        );
        recibo = "recibo enviado para " + paraRecibo;
      }
    } catch (e2) {
      recibo = "falha ao enviar recibo: " + e2;
    }

    return json({ ok: true, recebidas: recebidas, enviados: enviados, erros: erros, recibo: recibo });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Procura, na sua caixa, os avisos de FALHA de entrega (bounces) e devolve
// { "email_minusculo": "motivo" } para o painel marcar os candidatos.
function checarBounces(dias) {
  var q = 'newer_than:' + (dias || 14) + 'd (from:mailer-daemon OR from:postmaster ' +
          'OR subject:"Delivery Status Notification" OR subject:"Address not found" ' +
          'OR subject:"Undelivered" OR subject:"failure")';
  var threads = GmailApp.search(q, 0, 200);
  var falhas = {};
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var i = 0; i < msgs.length; i++) {
      var corpo = "";
      try { corpo = msgs[i].getPlainBody() || ""; } catch (e) { corpo = ""; }
      var motivo = motivoBounce(corpo);
      // Endereços mais confiáveis: linhas "Final-Recipient".
      var achou = false;
      var reFinal = /Final-Recipient:\s*rfc822;\s*<?([^\s<>]+@[^\s<>]+)/gi;
      var m;
      while ((m = reFinal.exec(corpo))) { falhas[limparEmail(m[1])] = motivo; achou = true; }
      if (!achou) {
        var todos = corpo.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
        for (var j = 0; j < todos.length; j++) falhas[limparEmail(todos[j])] = motivo;
      }
    }
  }
  return falhas;
}
function motivoBounce(corpo) {
  var c = (corpo || "").toLowerCase();
  if (c.indexOf("couldn't be found") !== -1 || c.indexOf("address not found") !== -1 ||
      c.indexOf("no such user") !== -1 || c.indexOf("does not exist") !== -1 ||
      c.indexOf("user unknown") !== -1) {
    return "E-mail não existe";
  }
  return "Falha na entrega";
}
function limparEmail(s) {
  return String(s || "").toLowerCase().replace(/[<>.,;]+$/, "").trim();
}

// ===== Leitura das planilhas da aba Formação =====
// Devolve { cadastros: [cpf…], termos: { capital: {cpf: link}, interior: {…} } }.
// Só CPF trafega — nenhum nome, telefone ou endereço sai das planilhas.
function dadosFormacao() {
  return {
    cadastros: cpfsDaColuna(PLANILHA_CADASTROS, "K"),
    termos: {
      capital: linksPorCpf(PLANILHA_TERMOS_CAPITAL, "R", "AL"),
      interior: linksPorCpf(PLANILHA_TERMOS_INTERIOR, "R", "AL"),
    },
  };
}

// "K" -> 11, "AL" -> 38
function colunaParaIndice(letra) {
  var n = 0, s = String(letra).toUpperCase();
  for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}
function apenasDigitos(v) { return String(v == null ? "" : v).replace(/\D/g, ""); }

// Lista os CPFs de uma coluna (quem preencheu o formulário de cadastro).
function cpfsDaColuna(id, colCpf) {
  if (!id) return [];
  var sh = SpreadsheetApp.openById(id).getSheets()[0];
  var ult = sh.getLastRow();
  if (ult < 2) return [];
  var vals = sh.getRange(2, colunaParaIndice(colCpf), ult - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var cpf = apenasDigitos(vals[i][0]);
    if (cpf.length === 11) out.push(cpf);
  }
  return out;
}

// Mapa CPF -> link do termo de bolsa.
function linksPorCpf(id, colCpf, colLink) {
  if (!id) return {};
  var sh = SpreadsheetApp.openById(id).getSheets()[0];
  var ult = sh.getLastRow();
  if (ult < 2) return {};
  var cc = colunaParaIndice(colCpf), cl = colunaParaIndice(colLink);
  var ini = Math.min(cc, cl), fim = Math.max(cc, cl);
  var faixa = sh.getRange(2, ini, ult - 1, fim - ini + 1);
  var vals = faixa.getValues();
  var ricos = null; // só carrega se precisar (link escondido atrás de texto)
  var mapa = {};
  for (var i = 0; i < vals.length; i++) {
    var cpf = apenasDigitos(vals[i][cc - ini]);
    if (cpf.length !== 11) continue;
    var link = String(vals[i][cl - ini] || "").trim();
    if (!/^https?:\/\//i.test(link)) {
      // A célula pode ter um hiperlink com texto por cima ("Ver termo").
      if (!ricos) ricos = faixa.getRichTextValues();
      var url = ricos[i][cl - ini] ? ricos[i][cl - ini].getLinkUrl() : null;
      link = url || "";
    }
    if (/^https?:\/\//i.test(link)) mapa[cpf] = link;
  }
  return mapa;
}

// Valida o token chamando o próprio Supabase.
function usuarioValido(token) {
  var resp = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/user", {
    method: "get",
    headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
    muteHttpExceptions: true,
  });
  return resp.getResponseCode() === 200;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. Clique no ícone de **salvar** (disquete) e dê um nome ao projeto
   (ex.: *Convocações RBCIP*).

---

## Passo 2 — Publicar como Web App

1. No canto superior direito, clique em **Implantar → Nova implantação**.
2. Em **Tipo**, escolha **App da Web** (Web app).
3. Configure:
   - **Executar como:** *Eu* (a conta que envia os e-mails).
   - **Quem pode acessar:** *Qualquer pessoa* (é o que permite o painel chamar).
4. Clique em **Implantar**.
5. O Google vai pedir para **autorizar** o acesso ao Gmail — aceite (é o que
   permite enviar). Pode aparecer um aviso "app não verificado": clique em
   *Avançado → Acessar (nome do projeto)*.
6. Copie a **URL do App da Web** (termina em `/exec`).

---

## Passo 3 — Ligar no painel

No arquivo **`js/config.js`**, preencha **só a URL do Web App**:

```javascript
CONVOCACAO_BACKEND_URL: "COLE_AQUI_A_URL_DO_WEB_APP",   // termina em /exec
```

Os links de agendamento da entrevista (`AGENDA_LINKS`, 3 opções) e o link do
formulário de Cadastro de Bolsista já vêm preenchidos — confira se estão corretos.

Salve, faça o commit/deploy e recarregue o painel (Ctrl+Shift+R). Pronto: os
botões de convocação passam a enviar de verdade.

---

## "Apertei enviar, mas não recebi o e-mail!"

Quase sempre é isto: **as convocações vão para os CANDIDATOS, não para você.**
Sua caixa de entrada não recebe nada — o e-mail sai da sua conta para o candidato.
Para confirmar:

1. Abra a pasta **"Enviados"** (Sent) do seu Gmail — as convocações devem estar lá.
2. Com o script atualizado acima, **você recebe um recibo** ("RBCIP — X
   convocações enviadas") listando para quem foi. Se o recibo chegou, os e-mails
   saíram.
3. Para um teste 100% seu, importe um CSV com **apenas o seu e-mail** como
   candidato e convoque — aí você recebe a convocação de verdade.

Se o painel disser "0 e-mails enviados", o problema é no script (autorização do
Gmail ou token) — reimplante uma **nova versão** e teste de novo.

---

## "Os e-mails saíram, mas o recibo deu erro de permissão"

Se o aviso na tela mostrar algo como *"Você não tem permissão para chamar
MailApp.sendEmail. Permissões necessárias: .../auth/script.send_mail"*, o envio
das convocações **funcionou** — só o recibo falhou.

A causa é que `MailApp` e `GmailApp` pedem permissões diferentes, e você
autorizou apenas a do Gmail. A correção é usar `GmailApp` também no recibo,
como está no código acima. Se o seu script ainda tiver `MailApp.sendEmail` na
parte do recibo:

1. Abra o projeto em <https://script.google.com>.
2. Troque `MailApp.sendEmail(` por `GmailApp.sendEmail(` (só na parte do recibo).
3. Salve e **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova
   versão → Implantar**. Sem a nova versão, o Web App continua rodando o código
   antigo.

Não é preciso reautorizar nada: o `GmailApp` já está liberado desde a primeira
autorização.

---

## Pontos importantes

- **Limite do Gmail:** contas Google Workspace enviam ~1.500 e-mails/dia; contas
  gratuitas, ~100/dia. Para o volume do processo (dezenas por vez), é folgado.
- **Segurança:** o script só envia se o pedido trouxer um token de alguém logado
  no painel. Ainda assim, mantenha a URL do Web App discreta.
- **Teste antes:** abra a URL `/exec` no navegador — deve aparecer
  `{"ok":true,...}`. Depois, faça uma convocação de teste para um e-mail seu.
- **Texto dos e-mails:** o conteúdo (assunto/corpo) está em `js/dashboard.js`
  nas funções `emailConvocacaoEntrevista` e `emailConvocacaoCadastro` — me peça
  para ajustar o texto quando quiser.
- **Se o envio falhar com erro de CORS:** reimplante o Web App (Implantar →
  Gerenciar implantações → editar → nova versão) e confirme "Quem pode acessar:
  Qualquer pessoa". Me avise que eu ajusto o modo de chamada.
