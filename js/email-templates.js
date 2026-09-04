/**
 * Corpos em HTML dos e-mails enviados pela aba Candidatos.
 *
 * Cada função devolve o HTML pronto. O painel manda esse HTML junto com a
 * versão em texto puro (js/dashboard.js), e o Apps Script envia os dois:
 * `GmailApp.sendEmail(para, assunto, texto, { htmlBody: html })`.
 *
 * **O texto puro não é redundância.** É ele que aparece em cliente sem HTML,
 * na prévia da caixa de entrada e para os filtros de spam — mensagem só-HTML
 * costuma cair em "Promoções". Ao mexer aqui, mexa também no texto lá.
 *
 * Regras de HTML para e-mail (não são as do site):
 *   - layout em <table>, nunca flexbox/grid;
 *   - CSS inline (`style="..."`), nunca arquivo separado ou <link>: o Gmail
 *     descarta folhas externas;
 *   - `border-radius` e `box-shadow` somem no Outlook do Windows (ele desenha
 *     com o motor do Word). Servem de enfeite; o e-mail tem de ler sem eles;
 *   - 600px de largura máxima;
 *   - imagem por URL pública — nunca `assets/...` relativo, que não existe do
 *     lado de quem recebe.
 *
 * O e-mail de aviso ao financeiro NÃO está aqui: ele é montado dentro do
 * próprio Apps Script (a rotina automática roda sem o painel aberto). O
 * esqueleto lá é gêmeo deste — mudou um, mude o outro.
 */
