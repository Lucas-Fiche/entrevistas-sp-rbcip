# Envio automático das convocações (Google Apps Script + Gmail)

Este guia liga os botões de **Convocação** (aba *Candidatos* do painel) ao envio
real de e-mails. Os e-mails são enviados **pelo seu Gmail** (saem do seu próprio
endereço), por um pequeno *Web App* do Google Apps Script. **Sem custo** e sem
serviço de e-mail externo.

Você faz isto **uma vez**. Depois, todo clique de convocação envia sozinho.

---

> **Só quer ligar o aviso automático ao financeiro?** Vá direto ao
> [Passo 4](#passo-4--ligar-as-automações-sincronização-e-aviso-ao-financeiro).
> Os passos 1 a 3 fazem o script responder aos botões do painel; o 4 é o que
> faz as rotinas rodarem sozinhas.

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
//
// >>> LEIA ANTES DE RECOLAR O CÓDIGO <<<
// Os valores em branco aqui embaixo são o MODELO do repositório. Recolar o
// script inteiro por cima do seu apaga o que você tinha preenchido, e a
// sincronização passa a falhar com "Preencha PLANILHA_PONTE no script".
//
// Para isso não se repetir, guarde-os nas PROPRIEDADES DO SCRIPT: o código lê
// de lá primeiro, e propriedade nenhuma se perde quando o código é trocado.
//   Apps Script → engrenagem "Configurações do projeto" → Propriedades do
//   script → Adicionar propriedade, uma para cada:
//       PLANILHA_PONTE   (o id da planilha-ponte)
//       ABA_PONTE        (opcional; em branco = primeira aba)
//       ROBO_EMAIL       ROBO_SENHA      (só para a sincronização automática)
//       EMAIL_RECIBO     (opcional)
// Feito isso, pode recolar o código quantas vezes quiser sem perder nada.

function prop(nome, padrao) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(nome);
    if (v !== null && String(v).trim() !== "") return String(v).trim();
  } catch (e) { /* projeto sem propriedades: cai no valor de baixo */ }
  return padrao || "";
}

var SUPABASE_URL = prop("SUPABASE_URL", "https://gnqzcmzyupetpvlhsfsu.supabase.co");
var SUPABASE_ANON_KEY = prop("SUPABASE_ANON_KEY", "sb_publishable_MEhaRpgmqmEW8wkh39N3Wg_brzS5bX_");

// >>> COLOQUE AQUI o e-mail que deve receber o RECIBO de cada envio. <<<
var EMAIL_RECIBO = prop("EMAIL_RECIBO", "lucas@rbcip.org");

// ===== Planilha-ponte lida pela aba Formação =====
// O script lê UMA planilha só: a "ponte" (Dados para o Sistema), que você
// alimenta com IMPORTRANGE a partir das planilhas oficiais. Assim o script
// nunca depende do layout delas e enxerga apenas CPF e link do termo.
// O ID é o trecho da URL entre /d/ e /edit. Fica SÓ AQUI (ou nas propriedades
// do script), nunca no repositório.
var PLANILHA_PONTE = prop("PLANILHA_PONTE", "");

// Nome da aba da ponte. Deixe "" para usar a primeira.
// (O script informa no resumo qual aba leu — confira sempre que o número
//  parecer estranho: ler a aba errada é o erro que não dá mensagem.)
var ABA_PONTE = prop("ABA_PONTE", "");

// Colunas da ponte (linha 1 = cabeçalho):
//   A: CPF do Cadastro de Bolsista
//   B: CPF Capital    C: Link do termo — Capital
//   D: CPF Interior   E: Link do termo — Interior
//   F: Data do Cadastro de Bolsista  ← o carimbo de data/hora do formulário
//
// A coluna F é a data em que a pessoa PREENCHEU o cadastro — é ela que vira a
// "entrada no projeto" no painel. Puxe-a no mesmo IMPORTRANGE da coluna A, para
// as duas andarem juntas (mesma linha = mesma pessoa). Se a coluna F ficar
// vazia, nada quebra: o painel só continua sem saber a data de entrada.

