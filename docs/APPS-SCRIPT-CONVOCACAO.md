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

// ===== Planilha-ponte lida pela aba Formação =====
// O script lê UMA planilha só: a "ponte" (Dados para o Sistema), que você
// alimenta com IMPORTRANGE a partir das planilhas oficiais. Assim o script
// nunca depende do layout delas e enxerga apenas CPF e link do termo.
// O ID é o trecho da URL entre /d/ e /edit. Fica SÓ AQUI, nunca no repositório.
var PLANILHA_PONTE = "";

// Nome da aba da ponte. Deixe "" para usar a primeira.
// (O script informa no resumo qual aba leu — confira sempre que o número
//  parecer estranho: ler a aba errada é o erro que não dá mensagem.)
var ABA_PONTE = "";

// Colunas da ponte (linha 1 = cabeçalho):
//   A: CPF do Cadastro de Bolsista
//   B: CPF Capital    C: Link do termo — Capital
//   D: CPF Interior   E: Link do termo — Interior

// ===== Conta do robô (só para a sincronização automática) =====
// Crie no Supabase, em Authentication → Users, um usuário SÓ para isto
// (ex.: robo@rbcip.org) e inclua o e-mail na tabela app_admins. O robô passa a
// ter exatamente os mesmos poderes de um admin do painel — nem mais, nem menos
// — e as regras de RLS continuam valendo.
// NUNCA use aqui a chave service_role: ela ignora o RLS e não é revogável sem
// trocar a chave do projeto inteiro. Se esta senha vazar, basta apagar o
// usuário no Supabase.
// Estes dados ficam SÓ AQUI, nunca no repositório do sistema.
var ROBO_EMAIL = "";
var ROBO_SENHA = "";

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

// ===== Leitura da planilha-ponte =====
// Devolve { cadastros: [cpf…], termos: { capital: {cpf: link}, interior: {…} },
//           lidos: {…} }. `lidos` diz qual aba foi lida e quantas linhas vieram
// de cada coluna — é o que permite perceber na hora que algo veio do lugar
// errado, em vez de descobrir pelos dados errados no painel.
function dadosFormacao() {
  if (!PLANILHA_PONTE) throw new Error("Preencha PLANILHA_PONTE no script.");
  var ss = SpreadsheetApp.openById(PLANILHA_PONTE);
  var sh = ABA_PONTE ? ss.getSheetByName(ABA_PONTE) : ss.getSheets()[0];
  if (!sh) throw new Error('Aba "' + ABA_PONTE + '" nao existe na planilha-ponte.');

  var ult = sh.getLastRow();
  var nc = Math.min(5, sh.getMaxColumns());
  var vals = ult > 1 ? sh.getRange(2, 1, ult - 1, nc).getValues() : [];

  var cadastros = [], capital = {}, interior = {};
  for (var i = 0; i < vals.length; i++) {
    var cpfCad = apenasDigitos(vals[i][0]);
    if (cpfCad.length === 11) cadastros.push(cpfCad);
    juntarTermo(capital, vals[i][1], vals[i][2]);
    juntarTermo(interior, vals[i][3], vals[i][4]);
  }

  return {
    cadastros: cadastros,
    termos: { capital: capital, interior: interior },
    lidos: {
      aba: sh.getName(),
      linhas: vals.length,
      cadastros: cadastros.length,
      termos_capital: Object.keys(capital).length,
      termos_interior: Object.keys(interior).length,
    },
  };
}

function apenasDigitos(v) { return String(v == null ? "" : v).replace(/\D/g, ""); }

// Só entra no mapa o par completo: CPF de 11 dígitos + link http(s).
// Erros do IMPORTRANGE (#REF!, #N/A, "Loading…") caem fora sozinhos.
function juntarTermo(mapa, cpf, link) {
  var c = apenasDigitos(cpf);
  var l = String(link || "").trim();
  if (c.length === 11 && /^https?:\/\//i.test(l)) mapa[c] = l;
}

// ===== Sincronização automática (gatilho de tempo) =====
// Roda no servidor do Google, sem navegador aberto. Faz o mesmo que o botão
// "Sincronizar planilhas" do painel — inclusive a regra de nunca apagar nada.

// Rode UMA VEZ, pelo editor, para ligar o gatilho (a cada 6 horas).
function instalarGatilhoSincronizacao() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "sincronizacaoAutomatica") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("sincronizacaoAutomatica").timeBased().everyHours(6).create();
  return "Gatilho instalado: a cada 6 horas.";
}

