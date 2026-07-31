/**
 * Dashboard de entrevistas — RBCIP.
 * Login via Supabase Auth; abas Capital / Interior (tabelas) e Visualização de dados.
 * Depende de: config.js, forms-schema.js e do SDK do Supabase.
 */
(function () {
  "use strict";

  // ---------- Utilidades ----------
  function $(s, c) { return (c || document).querySelector(s); }
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(f); });
    return n;
  }
  function mostrar(elm, sim) { elm.classList.toggle("oculto", !sim); }

  function formatarDataHora(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function formatarData(valor) {
    if (!valor) return "—";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : valor;
  }
  function statusTexto(r) {
    if (r.nao_compareceu) return "Faltante";
    if (r.nao_cumpre_requisitos) return "Não cumpre requisitos";
    return "Avaliado";
  }
  function statusClasse(r) {
    if (r.nao_compareceu) return "tag tag--cinza";
    if (r.nao_cumpre_requisitos) return "tag tag--vermelho";
    return "tag tag--verde";
  }
  function pontuacaoTexto(r) {
    if (r.pontuacao_total === null || r.pontuacao_total === undefined) return "—";
    return r.pontuacao_total + (r.pontuacao_maxima ? " / " + r.pontuacao_maxima : "");
  }

  // ---------- Estado ----------
  var cfg = window.SUPABASE_CONFIG || {};
  var client = null;
  var linhas = [];
  var ordenacao = { capital: { col: "pontuacao", asc: false }, interior: { col: "pontuacao", asc: false } };
  var busca = { capital: "", interior: "" };

  // ---------- Colunas da tabela ----------
  var COLUNAS = [
    { chave: "candidato", titulo: "Candidato", valor: function (r) { return r.candidato || "—"; } },
    { chave: "data", titulo: "Data", valor: function (r) { return formatarData(r.data_entrevista); }, ord: function (r) { return r.data_entrevista || ""; } },
    { chave: "entrevistador", titulo: "Entrevistador", valor: function (r) { return r.entrevistador || "—"; } },
    { chave: "pontuacao", titulo: "Pontuação", num: true, valor: pontuacaoTexto, ord: function (r) { return r.pontuacao_total == null ? -1 : r.pontuacao_total; } },
    { chave: "recomendacao", titulo: "Recomendação", valor: function (r) { return r.recomendacao || "—"; } },
    { chave: "status", titulo: "Status", valor: statusTexto, ord: statusTexto, tag: true },
    { chave: "registro", titulo: "Registrado em", valor: function (r) { return formatarDataHora(r.created_at); }, ord: function (r) { return r.created_at || ""; } },
  ];

  // ---------- Geografia (mapa de regiões) ----------
  // Coordenadas (lon, lat) da cidade-polo de cada região. As chaves precisam
  // ser idênticas aos valores do droplist "Região" do formulário do Interior.
  // curto = nome exibido ao lado da bolha; dir = direção do rótulo [dx, dy];
  // gap = distância extra além do raio da bolha (afasta o texto; gap grande usa linha-guia).
  var REGIOES = {
    "Itapeva (região)": { lon: -48.87, lat: -23.98, curto: "Itapeva", dir: [1, 0], gap: 6 },
    "Marília (região)": { lon: -49.95, lat: -22.21, curto: "Marília", dir: [-1, 0], gap: 6 },
    "Campinas (região)": { lon: -47.06, lat: -22.90, curto: "Campinas", dir: [1, 0], gap: 10 },
    "Sorocaba (região)": { lon: -47.46, lat: -23.50, curto: "Sorocaba", dir: [0, 1], gap: 22 },
    "Ribeirão Preto (região)": { lon: -47.81, lat: -21.17, curto: "Ribeirão Preto", dir: [1, 0], gap: 6 },
    "Piracicaba (região)": { lon: -47.65, lat: -22.72, curto: "Piracicaba", dir: [-1, -0.15], gap: 40 },
    "São José dos Campos / Vale do Paraíba": { lon: -45.88, lat: -23.18, curto: "S.J. Campos / Vale", dir: [1, 0], gap: 8 },
    "Franca (região)": { lon: -47.40, lat: -20.54, curto: "Franca", dir: [1, 0], gap: 6 },
    "Bauru (região)": { lon: -49.06, lat: -22.31, curto: "Bauru", dir: [0, -1], gap: 16 },
    "Americana (região)": { lon: -47.33, lat: -22.74, curto: "Americana", dir: [0, -1], gap: 40 },
    "Baixada Santista (Santos / Praia Grande / Guarujá)": { lon: -46.33, lat: -23.96, curto: "Baixada Santista", dir: [1, 0], gap: 8 },
    "Presidente Prudente (região)": { lon: -51.39, lat: -22.13, curto: "Pres. Prudente", dir: [1, 0], gap: 6 },
    "Araçatuba (região)": { lon: -50.43, lat: -21.21, curto: "Araçatuba", dir: [1, 0], gap: 6 },
    "São José do Rio Preto (região)": { lon: -49.38, lat: -20.82, curto: "S.J. Rio Preto", dir: [1, 0], gap: 6 },
  };

  // Contorno aproximado do estado de São Paulo (lon, lat), só para dar contexto.
  var CONTORNO_SP = [
    [-51.0, -20.0], [-49.0, -20.2], [-47.2, -20.3], [-46.3, -21.2], [-45.0, -22.0],
    [-44.2, -22.4], [-44.9, -23.0], [-45.9, -23.8], [-46.4, -24.0], [-47.9, -24.7],
    [-48.5, -25.2], [-49.4, -24.4], [-50.4, -24.0], [-51.8, -22.9], [-52.9, -22.5],
    [-53.1, -21.5], [-52.0, -20.6],
  ];

  var MAPA = { W: 760, H: 444, m: 18, lonMin: -53.1, lonMax: -44.2, latMin: -25.2, latMax: -20.0 };
  function projetar(lon, lat) {
    return {
      x: MAPA.m + ((lon - MAPA.lonMin) / (MAPA.lonMax - MAPA.lonMin)) * (MAPA.W - 2 * MAPA.m),
      y: MAPA.m + ((MAPA.latMax - lat) / (MAPA.latMax - MAPA.latMin)) * (MAPA.H - 2 * MAPA.m),
    };
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  // ---------- Autenticação ----------
  function iniciarCliente() {
    if (!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)) return false;
    if (!window.supabase) return false;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return true;
  }

  function mostrarLogin(msg) {
    mostrar($("#dashboard"), false);
    mostrar($("#login"), true);
    if (msg) { var e = $("#login-erro"); e.textContent = msg; mostrar(e, true); }
  }

  function entrarDashboard(session) {
    mostrar($("#login"), false);
    mostrar($("#dashboard"), true);
    $("#usuario-email").textContent = (session && session.user && session.user.email) || "";
    carregarDados();
  }

  function configurarLogin() {
    $("#login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("#login-btn");
      var erro = $("#login-erro");
      mostrar(erro, false);
      btn.disabled = true;
      btn.textContent = "Entrando…";
      client.auth
        .signInWithPassword({ email: $("#email").value.trim(), password: $("#senha").value })
        .then(function (resp) {
          btn.disabled = false;
          btn.textContent = "Entrar";
          if (resp.error) {
            erro.textContent = "E-mail ou senha inválidos.";
            mostrar(erro, true);
            return;
          }
          entrarDashboard(resp.data.session);
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Entrar";
          erro.textContent = "Erro ao entrar: " + (err.message || err);
          mostrar(erro, true);
        });
    });

    $("#btn-sair").addEventListener("click", function () {
      client.auth.signOut().then(function () {
        linhas = [];
        mostrarLogin();
      });
    });
    $("#btn-atualizar").addEventListener("click", carregarDados);
  }

  // ---------- Carregar dados ----------
  function carregarDados() {
    var carregando = $("#carregando");
    var erro = $("#dash-erro");
    mostrar(erro, false);
    mostrar(carregando, true);
    client
      .from(cfg.TABELA || "entrevistas")
      .select("*")
      .order("pontuacao_total", { ascending: false, nullsFirst: false })
      .then(function (resp) {
        mostrar(carregando, false);
        if (resp.error) {
          erro.textContent = "Não foi possível carregar os dados: " + (resp.error.message || resp.error);
          mostrar(erro, true);
          return;
        }
        linhas = resp.data || [];
        renderTudo();
      });
  }

  // ---------- Render das tabelas ----------
  function linhasDoTipo(tipo) {
    var termo = busca[tipo].toLowerCase();
    var lista = linhas.filter(function (r) { return r.tipo === tipo; });
    if (termo) {
      lista = lista.filter(function (r) {
        return ((r.candidato || "") + " " + (r.entrevistador || "")).toLowerCase().indexOf(termo) !== -1;
      });
    }
    var o = ordenacao[tipo];
    var col = COLUNAS.filter(function (c) { return c.chave === o.col; })[0] || COLUNAS[3];
    var fn = col.ord || col.valor;
    lista.sort(function (a, b) {
      var va = fn(a), vb = fn(b);
      if (va < vb) return o.asc ? -1 : 1;
      if (va > vb) return o.asc ? 1 : -1;
      return 0;
    });
    return lista;
  }

  function renderPainelTabela(tipo) {
    var painel = $("#painel-" + tipo);
    painel.innerHTML = "";

    var barra = el("div", { class: "painel__barra" });
    var inputBusca = el("input", { class: "painel__busca", type: "search", placeholder: "Buscar por candidato ou entrevistador…" });
    inputBusca.value = busca[tipo];
    inputBusca.addEventListener("input", function () { busca[tipo] = inputBusca.value; renderTabela(tipo); });
    barra.appendChild(inputBusca);
    painel.appendChild(barra);

    painel.appendChild(el("div", { class: "tabela-wrap", id: "tabela-" + tipo }));
    renderTabela(tipo);
  }

  function renderTabela(tipo) {
    var wrap = $("#tabela-" + tipo);
    wrap.innerHTML = "";
    var lista = linhasDoTipo(tipo);

    if (lista.length === 0) {
      wrap.appendChild(el("p", { class: "vazio", text: "Nenhuma entrevista encontrada." }));
      return;
    }

    var o = ordenacao[tipo];
    var tabela = el("table", { class: "tabela" });
    var thead = el("thead");
    var trh = el("tr");
    COLUNAS.forEach(function (c) {
      var seta = o.col === c.chave ? (o.asc ? " ▲" : " ▼") : "";
      var th = el("th", { class: "tabela__th" + (c.num ? " tabela__th--num" : ""), text: c.titulo + seta });
      th.addEventListener("click", function () {
        if (o.col === c.chave) o.asc = !o.asc;
        else { o.col = c.chave; o.asc = false; }
        renderTabela(tipo);
      });
      trh.appendChild(th);
    });
    trh.appendChild(el("th", { class: "tabela__th", text: "" }));
    thead.appendChild(trh);
    tabela.appendChild(thead);

    var tbody = el("tbody");
    lista.forEach(function (r) {
      var tr = el("tr", { class: "tabela__tr" });
      COLUNAS.forEach(function (c) {
        var td = el("td", { class: "tabela__td" + (c.num ? " tabela__td--num" : "") });
        if (c.tag) {
          td.appendChild(el("span", { class: statusClasse(r), text: c.valor(r) }));
        } else {
          td.textContent = c.valor(r);
        }
        tr.appendChild(td);
      });
      var tdAcao = el("td", { class: "tabela__td" });
      var btn = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Detalhes" });
      btn.addEventListener("click", function () { abrirModal(r); });
      tdAcao.appendChild(btn);
      tr.appendChild(tdAcao);
      tbody.appendChild(tr);
    });
    tabela.appendChild(tbody);
    wrap.appendChild(tabela);
  }

  // ---------- Modal de detalhes ----------
  function mapaPerguntas(tipo) {
    var schema = window.FORMULARIOS && window.FORMULARIOS[tipo];
    var ordem = [];
    if (!schema) return ordem;
    schema.secoes.forEach(function (s) {
      s.perguntas.forEach(function (p) {
        if (p.id) ordem.push({ id: p.id, label: p.label, secao: s.titulo || "" });
      });
    });
    return ordem;
  }

  function abrirModal(r) {
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: r.candidato || "(sem nome)" }));

    var meta = el("p", { class: "modal__meta" });
    meta.textContent =
      (r.tipo === "capital" ? "Capital" : "Interior") +
      " · " + (r.entrevistador || "—") +
      " · " + formatarData(r.data_entrevista) +
      " · Pontuação: " + pontuacaoTexto(r);
    alvo.appendChild(meta);
    alvo.appendChild(el("span", { class: statusClasse(r) + " modal__status", text: statusTexto(r) }));

    var resp = r.respostas || {};
    var ordem = mapaPerguntas(r.tipo);
    var secaoAtual = null;
    var lista = el("dl", { class: "detalhe" });
    ordem.forEach(function (p) {
      var v = resp[p.id];
      if (v === undefined || v === "" || v === false) return; // pula vazios
      if (p.secao && p.secao !== secaoAtual) {
        secaoAtual = p.secao;
        lista.appendChild(el("dt", { class: "detalhe__secao", text: p.secao }));
      }
      lista.appendChild(el("dt", { class: "detalhe__pergunta", text: p.label }));
      lista.appendChild(el("dd", { class: "detalhe__resposta", text: v === true ? "Sim" : String(v) }));
    });
    alvo.appendChild(lista);

    mostrar($("#modal"), true);
  }

  function configurarModal() {
    $("#modal-fechar").addEventListener("click", fecharModal);
    $("#modal-fundo").addEventListener("click", fecharModal);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") fecharModal(); });
  }
  function fecharModal() { mostrar($("#modal"), false); }

  // ---------- Abas ----------
  function configurarAbas() {
    Array.prototype.forEach.call(document.querySelectorAll(".aba"), function (aba) {
      aba.addEventListener("click", function () {
        Array.prototype.forEach.call(document.querySelectorAll(".aba"), function (a) { a.classList.remove("aba--ativa"); });
        aba.classList.add("aba--ativa");
        var alvo = aba.getAttribute("data-aba");
        mostrar($("#painel-capital"), alvo === "capital");
        mostrar($("#painel-interior"), alvo === "interior");
        mostrar($("#painel-dados"), alvo === "dados");
      });
    });
  }

  // ---------- Visualização de dados ----------
  var vizTipo = "todos";

  function filtrarViz() {
    if (vizTipo === "todos") return linhas.slice();
    return linhas.filter(function (r) { return r.tipo === vizTipo; });
  }

  function statCard(rotulo, valor) {
    return el("div", { class: "stat" }, [
      el("div", { class: "stat__valor", text: String(valor) }),
      el("div", { class: "stat__rotulo", text: rotulo }),
    ]);
  }

  function graficoBarras(titulo, dados) {
    var max = dados.reduce(function (m, d) { return Math.max(m, d.valor); }, 0) || 1;
    var card = el("div", { class: "grafico" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: titulo }));
    if (dados.length === 0 || dados.every(function (d) { return d.valor === 0; })) {
      card.appendChild(el("p", { class: "vazio", text: "Sem dados." }));
      return card;
    }
    dados.forEach(function (d) {
      var linha = el("div", { class: "barra" });
      linha.appendChild(el("span", { class: "barra__rotulo", text: d.label }));
      var trilho = el("div", { class: "barra__trilho" });
      var preench = el("div", { class: "barra__preench" });
      preench.style.width = Math.round((d.valor / max) * 100) + "%";
      trilho.appendChild(preench);
      linha.appendChild(trilho);
      linha.appendChild(el("span", { class: "barra__valor", text: String(d.valor) }));
      card.appendChild(linha);
    });
    return card;
  }

  // Calcula a posição do rótulo a partir da direção (dir) e da distância (raio + gap).
  function posRotulo(px, py, r, dir, gap) {
    var ux = dir[0], uy = dir[1];
    var mag = Math.hypot(ux, uy) || 1;
    ux /= mag; uy /= mag;
    var d = r + (gap || 6);
    var lx = px + ux * d, ly = py + uy * d;
    var anchor = ux > 0.35 ? "start" : ux < -0.35 ? "end" : "middle";
    var baseline = uy > 0.35 ? "hanging" : uy < -0.35 ? "auto" : "central";
    return {
      x: lx, y: ly, anchor: anchor, baseline: baseline,
      guia: (gap || 6) >= 16,
      // origem/destino da linha-guia (da borda da bolha até junto do texto)
      x1: px + ux * r, y1: py + uy * r, x2: px + ux * (d - 3), y2: py + uy * (d - 3),
    };
  }

  function svgBandeiraSP() {
    var f = svgEl("svg", { viewBox: "0 0 60 40", class: "mapa__bandeira-svg" });
    var h = 40 / 13;
    for (var i = 0; i < 13; i++) {
      f.appendChild(svgEl("rect", { x: 0, y: (i * h).toFixed(3), width: 60, height: (h + 0.4).toFixed(3), fill: i % 2 === 0 ? "#ffffff" : "#000000" }));
    }
    f.appendChild(svgEl("rect", { x: 0, y: 0, width: 24, height: 15, fill: "#0039a6" }));
    f.appendChild(svgEl("circle", { cx: 12, cy: 7.5, r: 5.2, fill: "#ffffff" }));
    f.appendChild(svgEl("polygon", {
      points: "12.2,4.6 13.4,5.2 13.8,6.5 13.3,7.7 13.7,8.7 13.0,9.9 12.1,10.6 11.3,9.7 10.8,8.4 11.0,7.0 10.6,5.8 11.4,5.0",
      fill: "#c1121f",
    }));
    return f;
  }

  // Usa a imagem assets/bandeira-sp.png; se não existir, cai para o desenho SVG.
  function bandeiraSP() {
    var wrap = el("div", { class: "mapa__bandeira", title: "Estado de São Paulo" });
    var img = el("img", { class: "mapa__bandeira-img", src: "assets/bandeira-sp.png", alt: "Bandeira do Estado de São Paulo" });
    img.addEventListener("error", function () {
      wrap.innerHTML = "";
      wrap.appendChild(svgBandeiraSP());
    });
    wrap.appendChild(img);
    return wrap;
  }

  function renderMapa(contagem) {
    var card = el("div", { class: "grafico mapa" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: "Inscritos por região (mapa)" }));
    card.appendChild(bandeiraSP());

    var maxN = 0;
    Object.keys(REGIOES).forEach(function (nome) { maxN = Math.max(maxN, contagem[nome] || 0); });

    var svg = svgEl("svg", { viewBox: "0 0 " + MAPA.W + " " + MAPA.H, class: "mapa__svg" });

    var pts = CONTORNO_SP.map(function (c) { var p = projetar(c[0], c[1]); return p.x + "," + p.y; }).join(" ");
    svg.appendChild(svgEl("polygon", { points: pts, class: "mapa__uf" }));

    Object.keys(REGIOES).forEach(function (nome) {
      var c = REGIOES[nome];
      var p = projetar(c.lon, c.lat);
      var n = contagem[nome] || 0;
      var r = n > 0 ? 8 + (n / (maxN || 1)) * 18 : 4;
      var g = svgEl("g", {});
      var circ = svgEl("circle", { cx: p.x, cy: p.y, r: r, class: n > 0 ? "mapa__bola" : "mapa__bola--vazia" });
      var titulo = svgEl("title", {});
      titulo.textContent = nome + " — " + n + " inscrito" + (n === 1 ? "" : "s");
      circ.appendChild(titulo);
      g.appendChild(circ);

      // Rótulo com o nome da região (com linha-guia quando afastado)
      var rot = posRotulo(p.x, p.y, r, c.dir, c.gap);
      if (rot.guia) {
        g.appendChild(svgEl("line", { x1: rot.x1, y1: rot.y1, x2: rot.x2, y2: rot.y2, class: "mapa__guia" }));
      }
      var lab = svgEl("text", {
        x: rot.x, y: rot.y,
        class: n > 0 ? "mapa__label" : "mapa__label--vazio",
        "text-anchor": rot.anchor,
        "dominant-baseline": rot.baseline,
      });
      lab.textContent = c.curto;
      g.appendChild(lab);

      if (n > 0) {
        var t = svgEl("text", { x: p.x, y: p.y, class: "mapa__num", "text-anchor": "middle", "dominant-baseline": "central" });
        t.textContent = String(n);
        g.appendChild(t);
      }
      svg.appendChild(g);
    });

    card.appendChild(svg);
    var totalRegioes = Object.keys(contagem).reduce(function (s, k) { return s + contagem[k]; }, 0);
    card.appendChild(el("p", {
      class: "mapa__legenda",
      text: totalRegioes === 0
        ? "Nenhum inscrito com região informada ainda."
        : "Passe o mouse sobre cada ponto para ver a região. O tamanho da bolha indica o número de inscritos.",
    }));
    return card;
  }

  function contarPor(lista, fn) {
    var mapa = {};
    lista.forEach(function (r) {
      var k = fn(r);
      if (k == null || k === "") return;
      mapa[k] = (mapa[k] || 0) + 1;
    });
    return mapa;
  }

  function renderDados() {
    var painel = $("#painel-dados");
    painel.innerHTML = "";

    // Filtro por tipo
    var barra = el("div", { class: "painel__barra" });
    barra.appendChild(el("span", { class: "viz-filtro__rotulo", text: "Região:" }));
    ["todos", "capital", "interior"].forEach(function (t) {
      var b = el("button", {
        class: "viz-filtro" + (vizTipo === t ? " viz-filtro--ativo" : ""),
        type: "button",
        text: t === "todos" ? "Todas" : t === "capital" ? "Capital" : "Interior",
      });
      b.addEventListener("click", function () { vizTipo = t; renderDados(); });
      barra.appendChild(b);
    });
    painel.appendChild(barra);

    var lista = filtrarViz();
    var avaliados = lista.filter(function (r) { return !r.nao_compareceu && !r.nao_cumpre_requisitos; });
    var comNota = avaliados.filter(function (r) { return r.pontuacao_total != null; });
    var media = comNota.length
      ? Math.round((comNota.reduce(function (s, r) { return s + r.pontuacao_total; }, 0) / comNota.length) * 10) / 10
      : "—";

    // KPIs
    var stats = el("div", { class: "stats" }, [
      statCard("Entrevistas", lista.length),
      statCard("Avaliados", avaliados.length),
      statCard("Faltantes", lista.filter(function (r) { return r.nao_compareceu; }).length),
      statCard("Não cumprem requisitos", lista.filter(function (r) { return r.nao_cumpre_requisitos; }).length),
      statCard("Pontuação média", media),
    ]);
    painel.appendChild(stats);

    // Contagem por região (formulário do Interior) + mapa
    var contRegiao = contarPor(lista, function (r) { return r.respostas && r.respostas.regiao_atuacao; });
    painel.appendChild(renderMapa(contRegiao));

    var grid = el("div", { class: "graficos" });

    // Inscritos por região (barras) — ordenado do maior para o menor
    var regioesOrdenadas = Object.keys(REGIOES)
      .map(function (nome) { return { label: nome.replace(/ \(região\)$/, ""), valor: contRegiao[nome] || 0 }; })
      .filter(function (d) { return d.valor > 0; })
      .sort(function (a, b) { return b.valor - a.valor; });
    if (regioesOrdenadas.length) {
      grid.appendChild(graficoBarras("Inscritos por região", regioesOrdenadas));
    }

    // Recomendações
    var ordemRec = ["Aprovado - Forte Recomendação", "Aprovado - Recomendação", "Aprovado - Recomendação com Ressalvas", "Reprovado"];
    var contRec = contarPor(lista, function (r) { return r.recomendacao; });
    grid.appendChild(graficoBarras("Recomendação final", ordemRec.map(function (k) {
      return { label: k.replace("Aprovado - ", "Aprov.: "), valor: contRec[k] || 0 };
    })));

    // Por entrevistador
    var contEnt = contarPor(lista, function (r) { return r.entrevistador; });
    grid.appendChild(graficoBarras("Entrevistas por entrevistador", Object.keys(contEnt).sort().map(function (k) {
      return { label: k, valor: contEnt[k] };
    })));

    // Por região (só faz sentido em "Todas")
    if (vizTipo === "todos") {
      grid.appendChild(graficoBarras("Entrevistas por região", [
        { label: "Capital", valor: linhas.filter(function (r) { return r.tipo === "capital"; }).length },
        { label: "Interior", valor: linhas.filter(function (r) { return r.tipo === "interior"; }).length },
      ]));
    }

    painel.appendChild(grid);
  }

  // ---------- Render geral ----------
  function renderTudo() {
    $("#cont-capital").textContent = linhas.filter(function (r) { return r.tipo === "capital"; }).length;
    $("#cont-interior").textContent = linhas.filter(function (r) { return r.tipo === "interior"; }).length;
    renderPainelTabela("capital");
    renderPainelTabela("interior");
    renderDados();
  }

  // ---------- Início ----------
  function init() {
    configurarAbas();
    configurarModal();

    if (!iniciarCliente()) {
      mostrarLogin(
        "Configuração do Supabase ausente ou SDK não carregado. Verifique js/config.js e a conexão."
      );
      return;
    }
    configurarLogin();

    client.auth.getSession().then(function (resp) {
      var session = resp.data && resp.data.session;
      if (session) entrarDashboard(session);
      else mostrarLogin();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