// ===== Conta do robô (só para a sincronização automática) =====
// Crie no Supabase, em Authentication → Users, um usuário SÓ para isto
// (ex.: robo@rbcip.org) e inclua o e-mail na tabela app_admins. O robô passa a
// ter exatamente os mesmos poderes de um admin do painel — nem mais, nem menos
// — e as regras de RLS continuam valendo.
// NUNCA use aqui a chave service_role: ela ignora o RLS e não é revogável sem
// trocar a chave do projeto inteiro. Se esta senha vazar, basta apagar o
// usuário no Supabase.
// Estes dados ficam SÓ AQUI (ou nas propriedades do script), nunca no
// repositório do sistema.
var ROBO_EMAIL = prop("ROBO_EMAIL", "");
var ROBO_SENHA = prop("ROBO_SENHA", "");

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

    // 1e) Estado da automação: quais gatilhos estão instalados. Sem isto, o
    // painel não teria como distinguir "automático ligado" de "ninguém rodando".
    if (body.acao === "status_automacao") {
      return json({ ok: true, gatilhos: gatilhosInstalados() });
    }

    // 1d) Aviso ao financeiro: quem ficou apto e só depende do termo de bolsa.
    // O mesmo trabalho que a rotina automática faz sozinha — este caminho
    // existe para o painel poder avisar na hora, sem esperar o próximo ciclo.
    if (body.acao === "avisar_aptos") {
      var r = avisarAptos();
      return json({ ok: true, avisados: r.avisados, destinatarios: r.destinatarios });
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
// Devolve { cadastros: [cpf…], datas_cadastro: {cpf: "dd/mm/aaaa"},
//           termos: { capital: {cpf: link}, interior: {…} }, lidos: {…} }.
// `lidos` diz qual aba foi lida e quantas linhas vieram de cada coluna — é o
// que permite perceber na hora que algo veio do lugar errado, em vez de
// descobrir pelos dados errados no painel.
function dadosFormacao() {
  if (!PLANILHA_PONTE) {
    throw new Error("PLANILHA_PONTE esta vazia. Preencha em Configuracoes do " +
      "projeto -> Propriedades do script (PLANILHA_PONTE = id da planilha), ou " +
      "na linha var PLANILHA_PONTE do codigo. Recolar o script por cima apaga " +
      "o valor que estava no codigo; a propriedade sobrevive.");
  }
  var ss = SpreadsheetApp.openById(PLANILHA_PONTE);
  var sh = ABA_PONTE ? ss.getSheetByName(ABA_PONTE) : ss.getSheets()[0];
  if (!sh) throw new Error('Aba "' + ABA_PONTE + '" nao existe na planilha-ponte.');

  var ult = sh.getLastRow();
  var nc = Math.min(6, sh.getMaxColumns());
  var vals = ult > 1 ? sh.getRange(2, 1, ult - 1, nc).getValues() : [];

  var cadastros = [], datas = {}, capital = {}, interior = {};
  for (var i = 0; i < vals.length; i++) {
    var cpfCad = apenasDigitos(vals[i][0]);
    if (cpfCad.length === 11) {
      cadastros.push(cpfCad);
      // A data do cadastro (coluna F). Guarda a MAIS ANTIGA quando o mesmo CPF
      // aparece duas vezes: se a pessoa preencheu o formulário de novo, quem
      // marca a entrada no projeto é a primeira vez.
      var d = dataBR(vals[i][5]);
      if (d && (!datas[cpfCad] || maisAntiga(d, datas[cpfCad]))) datas[cpfCad] = d;
    }
    juntarTermo(capital, vals[i][1], vals[i][2]);
    juntarTermo(interior, vals[i][3], vals[i][4]);
  }

  return {
    cadastros: cadastros,
    datas_cadastro: datas,
    termos: { capital: capital, interior: interior },
    lidos: {
      aba: sh.getName(),
      linhas: vals.length,
      cadastros: cadastros.length,
      datas_cadastro: Object.keys(datas).length,
      termos_capital: Object.keys(capital).length,
      termos_interior: Object.keys(interior).length,
    },
  };
}

// Célula da coluna F -> "dd/mm/aaaa". O carimbo do Google Forms chega como Date;
// se alguém colar texto, aceita dd/mm/aaaa e aaaa-mm-dd. Qualquer outra coisa
// vira vazio — data inventada aqui viraria número errado no relatório depois.
function dataBR(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }
  var t = String(v == null ? "" : v).trim();
  var m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[1] + "/" + m[2] + "/" + m[3];
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + "/" + m[2] + "/" + m[1];
  return "";
}

function maisAntiga(a, b) {
  return a.slice(6) + a.slice(3, 5) + a.slice(0, 2) <
         b.slice(6) + b.slice(3, 5) + b.slice(0, 2);
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

// Quais rotinas automáticas estão de pé, e de quanto em quanto tempo.
function gatilhosInstalados() {
  var achados = {};
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "sincronizacaoAutomatica" || fn === "avisoAutomatico") achados[fn] = true;
  }
  return {
    sincronizacao: !!achados.sincronizacaoAutomatica,
    aviso: !!achados.avisoAutomatico,
  };
}

