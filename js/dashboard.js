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
  // Recomendação: rótulo curto, cor (tons de verde para aprovados; vermelho para reprovado)
  // e rank para ordenação (do melhor ao pior).
  var REC_RANK = {
    "Aprovado - Forte Recomendação": 4,
    "Aprovado - Recomendação": 3,
    "Aprovado - Recomendação com Ressalvas": 2,
    "Reprovado": 1,
  };
  function recomendacaoCurta(v) {
    if (!v) return "—";
    if (v.indexOf("Forte") !== -1) return "Forte recomendação";
    if (v.indexOf("Ressalvas") !== -1) return "Com ressalvas";
    if (v === "Reprovado") return "Reprovado";
    if (v.indexOf("Aprovado") !== -1) return "Recomendação";
    return v;
  }
  function recomendacaoClasse(r) {
    var v = r.recomendacao;
    if (!v) return "";
    if (v === "Reprovado") return "tag tag--vermelho";
    if (v.indexOf("Forte") !== -1) return "tag tag--verde-forte";
    if (v.indexOf("Ressalvas") !== -1) return "tag tag--verde-claro";
    if (v.indexOf("Aprovado") !== -1) return "tag tag--verde";
    return "";
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
    {
      chave: "recomendacao", titulo: "Recomendação",
      valor: function (r) { return recomendacaoCurta(r.recomendacao); },
      tituloCel: function (r) { return r.recomendacao || ""; },
      ord: function (r) { return REC_RANK[r.recomendacao] || 0; },
      tag: true, tagClasse: recomendacaoClasse,
    },
    { chave: "status", titulo: "Status", valor: statusTexto, ord: statusTexto, tag: true, tagClasse: statusClasse },
    { chave: "registro", titulo: "Registrado em", valor: function (r) { return formatarDataHora(r.created_at); }, ord: function (r) { return r.created_at || ""; } },
  ];

  // ---------- Exportação (CSV / XLSX) ----------
  // IDs já cobertos por colunas fixas ou pelo Status (evita duplicar).
  var SKIP_EXPORT = ["nome_candidato", "data_entrevista", "nome_entrevistador", "nao_compareceu", "nao_cumpre_requisitos", "recomendacao_final"];

  function colunasExport(tipo) {
    var cols = [
      { h: "Candidato", g: function (r) { return r.candidato || ""; } },
      { h: "Data da entrevista", g: function (r) { return formatarData(r.data_entrevista); } },
      { h: "Entrevistador", g: function (r) { return r.entrevistador || ""; } },
      { h: "Pontuação", g: function (r) { return r.pontuacao_total == null ? "" : r.pontuacao_total; } },
      { h: "Pontuação máxima", g: function (r) { return r.pontuacao_maxima == null ? "" : r.pontuacao_maxima; } },
      { h: "Recomendação", g: function (r) { return r.recomendacao || ""; } },
      { h: "Status", g: function (r) { return statusTexto(r); } },
      { h: "Registrado em", g: function (r) { return formatarDataHora(r.created_at); } },
    ];
    var schema = window.FORMULARIOS && window.FORMULARIOS[tipo];
    if (schema) {
      schema.secoes.forEach(function (s) {
        s.perguntas.forEach(function (p) {
          if (!p.id || SKIP_EXPORT.indexOf(p.id) !== -1) return;
          cols.push({
            h: p.label,
            g: function (r) {
              var v = r.respostas ? r.respostas[p.id] : "";
              if (v === true) return "Sim";
              if (v === false) return "Não";
              return v == null ? "" : v;
            },
          });
        });
      });
    }
    return cols;
  }

  function montarAOA(tipo) {
    var cols = colunasExport(tipo);
    var lista = linhas.filter(function (r) { return r.tipo === tipo; }).sort(function (a, b) {
      var pa = a.pontuacao_total == null ? -1 : a.pontuacao_total;
      var pb = b.pontuacao_total == null ? -1 : b.pontuacao_total;
      return pb - pa;
    });
    var aoa = [cols.map(function (c) { return c.h; })];
    lista.forEach(function (r) { aoa.push(cols.map(function (c) { return c.g(r); })); });
    return aoa;
  }

  function nomeArquivo(tipo, ext) {
    var d = new Date();
    var iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return "entrevistas-" + tipo + "-" + iso + "." + ext;
  }

  // ---------- Geografia (mapa de regiões) ----------
  // Coordenadas (lon, lat) da cidade-polo de cada região. As chaves precisam
  // ser idênticas aos valores do droplist "Região" do formulário do Interior.
  // curto = nome exibido ao lado da bolha; dir = direção do rótulo [dx, dy];
  // gap = distância extra além do raio da bolha (afasta o texto; gap grande usa linha-guia).
  var REGIOES = {
    "Itapeva (região)": { lon: -48.87, lat: -23.98, curto: "Itapeva", dir: [1, 0], gap: 6 },
    "Marília (região)": { lon: -49.95, lat: -22.21, curto: "Marília", dir: [1, 0], gap: 6 },
    "Campinas (região)": { lon: -47.06, lat: -22.90, curto: "Campinas", dir: [1, 0], gap: 10 },
    "Sorocaba (região)": { lon: -47.46, lat: -23.50, curto: "Sorocaba", dir: [0, 1], gap: 22 },
    "Ribeirão Preto (região)": { lon: -47.81, lat: -21.17, curto: "Ribeirão Preto", dir: [1, 0], gap: 6 },
    "Piracicaba (região)": { lon: -47.65, lat: -22.72, curto: "Piracicaba", dir: [-1, -0.15], gap: 40 },
    "São José dos Campos / Vale do Paraíba": { lon: -45.88, lat: -23.18, curto: "S.J. Campos / Vale", dir: [1, 0], gap: 8 },
    "Franca (região)": { lon: -47.40, lat: -20.54, curto: "Franca", dir: [1, 0], gap: 6 },
    "Bauru (região)": { lon: -49.06, lat: -22.31, curto: "Bauru", dir: [0, -1], gap: 16 },
    "Americana (região)": { lon: -47.33, lat: -22.74, curto: "Americana", dir: [0, -1], gap: 40 },
    "Baixada Santista (Santos / Praia Grande / Guarujá)": { lon: -46.33, lat: -23.96, curto: "Baixada Santista", dir: [1, 0], gap: 8 },
    "Presidente Prudente (região)": { lon: -51.39, lat: -22.13, curto: "Pres. Prudente", dir: [-1, 0], gap: 6 },
    "Araçatuba (região)": { lon: -50.43, lat: -21.21, curto: "Araçatuba", dir: [1, 0], gap: 6 },
    "São José do Rio Preto (região)": { lon: -49.38, lat: -20.82, curto: "S.J. Rio Preto", dir: [1, 0], gap: 6 },
  };

  // Ponto da Capital (cidade de São Paulo) — candidatos do formulário Capital.
  var CAPITAL = { lon: -46.63, lat: -23.55, curto: "Capital", dir: [0, -1], gap: 10 };

  // Contorno aproximado do estado de São Paulo (lon, lat), só para dar contexto.
  // Contorno real do Estado de São Paulo (lon, lat), simplificado (fonte: IBGE via
  // geodata-br-states). Projetado junto com os pontos para alinhamento perfeito.
  var CONTORNO_SP = [
    [-50.470, -19.780], [-50.346, -19.868], [-50.016, -19.927], [-49.261, -19.964], [-49.309, -20.104], [-49.246, -20.283],
    [-49.173, -20.313], [-49.067, -20.155], [-49.001, -20.161], [-48.971, -20.390], [-48.899, -20.442], [-48.826, -20.162],
    [-48.255, -20.144], [-48.238, -20.029], [-48.106, -20.147], [-47.976, -20.036], [-47.896, -20.126], [-47.854, -19.990],
    [-47.709, -19.979], [-47.635, -20.050], [-47.469, -19.962], [-47.257, -20.167], [-47.293, -20.448], [-47.153, -20.521],
    [-47.097, -20.645], [-47.240, -20.886], [-47.148, -20.973], [-47.012, -21.423], [-46.666, -21.362], [-46.510, -21.470],
    [-46.519, -21.613], [-46.691, -21.837], [-46.613, -22.007], [-46.724, -22.077], [-46.599, -22.137], [-46.724, -22.307],
    [-46.662, -22.419], [-46.407, -22.540], [-46.394, -22.663], [-46.479, -22.699], [-46.335, -22.761], [-46.357, -22.901],
    [-46.145, -22.858], [-46.140, -22.923], [-45.912, -22.817], [-45.889, -22.876], [-45.790, -22.859], [-45.714, -22.757],
    [-45.818, -22.711], [-45.694, -22.652], [-45.717, -22.578], [-45.661, -22.579], [-45.667, -22.652], [-45.474, -22.589],
    [-45.398, -22.654], [-44.808, -22.405], [-44.641, -22.609], [-44.509, -22.641], [-44.384, -22.574], [-44.162, -22.679],
    [-44.273, -22.832], [-44.495, -22.846], [-44.792, -22.982], [-44.890, -23.227], [-44.726, -23.371], [-44.909, -23.335],
    [-45.060, -23.423], [-45.015, -23.464], [-45.081, -23.524], [-45.167, -23.495], [-45.210, -23.584], [-45.409, -23.625],
    [-45.424, -23.830], [-45.923, -23.771], [-46.123, -23.839], [-46.183, -23.992], [-46.283, -24.044], [-46.379, -23.970],
    [-46.400, -24.034], [-46.824, -24.206], [-46.995, -24.325], [-47.009, -24.414], [-47.794, -24.932], [-47.910, -25.054],
    [-47.909, -25.168], [-48.098, -25.310], [-48.027, -25.221], [-48.186, -25.207], [-48.156, -25.144], [-48.250, -24.978],
    [-48.324, -25.054], [-48.411, -24.980], [-48.513, -25.091], [-48.583, -25.052], [-48.500, -24.739], [-48.583, -24.671],
    [-49.306, -24.674], [-49.316, -24.556], [-49.202, -24.343], [-49.611, -23.852], [-49.550, -23.705], [-49.630, -23.512],
    [-49.567, -23.427], [-49.679, -23.166], [-49.912, -23.052], [-49.987, -22.898], [-50.238, -22.955], [-50.662, -22.896],
    [-50.737, -22.964], [-50.889, -22.797], [-51.150, -22.756], [-51.266, -22.668], [-51.719, -22.670], [-52.110, -22.517],
    [-52.223, -22.676], [-52.251, -22.616], [-52.503, -22.635], [-52.585, -22.566], [-52.702, -22.628], [-52.925, -22.566],
    [-53.106, -22.622], [-52.377, -22.107], [-52.054, -21.673], [-52.096, -21.542], [-51.968, -21.502], [-51.866, -21.349],
    [-51.876, -21.136], [-51.624, -20.944], [-51.594, -20.644], [-51.351, -20.363], [-51.118, -20.287], [-50.966, -20.034],
    [-50.470, -19.780],
  ];

  // Projeção equirretangular com correção de longitude por cos(lat) — mantém as
  // proporções reais do estado (nem achatado, nem esticado).
  var MAPA = { W: 820, m: 16, lonMin: -53.106, lonMax: -44.162, latMin: -25.31, latMax: -19.78 };
  MAPA.cosLat = Math.cos(((MAPA.latMin + MAPA.latMax) / 2) * Math.PI / 180);
  MAPA.scale = (MAPA.W - 2 * MAPA.m) / ((MAPA.lonMax - MAPA.lonMin) * MAPA.cosLat);
  MAPA.H = 2 * MAPA.m + (MAPA.latMax - MAPA.latMin) * MAPA.scale;
  function projetar(lon, lat) {
    return {
      x: MAPA.m + (lon - MAPA.lonMin) * MAPA.cosLat * MAPA.scale,
      y: MAPA.m + (MAPA.latMax - lat) * MAPA.scale,
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
  function buscarEntrevistas() {
    return client
      .from(cfg.TABELA || "entrevistas")
      .select("*")
      .order("pontuacao_total", { ascending: false, nullsFirst: false });
  }

  // Reconhece erros de sessão expirada (JWT) para tratar sem assustar o usuário.
  function ehErroSessao(err) {
    if (!err) return false;
    var m = String(err.message || err.msg || "").toLowerCase();
    return m.indexOf("jwt") !== -1 || m.indexOf("expired") !== -1 ||
      err.code === "PGRST301" || err.status === 401;
  }

  function carregarDados() {
    var carregando = $("#carregando");
    var erro = $("#dash-erro");
    mostrar(erro, false);
    mostrar(carregando, true);

    function aplicar(resp) {
      mostrar(carregando, false);
      if (resp.error) {
        erro.textContent = "Não foi possível carregar os dados: " + (resp.error.message || resp.error);
        mostrar(erro, true);
        return;
      }
      linhas = resp.data || [];
      renderTudo();
    }

    buscarEntrevistas().then(function (resp) {
      if (resp.error && ehErroSessao(resp.error)) {
        // Sessão expirou: tenta renovar em silêncio e refazer a busca.
        client.auth.refreshSession().then(function (r) {
          if (r.error || !r.data || !r.data.session) {
            // Não deu para renovar: volta ao login com mensagem amigável.
            mostrar(carregando, false);
            linhas = [];
            mostrarLogin("Sua sessão expirou por segurança. Entre novamente para continuar.");
            return;
          }
          buscarEntrevistas().then(aplicar);
        });
        return;
      }
      aplicar(resp);
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

    var acoes = el("div", { class: "painel__acoes" });
    var bCsv = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Baixar CSV" });
    bCsv.addEventListener("click", function () {
      window.Exportador.csv(nomeArquivo(tipo, "csv"), montarAOA(tipo));
    });
    var bXlsx = el("button", { class: "btn btn--pequeno", type: "button", text: "Baixar Excel" });
    bXlsx.addEventListener("click", function () {
      window.Exportador.xlsx(nomeArquivo(tipo, "xlsx"), tipo === "capital" ? "Capital" : "Interior", montarAOA(tipo));
    });
    acoes.appendChild(bCsv);
    acoes.appendChild(bXlsx);
    barra.appendChild(acoes);
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
        var cls = c.tag && c.tagClasse ? c.tagClasse(r) : "";
        if (cls) {
          var span = el("span", { class: cls, text: c.valor(r) });
          if (c.tituloCel) { var t = c.tituloCel(r); if (t) span.setAttribute("title", t); }
          td.appendChild(span);
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
  var vizDe = "";
  var vizAte = "";
  var vizRegiao = "";

  function filtrarViz() {
    var lista = linhas.slice();
    if (vizTipo !== "todos") lista = lista.filter(function (r) { return r.tipo === vizTipo; });
    if (vizDe) lista = lista.filter(function (r) { return r.data_entrevista && r.data_entrevista >= vizDe; });
    if (vizAte) lista = lista.filter(function (r) { return r.data_entrevista && r.data_entrevista <= vizAte; });
    if (vizRegiao) lista = lista.filter(function (r) { return r.respostas && r.respostas.regiao_atuacao === vizRegiao; });
    return lista;
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
      linha.appendChild(el("span", { class: "barra__rotulo", text: d.label, title: d.titulo || d.label }));
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

  function formatarNum(n) {
    return String(n).replace(".", ",");
  }

  // Lista de médias (nome + valor destacado, sem barra).
  function graficoMedia(titulo, dados) {
    var card = el("div", { class: "grafico" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: titulo }));
    if (!dados.length) {
      card.appendChild(el("p", { class: "vazio", text: "Sem dados." }));
      return card;
    }
    var lista = el("div", { class: "medias" });
    dados.forEach(function (d) {
      var valor = el("span", { class: "media-item__valor" }, [
        el("strong", { text: formatarNum(d.valor) }),
        d.max ? el("span", { class: "media-item__max", text: " / " + formatarNum(d.max) }) : null,
      ]);
      lista.appendChild(el("div", { class: "media-item" }, [
        el("span", { class: "media-item__nome", text: d.label }),
        valor,
      ]));
    });
    card.appendChild(lista);
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

  // Mede a largura do rótulo (nome + número) sem depender de a aba estar visível.
  var _mctx = (function () { try { return document.createElement("canvas").getContext("2d"); } catch (e) { return null; } })();
  var FONTE_MAPA = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  function larguraRotulo(curto, n) {
    if (!_mctx) return (String(curto).length + 2) * 7;
    _mctx.font = "600 12.5px " + FONTE_MAPA;
    var w1 = _mctx.measureText(curto).width;
    _mctx.font = "800 12.5px " + FONTE_MAPA;
    var w2 = _mctx.measureText(String(n)).width;
    return w1 + 5 + w2;
  }

  function desenharPonto(svg, px, py, n, maxN, nomeCompleto, curto, dir, gap, cls) {
    // Bolhas com área proporcional à contagem (raio ~7 a 12) — visíveis, mas sem
    // sobrepor (as cidades do aglomerado central ficam a ~28px entre si).
    var r = n > 0 ? 7 + Math.sqrt(maxN > 0 ? n / maxN : 1) * 5 : 4;
    var g = svgEl("g", {});
    var circ = svgEl("circle", {
      cx: px, cy: py, r: r,
      class: n > 0 ? "mapa__bola" + (cls ? " " + cls : "") : "mapa__bola--vazia",
    });
    var titulo = svgEl("title", {});
    titulo.textContent = nomeCompleto + " — " + n + " inscrito" + (n === 1 ? "" : "s");
    circ.appendChild(titulo);
    g.appendChild(circ);

    // Rótulo só para pontos COM inscritos (limpa o mapa). Vazios: só o ponto + hover.
    if (n > 0) {
      var rot = posRotulo(px, py, r, dir, gap);
      if (rot.guia) {
        g.appendChild(svgEl("line", { x1: rot.x1, y1: rot.y1, x2: rot.x2, y2: rot.y2, class: "mapa__guia" }));
      }
      // Fundo (pílula) atrás do rótulo para melhorar a leitura sobre o mapa.
      var total = larguraRotulo(curto, n);
      var fs = 12.5, padX = 7, padY = 3.5, H = fs + 2 * padY;
      var cx = rot.anchor === "start" ? rot.x + total / 2 : rot.anchor === "end" ? rot.x - total / 2 : rot.x;
      var cy = rot.baseline === "hanging" ? rot.y + fs / 2 : rot.baseline === "auto" ? rot.y - fs * 0.3 : rot.y;
      g.appendChild(svgEl("rect", {
        x: cx - total / 2 - padX, y: cy - H / 2,
        width: total + 2 * padX, height: H, rx: 5,
        class: "mapa__pill",
      }));

      var lab = svgEl("text", {
        x: rot.x, y: rot.y,
        class: "mapa__label",
        "text-anchor": rot.anchor,
        "dominant-baseline": rot.baseline,
      });
      lab.textContent = curto;
      var num = svgEl("tspan", { class: "mapa__labelnum", dx: "5" });
      num.textContent = String(n);
      lab.appendChild(num);
      g.appendChild(lab);
    }
    svg.appendChild(g);
  }

  // capitalCount: nº de inscritos da Capital (null = não exibir a bolha da Capital)
  function renderMapa(contagem, capitalCount) {
    var card = el("div", { class: "grafico mapa" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: "Inscritos por região (mapa)" }));
    card.appendChild(bandeiraSP());

    var maxN = 0;
    Object.keys(REGIOES).forEach(function (nome) { maxN = Math.max(maxN, contagem[nome] || 0); });
    if (capitalCount != null) maxN = Math.max(maxN, capitalCount);

    var svg = svgEl("svg", { viewBox: "0 0 " + MAPA.W + " " + MAPA.H, class: "mapa__svg" });

    var pts = CONTORNO_SP.map(function (c) { var p = projetar(c[0], c[1]); return p.x + "," + p.y; }).join(" ");
    svg.appendChild(svgEl("polygon", { points: pts, class: "mapa__uf" }));

    Object.keys(REGIOES).forEach(function (nome) {
      var c = REGIOES[nome];
      var p = projetar(c.lon, c.lat);
      desenharPonto(svg, p.x, p.y, contagem[nome] || 0, maxN, nome, c.curto, c.dir, c.gap, null);
    });

    if (capitalCount != null) {
      var pc = projetar(CAPITAL.lon, CAPITAL.lat);
      desenharPonto(svg, pc.x, pc.y, capitalCount, maxN, "Capital (São Paulo)", CAPITAL.curto, CAPITAL.dir, CAPITAL.gap, "mapa__bola--capital");
    }

    card.appendChild(svg);
    var total = Object.keys(contagem).reduce(function (s, k) { return s + contagem[k]; }, 0) + (capitalCount || 0);
    card.appendChild(el("p", {
      class: "mapa__legenda",
      text: total === 0
        ? "Nenhum inscrito com localização ainda."
        : "O número ao lado de cada ponto indica a quantidade de inscritos (a Capital aparece em roxo).",
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

    // ----- Barra de filtros (tipo, período e região) -----
    var barra = el("div", { class: "viz-filtros" });

    // Tipo
    var gTipo = el("div", { class: "viz-grupo" });
    gTipo.appendChild(el("span", { class: "viz-filtro__rotulo", text: "Tipo:" }));
    ["todos", "capital", "interior"].forEach(function (t) {
      var b = el("button", {
        class: "viz-filtro" + (vizTipo === t ? " viz-filtro--ativo" : ""),
        type: "button",
        text: t === "todos" ? "Todas" : t === "capital" ? "Capital" : "Interior",
      });
      b.addEventListener("click", function () {
        vizTipo = t;
        if (t === "capital") vizRegiao = "";
        renderDados();
      });
      gTipo.appendChild(b);
    });
    barra.appendChild(gTipo);

    // Período (data da entrevista)
    var gData = el("div", { class: "viz-grupo viz-grupo--periodo" });
    gData.appendChild(el("span", { class: "viz-filtro__rotulo", text: "Período:" }));
    var de = el("input", { type: "date", class: "viz-data", value: vizDe, title: "Data inicial" });
    de.addEventListener("change", function () { vizDe = de.value; renderDados(); });
    var ate = el("input", { type: "date", class: "viz-data", value: vizAte, title: "Data final" });
    ate.addEventListener("change", function () { vizAte = ate.value; renderDados(); });
    gData.appendChild(de);
    gData.appendChild(el("span", { class: "viz-ate", text: "até" }));
    gData.appendChild(ate);
    barra.appendChild(gData);

    // Região (interior)
    var gReg = el("div", { class: "viz-grupo" });
    gReg.appendChild(el("span", { class: "viz-filtro__rotulo", text: "Região:" }));
    var sel = el("select", { class: "viz-select" });
    sel.appendChild(el("option", { value: "", text: "Todas as regiões" }));
    Object.keys(REGIOES).forEach(function (nome) {
      var o = el("option", { value: nome, text: nome.replace(/ \(região\)$/, "") });
      sel.appendChild(o);
    });
    sel.value = vizRegiao;
    if (vizTipo === "capital") sel.setAttribute("disabled", "disabled");
    sel.addEventListener("change", function () {
      vizRegiao = sel.value;
      if (vizRegiao && vizTipo === "capital") vizTipo = "todos";
      renderDados();
    });
    gReg.appendChild(sel);
    barra.appendChild(gReg);

    // Limpar
    if (vizTipo !== "todos" || vizDe || vizAte || vizRegiao) {
      var limpar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Limpar filtros" });
      limpar.addEventListener("click", function () {
        vizTipo = "todos"; vizDe = ""; vizAte = ""; vizRegiao = "";
        renderDados();
      });
      barra.appendChild(limpar);
    }

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
    // A bolha da Capital só aparece quando não filtrado por Interior nem por região específica.
    var capitalCount = (vizTipo === "interior" || vizRegiao) ? null : lista.filter(function (r) { return r.tipo === "capital"; }).length;
    painel.appendChild(renderMapa(contRegiao, capitalCount));

    var grid = el("div", { class: "graficos" });

    // Inscritos por região (leitura precisa dos números do interior) — do maior ao menor
    var regioesOrdenadas = Object.keys(REGIOES)
      .map(function (nome) { return { label: nome.replace(/ \(região\)$/, ""), valor: contRegiao[nome] || 0 }; })
      .filter(function (d) { return d.valor > 0; })
      .sort(function (a, b) { return b.valor - a.valor; });
    if (regioesOrdenadas.length) {
      grid.appendChild(graficoBarras("Inscritos por região (interior)", regioesOrdenadas));
    }

    // Recomendações (rótulos curtos e distintos; texto completo no hover)
    var ROTULO_REC = {
      "Aprovado - Forte Recomendação": "Forte recomendação",
      "Aprovado - Recomendação": "Recomendação",
      "Aprovado - Recomendação com Ressalvas": "Com ressalvas",
      "Reprovado": "Reprovado",
    };
    var contRec = contarPor(lista, function (r) { return r.recomendacao; });
    grid.appendChild(graficoBarras("Recomendação final", Object.keys(ROTULO_REC).map(function (k) {
      return { label: ROTULO_REC[k], titulo: k, valor: contRec[k] || 0 };
    })));

    // Por entrevistador (quantidade)
    var contEnt = contarPor(lista, function (r) { return r.entrevistador; });
    grid.appendChild(graficoBarras("Entrevistas por entrevistador", Object.keys(contEnt).sort().map(function (k) {
      return { label: k, valor: contEnt[k] };
    })));

    // Nota média por entrevistador (só candidatos avaliados, com pontuação)
    var somaEnt = {}, somaMaxEnt = {}, qtdEnt = {};
    lista.forEach(function (r) {
      if (r.pontuacao_total == null || !r.entrevistador) return;
      somaEnt[r.entrevistador] = (somaEnt[r.entrevistador] || 0) + r.pontuacao_total;
      somaMaxEnt[r.entrevistador] = (somaMaxEnt[r.entrevistador] || 0) + (r.pontuacao_maxima || 0);
      qtdEnt[r.entrevistador] = (qtdEnt[r.entrevistador] || 0) + 1;
    });
    var mediaEnt = Object.keys(somaEnt).sort().map(function (k) {
      return {
        label: k,
        valor: Math.round((somaEnt[k] / qtdEnt[k]) * 10) / 10,
        max: Math.round((somaMaxEnt[k] / qtdEnt[k]) * 10) / 10,
      };
    });
    if (mediaEnt.length) {
      grid.appendChild(graficoMedia("Nota média por entrevistador", mediaEnt));
    }

    // Por região (só faz sentido em "Todas")
    if (vizTipo === "todos" && !vizRegiao) {
      grid.appendChild(graficoBarras("Capital × Interior", [
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