// Desliga a automação (a sincronização manual continua funcionando).
function removerGatilhoSincronizacao() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "sincronizacaoAutomatica") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  return "Gatilho removido.";
}

function sincronizacaoAutomatica() {
  var token = null, lidos = null;
  try {
    var dados = dadosFormacao();
    lidos = dados.lidos;

    var cadastros = {};
    for (var i = 0; i < dados.cadastros.length; i++) cadastros[dados.cadastros[i]] = true;
    var temCadastros = dados.cadastros.length > 0;

    token = tokenDoRobo();
    var fichas = supabase(token, "formacao?select=id,nome,tipo,cpf,cadastro_bolsista,termo_link");

    var mudaram = [];
    for (var j = 0; j < fichas.length; j++) {
      var f = fichas[j];
      var cpf = apenasDigitos(f.cpf);
      if (cpf.length !== 11) continue;

      var patch = {};
      // Preencheu o cadastro de bolsista?
      if (temCadastros && cadastros[cpf] &&
          String(f.cadastro_bolsista || "").toLowerCase() !== "realizado") {
        patch.cadastro_bolsista = "Realizado";
      }
      // Termo de bolsa emitido? (só acrescenta; nunca remove um link existente)
      var link = (dados.termos[f.tipo] || {})[cpf];
      if (link && link !== f.termo_link) {
        patch.termo_link = link;
        patch.termo_bolsa = "Emitido";
      }
      if (!Object.keys(patch).length) continue;

      patch.updated_at = new Date().toISOString();
      supabase(token, "formacao?id=eq." + f.id, "patch", patch);
      mudaram.push(f.nome || f.id);
    }

    registrarSincronizacao(token, lidos, mudaram.length, null);

    // Só avisa quando algo mudou — senão vira e-mail diário ignorado.
    if (mudaram.length) {
      GmailApp.sendEmail(EMAIL_RECIBO,
        "RBCIP — sincronizacao automatica: " + mudaram.length + " ficha(s)",
        "Atualizadas:\n" + mudaram.join("\n") +
        "\n\nLidos da ponte: " + JSON.stringify(lidos));
    }
    return mudaram.length;
  } catch (err) {
    // Falha silenciosa é o pior cenário numa rotina automática: avisa e registra.
    try { if (token) registrarSincronizacao(token, lidos, 0, String(err)); } catch (e2) {}
    try {
      GmailApp.sendEmail(EMAIL_RECIBO, "RBCIP — sincronizacao automatica FALHOU", String(err));
    } catch (e3) {}
    throw err;
  }
}

function registrarSincronizacao(token, lidos, atualizadas, detalhe) {
  supabase(token, "sincronizacoes", "post", {
    origem: "automatica",
    usuario: ROBO_EMAIL,
    lidos: lidos,
    atualizadas: atualizadas,
    detalhe: detalhe,
  });
}

// Faz login como o robô e devolve o token (vale ~1 hora, suficiente para a
// execução). Sem service_role: as regras de RLS continuam valendo.
function tokenDoRobo() {
  if (!ROBO_EMAIL || !ROBO_SENHA) throw new Error("Preencha ROBO_EMAIL e ROBO_SENHA no script.");
  var resp = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "post",
    contentType: "application/json",
    headers: { apikey: SUPABASE_ANON_KEY },
    payload: JSON.stringify({ email: ROBO_EMAIL, password: ROBO_SENHA }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Login do robo falhou: " + resp.getContentText());
  }
  return JSON.parse(resp.getContentText()).access_token;
}

// Chamada REST ao Supabase, autenticada como o robô.
function supabase(token, caminho, metodo, corpo) {
  var opcoes = {
    method: metodo || "get",
    contentType: "application/json",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + token,
      Prefer: "return=minimal",
    },
    muteHttpExceptions: true,
  };
  if (corpo) opcoes.payload = JSON.stringify(corpo);
  var resp = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + caminho, opcoes);
  if (resp.getResponseCode() >= 300) {
    throw new Error(caminho + " -> " + resp.getResponseCode() + " " + resp.getContentText());
  }
  var txt = resp.getContentText();
  return txt ? JSON.parse(txt) : null;
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

Há ainda `PLATAFORMA_CADASTRO_CAPITAL` e `PLATAFORMA_CADASTRO_INTERIOR`: são os
links em que a pessoa **se cadastra na plataforma**, um por projeto. O painel os
usa no botão *Solicitar inscrição*, quando alguém se cadastrou numa região e foi
entrevistado na outra (veja `docs/ADMIN-E-EDICAO.md`).

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