// ===== Aviso ao financeiro: gatilho próprio, de hora em hora =====
// A sincronização já avisa ao fim de cada rodada, mas ela roda de 6 em 6 horas
// porque lê planilhas. O aviso só lê o Supabase, é barato, e o treinamento é
// marcado à mão no painel a qualquer momento — então vale ter um gatilho só
// dele, mais frequente. Instalar os dois não duplica e-mail: cada pessoa entra
// em um aviso só.
//
// Rode UMA VEZ, pelo editor, para ligar.
function instalarGatilhoAviso() {
  removerGatilhoAviso();
  ScriptApp.newTrigger("avisoAutomatico").timeBased().everyHours(1).create();
  return "Gatilho do aviso instalado: de hora em hora.";
}

function removerGatilhoAviso() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "avisoAutomatico") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  return "Gatilho do aviso removido.";
}

function avisoAutomatico() {
  try {
    var r = avisarAptos();
    return r.avisados;
  } catch (err) {
    // Rotina automática que falha calada é o pior caso: avisa quem cuida.
    try {
      GmailApp.sendEmail(EMAIL_RECIBO, "RBCIP — aviso ao financeiro FALHOU", String(err));
    } catch (e) {}
    throw err;
  }
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
    var datas = dados.datas_cadastro || {};

    token = tokenDoRobo();
    var fichas = supabase(token,
      "formacao?select=id,nome,tipo,cpf,cadastro_bolsista,termo_link,data_entrada");

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
      // A data em que preencheu é a entrada no projeto. Só preenche o que está
      // vazio: uma data já registrada (à mão ou antes) não é sobrescrita.
      if (datas[cpf] && !f.data_entrada) {
        patch.data_entrada = datas[cpf];
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

    // Depois de sincronizar, avisa o financeiro de quem ficou apto. Uma falha
    // aqui não pode desfazer a sincronização, que já deu certo.
    var aviso = { avisados: 0 };
    try { aviso = avisarAptos(token); } catch (eAviso) {
      try {
        GmailApp.sendEmail(EMAIL_RECIBO, "RBCIP — aviso ao financeiro FALHOU", String(eAviso));
      } catch (e4) {}
    }

    // Só avisa quando algo mudou — senão vira e-mail diário ignorado.
    if (mudaram.length || aviso.avisados) {
      GmailApp.sendEmail(EMAIL_RECIBO,
        "RBCIP — sincronizacao automatica: " + mudaram.length + " ficha(s)",
        "Atualizadas:\n" + (mudaram.join("\n") || "(nenhuma)") +
        "\n\nAvisos de 'apto, aguardando termo' enviados ao financeiro: " + aviso.avisados +
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

// ===== Aviso ao financeiro: "apto, só falta o termo" =====
// Apto = cadastro de bolsista preenchido E treinamento realizado E sem termo
// E não desligado. A regra também existe no banco, na view aptos_para_termo
// (sql/perfil-financeiro.sql); aqui ela é aplicada sobre as mesmas colunas.
//
// Cada pessoa entra em UM aviso só: depois de enviada, a ficha recebe
// aviso_apto_em e não volta na próxima rodada. Sem isso o financeiro receberia
// a mesma lista de 6 em 6 horas e pararia de ler.
function avisarAptos(token) {
  var t = token || tokenDoRobo();

  var financeiro = supabase(t, "app_financeiro?select=email") || [];
  var destinatarios = [];
  for (var i = 0; i < financeiro.length; i++) {
    if (financeiro[i].email) destinatarios.push(String(financeiro[i].email).trim());
  }

  var fichas = supabase(t,
    "formacao?select=id,nome,tipo,cpf,email,grupo,regiao,data_entrada,cadastro_bolsista," +
    "treinamento_presencial,treinamento_online,termo_link,desligado_em,aviso_apto_em") || [];

  var aptos = [];
  for (var j = 0; j < fichas.length; j++) {
    var f = fichas[j];
    if (f.aviso_apto_em) continue;
    if (f.desligado_em) continue;
    if (f.termo_link) continue;
    if (String(f.cadastro_bolsista || "").toLowerCase() !== "realizado") continue;
    var treino = String(f.treinamento_presencial || f.treinamento_online || "").toLowerCase();
    if (treino !== "realizado") continue;
    aptos.push(f);
  }
  if (!aptos.length) return { avisados: 0, destinatarios: destinatarios };

  // Sem ninguém no financeiro, NÃO marca as fichas: se marcasse, essas pessoas
  // nunca mais entrariam num aviso, e o primeiro financeiro cadastrado
  // começaria já sem saber delas.
  if (!destinatarios.length) return { avisados: 0, destinatarios: [] };

  var linhas = [];
  for (var k = 0; k < aptos.length; k++) {
    var a = aptos[k];
    linhas.push("· " + (a.nome || "(sem nome)") +
      "  |  " + (a.tipo === "capital" ? "Capital" : "Interior") +
      (a.grupo || a.regiao ? " / " + (a.grupo || a.regiao) : "") +
      (a.cpf ? "  |  CPF " + a.cpf : "") +
      (a.email ? "  |  " + a.email : ""));
  }

  var assunto = "RBCIP — " + aptos.length +
    (aptos.length === 1 ? " pessoa apta, aguardando o termo de bolsa"
                        : " pessoas aptas, aguardando o termo de bolsa");
  var corpo =
    "As pessoas abaixo concluíram o cadastro de bolsista e o treinamento.\n" +
    "Falta apenas o termo de bolsa para começarem a atuar.\n\n" +
    linhas.join("\n") +
    "\n\nEsta lista sai uma vez por pessoa: quem aparece aqui não volta no próximo aviso.\n" +
    "Painel: aba \"Termos de Bolsa\".";

  GmailApp.sendEmail(destinatarios.join(","), assunto, corpo);

  // Só marca depois de o e-mail ter saído.
  var agora = new Date().toISOString();
  for (var m = 0; m < aptos.length; m++) {
    supabase(t, "formacao?id=eq." + aptos[m].id, "patch",
      { aviso_apto_em: agora, updated_at: agora });
  }
  return { avisados: aptos.length, destinatarios: destinatarios };
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
  if (!ROBO_EMAIL || !ROBO_SENHA) {
    throw new Error("Falta a conta do robo. Preencha ROBO_EMAIL e ROBO_SENHA em " +
      "Configuracoes do projeto -> Propriedades do script. Sem ela as rotinas " +
      "automaticas nao conseguem gravar no Supabase (elas rodam sem ninguem logado).");
  }
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

## Atualizar o script depois (sem perder a configuração)

Quando este documento mudar, **não recole o código inteiro por reflexo**: o
bloco de configuração aqui é o modelo do repositório, com `PLANILHA_PONTE`,
`ROBO_EMAIL` e `ROBO_SENHA` **em branco de propósito** (esses valores nunca
entram no repositório). Colar por cima apaga o que você tinha, e a
sincronização passa a falhar com:

> Não foi possível sincronizar: Error: Preencha PLANILHA_PONTE no script.

### Como resolver agora

Abra o Apps Script e preencha o ID de novo. Duas formas:

- **Recomendada — Propriedades do script.** Engrenagem **Configurações do
  projeto** → **Propriedades do script** → *Adicionar propriedade*:
  `PLANILHA_PONTE` = o id da planilha-ponte (o trecho da URL entre `/d/` e
  `/edit`). Faça o mesmo com `ROBO_EMAIL` e `ROBO_SENHA` se usa a
  sincronização automática. O código lê as propriedades **antes** dos valores
  escritos nele, então a partir daí **recolar o código nunca mais apaga a sua
  configuração**.
- **Alternativa:** editar de novo as linhas `var PLANILHA_PONTE = ...` no
  código. Funciona, mas se perde na próxima atualização.

Depois, **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova
versão → Implantar**. Sem isso o Web App continua servindo o código antigo.

### Antes de colar, salve o que é seu

Se preferir continuar guardando tudo no código, copie estes valores para um
bloco de notas antes de colar e reponha depois:

`PLANILHA_PONTE` · `ABA_PONTE` · `ROBO_EMAIL` · `ROBO_SENHA` · `EMAIL_RECIBO`

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

## Passo 4 — Ligar as automações (sincronização e aviso ao financeiro)

Os passos 1 a 3 fazem o script **responder ao painel**: você clica, ele envia.
Isso não precisa de nada além do login de quem clicou.

As rotinas **automáticas** são outra história. Elas rodam no servidor do Google,
de tempos em tempos, **sem ninguém logado** — e mesmo assim precisam gravar no
Supabase (marcar o cadastro como realizado, anexar o link do termo, registrar
que o financeiro foi avisado). Para isso existe a **conta do robô**.

São duas automações, independentes entre si:

| Função | O que faz | Frequência |
| --- | --- | --- |
| `avisoAutomatico` | Avisa o financeiro de quem ficou **apto** (cadastro + treinamento feitos, sem termo) | de hora em hora |
| `sincronizacaoAutomatica` | Lê a planilha-ponte, marca cadastros e termos **e** manda o aviso ao final | de 6 em 6 horas |

Ligar as duas não duplica e-mail: cada pessoa entra em **um aviso só**.

### 4.1 — Criar a conta do robô (uma vez)

1. No **Supabase → Authentication → Users → Add user**: crie um usuário **só
   para isto**, por exemplo `robo@rbcip.org`, com uma senha longa e aleatória.
   Marque **Auto Confirm User**.
2. Dê a ele perfil de administrador, porque é ele quem vai gravar:

   ```sql
   insert into public.app_admins (email) values ('robo@rbcip.org');
   ```

> **Por que uma conta, e não a chave secreta.** A chave `service_role` ignora o
> RLS e só é revogável trocando a chave do projeto inteiro. O robô tem
> exatamente os poderes de um admin do painel — nem mais, nem menos — e as
> regras de RLS continuam valendo para ele. Se a senha vazar, basta apagar o
> usuário no Supabase.

### 4.2 — Guardar a senha no Apps Script

**Configurações do projeto** (a engrenagem) → **Propriedades do script** →
*Adicionar propriedade*, duas vezes:

| Propriedade | Valor |
| --- | --- |
| `ROBO_EMAIL` | `robo@rbcip.org` |
| `ROBO_SENHA` | a senha que você definiu |

Guardadas ali, elas **sobrevivem a qualquer atualização do código**. (Se
preferir, dá para escrevê-las nas linhas `var ROBO_EMAIL = ...`, mas aí se
perdem na próxima vez que o código for recolado.)

### 4.3 — Testar uma vez, à mão

No editor, escolha **`avisoAutomatico`** no seletor do topo e clique em
**Executar**.

- Na primeira vez o Google pede **autorização** — aceite. Se aparecer "app não
  verificado", clique em *Avançado → Acessar (nome do projeto)*.
- No **Registro de execução** (embaixo), veja se terminou sem erro.
- Se houver alguém apto e pelo menos um e-mail em `app_financeiro`, o aviso sai
  na hora. Se não houver, ele termina sem enviar nada — e isso é o certo.

> **Nada sai se a lista do financeiro estiver vazia.** Inclua ao menos um
> e-mail em `app_financeiro` (veja `sql/perfil-financeiro.sql`) antes de
> concluir que a automação não funciona.

### 4.4 — Instalar os gatilhos

Ainda no editor, execute **uma vez cada**:

- **`instalarGatilhoAviso`** → o aviso passa a sair de hora em hora.
- **`instalarGatilhoSincronizacao`** → a sincronização passa a rodar de 6 em 6
  horas (opcional, se você quer as planilhas atualizando sozinhas também).

Para desligar: `removerGatilhoAviso` e `removerGatilhoSincronizacao`.

### 4.5 — Conferir que está de pé

Três lugares, do mais rápido ao mais completo:

1. **No painel**, aba *Termos de Bolsa*: abaixo dos botões, o administrador vê
   `✓ Envio automático ligado` ou `⚠ Envio automático desligado`. É a
   confirmação de que o painel enxerga o gatilho. (Se disser "não foi possível
   conferir", republique o Web App: a checagem é uma ação nova do script.)
2. **No Apps Script**, ícone do **relógio** (Acionadores) na barra da esquerda:
   devem aparecer `avisoAutomatico` e, se você instalou, `sincronizacaoAutomatica`.
3. **No mesmo lugar**, aba *Execuções*: mostra cada rodada, com erro ou sucesso.

Se uma rodada automática falhar, o script manda um e-mail para `EMAIL_RECIBO`
com o motivo — rotina que falha calada é o pior cenário.

### Problemas comuns nesta etapa

| Mensagem | O que é |
| --- | --- |
| `Falta a conta do robo…` | `ROBO_EMAIL`/`ROBO_SENHA` em branco. Passo 4.2. |
| `Login do robo falhou: …` | E-mail ou senha errados, ou o usuário não foi confirmado no Supabase (marque *Auto Confirm User*). |
| `formacao -> 401` ou `403` | O robô existe, mas não está em `app_admins`. Passo 4.1, item 2. |
| Roda sem erro e nada chega | Não há ninguém apto, ou `app_financeiro` está vazia. |

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
