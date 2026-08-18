/**
 * Renderizador dos formulários + validação + pontuação + autosave + envio.
 * Depende de: config.js, forms-schema.js e (opcional) do SDK do Supabase.
 */
(function () {
  "use strict";

  // ---------- Utilidades ----------
  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }
  function el(tag, attrs, filhos) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (filhos || []).forEach(function (f) {
      if (f) node.appendChild(f);
    });
    return node;
  }
  function getParam(nome) {
    return new URLSearchParams(window.location.search).get(nome);
  }
  function hojeISO() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function escaparSeletor(valor) {
    if (window.CSS && CSS.escape) return CSS.escape(valor);
    return String(valor).replace(/["\\]/g, "\\$&");
  }

  // ---------- Estado do Supabase ----------
  var cfg = window.SUPABASE_CONFIG || {};
  var supabaseConfigurado = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  var supabaseClient = null;
  if (supabaseConfigurado && window.supabase) {
    // persistSession:false -> o formulário NÃO herda a sessão de login do dashboard.
    // Ele sempre envia como visitante (anon), que é o papel correto e não expira,
    // evitando o erro "JWT expired" quando alguém está logado no mesmo navegador.
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // ---------- Renderização de perguntas ----------
  function renderCampo(p) {
    if (p.tipo === "titulo-bloco") {
      var bloco = el("div", { class: "pergunta" });
      bloco.appendChild(el("h3", { class: "pergunta__label", text: p.label }));
      if (p.ajuda) bloco.appendChild(el("p", { class: "pergunta__ajuda", text: p.ajuda }));
      if (p.rubrica) bloco.appendChild(renderRubrica(p.rubrica));
      return bloco;
    }

    if (p.tipo === "info") return renderInfo(p);
    if (p.tipo === "alerta") return renderAlerta(p);

    var wrap = el("div", { class: "pergunta", "data-id": p.id });
    // Campo condicional começa escondido; é revelado por atualizarCondicionais().
    if (p.dependeDe) wrap.classList.add("oculto");

    var label = el("label", { class: "pergunta__label", for: "campo_" + p.id });
    label.appendChild(document.createTextNode(p.label));
    if (p.obrigatorio) label.appendChild(el("span", { class: "pergunta__obrig", text: "*" }));
    wrap.appendChild(label);

    if (p.ajuda) {
      wrap.appendChild(el("p", { class: "pergunta__ajuda pergunta__ajuda--italico", text: p.ajuda }));
    }

    wrap.appendChild(renderControle(p));
    if (p.aviso) wrap.appendChild(renderAvisoCondicional(p));
    wrap.appendChild(el("div", { class: "pergunta__msg-erro", text: "Este campo é obrigatório." }));
    return wrap;
  }

  // Aviso que aparece apenas quando a resposta bate com p.aviso.quando.
  function renderAvisoCondicional(p) {
    var box = el("div", { class: "aviso-cond oculto", id: "aviso_" + p.id });
    box.appendChild(el("p", { class: "aviso-cond__texto", text: p.aviso.texto }));
    if (p.aviso.link) {
      box.appendChild(
        el("a", {
          class: "aviso-cond__link",
          href: p.aviso.link,
          target: "_blank",
          rel: "noopener noreferrer",
          text: p.aviso.link,
        })
      );
    }
    return box;
  }

  function renderControle(p) {
    switch (p.tipo) {
      case "texto":
        return el("input", { type: "text", id: "campo_" + p.id, name: p.id });
      case "data":
        return el("input", { type: "date", id: "campo_" + p.id, name: p.id, max: hojeISO() });
      case "textarea":
        return el("textarea", { id: "campo_" + p.id, name: p.id, rows: "4" });
      case "select":
        return renderSelect(p);
      case "radio":
        return renderRadio(p);
      case "escala":
        return renderEscala(p);
      case "flag":
        return renderFlag(p);
      default:
        return el("div");
    }
  }

  function renderSelect(p) {
    var sel = el("select", { class: "campo-select", id: "campo_" + p.id, name: p.id });
    sel.appendChild(el("option", { value: "", text: "Selecione..." }));
    p.opcoes.forEach(function (opt) {
      sel.appendChild(el("option", { value: opt, text: opt }));
    });
    return sel;
  }

  function renderRadio(p) {
    var grupo = el("div", { class: "opcoes", id: "campo_" + p.id });
    p.opcoes.forEach(function (opt, i) {
      var input = el("input", { type: "radio", name: p.id, value: opt, id: p.id + "_" + i });
      var lab = el("label", { class: "opcao" }, [input, el("span", { text: opt })]);
      grupo.appendChild(lab);
    });
    return grupo;
  }

  function renderInfo(p) {
    var det = el("details", { class: "infobox" });
    var sum = el("summary", { class: "infobox__titulo" });
    sum.appendChild(el("span", { class: "infobox__icone", text: "i" }));
    sum.appendChild(el("span", { class: "infobox__rotulo", text: p.titulo }));
    det.appendChild(sum);

    var corpo = el("div", { class: "infobox__corpo" });
    (p.paragrafos || []).forEach(function (item) {
      if (typeof item === "string") {
        corpo.appendChild(el("p", { class: "infobox__p", text: item }));
      } else if (item.sub) {
        corpo.appendChild(el("p", { class: "infobox__sub", text: item.sub }));
      } else if (item.destaque) {
        corpo.appendChild(el("div", { class: "infobox__total", text: item.destaque }));
      }
    });
    det.appendChild(corpo);
    return det;
  }

  // Card de alerta destacado (vermelho), sempre visível — ex.: exigência da conta.
  function renderAlerta(p) {
    var box = el("div", { class: "alerta-card", role: "alert" });
    if (p.titulo) {
      box.appendChild(
        el("div", { class: "alerta-card__titulo" }, [
          el("span", { class: "alerta-card__icone", text: "!" }),
          el("span", { text: p.titulo }),
        ])
      );
    }
    (p.paragrafos || []).forEach(function (t) {
      box.appendChild(el("p", { class: "alerta-card__p", text: t }));
    });
    return box;
  }

  function renderRubrica(itens) {
    var ul = el("ul", { class: "rubrica" });
    itens.forEach(function (it) {
      ul.appendChild(
        el("li", { class: "rubrica__item" }, [
          el("span", { class: "rubrica__nota", text: it.nota }),
          el("span", { class: "rubrica__desc", text: it.desc }),
        ])
      );
    });
    return ul;
  }

  function renderEscala(p) {
    var box = el("div", { class: "escala", id: "campo_" + p.id });
    var linha = el("div", { class: "escala__linha" });
    linha.appendChild(el("span", { class: "escala__extremo", text: "Não se aplica" }));

    var pontos = el("div", { class: "escala__pontos" });
    for (var n = 1; n <= 5; n++) {
      var desc = typeof DESC_NOTA !== "undefined" ? DESC_NOTA[n] || "" : "";
      var input = el("input", { type: "radio", name: p.id, value: String(n), id: p.id + "_" + n, title: desc });
      var ponto = el("label", { class: "escala__ponto", title: desc }, [el("span", { text: String(n) }), input]);
      pontos.appendChild(ponto);
    }
    linha.appendChild(pontos);
    linha.appendChild(el("span", { class: "escala__extremo escala__extremo--dir", text: "Excelente" }));
    box.appendChild(linha);
    return box;
  }

  function renderFlag(p) {
    var input = el("input", { type: "checkbox", name: p.id, id: "campo_" + p.id, value: "sim" });
    return el("label", { class: "flag" }, [input, el("span", { text: p.textoFlag })]);
  }

  function renderSecao(secao) {
    var frag = el("section", { class: "secao", "data-chave": secao.chave || "" });
    if (secao.titulo) {
      var cab = el("div", { class: "secao__cabecalho" });
      cab.appendChild(el("h2", { class: "secao__titulo", text: secao.titulo }));
      if (secao.descricao) cab.appendChild(el("p", { class: "secao__descricao", text: secao.descricao }));
      frag.appendChild(cab);
    }
    secao.perguntas.forEach(function (p) {
      frag.appendChild(renderCampo(p));
    });
    return frag;
  }

  // ---------- Leitura das respostas ----------
  function lerValor(form, p) {
    if (p.tipo === "flag") {
      return form.querySelector('[name="' + p.id + '"]').checked;
    }
    if (p.tipo === "radio" || p.tipo === "escala") {
      var marcado = form.querySelector('[name="' + p.id + '"]:checked');
      return marcado ? marcado.value : "";
    }
    var campo = form.querySelector('[name="' + p.id + '"]');
    return campo ? campo.value.trim() : "";
  }

  function aplicarValor(form, p, val) {
    if (p.tipo === "flag") {
      var chk = form.querySelector('[name="' + p.id + '"]');
      if (chk) chk.checked = Boolean(val);
    } else if (p.tipo === "radio" || p.tipo === "escala") {
      if (val !== "" && val !== null && val !== undefined) {
        var input = form.querySelector('[name="' + p.id + '"][value="' + escaparSeletor(val) + '"]');
        if (input) input.checked = true;
      }
    } else {
      var campo = form.querySelector('[name="' + p.id + '"]');
      if (campo) campo.value = val;
    }
  }

  function todasPerguntas(schema) {
    var lista = [];
    schema.secoes.forEach(function (s) {
      s.perguntas.forEach(function (p) {
        if (p.id) lista.push(p);
      });
    });
    return lista;
  }

  // ---------- Pontuação ----------
  // Regras (o bloco de Elegibilidade NÃO pontua):
  //  - escala (STAR): soma o valor de 1 a 5;
  //  - radio de 2 opções (Adequado/Inadequado, Sim/Não): 1 ponto se marcar a 1ª opção.
  //  - radio de 4 opções (Recomendação Final) não pontua.
  function calcularPontuacao(schema, form) {
    var total = 0;
    var maximo = 0;
    schema.secoes.forEach(function (s) {
      if (s.chave === "elegibilidade") return;
      s.perguntas.forEach(function (p) {
        if (p.tipo === "escala") {
          maximo += 5;
          var v = lerValor(form, p);
          if (v) total += Number(v);
        } else if (p.tipo === "radio" && p.opcoes && p.opcoes.length === 2) {
          maximo += 1;
          var r = lerValor(form, p);
          if (r && r === p.opcoes[0]) total += 1;
        }
      });
    });
    return { total: total, maximo: maximo };
  }

  // Faixas de pontuação para orientar o entrevistador (fáceis de ajustar aqui).
  // "ate" = limite superior da faixa (inclusivo). Máximo atual: 36.
  var FAIXAS_PONTUACAO = [
    { ate: 20, texto: "Pontuação baixa — o candidato não atendeu às expectativas.", classe: "faixa--baixa" },
    { ate: 28, texto: "Pontuação mediana — o candidato atendeu parcialmente.", classe: "faixa--media" },
    { ate: 33, texto: "Pontuação boa — o candidato atende bem às expectativas.", classe: "faixa--boa" },
    { ate: Infinity, texto: "Pontuação excelente — o candidato se destacou.", classe: "faixa--otima" },
  ];
  function faixaPontuacao(total) {
    for (var i = 0; i < FAIXAS_PONTUACAO.length; i++) {
      if (total <= FAIXAS_PONTUACAO[i].ate) return FAIXAS_PONTUACAO[i];
    }
    return FAIXAS_PONTUACAO[FAIXAS_PONTUACAO.length - 1];
  }

  // ---------- Colapso conforme marcadores ----------
  function estaFaltante(form) {
    return form.querySelector('[name="nao_compareceu"]').checked;
  }
  function estaReprovado(form) {
    var c = form.querySelector('[name="nao_cumpre_requisitos"]');
    return c ? c.checked : false;
  }
  function toggleSecao(form, chave, mostrar) {
    var s = form.querySelector('.secao[data-chave="' + chave + '"]');
    if (s) s.classList.toggle("oculto", !mostrar);
  }
  function aplicarColapso(form) {
    var faltante = estaFaltante(form);
    var reprovado = estaReprovado(form);
    toggleSecao(form, "elegibilidade", !faltante);
    toggleSecao(form, "informativo", !(faltante || reprovado));
    toggleSecao(form, "avaliador", !(faltante || reprovado));
    toggleSecao(form, "fechamento", !(faltante || reprovado));
    var box = $("#score-box");
    if (box) box.classList.toggle("oculto", faltante || reprovado);
  }

  // Verdadeiro se a condição de exibição (p.dependeDe) está satisfeita.
  function condicaoAtendida(form, p) {
    if (!p.dependeDe) return true;
    var alvo = form.querySelector('[name="' + p.dependeDe.campo + '"]:checked');
    return !!(alvo && alvo.value === p.dependeDe.valor);
  }

  // Mostra/esconde avisos e campos condicionais conforme as respostas.
  function atualizarCondicionais(form, schema) {
    todasPerguntas(schema).forEach(function (p) {
      // Aviso estático (ex.: link do SIPE quando "Não").
      if (p.aviso) {
        var box = document.getElementById("aviso_" + p.id);
        if (box) {
          var marcado = form.querySelector('[name="' + p.id + '"]:checked');
          box.classList.toggle("oculto", !(marcado && marcado.value === p.aviso.quando));
        }
      }
      // Campo condicional (ex.: nome de quem indicou quando "Sim").
      if (p.dependeDe) {
        var wrap = form.querySelector('.pergunta[data-id="' + p.id + '"]');
        if (wrap) {
          var mostrar = condicaoAtendida(form, p);
          wrap.classList.toggle("oculto", !mostrar);
          if (!mostrar) {
            // Limpa o valor ao esconder, para não gravar dado obsoleto.
            var campo = form.querySelector('[name="' + p.id + '"]');
            if (campo && campo.value) campo.value = "";
          }
        }
      }
    });
  }

  // ---------- Autosave (rascunho) ----------
  function chaveRascunho(schema) {
    return "rascunho_" + schema.id;
  }
  function salvarRascunho(form, schema) {
    var dados = {};
    todasPerguntas(schema).forEach(function (p) {
      dados[p.id] = lerValor(form, p);
    });
    try {
      localStorage.setItem(chaveRascunho(schema), JSON.stringify({ dados: dados, ts: Date.now() }));
    } catch (e) {
      /* ignora limite de armazenamento */
    }
  }
  function limparRascunho(schema) {
    try {
      localStorage.removeItem(chaveRascunho(schema));
    } catch (e) {}
  }
  function restaurarRascunho(form, schema) {
    var raw;
    try {
      raw = localStorage.getItem(chaveRascunho(schema));
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return false;
    }
    var dados = obj.dados || {};
    var temAlgo = false;
    todasPerguntas(schema).forEach(function (p) {
      if (!(p.id in dados)) return;
      if (dados[p.id] !== "" && dados[p.id] !== false) temAlgo = true;
      aplicarValor(form, p, dados[p.id]);
    });
    return temAlgo;
  }

  // ---------- Validação ----------
  function validar(form, schema) {
    var faltante = estaFaltante(form);
    var reprovado = estaReprovado(form);

    limparErros(form);
    var invalidos = [];

    todasPerguntas(schema).forEach(function (p) {
      if (!p.obrigatorio) return;
      if (faltante && !ehIdentificacao(p)) return;
      if (reprovado && ehAvaliacao(p, schema)) return;
      if (p.dependeDe && !condicaoAtendida(form, p)) return; // campo escondido não é exigido

      var valor = lerValor(form, p);
      if (valor === "" || valor === null) invalidos.push(p);
    });

    invalidos.forEach(function (p) {
      var wrap = form.querySelector('.pergunta[data-id="' + p.id + '"]');
      if (wrap) wrap.classList.add("pergunta--erro");
    });

    return invalidos;
  }

  function ehIdentificacao(p) {
    return ["nome_candidato", "data_entrevista", "nome_entrevistador"].indexOf(p.id) !== -1;
  }
  function ehAvaliacao(p, schema) {
    var secaoAval = schema.secoes.filter(function (s) {
      return s.chave === "avaliador";
    })[0];
    return secaoAval ? secaoAval.perguntas.indexOf(p) !== -1 : false;
  }
  function limparErros(form) {
    Array.prototype.forEach.call(form.querySelectorAll(".pergunta--erro"), function (n) {
      n.classList.remove("pergunta--erro");
    });
  }

  // ---------- Montagem do registro ----------
  function montarRegistro(form, schema) {
    var respostas = {};
    todasPerguntas(schema).forEach(function (p) {
      respostas[p.id] = lerValor(form, p);
    });
    // Identificador do candidato (o e-mail dele), vindo do link ?cid=... .
    // Serve para o painel casar esta entrevista com a ficha do candidato, sem
    // depender do nome digitado. É invisível para o entrevistador e opcional
    // (se o link não trouxer, cai no casamento por nome).
    var cid = getParam("cid");
    if (cid && cid.trim()) respostas.cid = cid.trim();
    // Candidato faltante ou reprovado não é pontuado (fora do ranking).
    var avaliado = !respostas.nao_compareceu && !respostas.nao_cumpre_requisitos;
    var pont = calcularPontuacao(schema, form);

    return {
      tipo: schema.id,
      perfil: "Avaliador (Entrevistador)",
      candidato: respostas.nome_candidato || null,
      data_entrevista: respostas.data_entrevista || null,
      entrevistador: respostas.nome_entrevistador || null,
      nao_compareceu: Boolean(respostas.nao_compareceu),
      nao_cumpre_requisitos: Boolean(respostas.nao_cumpre_requisitos),
      recomendacao: respostas.recomendacao_final || null,
      pontuacao_total: avaliado ? pont.total : null,
      pontuacao_maxima: avaliado ? pont.maximo : null,
      respostas: respostas,
    };
  }

  // ---------- Envio ----------
  function enviar(registro) {
    if (supabaseClient) {
      return supabaseClient
        .from(cfg.TABELA || "entrevistas")
        .insert(registro)
        .then(function (resp) {
          if (resp.error) throw resp.error;
          return { modo: "supabase" };
        });
    }
    return new Promise(function (resolve) {
      var chave = "entrevistas_teste";
      var atual = JSON.parse(localStorage.getItem(chave) || "[]");
      registro.id = "local_" + Date.now();
      registro.created_at = new Date().toISOString();
      atual.push(registro);
      localStorage.setItem(chave, JSON.stringify(atual));
      resolve({ modo: "local" });
    });
  }

  // ---------- Tela de sucesso ----------
  function mostrarSucesso(container, modo) {
    var acoes = el("div", { class: "sucesso__acoes" });
    var novo = el("button", { class: "btn", type: "button", text: "Registrar outra entrevista" });
    novo.addEventListener("click", function () {
      window.location.reload();
    });
    var inicio = el("a", { class: "btn btn--secundario", href: "index.html", text: "Voltar ao início" });
    acoes.appendChild(novo);
    acoes.appendChild(inicio);

    var texto =
      modo === "local"
        ? "Resposta salva localmente (modo de teste). Configure o Supabase em js/config.js para gravar no banco de dados."
        : "A entrevista foi registrada com sucesso.";

    var painel = el("div", { class: "sucesso" }, [
      el("div", { class: "sucesso__icone", text: "✓" }),
      el("h1", { class: "sucesso__titulo", text: "Formulário enviado!" }),
      el("p", { class: "sucesso__texto", text: texto }),
      acoes,
    ]);

    container.innerHTML = "";
    container.appendChild(painel);
    window.scrollTo(0, 0);
  }

  var SITE_URL = "https://entrevistas-sp-rbcip.vercel.app/";

  // ---------- Inicialização ----------
  function init() {
    var container = $("#app");

    // Proteção: se a página foi aberta como ARQUIVO salvo no computador
    // (protocolo file:), ela não funciona — orienta a usar o site.
    if (location.protocol === "file:") {
      container.innerHTML = "";
      var aviso = el("div", { class: "banner banner--erro" });
      aviso.innerHTML =
        "⚠️ <strong>Esta é uma cópia salva no computador e não funciona.</strong><br><br>" +
        "As respostas preenchidas aqui <strong>não são registradas</strong>. " +
        "Use sempre o site oficial:<br><br>" +
        '<a href="' + SITE_URL + '" style="font-size:17px;font-weight:700">' + SITE_URL + "</a><br><br>" +
        "Dica: abra o link acima e salve nos <strong>Favoritos</strong> do navegador. " +
        "Se houver um arquivo deste formulário na sua Área de Trabalho, pode apagá-lo.";
      container.appendChild(aviso);
      return;
    }

    var tipo = (getParam("tipo") || "").toLowerCase();
    var schema = window.FORMULARIOS[tipo];

    if (!schema) {
      container.appendChild(
        el("div", { class: "banner banner--erro", text: "Formulário não encontrado. Volte à página inicial e selecione uma opção." })
      );
      container.appendChild(el("a", { class: "btn btn--secundario", href: "index.html", text: "Voltar ao início" }));
      return;
    }

    document.title = schema.regiao + " — Entrevista RBCIP";

    // Cabeçalho
    var header = el("div", { class: "form-header" });
    header.appendChild(el("a", { class: "form-header__voltar", href: "index.html", text: "← Voltar ao início" }));
    header.appendChild(el("h1", { class: "form-header__titulo", text: schema.titulo }));
    header.appendChild(el("p", { class: "form-header__sub", text: schema.subtitulo }));
    header.appendChild(el("p", { class: "form-header__obrigatorio", text: "* Indica uma pergunta obrigatória" }));
    container.appendChild(header);

    // Banner de rascunho (preenchido depois, se houver)
    var bannerRascunho = el("div", { class: "banner banner--aviso oculto", id: "banner-rascunho" });
    container.appendChild(bannerRascunho);

    // Aviso de modo de teste
    if (!supabaseConfigurado) {
      container.appendChild(
        el("div", {
          class: "banner banner--aviso",
          text:
            "Modo de teste: o Supabase ainda não foi configurado. As respostas serão salvas apenas neste navegador. " +
            "Preencha js/config.js para conectar ao banco de dados.",
        })
      );
    }

    var enviado = false; // vira true após envio bem-sucedido
    var formSujo = false; // vira true quando algo é preenchido

    // Formulário
    var form = el("form", { id: "form-entrevista", novalidate: "novalidate" });
    // TRAVA PERMANENTE: impede o envio nativo do HTML (que recarregaria a página
    // em branco e perderia as respostas), mesmo que algo mais falhe na inicialização.
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    schema.secoes.forEach(function (s) {
      form.appendChild(renderSecao(s));
    });

    // Caixa de pontuação (com aviso por faixa), inserida ANTES da Recomendação Final
    // para o entrevistador se guiar pela nota ao recomendar.
    var ICONE_SCORE =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4.5"></circle>' +
      '<circle cx="12" cy="12" r="0.6" fill="currentColor"></circle></svg>';
    var scoreBox = el("div", { class: "score-box", id: "score-box" }, [
      el("div", { class: "score-box__cabecalho" }, [
        el("span", { class: "score-box__icone", html: ICONE_SCORE }),
        el("span", { class: "score-box__rotulo", text: "Pontuação do candidato" }),
        el("span", { class: "score-box__num" }, [
          el("strong", { class: "score-box__valor", id: "score-valor", text: "0" }),
          el("span", { class: "score-box__max", id: "score-max", text: " / 0" }),
        ]),
      ]),
      el("div", { class: "score-box__barra" }, [
        el("div", { class: "score-box__preenchido", id: "score-barra" }),
      ]),
      el("div", { class: "score-box__aviso", id: "score-aviso" }),
    ]);
    // A Recomendação Final (Bloco 4) sai da seção do Avaliador para um cartão
    // próprio, com a caixa de pontuação logo acima — assim cada bloco fica
    // sendo um cartão independente (cantos arredondados + sombra).
    var alvoRec = form.querySelector('.pergunta[data-id="recomendacao_final"]');
    if (alvoRec && alvoRec.parentNode) {
      var secaoOrigem = alvoRec.parentNode;
      var fechamento = el("section", { class: "secao secao--fechamento", "data-chave": "fechamento" });
      var mover = [];
      // título "Bloco 4: Fechamento" (irmão anterior sem data-id), se houver
      var prev = alvoRec.previousElementSibling;
      if (prev && prev.classList.contains("pergunta") && !prev.getAttribute("data-id")) {
        mover.push(prev);
      }
      // recomendação + tudo que vier depois dela na seção
      for (var cur = alvoRec; cur; cur = cur.nextElementSibling) mover.push(cur);
      mover.forEach(function (n) { fechamento.appendChild(n); });
      // insere logo após a seção de origem: [seção avaliador][score][fechamento]
      secaoOrigem.parentNode.insertBefore(scoreBox, secaoOrigem.nextSibling);
      scoreBox.parentNode.insertBefore(fechamento, scoreBox.nextSibling);
    } else {
      form.appendChild(scoreBox); // reserva
    }

    // Rodapé: botão + erro geral
    var msgErro = el("div", { class: "banner banner--erro oculto", id: "erro-geral" });
    var botao = el("button", { class: "btn", type: "submit", text: "Enviar" });
    var rodape = el("div", { class: "form-rodape" }, [botao]);

    form.appendChild(msgErro);
    form.appendChild(rodape);
    container.appendChild(form);

    // ----- Valores iniciais -----
    // 1) data pré-preenchida com hoje
    var campoData = form.querySelector('[name="data_entrevista"]');
    if (campoData && !campoData.value) campoData.value = hojeISO();

    // 2) restaura rascunho, se houver (protegido: nunca deve abortar a inicialização)
    var temRascunho = false;
    try {
      temRascunho = restaurarRascunho(form, schema);
    } catch (e) {
      console.error("Falha ao restaurar rascunho:", e);
    }
    if (temRascunho) {
      bannerRascunho.textContent = "Rascunho recuperado automaticamente. ";
      var descartar = el("button", { type: "button", class: "link-descartar", text: "Descartar rascunho" });
      descartar.addEventListener("click", function () {
        limparRascunho(schema);
        window.location.reload();
      });
      bannerRascunho.appendChild(descartar);
      bannerRascunho.classList.remove("oculto");
    }

    // ----- Estado dinâmico -----
    function atualizarScore() {
      var r = calcularPontuacao(schema, form);
      var v = $("#score-valor");
      var m = $("#score-max");
      if (v) v.textContent = String(r.total);
      if (m) m.textContent = " / " + r.maximo;

      var caixa = $("#score-box");
      var barra = $("#score-barra");
      var aviso = $("#score-aviso");
      var pct = r.maximo > 0 ? Math.max(0, Math.min(100, (r.total / r.maximo) * 100)) : 0;
      if (barra) barra.style.width = pct + "%";
      // Ajusta só as classes de faixa (preserva "oculto" e demais classes da caixa).
      if (caixa) caixa.classList.remove("faixa--baixa", "faixa--media", "faixa--boa", "faixa--otima");
      if (r.total <= 0) {
        if (aviso) {
          aviso.textContent = "A pontuação aparece aqui conforme você preenche as avaliações.";
          aviso.className = "score-box__aviso score-box__aviso--neutro";
        }
      } else {
        var f = faixaPontuacao(r.total);
        if (caixa) caixa.classList.add(f.classe);
        if (aviso) {
          aviso.textContent = f.texto;
          aviso.className = "score-box__aviso";
        }
      }
    }

    function aoAlterar() {
      formSujo = true;
      aplicarColapso(form);
      atualizarCondicionais(form, schema);
      atualizarScore();
      salvarRascunho(form, schema);
    }
    form.addEventListener("input", aoAlterar);
    form.addEventListener("change", aoAlterar);

    // Avisa antes de sair/recarregar com respostas ainda não enviadas.
    window.addEventListener("beforeunload", function (e) {
      if (formSujo && !enviado) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    aplicarColapso(form);
    atualizarCondicionais(form, schema);
    atualizarScore();

    // ----- Envio -----
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var invalidos = validar(form, schema);
      var erroGeral = $("#erro-geral");

      if (invalidos.length > 0) {
        erroGeral.textContent =
          "Existem " + invalidos.length + " campo(s) obrigatório(s) não preenchido(s). Verifique os itens destacados.";
        erroGeral.classList.remove("oculto");
        var primeiro = form.querySelector(".pergunta--erro");
        if (primeiro) primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      erroGeral.classList.add("oculto");

      botao.disabled = true;
      botao.textContent = "Enviando...";

      enviar(montarRegistro(form, schema))
        .then(function (resultado) {
          enviado = true;
          limparRascunho(schema);
          mostrarSucesso(container, resultado.modo);
        })
        .catch(function (err) {
          console.error(err);
          botao.disabled = false;
          botao.textContent = "Enviar";
          erroGeral.textContent =
            "Não foi possível enviar o formulário: " + (err.message || err) + ". Tente novamente.";
          erroGeral.classList.remove("oculto");
          erroGeral.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      init();
    } catch (e) {
      console.error("Erro ao inicializar o formulário:", e);
      var container = $("#app");
      if (container) {
        container.appendChild(
          el("div", {
            class: "banner banner--erro",
            text: "Ocorreu um erro ao carregar o formulário. Recarregue a página (Ctrl+Shift+R). Se persistir, avise o suporte.",
          })
        );
      }
    }
  });
})();