(function () {
  "use strict";

  var cfg = window.SUPABASE_CONFIG || {};

  // Nome e e-mail de candidato entram no meio do HTML. Sem escapar, um "&" no
  // nome quebra a marcação e um "<" abriria caminho para injetar tag.
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function logo() {
    return cfg.LOGO_EMAIL_URL || "";
  }

  /**
   * Esqueleto comum: cabeçalho com a logo, miolo e rodapé.
   * `previa` é o trecho que o Gmail mostra ao lado do assunto na lista de
   * mensagens. Sem ele, a prévia vira o começo do rodapé ou um pedaço solto.
   */
  function moldura(titulo, previa, miolo) {
    var ano = new Date().getFullYear();
    var src = logo();
    return '<!DOCTYPE html>\n' +
      '<html lang="pt-BR">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      // Pede aos clientes para não inverterem as cores no modo escuro: o
      // cabeçalho é branco e a logo, azul-marinho — invertido, some.
      '<meta name="color-scheme" content="light">\n' +
      '<meta name="supported-color-schemes" content="light">\n' +
      "<title>" + esc(titulo) + "</title>\n</head>\n" +
      '<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: \'Helvetica Neue\', Helvetica, Arial, sans-serif; color: #333333;">\n' +
      // Prévia da caixa de entrada: invisível no corpo da mensagem.
      '<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">' + esc(previa) + "</div>\n" +
      '  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f6f8; padding: 30px 10px;">\n' +
      "    <tr>\n      <td align=\"center\">\n" +
      '        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 600px; width: 100%;">\n' +
      "          <tr>\n" +
      '            <td style="background-color: #ffffff; padding: 30px 25px; text-align: center; border-bottom: 4px solid #004B87;">\n' +
      (src
        ? '              <img src="' + esc(src) + '" alt="RBCIP - Pesquisa e Inovação" width="180" style="max-width: 180px; height: auto; border: 0; display: inline-block;">\n'
        // Sem LOGO_EMAIL_URL configurada, o texto ocupa o lugar da imagem. É
        // melhor do que o retângulo de imagem quebrada que o Gmail desenha.
        : '              <span style="font-size: 22px; font-weight: bold; color: #004B87; letter-spacing: 1px;">RBCIP</span><br><span style="font-size: 12px; color: #64748b;">pesquisa e inovação</span>\n') +
      "            </td>\n          </tr>\n" +
      "          <tr>\n" +
      '            <td style="padding: 40px 30px; font-size: 15px; line-height: 1.6; color: #444444;">\n' +
      miolo + "\n" +
      "            </td>\n          </tr>\n" +
      "          <tr>\n" +
      '            <td style="background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #eeeeee;">\n' +
      "              &copy; " + ano + " RBCIP. Todos os direitos reservados.<br>\n" +
      "              Este é um e-mail automático, mas fique à vontade para responder se tiver dúvidas.\n" +
      "            </td>\n          </tr>\n" +
      "        </table>\n      </td>\n    </tr>\n  </table>\n</body>\n</html>";
  }

  function botao(href, texto, cor) {
    return '<a href="' + esc(href) + '" style="display: inline-block; padding: 14px 28px; ' +
      "background-color: " + cor + '; color: #ffffff; text-decoration: none; border-radius: 5px; ' +
      'font-weight: bold; font-size: 15px;">' + esc(texto) + "</a>";
  }

  // ---------- 1. Convite para entrevista ----------
  function convocacaoEntrevista(links) {
    var botoes = (links || []).map(function (l, i) {
      return '  <a href="' + esc(l) + '" style="display: inline-block; margin: 5px; padding: 12px 20px; ' +
        'background-color: #004B87; color: #ffffff; text-decoration: none; border-radius: 4px; ' +
        'font-weight: bold; font-size: 14px;">Agenda Opção ' + (i + 1) + "</a>";
    }).join("\n");

    var miolo =
      '<h3 style="margin-top: 0; color: #004B87; font-size: 18px;">Convite para Entrevista - Processo Seletivo</h3>\n' +
      "<p>Prezado(a) candidato(a),</p>\n" +
      "<p>Espero que este e-mail o(a) encontre bem.</p>\n" +
      "<p>Estamos iniciando nosso processo seletivo para oportunidades em São Paulo e região, e gostaríamos de convidá-lo(a) para uma entrevista, conforme seu interesse e inscrição na plataforma SIPE.</p>\n" +
      "<p>Para darmos continuidade, por favor, escolha o horário de sua preferência acessando <strong>apenas um</strong> dos links abaixo:</p>\n" +
      '<div style="text-align: center; margin: 30px 0;">\n' + botoes + "\n</div>\n" +
      '<div style="background-color: #f1f5f9; padding: 15px; border-left: 4px solid #94a3b8; border-radius: 4px; font-size: 14px; margin-bottom: 25px;">\n' +
      "  <strong>Dica:</strong> A ordem dos links não interfere na ordem em que as entrevistas serão realizadas. Agende sua entrevista no que melhor se adequar aos seus horários.\n" +
      "</div>\n" +
      "<p>Caso tenha alguma dúvida ou ocorra algum imprevisto, fique à vontade para responder a este e-mail.</p>\n" +
      '<p style="margin-bottom: 0;">Atenciosamente,<br><strong>Equipe de Recrutamento RBCIP</strong></p>';

    return moldura(
      "Convite para Entrevista - Processo Seletivo RBCIP",
      "Escolha o horário da sua entrevista em um dos links de agendamento.",
      miolo
    );
  }

  // ---------- 2. Convocação para o cadastro de bolsista ----------
  function convocacaoCadastro(primeiroNome, linkFormulario) {
    var miolo =
      '<h3 style="margin-top: 0; color: #004B87; font-size: 18px;">Aprovação na Entrevista e Cadastro de Bolsista</h3>\n' +
      "<p>Olá, <strong>" + esc(primeiroNome) + "</strong>!</p>\n" +
      "<p>Sou o Lucas, da RBCIP. Tenho uma ótima notícia: você foi <strong>aprovado(a)</strong> em nossa entrevista.</p>\n" +
      "<p>Solicitamos que preencha o cadastro de bolsista clicando no botão abaixo para que possamos prosseguir com o seu termo de bolsa. Após o preenchimento, agendaremos um treinamento online para você participar e, após a conclusão dele, poderá iniciar as atividades.</p>\n" +
      '<div style="text-align: center; margin: 35px 0;">\n  ' +
      botao(linkFormulario, "Preencher Cadastro de Bolsista", "#28a745") + "\n</div>\n" +
      '<div style="background-color: #fff3cd; color: #856404; padding: 15px; border-radius: 5px; border-left: 5px solid #ffeeba; margin-bottom: 25px; font-size: 14px;">\n' +
      "  <strong>&#9888;&#65039; Ação Necessária:</strong> É obrigatório o envio dos seus <strong>antecedentes criminais</strong> nas esferas Estadual e Federal para o e-mail " +
      '<a href="mailto:rh@rbcip.org" style="color: #856404; font-weight: bold;">rh@rbcip.org</a>. ' +
      "O seu termo de bolsa só poderá ser gerado após o recebimento do cadastro e dos antecedentes.\n</div>\n" +
      "<p><strong>Coordenador do Projeto:</strong> Marcelo Fiche</p>\n" +
      '<p style="margin-bottom: 0;">Atenciosamente,<br><strong>Lucas</strong><br>Equipe RBCIP</p>';

    return moldura(
      "Cadastro de Bolsista - Processo Seletivo RBCIP",
      "Você foi aprovado(a) na entrevista. Preencha o cadastro de bolsista para seguirmos.",
      miolo
    );
  }

  // ---------- 3. Inscrição no projeto da região certa ----------
  function cadastroRegiao(primeiroNome, projetoCerto, projetoErrado, linkPlataforma) {
    var miolo =
      '<h3 style="margin-top: 0; color: #004B87; font-size: 18px;">Ajuste de Inscrição - Processo Seletivo</h3>\n' +
      "<p>Olá, <strong>" + esc(primeiroNome) + "</strong>!</p>\n" +
      "<p>Sou o Lucas, da RBCIP. Obrigado pela sua participação em nossa entrevista.</p>\n" +
      "<p>Na entrevista, foi registrado o seu interesse em atuar no projeto <strong>" + esc(projetoCerto) +
      "</strong>. Como a sua inscrição na plataforma foi feita no projeto <strong>" + esc(projetoErrado) +
      "</strong>, e cada projeto tem a sua própria inscrição, precisamos que você se inscreva no projeto correto para seguirmos com as próximas etapas:</p>\n" +
      '<div style="text-align: center; margin: 35px 0;">\n  ' +
      botao(linkPlataforma, "Inscrever-se no " + projetoCerto, "#f59e0b") + "\n</div>\n" +
      '<p style="font-size: 14px; background-color: #f9fafb; padding: 15px; border-radius: 5px; color: #555;">\n' +
      "  <em><strong>Nota:</strong> É o mesmo formulário que você já preencheu, apenas no link do projeto correto. " +
      "<strong>Não é necessário fazer uma nova entrevista</strong>: assim que a inscrição for concluída, damos sequência ao seu processo.</em>\n</p>\n" +
      "<p>Caso tenha alguma dúvida, fique à vontade para responder a este e-mail.</p>\n" +
      '<p style="margin-bottom: 0;">Atenciosamente,<br><strong>Lucas</strong><br>Equipe RBCIP</p>';

    return moldura(
      "Inscrição no projeto correto - Processo Seletivo RBCIP",
      "Sua inscrição precisa ser refeita no projeto " + projetoCerto + ". Não é preciso nova entrevista.",
      miolo
    );
  }

  window.EMAIL_HTML = {
    convocacaoEntrevista: convocacaoEntrevista,
    convocacaoCadastro: convocacaoCadastro,
    cadastroRegiao: cadastroRegiao,
  };
})();
