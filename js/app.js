/**
 * Renderizador dos formulários + validação + envio ao Supabase.
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

  // ---------- Estado do Supabase ----------
  var cfg = window.SUPABASE_CONFIG || {};
  var supabaseConfigurado = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  var supabaseClient = null;
  if (supabaseConfigurado && window.supabase) {
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  // ---------- Renderização de perguntas ----------
  function renderCampo(p) {
    // Campo dentro de um wrapper .pergunta, exceto títulos de bloco.
    if (p.tipo === "titulo-bloco") {
      var bloco = el("div", { class: "pergunta" });
      bloco.appendChild(el("h3", { class: "pergunta__label", text: p.label }));
      if (p.ajuda) bloco.appendChild(el("p", { class: "pergunta__ajuda", text: p.ajuda }));
      return bloco;
    }

    var wrap = el("div", { class: "pergunta", "data-id": p.id });

    var label = el("label", { class: "pergunta__label", for: "campo_" + p.id });
    label.appendChild(document.createTextNode(p.label));
    if (p.obrigatorio) label.appendChild(el("span", { class: "pergunta__obrig", text: "*" }));
    wrap.appendChild(label);

    if (p.ajuda) {
      wrap.appendChild(el("p", { class: "pergunta__ajuda pergunta__ajuda--italico", text: p.ajuda }));
    }

    wrap.appendChild(renderControle(p));
    wrap.appendChild(el("div", { class: "pergunta__msg-erro", text: "Este campo é obrigatório." }));
    return wrap;
  }

  function renderControle(p) {
    switch (p.tipo) {
      case "texto":
        return el("input", { type: "text", id: "campo_" + p.id, name: p.id });
      case "data":
        return el("input", { type: "date", id: "campo_" + p.id, name: p.id });
      case "textarea":
        return el("textarea", { id: "campo_" + p.id, name: p.id, rows: "4" });
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

  function renderRadio(p) {
    var grupo = el("div", { class: "opcoes", id: "campo_" + p.id });
    p.opcoes.forEach(function (opt, i) {
      var input = el("input", { type: "radio", name: p.id, value: opt, id: p.id + "_" + i });
      var lab = el("label", { class: "opcao" }, [input, el("span", { text: opt })]);
      grupo.appendChild(lab);
    });
    return grupo;
  }

  function renderEscala(p) {
    var box = el("div", { class: "escala", id: "campo_" + p.id });
    box.appendChild(el("p", { class: "escala__legenda", text: LEGENDA_STAR }));
    var linha = el("div", { class: "escala__linha" });
    linha.appendChild(el("span", { class: "escala__extremo", text: "Não" }));

    var pontos = el("div", { class: "escala__pontos" });
    for (var n = 1; n <= 5; n++) {
      var input = el("input", { type: "radio", name: p.id, value: String(n), id: p.id + "_" + n });
      var ponto = el("label", { class: "escala__ponto" }, [
        el("span", { text: String(n) }),
        input,
      ]);
      pontos.appendChild(ponto);
    }
    linha.appendChild(pontos);
    linha.appendChild(el("span", { class: "escala__extremo escala__extremo--dir", text: "Excelente/Exemplar" }));
    box.appendChild(linha);
    return box;
  }

  function renderFlag(p) {
    var input = el("input", { type: "checkbox", name: p.id, id: "campo_" + p.id, value: "sim" });
    return el("label", { class: "flag" }, [input, el("span", { text: p.textoFlag })]);
  }

  function renderSecao(secao) {
    var frag = el("section", { class: "secao" });
    var cab = el("div", { class: "secao__cabecalho" });
    cab.appendChild(el("h2", { class: "secao__titulo", text: secao.titulo }));
    if (secao.descricao) cab.appendChild(el("p", { class: "secao__descricao", text: secao.descricao }));
    frag.appendChild(cab);
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

  function todasPerguntas(schema) {
    var lista = [];
    schema.secoes.forEach(function (s) {
      s.perguntas.forEach(function (p) {
        if (p.id) lista.push(p);
      });
    });
    return lista;
  }

  // ---------- Validação ----------
  // Regras de saída antecipada:
  //  - "não compareceu": exige apenas identificação básica.
  //  - "não cumpre requisitos": exige identificação + elegibilidade (não os blocos de avaliação).
  function validar(form, schema) {
    var faltante = form.querySelector('[name="nao_compareceu"]').checked;
    var reprovado = form.querySelector('[name="nao_cumpre_requisitos"]').checked;

    limparErros(form);
    var invalidos = [];

    todasPerguntas(schema).forEach(function (p) {
      if (!p.obrigatorio) return;

      // Aplica as regras de saída antecipada.
      if (faltante && !ehIdentificacao(p)) return;
      if (reprovado && ehAvaliacao(p, schema)) return;

      var valor = lerValor(form, p);
      if (valor === "" || valor === null) {
        invalidos.push(p);
      }
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

  // Perguntas que pertencem à seção "Perfil Avaliador" (blocos de avaliação).
  function ehAvaliacao(p, schema) {
    var secaoAval = schema.secoes.filter(function (s) {
      return s.titulo === "Perfil Avaliador (Entrevistador)";
    })[0];
    if (!secaoAval) return false;
    return secaoAval.perguntas.indexOf(p) !== -1;
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

    return {
      tipo: schema.id,
      perfil: "Avaliador (Entrevistador)",
      candidato: respostas.nome_candidato || null,
      data_entrevista: respostas.data_entrevista || null,
      entrevistador: respostas.nome_entrevistador || null,
      nao_compareceu: Boolean(respostas.nao_compareceu),
      nao_cumpre_requisitos: Boolean(respostas.nao_cumpre_requisitos),
      recomendacao: respostas.recomendacao_final || null,
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
    // Modo de teste: guarda no navegador.
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
  function mostrarSucesso(container, schema, modo) {
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

  // ---------- Inicialização ----------
  function init() {
    var container = $("#app");
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

    // Formulário
    var form = el("form", { id: "form-entrevista", novalidate: "novalidate" });
    schema.secoes.forEach(function (s) {
      form.appendChild(renderSecao(s));
    });

    // Rodapé com botão
    var msgErro = el("div", { class: "banner banner--erro oculto", id: "erro-geral" });
    var botao = el("button", { class: "btn", type: "submit", text: "Enviar" });
    var rodape = el("div", { class: "form-rodape" }, [botao]);
    form.appendChild(msgErro);
    form.appendChild(rodape);
    container.appendChild(form);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var invalidos = validar(form, schema);
      var erroGeral = $("#erro-geral");

      if (invalidos.length > 0) {
        erroGeral.textContent = "Existem " + invalidos.length + " campo(s) obrigatório(s) não preenchido(s). Verifique os itens destacados.";
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
          mostrarSucesso(container, schema, resultado.modo);
        })
        .catch(function (err) {
          console.error(err);
          botao.disabled = false;
          botao.textContent = "Enviar";
          erroGeral.textContent = "Não foi possível enviar o formulário: " + (err.message || err) + ". Tente novamente.";
          erroGeral.classList.remove("oculto");
          erroGeral.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
