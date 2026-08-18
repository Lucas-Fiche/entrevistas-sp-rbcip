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

// Health-check simples (abrir a URL no navegador deve mostrar {"ok":true}).
function doGet() {
  return json({ ok: true, servico: "convocacoes RBCIP" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // 1) Confere que quem chamou está logado no painel (token do Supabase).
    if (!body.token || !usuarioValido(body.token)) {
      return json({ ok: false, error: "Não autorizado (faça login no painel)." });
    }

    // 2) Envia cada mensagem pelo Gmail.
    var mensagens = body.mensagens || [];
    var enviados = 0;
    for (var i = 0; i < mensagens.length; i++) {
      var m = mensagens[i];
      if (!m || !m.para) continue;
      GmailApp.sendEmail(m.para, m.assunto || "(sem assunto)", m.corpo || "");
      enviados++;
    }
    return json({ ok: true, enviados: enviados });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
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
