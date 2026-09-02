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
  var usuarioEmail = "";
  var admin = true;      // definido no login (ver resolverAdmin)
  var supervisor = false; // perfil supervisor (sql/perfil-supervisor.sql)
  var financeiro = false; // perfil financeiro (sql/perfil-financeiro.sql)
  // Ordenação padrão: por data da entrevista, mais recente no topo (desempate por horário de registro).
  var ordenacao = { capital: { col: "data", asc: false }, interior: { col: "data", asc: false } };
  var busca = { capital: "", interior: "" };

  // ---------- Colunas da tabela ----------
  var COLUNAS = [
    {
      chave: "candidato", titulo: "Candidato",
      valor: function (r) { return r.candidato || "—"; },
      // Entrevistas anteriores à pergunta do CPF ficam marcadas, para localizar
      // quais ainda precisam ser completadas em Detalhes.
      aviso: function (r) { return cpfEntrevista(r) ? "" : "sem CPF"; },
    },
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
  var SKIP_EXPORT = ["nome_candidato", "cpf_candidato", "data_entrevista", "nome_entrevistador", "nao_compareceu", "nao_cumpre_requisitos", "recomendacao_final"];

  function colunasExport(tipo) {
    var cols = [
      { h: "Candidato", g: function (r) { return r.candidato || ""; } },
      // Coluna própria: cobre também as entrevistas antigas, cujo CPF foi
      // preenchido pelo painel e não está dentro do JSON de respostas.
      { h: "CPF", g: function (r) { return cpfEntrevista(r); } },
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
    // Voltar para o login — por "Sair" ou porque a sessão caiu — tem de levar
    // embora tudo que era da sessão anterior. O menu ficava aberto por cima da
    // tela de login, mostrando o e-mail e o perfil de quem acabou de sair.
    limparTelaDaSessao();
    mostrar($("#dashboard"), false);
    mostrar($("#login"), true);
    if (msg) { var e = $("#login-erro"); e.textContent = msg; mostrar(e, true); }
  }

  function limparTelaDaSessao() {
    fecharMenu(false);   // sem devolver o foco: o botão que o abriu sumiu junto
    fecharModal();
    var pag = $("#pagina");
    if (pag) { pag.innerHTML = ""; mostrar(pag, false); }
    var abas = $("#abas");
    if (abas) mostrar(abas, true);
    paginaAberta = "";
    marcarItemDoMenu("");
    ["#usuario-email", "#menu-email"].forEach(function (sel) {
      var n = $(sel);
      if (n) n.textContent = "";
    });
    ["#selo-perfil", "#menu-perfil"].forEach(function (sel) {
      var n = $(sel);
      if (n) { n.textContent = ""; n.className = "selo-perfil"; }
    });
    // Os painéis guardam o HTML já montado da sessão anterior. Sem limpar,
    // o próximo login mostra por um instante a tela de quem saiu — com os
    // botões do perfil dele — até `carregarDados` terminar.
    ["candidatos", "capital", "interior", "formacao", "dados", "termos"].forEach(function (p) {
      var n = $("#painel-" + p);
      if (n) n.innerHTML = "";
    });
  }

  function entrarDashboard(session) {
    mostrar($("#login"), false);
    mostrar($("#dashboard"), true);
    usuarioEmail = (session && session.user && session.user.email) || "";
    $("#usuario-email").textContent = usuarioEmail;
    resolverAdmin().then(function () {
      marcarSeloAdmin();
      aplicarPerfilNasAbas();
      carregarDados();
    });
  }

  // ---------- Perfis (admin · supervisor · financeiro · somente leitura) ----
  // A regra que vale é a do banco: `app_admins` (sql/admin.sql),
  // `app_supervisores` (sql/perfil-supervisor.sql) e `app_financeiro`
  // (sql/perfil-financeiro.sql). Se `app_admins` ainda não existir, cai na
  // lista de js/config.js; se as duas faltarem, todo usuário logado edita
  // (comportamento antigo, para não travar o sistema).
  function resolverAdmin() {
    if (!client) { admin = true; supervisor = false; financeiro = false; return Promise.resolve(); }
    return Promise.all([lerAdmins(), lerSupervisores(), lerFinanceiro()]);

    function lerAdmins() {
      return client.from("app_admins").select("email").then(function (resp) {
        if (resp.error || !resp.data) return listaConfig();
        var lista = resp.data.map(function (a) { return normEmail(a.email); });
        admin = lista.indexOf(normEmail(usuarioEmail)) !== -1;
      }).catch(listaConfig);
    }
    // A tabela pode ainda não existir (SQL não rodado): nesse caso simplesmente
    // não há supervisores, e ninguém fica sem acesso por causa disso.
    function lerSupervisores() {
      return client.from("app_supervisores").select("email").then(function (resp) {
        if (resp.error || !resp.data) { supervisor = false; return; }
        var lista = resp.data.map(function (s) { return normEmail(s.email); });
        supervisor = lista.indexOf(normEmail(usuarioEmail)) !== -1;
      }).catch(function () { supervisor = false; });
    }
    // Mesma ideia da lista de supervisores: tabela ausente = ninguém tem o
    // perfil, e nada deixa de funcionar por causa disso.
    function lerFinanceiro() {
      return client.from("app_financeiro").select("email").then(function (resp) {
        if (resp.error || !resp.data) { financeiro = false; return; }
        var lista = resp.data.map(function (f) { return normEmail(f.email); });
        financeiro = lista.indexOf(normEmail(usuarioEmail)) !== -1;
      }).catch(function () { financeiro = false; });
    }
    function listaConfig() {
      var lista = (cfg.ADMIN_EMAILS || []).map(normEmail);
      admin = !lista.length || lista.indexOf(normEmail(usuarioEmail)) !== -1;
    }
  }
  function ehAdmin() { return admin; }
  // Supervisor de verdade é quem está na lista E não é admin (o admin já pode
  // tudo; contar duas vezes só confundiria os avisos da tela).
  function ehSupervisor() { return supervisor && !admin; }
  // Financeiro é leitura como qualquer leitor, com uma aba a mais.
  function ehFinanceiro() { return financeiro && !admin && !supervisor; }
  // A aba Termos de Bolsa é do financeiro; o admin também vê, porque é ele
  // quem lança o termo e responde por ele.
  function podeVerTermos() { return ehAdmin() || ehFinanceiro(); }
  // A aba Visualização de dados não faz parte do trabalho do supervisor.
  function podeVerDados() { return !ehSupervisor(); }
  // Único campo que o supervisor mexe: o grupo de um bolsista da Capital — e
  // só para PREENCHER quem ainda não tem grupo. Trocar alguém de grupo é
  // remanejar gente entre supervisores, decisão da coordenação; por isso é do
  // administrador. A mesma regra está na função `definir_grupo` do banco.
  function semGrupo(f) { return !String((f && f.grupo) || "").trim(); }
  function podeEditarGrupo(f) {
    if (ehAdmin()) return true;
    if (!ehSupervisor()) return false;
    return !!f && f.tipo === "capital" && semGrupo(f);
  }
  // Existe coluna de ação nesta aba? (Ela pode existir com linhas sem botão:
  // o supervisor vê o botão só em quem está sem grupo.)
  function temColunaDeGrupo(tipo) {
    return ehAdmin() || (ehSupervisor() && tipo === "capital");
  }

  function nomeDoPerfil() {
    if (ehAdmin()) return "admin";
    if (ehSupervisor()) return "supervisor";
    if (ehFinanceiro()) return "financeiro";
    return "somente leitura";
  }

  function classeDoSelo() {
    return "selo-perfil" + (ehAdmin() ? " selo-perfil--admin"
      : ehSupervisor() ? " selo-perfil--supervisor"
      : ehFinanceiro() ? " selo-perfil--financeiro" : "");
  }

  function marcarSeloAdmin() {
    var alvo = $("#usuario-email");
    if (alvo && alvo.parentNode) {
      var selo = $("#selo-perfil");
      if (!selo) {
        selo = el("span", { id: "selo-perfil", class: "selo-perfil" });
        alvo.parentNode.insertBefore(selo, alvo.nextSibling);
      }
      selo.textContent = nomeDoPerfil();
      selo.className = classeDoSelo();
    }
    // O menu lateral repete quem está logado: aberto, ele cobre o cabeçalho.
    var mEmail = $("#menu-email");
    if (mEmail) mEmail.textContent = usuarioEmail || "";
    var mPerfil = $("#menu-perfil");
    if (mPerfil) { mPerfil.textContent = nomeDoPerfil(); mPerfil.className = classeDoSelo(); }
  }

  // Esconde a aba Visualização de dados de quem é supervisor. Some o botão e o
  // painel: sem botão não há como chegar lá, e sem painel não há o que vazar
  // se alguém forçar a classe pelo inspetor.
  function aplicarPerfilNasAbas() {
    // "Gerenciar usuários" é do administrador — some do menu para os demais.
    var liUsuarios = $("#menu-li-usuarios");
    if (liUsuarios) mostrar(liUsuarios, ehAdmin());

    // A aba Termos de Bolsa só existe para admin e financeiro.
    var abaTermos = document.querySelector('.aba[data-aba="termos"]');
    if (abaTermos) mostrar(abaTermos, podeVerTermos());
    if (!podeVerTermos()) {
      var pTermos = $("#painel-termos");
      if (pTermos) { pTermos.innerHTML = ""; mostrar(pTermos, false); }
    }

    var botao = document.querySelector('.aba[data-aba="dados"]');
    var painel = $("#painel-dados");
    var mostra = podeVerDados();
    if (botao) mostrar(botao, mostra);
    if (!mostra && painel) {
      painel.innerHTML = "";
      mostrar(painel, false);
      // Se a aba escondida era a que estava aberta, volta para a primeira.
      if (botao && botao.classList.contains("aba--ativa")) {
        var primeira = document.querySelector('.aba[data-aba="candidatos"]');
        if (primeira) primeira.click();
      }
    }
  }

  // Trava de verdade das ações de escrita. Cada botão já é escondido de quem
  // não pode usá-lo, mas a checagem mora TAMBÉM aqui: se um botão escapar
  // (como escapou o "Convocar cadastro"), o pior que acontece é nada acontecer.
  function exigirAdmin(oQue) {
    if (ehAdmin()) return true;
    alert((oQue || "Esta ação") + " é restrita aos administradores.\n\n" +
      "Seu acesso é de " + nomeDoPerfil() + ".");
    return false;
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
        // Nada da sessão anterior sobrevive ao logout, nem em memória.
        linhas = []; candidatos = []; formacao = []; metas = [];
        supervisores = []; importacoes = []; sincronizacoes = [];
        usuarioEmail = "";
        esquecerCasamentos();
        mostrarLogin();
      });
    });
    $("#btn-atualizar").addEventListener("click", carregarDados);
    configurarLargura();
    configurarMenu();
  }

  // ---------- Menu lateral (☰) ----------
  var focoAntesDoMenu = null;

  function menuAberto() {
    var m = $("#menu-lateral");
    return !!m && !m.classList.contains("oculto");
  }

  function abrirMenu() {
    focoAntesDoMenu = document.activeElement;
    mostrar($("#menu-lateral"), true);
    mostrar($("#menu-fundo"), true);
    $("#btn-menu").setAttribute("aria-expanded", "true");
    // O foco entra no menu: quem navega por teclado não fica preso atrás dele.
    var primeiro = $("#menu-lateral").querySelector(".menu-lat__fechar");
    if (primeiro) primeiro.focus();
  }

  // `devolverFoco` = false ao sair da conta: o ☰ que abriu o menu está escondido
  // junto com o painel, e mandar o foco para um elemento invisível o joga para
  // o começo da página em vez de para o formulário de login.
  function fecharMenu(devolverFoco) {
    if (!menuAberto()) { focoAntesDoMenu = null; return; }
    mostrar($("#menu-lateral"), false);
    mostrar($("#menu-fundo"), false);
    $("#btn-menu").setAttribute("aria-expanded", "false");
    if (devolverFoco !== false && focoAntesDoMenu && focoAntesDoMenu.focus) {
      focoAntesDoMenu.focus();
    }
    focoAntesDoMenu = null;
  }

  function configurarMenu() {
    $("#btn-menu").addEventListener("click", function () {
      if (menuAberto()) fecharMenu(); else abrirMenu();
    });
    $("#menu-fechar").addEventListener("click", fecharMenu);
    $("#menu-fundo").addEventListener("click", fecharMenu);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuAberto()) fecharMenu();
    });
    Array.prototype.forEach.call(
      document.querySelectorAll(".menu-lat__item[data-pagina]"),
      function (b) {
        b.addEventListener("click", function () {
          abrirPagina(b.getAttribute("data-pagina"));
          fecharMenu();
        });
      }
    );
    // "Formulários" é um link de verdade (abre outra página): só fecha o menu.
    Array.prototype.forEach.call(
      document.querySelectorAll('.menu-lat__item[href]'),
      function (a) { a.addEventListener("click", fecharMenu); }
    );
  }

  // ---------- Páginas do menu (Gerenciar usuários · Meu perfil) ----------
  // Não são abas: ocupam o lugar das abas e voltam pelo "← Voltar". Guardar
  // qual está aberta permite recarregar a página depois de uma ação.
  var paginaAberta = "";

  function abrirPagina(qual) {
    if (qual === "usuarios" && !ehAdmin()) return;
    paginaAberta = qual;
    mostrar($("#abas"), false);
    ["candidatos", "capital", "interior", "formacao", "dados", "termos"].forEach(function (p) {
      mostrar($("#painel-" + p), false);
    });
    var pag = $("#pagina");
    mostrar(pag, true);
    marcarItemDoMenu(qual);
    if (qual === "usuarios") renderUsuarios();
    else renderMeuPerfil();
    window.scrollTo(0, 0);
  }

  function fecharPagina() {
    paginaAberta = "";
    var pag = $("#pagina");
    pag.innerHTML = "";
    mostrar(pag, false);
    mostrar($("#abas"), true);
    marcarItemDoMenu("");
    // Devolve a aba que estava aberta antes (o clique refaz painel e largura).
    var ativa = document.querySelector(".aba--ativa") ||
      document.querySelector('.aba[data-aba="candidatos"]');
    if (ativa) ativa.click();
  }

  function marcarItemDoMenu(qual) {
    Array.prototype.forEach.call(
      document.querySelectorAll(".menu-lat__item[data-pagina]"),
      function (b) {
        b.classList.toggle("menu-lat__item--ativo", b.getAttribute("data-pagina") === qual);
      }
    );
  }

  // Cabeçalho comum das duas páginas: título, botão de voltar e subtítulo.
  function cabecalhoDaPagina(titulo, sub) {
    var topo = el("div", { class: "pagina__topo" });
    var voltar = el("button", {
      class: "btn btn--secundario btn--pequeno", type: "button", text: "← Voltar",
    });
    voltar.addEventListener("click", fecharPagina);
    topo.appendChild(voltar);
    topo.appendChild(el("h2", { class: "pagina__titulo", text: titulo }));
    var frag = document.createDocumentFragment();
    frag.appendChild(topo);
    if (sub) frag.appendChild(el("p", { class: "pagina__sub", text: sub }));
    return frag;
  }

  // ---------- Largura da tela (padrão × tela cheia) ----------
  // Em notebooks, as tabelas grandes ficam melhores usando a tela inteira.
  // A escolha fica salva no navegador de quem usa.
  var CHAVE_LARGURA = "rbcip_dash_largura";
  var abaAtiva = "candidatos";
  // Todas as abas nascem na largura padrão, que é a mais confortável de ler.
  // A Formação já nasceu em tela cheia por causa das muitas colunas; com a
  // coluna de Editar reduzida ao lápis e a Região encurtada, a tabela cabe.
  // A preferência é guardada POR ABA — clicar no botão vale para a aba em que
  // você está, e é lembrada na próxima visita.
  var LARGURA_PADRAO_DA_ABA = {};

  function preferenciasLargura() {
    var bruto = null;
    try { bruto = localStorage.getItem(CHAVE_LARGURA); } catch (e) { bruto = null; }
    if (!bruto) return {};
    // Formato antigo: uma string valendo para o painel inteiro.
    if (bruto === "cheia" || bruto === "padrao") {
      return { candidatos: bruto, capital: bruto, interior: bruto, dados: bruto };
    }
    try { return JSON.parse(bruto) || {}; } catch (e) { return {}; }
  }
  function larguraDaAba(aba) {
    var prefs = preferenciasLargura();
    var escolha = prefs[aba] || LARGURA_PADRAO_DA_ABA[aba] || "padrao";
    return escolha === "cheia";
  }
  function aplicarLargura(cheia) {
    document.body.classList.toggle("tela-cheia", cheia);
    var btn = $("#btn-largura");
    if (btn) {
      btn.textContent = cheia ? "⛶ Largura padrão" : "⛶ Tela cheia";
      btn.setAttribute("aria-pressed", cheia ? "true" : "false");
    }
  }
  function aplicarLarguraDaAba(aba) {
    abaAtiva = aba || abaAtiva;
    aplicarLargura(larguraDaAba(abaAtiva));
  }
  function configurarLargura() {
    aplicarLarguraDaAba(abaAtiva);
    var btn = $("#btn-largura");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var cheia = !document.body.classList.contains("tela-cheia");
      aplicarLargura(cheia);
      var prefs = preferenciasLargura();
      prefs[abaAtiva] = cheia ? "cheia" : "padrao";
      try { localStorage.setItem(CHAVE_LARGURA, JSON.stringify(prefs)); } catch (e) { /* sem localStorage */ }
    });
  }

  // ---------- Carregar dados ----------
  function buscarEntrevistas() {
    return client
      .from(cfg.TABELA || "entrevistas")
      .select("*")
      .order("created_at", { ascending: false, nullsFirst: false });
  }

  // Reconhece erros de sessão expirada (JWT) para tratar sem assustar o usuário.
  function ehErroSessao(err) {
    if (!err) return false;
    var m = String(err.message || err.msg || "").toLowerCase();
    return m.indexOf("jwt") !== -1 || m.indexOf("expired") !== -1 ||
      err.code === "PGRST301" || err.status === 401;
  }

  function carregarDados() {
    // "Atualizar" reconfere também o estado da automação: instalou o gatilho no
    // Apps Script e voltou ao painel, o aviso muda sem precisar recarregar.
    statusAutomacao = null;
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
      esquecerCasamentos();
      renderTudo();
      // Histórico e supervisores primeiro: os painéis dependem dos dois.
      Promise.all([carregarImportacoes(), carregarSupervisores(), carregarSincronizacoes(),
        carregarMetas()]).then(function () {
        carregarCandidatos(); // busca as fichas e re-renderiza o painel de candidatos
        carregarFormacao();   // idem para o painel de formação (bolsistas)
      });
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
      // Empate na coluna ordenada: o registro mais recente vem primeiro (topo),
      // usando a data/hora de registro (created_at). Resolve datas iguais com
      // horários diferentes.
      var ca = a.created_at || "", cb = b.created_at || "";
      if (ca > cb) return -1;
      if (ca < cb) return 1;
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

    // No celular a tabela vira cartão e o cabeçalho some — sem ele não há onde
    // clicar para ordenar. Este seletor faz o mesmo papel e só aparece lá.
    var ordBarra = el("div", { class: "ordenar-mobile" });
    ordBarra.appendChild(el("span", { class: "ordenar-mobile__rot", text: "Ordenar por:" }));
    var selOrd = el("select", { class: "viz-select ordenar-mobile__select" });
    COLUNAS.forEach(function (c) {
      selOrd.appendChild(el("option", { value: c.chave + "|desc", text: c.titulo + " ↓" }));
      selOrd.appendChild(el("option", { value: c.chave + "|asc", text: c.titulo + " ↑" }));
    });
    selOrd.value = ordenacao[tipo].col + "|" + (ordenacao[tipo].asc ? "asc" : "desc");
    selOrd.addEventListener("change", function () {
      var partes = selOrd.value.split("|");
      ordenacao[tipo].col = partes[0];
      ordenacao[tipo].asc = partes[1] === "asc";
      renderTabela(tipo);
    });
    ordBarra.appendChild(selOrd);
    painel.appendChild(ordBarra);

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
    // `tabela--cand` traz o modo cartão do celular (cabeçalho escondido, cada
    // linha vira um cartão com os rótulos ao lado dos valores).
    var tabela = el("table", { class: "tabela tabela--cand tabela--entrev" });
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
      COLUNAS.forEach(function (c, iCol) {
        var td = el("td", {
          // A primeira coluna (o nome) vira o cabeçalho do cartão no celular.
          class: "tabela__td" + (c.num ? " tabela__td--num" : "") + (iCol === 0 ? " cand-td-nome" : ""),
          "data-label": c.titulo,
        });
        var cls = c.tag && c.tagClasse ? c.tagClasse(r) : "";
        if (cls) {
          var span = el("span", { class: cls, text: c.valor(r) });
          if (c.tituloCel) { var t = c.tituloCel(r); if (t) span.setAttribute("title", t); }
          td.appendChild(span);
        } else {
          td.textContent = c.valor(r);
        }
        // Aviso discreto ao lado do valor (ex.: entrevista antiga sem CPF).
        if (c.aviso) {
          var texto = c.aviso(r);
          if (texto) td.appendChild(el("span", { class: "sem-cpf", title: "Abra os Detalhes para informar o CPF", text: texto }));
        }
        tr.appendChild(td);
      });
      var tdAcao = el("td", { class: "tabela__td cand-td-editar", "data-label": "Ficha" });
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function metaEntrevista(r) {
    return (r.tipo === "capital" ? "Capital" : "Interior") +
      " · " + (r.entrevistador || "—") +
      " · " + formatarData(r.data_entrevista) +
      " · Pontuação: " + pontuacaoTexto(r);
  }

  // Monta um documento HTML imprimível (usado para "Baixar PDF").
  function htmlDetalhes(r) {
    var resp = r.respostas || {};
    var secaoAtual = null;
    var corpo = "";
    mapaPerguntas(r.tipo).forEach(function (p) {
      // O CPF pode estar só na coluna (entrevistas antigas, preenchidas no painel).
      var v = p.id === "cpf_candidato" ? cpfEntrevista(r) : resp[p.id];
      if (v === undefined || v === "" || v === false) return;
      if (p.secao && p.secao !== secaoAtual) {
        secaoAtual = p.secao;
        corpo += '<h3 class="sec">' + escapeHtml(p.secao) + "</h3>";
      }
      corpo += '<p class="q">' + escapeHtml(p.label) + '</p><p class="a">' + escapeHtml(v === true ? "Sim" : String(v)) + "</p>";
    });
    if (r.ata_link) {
      corpo += '<h3 class="sec">Gravações / Atas</h3>' +
        '<p class="a"><a href="' + escapeHtml(r.ata_link) + '">' + escapeHtml(r.ata_link) + "</a></p>";
    }
    var css =
      "*{box-sizing:border-box}body{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#1c2530;margin:0;line-height:1.5}" +
      ".doc{max-width:760px;margin:0 auto;padding:8px}" +
      ".cab{border-bottom:3px solid #004e6b;padding-bottom:12px;margin-bottom:16px}" +
      ".marca{color:#004e6b;font-weight:700;letter-spacing:1px;font-size:12px;text-transform:uppercase}" +
      "h1{font-size:24px;margin:6px 0 4px}.meta{color:#5c6b78;margin:0;font-size:13px}.status{margin:6px 0 0;font-size:13px;color:#004e6b}" +
      ".sec{color:#004e6b;font-size:13px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #d5dee3;padding-bottom:4px;margin:22px 0 8px}" +
      ".q{font-weight:700;font-size:14px;margin:12px 0 2px}.a{margin:0;font-size:14px;white-space:pre-wrap}" +
      ".rodape{margin-top:28px;color:#5c6b78;font-size:11px;border-top:1px solid #d5dee3;padding-top:8px}" +
      "@page{margin:1.5cm}";
    return "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>" +
      "<title>Entrevista - " + escapeHtml(r.candidato || "") + "</title><style>" + css + "</style></head><body>" +
      '<div class="doc"><div class="cab"><div class="marca">RBCIP — Processo Seletivo</div>' +
      "<h1>" + escapeHtml(r.candidato || "(sem nome)") + "</h1>" +
      '<p class="meta">' + escapeHtml(metaEntrevista(r)) + "</p>" +
      '<p class="status">Status: ' + escapeHtml(statusTexto(r)) + "</p></div>" +
      corpo +
      '<p class="rodape">Documento gerado pelo dashboard de entrevistas — Processo Seletivo RBCIP.</p>' +
      "</div></body></html>";
  }

  function baixarPdf(r) {
    var w = window.open("", "_blank");
    if (!w) {
      alert("Não foi possível abrir a janela de impressão. Permita pop-ups para este site e tente de novo.");
      return;
    }
    w.document.open();
    w.document.write(htmlDetalhes(r));
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 300);
  }

  // ---------- Link das atas (pasta no Google Drive) ----------
  function salvarAtaLink(id, url) {
    if (!ehAdmin()) return Promise.reject(new Error("Ação restrita aos administradores."));
    if (!client) return Promise.reject(new Error("Sessão indisponível. Entre novamente."));
    return client
      .from(cfg.TABELA || "entrevistas")
      .update({ ata_link: url })
      .eq("id", id)
      .then(function (resp) {
        if (resp.error) throw resp.error;
        return resp;
      });
  }

  // Desenha o bloco de atas dentro de `wrap`, conforme já exista link ou não.
  function renderAta(wrap, r) {
    wrap.innerHTML = "";
    wrap.appendChild(el("div", { class: "ata__titulo", text: "📁 Pasta de gravações / atas" }));

    if (r.ata_link) {
      wrap.appendChild(
        el("a", {
          class: "ata__link",
          href: r.ata_link,
          target: "_blank",
          rel: "noopener noreferrer",
          text: r.ata_link,
        })
      );
      return;
    }

    var input = el("input", {
      class: "ata__input",
      type: "url",
      placeholder: "Cole o link da pasta (Google Drive)…",
    });
    var btn = el("button", { class: "btn btn--pequeno", type: "button", text: "Salvar link" });
    var msg = el("p", { class: "ata__msg oculto" });
    function erro(texto) {
      msg.textContent = texto;
      msg.className = "ata__msg ata__msg--erro";
    }
    btn.addEventListener("click", function () {
      var url = input.value.trim();
      if (!/^https?:\/\/\S+/i.test(url)) {
        erro("Cole um link válido (deve começar com https://).");
        return;
      }
      if (!window.confirm("Depois de salvo, o link NÃO poderá ser editado pelo painel. Deseja continuar?")) {
        return;
      }
      btn.disabled = true;
      input.disabled = true;
      btn.textContent = "Salvando…";
      salvarAtaLink(r.id, url)
        .then(function () {
          r.ata_link = url; // reflete na memória (a mesma entrevista da tabela)
          renderAta(wrap, r); // troca para o modo somente-leitura
        })
        .catch(function (e) {
          btn.disabled = false;
          input.disabled = false;
          btn.textContent = "Salvar link";
          erro("Não foi possível salvar: " + (e.message || e));
        });
    });

    wrap.appendChild(el("div", { class: "ata__form" }, [input, btn]));
    wrap.appendChild(msg);
  }

  // ---------- CPF do candidato (chave entre entrevista, inscrição e formação) ----------
  // Entrevistas antigas foram feitas antes de a pergunta existir: o CPF delas é
  // preenchido aqui, à mão. As novas já chegam com o campo preenchido.
  function cpfEntrevista(r) {
    return r.cpf || (r.respostas && r.respostas.cpf_candidato) || "";
  }
  function salvarCpfEntrevista(id, cpf) {
    if (!ehAdmin()) return Promise.reject(new Error("Ação restrita aos administradores."));
    if (!client) return Promise.reject(new Error("Sessão indisponível. Entre novamente."));
    return client
      .from(cfg.TABELA || "entrevistas")
      .update({ cpf: cpf })
      .eq("id", id)
      .then(function (resp) {
        if (resp.error) throw resp.error;
        // O CPF é a chave do casamento: com ele preenchido, a conta muda.
        esquecerCasamentos();
        return resp;
      });
  }

  function renderCpfEntrevista(wrap, r, editando) {
    wrap.innerHTML = "";
    wrap.appendChild(el("div", { class: "ata__titulo", text: "🪪 CPF do candidato" }));
    var atual = cpfEntrevista(r);

    if (atual && !editando) {
      var linha = el("div", { class: "ata__form" });
      linha.appendChild(el("span", { class: "cpf-valor", text: formatarCPF(atual) }));
      if (ehAdmin()) {
        var btnEd = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Alterar" });
        btnEd.addEventListener("click", function () { renderCpfEntrevista(wrap, r, true); });
        linha.appendChild(btnEd);
      }
      wrap.appendChild(linha);
      return;
    }

    if (!ehAdmin()) {
      wrap.appendChild(el("p", { class: "ata__msg", text: "Não informado. Apenas administradores podem preencher." }));
      return;
    }

    var input = el("input", {
      class: "ata__input", type: "text", inputmode: "numeric", maxlength: "14",
      placeholder: "000.000.000-00", value: atual ? formatarCPF(atual) : "",
    });
    input.addEventListener("input", function () { input.value = mascaraCPF(input.value); });
    var btn = el("button", { class: "btn btn--pequeno", type: "button", text: "Salvar CPF" });
    var msg = el("p", { class: "ata__msg", text: "Liga esta entrevista à inscrição e à formação do candidato." });

    btn.addEventListener("click", function () {
      var valor = input.value.trim();
      if (soDigitos(valor).length !== 11) {
        msg.textContent = "Informe o CPF completo (11 dígitos).";
        msg.className = "ata__msg ata__msg--erro";
        return;
      }
      btn.disabled = true; input.disabled = true; btn.textContent = "Salvando…";
      salvarCpfEntrevista(r.id, valor)
        .then(function () {
          r.cpf = valor; // reflete na memória (mesma entrevista das tabelas)
          if (r.respostas) r.respostas.cpf_candidato = valor;
          renderCpfEntrevista(wrap, r, false);
          // O casamento com as fichas muda: atualiza as abas de controle.
          renderPainelCandidatos();
          renderPainelFormacao();
        })
        .catch(function (e) {
          btn.disabled = false; input.disabled = false; btn.textContent = "Salvar CPF";
          msg.textContent = /row-level security|permission|denied/i.test(e.message || "")
            ? "Sem permissão para gravar. Rode sql/cpf-entrevista.sql e confirme que você é administrador."
            : "Não foi possível salvar: " + (e.message || e);
          msg.className = "ata__msg ata__msg--erro";
        });
    });

    wrap.appendChild(el("div", { class: "ata__form" }, [input, btn]));
    wrap.appendChild(msg);
  }

  function blocoCpf(r) {
    var wrap = el("div", { class: "ata" });
    renderCpfEntrevista(wrap, r, false);
    return wrap;
  }

  function blocoAta(r) {
    var wrap = el("div", { class: "ata" });
    renderAta(wrap, r);
    return wrap;
  }

  function abrirModal(r) {
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: r.candidato || "(sem nome)" }));

    var meta = el("p", { class: "modal__meta" });
    meta.textContent = metaEntrevista(r);
    alvo.appendChild(meta);

    var topo = el("div", { class: "modal__topo" });
    topo.appendChild(el("span", { class: statusClasse(r) + " modal__status", text: statusTexto(r) }));
    var btnPdf = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "⬇ Baixar PDF" });
    btnPdf.addEventListener("click", function () { baixarPdf(r); });
    topo.appendChild(btnPdf);
    alvo.appendChild(topo);

    // CPF: sempre visível no topo (é a chave do sistema) e editável pelo admin.
    alvo.appendChild(blocoCpf(r));

    var resp = r.respostas || {};
    var ordem = mapaPerguntas(r.tipo);
    var secaoAtual = null;
    var lista = el("dl", { class: "detalhe" });
    ordem.forEach(function (p) {
      if (p.id === "cpf_candidato") return; // já aparece no bloco do topo
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

    // Link da pasta de gravações/atas (Google Drive) — ao final dos detalhes.
    // Grava uma vez; depois fica somente-leitura.
    alvo.appendChild(blocoAta(r));

    mostrar($("#modal"), true);
  }

  function configurarModal() {
    $("#modal-fechar").addEventListener("click", fecharModal);
    $("#modal-fundo").addEventListener("click", fecharModal);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") fecharModal(); });
  }
  function fecharModal() { mostrar($("#modal"), false); }

  // ============================================================
  //  Candidatos (controle central) — importar inscrições + casar entrevistas
  // ============================================================
  var candidatos = [];
  var candTipo = "capital"; // sub-filtro da tabela de candidatos
  var candMsg = "";
  var candBusca = "";

  function normStr(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().trim().replace(/\s+/g, " ");
  }
  function normEmail(s) { return String(s || "").trim().toLowerCase(); }
  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }

  // Detecta o separador do CSV (vírgula ou ponto e vírgula) pela 1ª linha,
  // contando apenas ocorrências FORA de aspas. Exports brasileiros usam ";".
  function detectarDelim(text) {
    var aspas = false, virg = 0, pv = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '"') { aspas = !aspas; continue; }
      if (aspas) continue;
      if (c === "\n") break;
      if (c === ",") virg++;
      else if (c === ";") pv++;
    }
    return pv > virg ? ";" : ",";
  }

  // Leitor de CSV robusto (trata aspas, separador e quebras dentro de campos).
  function parseCSV(text) {
    var delim = detectarDelim(text);
    var regs = [], campo = "", reg = [], aspas = false, i = 0, n = text.length;
    while (i < n) {
      var c = text[i];
      if (aspas) {
        if (c === '"') {
          if (text[i + 1] === '"') { campo += '"'; i += 2; continue; }
          aspas = false; i++; continue;
        }
        campo += c; i++; continue;
      }
      if (c === '"') { aspas = true; i++; continue; }
      if (c === delim) { reg.push(campo); campo = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { reg.push(campo); regs.push(reg); reg = []; campo = ""; i++; continue; }
      campo += c; i++;
    }
    if (campo !== "" || reg.length) { reg.push(campo); regs.push(reg); }
    regs = regs.filter(function (r) { return r.some(function (v) { return v && v.trim() !== ""; }); });
    if (!regs.length) return { headers: [], rows: [] };
    var headers = regs[0].map(function (h) { return h.trim(); });
    var rows = regs.slice(1).map(function (r) {
      var o = {};
      headers.forEach(function (h, idx) { o[h] = (r[idx] !== undefined ? r[idx] : "").trim(); });
      return o;
    });
    return { headers: headers, rows: rows };
  }

  // Compacta o nome de uma coluna: sem acento, sem pontuação, sem espaços.
  // "De qual região de SP sua residência está mais próxima? *" e
  // "De qual regiao de SP sua residencia esta mais proxima?" viram a mesma coisa.
  function normCol(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  // Procura o valor de uma coluna aceitando variações de cabeçalho, porque os
  // arquivos da plataforma usam a pergunta inteira como nome da coluna (com
  // asterisco, interrogação e acentos), enquanto as planilhas de controle usam
  // nomes curtos. A busca vai do mais exato ao mais tolerante.
  function pegaCol(row, nomes) {
    var i;
    // 1) nome exatamente igual
    for (i = 0; i < nomes.length; i++) {
      if (row[nomes[i]] !== undefined && row[nomes[i]] !== "") return row[nomes[i]];
    }
    // 2) nome igual depois de compactar (acentos, "?", "*", espaços)
    var idx = {};
    Object.keys(row).forEach(function (k) { idx[normCol(k)] = row[k]; });
    for (i = 0; i < nomes.length; i++) {
      var alvo = normCol(nomes[i]);
      if (alvo && idx[alvo] !== undefined && idx[alvo] !== "") return idx[alvo];
    }
    // 3) coluna que COMEÇA com o nome procurado ("Nome" acha "Nome completo")
    var chaves = Object.keys(idx);
    for (i = 0; i < nomes.length; i++) {
      var pref = normCol(nomes[i]);
      if (!pref) continue;
      for (var j = 0; j < chaves.length; j++) {
        if (chaves[j].indexOf(pref) === 0 && idx[chaves[j]]) return idx[chaves[j]];
      }
    }
    return "";
  }

  // Nomes que a REGIÃO pode ter: curto (planilha de controle) ou a pergunta
  // inteira do formulário de inscrição (arquivo da plataforma).
  var COLS_REGIAO = [
    "Região",
    "Regiao",
    "De qual região de SP sua residência está mais próxima?",
    "Região de atuação",
  ];

  // Ordenação padrão das tabelas de controle: a MESMA ordem do arquivo CSV
  // (é a ordem em que as pessoas se inscreveram / entraram no projeto).
  // Fichas antigas, importadas antes de existir a coluna `ordem`, ficam no fim
  // em ordem alfabética até a próxima importação.
  // Texto que explica, no rodapé da tabela, qual ordem está sendo usada.
  function notaOrdem(lista) {
    var semOrdem = lista.filter(function (x) { return x.ordem === null || x.ordem === undefined; }).length;
    if (!semOrdem) return "na mesma ordem do arquivo importado.";
    if (semOrdem === lista.length) return "reimporte o CSV para usar a ordem original da planilha.";
    return semOrdem + " ficha(s) sem posição definida aparecem no fim — reimporte o CSV para corrigir.";
  }

  function porOrdemPlanilha(a, b) {
    var oa = (a.ordem === null || a.ordem === undefined) ? Infinity : a.ordem;
    var ob = (b.ordem === null || b.ordem === undefined) ? Infinity : b.ordem;
    if (oa !== ob) return oa - ob;
    return normStr(a.nome).localeCompare(normStr(b.nome));
  }

  // ---------- Ordenar a lista clicando no título da coluna ----------
  // Ordenar é só uma forma de olhar a mesma lista: nada muda no banco, nada é
  // reordenado nos arquivos exportados (que saem sempre na ordem do arquivo
  // importado) e o terceiro clique no título devolve a ordem original.
  var ordemLista = {
    candidatos: { col: "", asc: true },
    formacao: { col: "", asc: true },
    termos: { col: "", asc: true },
  };

  // Data como chave de texto ordenável. Circulam dois formatos no sistema:
  // "aaaa-mm-dd" (vem do banco) e "dd/mm/aaaa" (vem das planilhas); os dois
  // viram "aaaammdd".
  function chaveData(valor) {
    var t = String(valor || "").trim();
    if (!t) return "";
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return iso[1] + iso[2] + iso[3];
    var br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
    if (br) return br[3] + br[2] + br[1];
    return t;
  }

  // Vazio vai sempre para o fim, nos dois sentidos: quem está sem CPF no topo
  // da lista decrescente esconderia justamente quem tem o dado.
  function compararChaves(a, b, asc) {
    var va = (a === null || a === undefined) ? "" : a;
    var vb = (b === null || b === undefined) ? "" : b;
    var ea = va === "" || va === "—";
    var eb = vb === "" || vb === "—";
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    var r = (typeof va === "number" && typeof vb === "number")
      ? va - vb
      : String(va).localeCompare(String(vb), "pt-BR");
    if (!r) return 0;
    return asc ? (r < 0 ? -1 : 1) : (r < 0 ? 1 : -1);
  }

  function ordenarLista(lista, estado, chaves) {
    var copia = lista.slice();
    var fn = estado && estado.col ? chaves[estado.col] : null;
    if (!fn) return copia.sort(porOrdemPlanilha);
    return copia.sort(function (a, b) {
      // Empate na coluna: a ordem do arquivo desempata sempre, para a lista
      // não "tremer" entre dois renders com os mesmos dados.
      return compararChaves(fn(a), fn(b), estado.asc) || porOrdemPlanilha(a, b);
    });
  }

  // Cabeçalho com os títulos clicáveis. Colunas sem chave em `chaves` (as de
  // ação, por exemplo) continuam sendo texto simples.
  function cabecalhoOrdenavel(cols, estado, chaves, aoOrdenar) {
    var trh = el("tr");
    cols.forEach(function (titulo) {
      if (!chaves[titulo]) {
        trh.appendChild(el("th", { class: "tabela__th", text: titulo }));
        return;
      }
      var ativa = estado.col === titulo;
      var th = el("th", {
        class: "tabela__th tabela__th--ord",
        "aria-sort": ativa ? (estado.asc ? "ascending" : "descending") : "none",
      });
      var b = el("button", {
        class: "th-ord" + (ativa ? " th-ord--ativa" : ""), type: "button",
        title: !ativa ? "Ordenar por " + titulo
          : estado.asc ? "Ordenado por " + titulo + ", crescente. Clique para inverter."
          : "Ordenado por " + titulo + ", decrescente. Clique para voltar à ordem do arquivo.",
      });
      b.appendChild(el("span", { text: titulo }));
      b.appendChild(el("span", {
        class: "th-ord__seta", "aria-hidden": "true",
        text: ativa ? (estado.asc ? "▲" : "▼") : "↕",
      }));
      // Três estados: crescente → decrescente → ordem do arquivo. Ninguém fica
      // preso numa ordenação sem saber como desfazer.
      b.addEventListener("click", function () {
        if (estado.col !== titulo) { estado.col = titulo; estado.asc = true; }
        else if (estado.asc) { estado.asc = false; }
        else { estado.col = ""; estado.asc = true; }
        aoOrdenar();
      });
      th.appendChild(b);
      trh.appendChild(th);
    });
    return trh;
  }

  // No celular a tabela vira cartão e o cabeçalho some — sem ele não há onde
  // clicar. Este seletor faz o mesmo papel e só aparece lá.
  function seletorDeOrdem(cols, estado, chaves, aoOrdenar) {
    var barra = el("div", { class: "ordenar-mobile" });
    barra.appendChild(el("span", { class: "ordenar-mobile__rot", text: "Ordenar por:" }));
    var sel = el("select", { class: "viz-select ordenar-mobile__select" });
    sel.appendChild(el("option", { value: "", text: "Ordem do arquivo" }));
    cols.forEach(function (t) {
      if (!chaves[t]) return;
      sel.appendChild(el("option", { value: t + "|asc", text: t + " ↑" }));
      sel.appendChild(el("option", { value: t + "|desc", text: t + " ↓" }));
    });
    sel.value = estado.col ? estado.col + "|" + (estado.asc ? "asc" : "desc") : "";
    sel.addEventListener("change", function () {
      var p = sel.value.split("|");
      estado.col = p[0] || "";
      estado.asc = p[1] !== "desc";
      aoOrdenar();
    });
    barra.appendChild(sel);
    return barra;
  }

  // O rodapé da tabela não pode continuar dizendo "na ordem do arquivo" depois
  // que alguém ordenou por uma coluna.
  function notaDaOrdem(lista, estado) {
    if (estado && estado.col) {
      return "ordenado por " + estado.col + " (" + (estado.asc ? "crescente" : "decrescente") +
        ") — o arquivo exportado sai sempre na ordem original.";
    }
    return notaOrdem(lista);
  }

  // Converte uma linha do CSV de inscrição numa ficha de candidato.
  // `idx` é a posição da linha no arquivo — é o que preserva a ordem original.
  // Data/hora em que a pessoa se inscreveu na plataforma (coluna `data_envio`).
  // Guardada como "AAAA-MM-DD HH:MM": ordena como texto, não depende de fuso
  // e não corre o risco de o navegador "puxar" a data um dia para trás.
  function normalizarDataHora(txt) {
    var t = String(txt || "").trim();
    if (!t) return null;
    var m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      return m[3] + "-" + m[2] + "-" + m[1] +
        (m[4] ? " " + m[4].padStart(2, "0") + ":" + m[5] : "");
    }
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) {
      return m[1] + "-" + m[2] + "-" + m[3] +
        (m[4] ? " " + m[4].padStart(2, "0") + ":" + m[5] : "");
    }
    return null;
  }
  function dataInscricao(row) {
    return normalizarDataHora(pegaCol(row, [
      "data_envio", "Data de envio", "Data do envio", "Data da inscrição", "Data de inscrição",
    ]));
  }

  // "2026-08-20 19:24" → "20/08/2026 19:24" (para exibir).
  function dataInscricaoBR(c) {
    var m = String((c && c.data_inscricao) || "").match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] + (m[4] ? " " + m[4] : "") : "";
  }

  function linhaParaCandidato(tipo, row, idx) {
    var nome = pegaCol(row, ["Nome completo", "Nome"]);
    var email = pegaCol(row, ["E-mail", "Email"]);
    var cpf = pegaCol(row, ["CPF"]);
    var regiao = pegaCol(row, COLS_REGIAO);
    var emailN = normEmail(email);
    // Identidade da ficha: CPF primeiro, porque é o único dado que não muda.
    // Usar o e-mail como identidade fazia uma correção de endereço virar uma
    // pessoa nova na próxima importação.
    var cpfD = soDigitos(cpf);
    var chave = (cpfD.length === 11 ? cpfD : "") || emailN || normStr(nome);
    if (!chave) return null;
    return {
      tipo: tipo,
      chave: chave,
      ordem: idx + 1,
      nome: nome || null,
      email: email || null,
      email_norm: emailN || null,
      cpf: cpf || null,
      regiao: regiao || null,
      data_inscricao: dataInscricao(row),
      inscricao: row,
      convocacao_entrevista: pegaCol(row, ["Convocação para Entrevista"]) || null,
      resultado_entrevista: pegaCol(row, ["Resultado Entrevista", "Resultado"]) || null,
      data_entrevista: pegaCol(row, ["Data da Entrevista"]) || null,
      convocacao_cadastro: pegaCol(row, ["Convocação para Cadastro"]) || null,
      data_convocacao_cadastro: pegaCol(row, ["Data do Envio para Convocação para Cadastro"]) || null,
      updated_at: new Date().toISOString(),
    };
  }

  // Resultado da entrevista no formato das planilhas (SELECIONADO / REPROVADO…).
  function resultadoSistema(ent) {
    if (!ent) return "";
    if (ent.nao_compareceu) return "NÃO COMPARECEU";
    if (ent.nao_cumpre_requisitos) return "REPROVADO";
    var v = ent.recomendacao || "";
    if (v === "Reprovado") return "REPROVADO";
    if (v.indexOf("Ressalva") !== -1) return "SELECIONADO COM RESSALVA";
    if (v.indexOf("Aprovado") !== -1) return "SELECIONADO";
    return v.toUpperCase();
  }
  // Já convocado? Considera tanto a data (envio pelo sistema) quanto o status
  // "Enviado" que veio da planilha de controle — evita reconvocar quem já recebeu.
  // Quem já foi ENTREVISTADO também conta: o convite chegou de algum jeito, e
  // uma ficha criada depois da entrevista (recadastro na outra região, correção
  // de CPF) não pode reabrir a fila de convocação — nem receber o e-mail de
  // novo, nem aparecer como pendente numa etapa que já passou.
  function jaConvocadoEntrevista(c) {
    return !!(c.data_convocacao_entrevista || c.convocacao_entrevista === "Enviado" ||
      casarEntrevista(c));
  }
  function jaConvocadoCadastro(c) {
    return !!(c.data_convocacao_cadastro || c.convocacao_cadastro === "Enviado");
  }
  // Resultado que vale para a ficha: a entrevista casada no sistema tem
  // prioridade; sem ela, o que veio da planilha.
  function resultadoDoCandidato(c, ent) {
    var e = ent === undefined ? casarEntrevista(c) : ent;
    return e ? resultadoSistema(e) : (c.resultado_entrevista || "");
  }
  // ---------- Marcador de resultado com a origem do dado ----------
  // Ícones que dizem DE ONDE veio o resultado, dentro do próprio marcador:
  //   • monitor  = entrevista preenchida no sistema;
  //   • planilha = valor que veio da importação de CSV.
  var ICONES_FONTE = {
    sistema:
      '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<rect x="1.6" y="2.4" width="12.8" height="8.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M5.6 13.6h4.8M8 11v2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      "</svg>",
    planilha:
      '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<rect x="1.8" y="2.2" width="12.4" height="11.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M1.8 6.1h12.4M6.4 6.1v7.7" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      "</svg>",
  };
  var ROTULO_FONTE = {
    sistema: "resultado da entrevista feita no sistema",
    planilha: "resultado importado da planilha",
  };

  // "Pendente" é o único estado da tabela que pede uma ação sua — merece o
  // mesmo peso visual dos marcadores de resultado, não um cinza de rodapé.
  var ICONE_RELOGIO =
    '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M8 4.4V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function tagPendente(texto, titulo) {
    var tag = el("span", { class: "tag tag--ambar tag--com-icone", title: titulo || "" });
    tag.innerHTML = ICONE_RELOGIO;
    tag.appendChild(el("span", { text: texto }));
    return tag;
  }

  var ICONE_BLOQUEIO =
    '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M4.4 4.4l7.2 7.2" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round"/></svg>';

  // Seletor grande do recorte principal da aba (Capital x Interior). É a
  // primeira decisão de quem abre a página, então tem rótulo, contagem e
  // desenho próprios — as pastilhas de recorte secundário (No projeto /
  // Desligados, Sem termo / Aptos…) são menores de propósito, para as duas
  // coisas não se confundirem.
  function seletorSegmentado(rotulo, opcoes, ativo, aoTrocar) {
    var wrap = el("div", { class: "projeto" });
    if (rotulo) wrap.appendChild(el("span", { class: "projeto__rot", text: rotulo }));
    var grupo = el("div", { class: "projeto__opcoes", role: "group", "aria-label": rotulo || "" });
    opcoes.forEach(function (o) {
      var b = el("button", {
        class: "projeto__btn" + (o.detalhe ? "" : " projeto__btn--simples") +
          (ativo === o.id ? " projeto__btn--ativa" : ""),
        type: "button",
        "aria-pressed": ativo === o.id ? "true" : "false",
        title: o.titulo || "",
      });
      b.appendChild(el("span", { class: "projeto__nome", text: o.nome }));
      if (o.detalhe) b.appendChild(el("span", { class: "projeto__qtd", text: o.detalhe }));
      b.addEventListener("click", function () { if (ativo !== o.id) aoTrocar(o.id); });
      grupo.appendChild(b);
    });
    wrap.appendChild(grupo);
    return wrap;
  }

  function seletorDeProjeto(ativo, contar, unidade, aoTrocar) {
    return seletorSegmentado("Projeto", ["capital", "interior"].map(function (t) {
      var n = contar(t);
      return { id: t, nome: nomeRegiao(t), detalhe: n + " " + unidade + (n === 1 ? "" : "s") };
    }), ativo, aoTrocar);
  }

  // Cabeçalho da lista, com o recorte secundário à direita. Separa a tabela do
  // bloco de números e das ações, e dá um nome ao que está sendo listado.
  function cabecalhoDaLista(titulo, recortes, ativo, aoTrocar) {
    var cab = el("div", { class: "lista-cab" });
    cab.appendChild(el("h3", { class: "lista-cab__titulo", text: titulo }));
    if (recortes && recortes.length) {
      var filtro = el("div", { class: "cand-filtro lista-cab__filtro" });
      recortes.forEach(function (v) {
        var b = el("button", {
          class: "cand-tab cand-tab--mini" + (ativo === v.id ? " cand-tab--ativa" : ""),
          type: "button", text: v.rot + (v.qtd === undefined ? "" : " (" + v.qtd + ")"),
        });
        b.addEventListener("click", function () { aoTrocar(v.id); });
        filtro.appendChild(b);
      });
      cab.appendChild(filtro);
    }
    return cab;
  }

  // Mensagem de status da importação. Se o bloco estiver recolhido, abre: um
  // erro dentro de uma gaveta fechada é um erro que ninguém lê.
  function mostrarStatus(id, texto) {
    var s = $(id);
    if (!s) return;
    s.textContent = texto;
    var caixa = s.closest && s.closest("details");
    if (caixa) caixa.setAttribute("open", "open");
  }

  // Botão só com o lápis. O texto "Editar" repetido em toda linha custava uma
  // coluna inteira de largura; quem precisa do nome da ação tem o cabeçalho da
  // coluna, o title e o aria-label.
  function botaoLapis(descricao) {
    return el("button", {
      class: "btn btn--secundario btn--pequeno btn--icone", type: "button",
      text: "✎", title: descricao, "aria-label": descricao,
    });
  }

  // Diferente de "aguardando": aqui falta uma etapa anterior, então o termo
  // nem pode ser pedido. O vermelho separa "é a vez dele" de "ainda não é".
  function tagNaoApto(titulo) {
    var tag = el("span", { class: "tag tag--vermelho tag--com-icone", title: titulo || "" });
    tag.innerHTML = ICONE_BLOQUEIO;
    tag.appendChild(el("span", { text: "Não apto" }));
    return tag;
  }

  function tagResultado(res, fonte) {
    var tag = el("span", { class: resultadoClasse(res) + " tag--com-icone", title: ROTULO_FONTE[fonte] || "" });
    tag.innerHTML = ICONES_FONTE[fonte] || "";
    tag.appendChild(el("span", { text: res || "—" }));
    return tag;
  }

  // Legenda dos ícones, exibida junto do resumo da tabela.
  function legendaFontes() {
    var wrap = el("span", { class: "legenda-fontes" });
    ["sistema", "planilha"].forEach(function (f) {
      var item = el("span", { class: "legenda-fontes__item", title: ROTULO_FONTE[f] });
      item.innerHTML = ICONES_FONTE[f];
      item.appendChild(el("span", { text: f === "sistema" ? "entrevista no sistema" : "importado da planilha" }));
      wrap.appendChild(item);
    });
    return wrap;
  }

  // Nome de região para exibir em tabela (sem o sufixo "(região)").
  function regiaoCurta(r) {
    // Aceita "(região)", "(Região)" e "(regiao)" — a mesma região aparece das
    // três formas entre a plataforma, as planilhas e o que é digitado à mão.
    return String(r || "").replace(/\s*\(regi[ãa]o\)$/i, "").trim() || "—";
  }

  // Nome curto para caber na coluna de uma tabela. Usa o MESMO rótulo do mapa
  // (REGIOES[...].curto), então a tabela e o gráfico chamam cada região do
  // mesmo jeito. Não são siglas inventadas: "Baixada Santista (Santos / Praia
  // Grande / Guarujá)" vira "Baixada Santista", e não "BS".
  //
  // O nome completo continua onde precisa ser exato: no "passe o mouse" da
  // célula, no filtro de região, nas metas e em tudo que é exportado.
  var CURTO_POR_REGIAO = null;
  function regiaoNaTabela(r) {
    if (!CURTO_POR_REGIAO) {
      CURTO_POR_REGIAO = {};
      Object.keys(REGIOES).forEach(function (nome) {
        var curto = REGIOES[nome].curto || regiaoCurta(nome);
        CURTO_POR_REGIAO[normStr(nome)] = curto;
        // Também pelo nome sem "(região)": é assim que muita ficha foi gravada.
        CURTO_POR_REGIAO[normStr(regiaoCurta(nome))] = curto;
      });
    }
    var achado = CURTO_POR_REGIAO[normStr(r)] || CURTO_POR_REGIAO[normStr(regiaoCurta(r))];
    // Grupo da Capital ("Verde", "Azul"…) ou região escrita de um jeito que não
    // está no mapa: mostra o que veio, sem o "(região)".
    return achado || regiaoCurta(r);
  }
  function resultadoClasse(res) {
    if (res === "SELECIONADO") return "tag tag--verde-forte";
    if (res === "SELECIONADO COM RESSALVA") return "tag tag--verde-claro";
    if (res === "REPROVADO") return "tag tag--vermelho";
    if (res === "NÃO COMPARECEU") return "tag tag--cinza";
    return "tag";
  }

  // Casa uma ficha de candidato com uma entrevista.
  // Ordem: 1º CPF (chave-mestra, preenchida na entrevista), 2º e-mail (cid), 3º nome.
  // O casamento é consultado muitas vezes por linha (resultado, convocação,
  // funil, exportação). A conta é a mesma para a mesma ficha: guarda o
  // resultado até os dados serem recarregados.
  var casamentos = {};
  function esquecerCasamentos() { casamentos = {}; }
  function casarEntrevista(cand) {
    var chave = (cand.id || cand.chave || cand.nome) + "|" + cand.tipo + "|" + soDigitos(cand.cpf) +
      "|" + (cand.email_norm || "") + "|" + normStr(cand.nome || "");
    if (Object.prototype.hasOwnProperty.call(casamentos, chave)) return casamentos[chave];
    var achada = casarEntrevistaBusca(cand);
    casamentos[chave] = achada;
    return achada;
  }

  function casarEntrevistaBusca(cand) {
    var doTipo = linhas.filter(function (r) { return r.tipo === cand.tipo; });
    var achadas = [];
    var cpf = soDigitos(cand.cpf);
    if (cpf.length === 11) {
      achadas = doTipo.filter(function (r) { return soDigitos(cpfEntrevista(r)) === cpf; });
    }
    if (!achadas.length && cand.email_norm) {
      achadas = doTipo.filter(function (r) {
        return r.respostas && normEmail(r.respostas.cid) && normEmail(r.respostas.cid) === cand.email_norm;
      });
    }
    if (!achadas.length && cand.nome) {
      var alvo = normStr(cand.nome);
      achadas = doTipo.filter(function (r) { return normStr(r.candidato) === alvo; });
    }
    // Rede de segurança: quem se inscreveu para um lado e foi entrevistado para
    // o outro (pediu para atuar na outra região) não pode ficar sem resultado.
    // Só por CPF: é a única chave forte o bastante para cruzar os dois lados.
    if (!achadas.length && cpf.length === 11) {
      achadas = linhas.filter(function (r) {
        return r.tipo !== cand.tipo && soDigitos(cpfEntrevista(r)) === cpf;
      });
    }
    if (!achadas.length) return null;
    // mais recente primeiro
    achadas.sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });
    return achadas[0];
  }

  function candTabela() { return cfg.CANDIDATOS_TABELA || "candidatos"; }

  // Devolve a promessa: quem chama precisa saber quando os dados chegaram.
  function carregarCandidatos() {
    if (!client) return Promise.resolve();
    return client.from(candTabela()).select("*").then(function (resp) {
      if (resp.error) {
        mostrarStatus("#cand-status", "Não foi possível carregar candidatos: " + (resp.error.message || resp.error));
        return;
      }
      candidatos = resp.data || [];
      esquecerCasamentos();
      var badge = $("#cont-candidatos");
      if (badge) badge.textContent = candidatos.length;
      renderPainelCandidatos();
      renderDados(); // o funil da aba de dados vem daqui
    });
  }

  var CAMPOS_ETAPA = [
    "convocacao_entrevista", "data_convocacao_entrevista", "resultado_entrevista",
    "data_entrevista", "convocacao_cadastro", "data_convocacao_cadastro",
  ];
  // Dados de identificação: um arquivo que não traga a coluna (ou traga vazia)
  // nunca APAGA o que já está preenchido na ficha.
  var CAMPOS_IDENTIDADE = ["nome", "email", "email_norm", "cpf", "regiao", "data_inscricao"];

  // ---------- Registro das importações (auditoria) ----------
  var importacoes = [];

  function carregarImportacoes() {
    if (!client) return Promise.resolve();
    try {
      return client.from("importacoes").select("*").then(function (resp) {
        // Tabela ainda não criada (sql/importacoes.sql): segue sem histórico.
        importacoes = (!resp.error && resp.data) ? resp.data : [];
      }).catch(function () { importacoes = []; });
    } catch (e) {
      importacoes = [];
      return Promise.resolve();
    }
  }

  function ultimaImportacao(aba, tipo) {
    var lista = importacoes.filter(function (i) { return i.aba === aba && i.tipo === tipo; });
    lista.sort(function (a, b) { return (b.criado_em || "").localeCompare(a.criado_em || ""); });
    return lista[0] || null;
  }

  function registrarImportacao(dados) {
    if (!client) return Promise.resolve();
    var reg = {
      usuario: usuarioEmail || null,
      aba: dados.aba, tipo: dados.tipo, arquivo: dados.arquivo || null,
      linhas: dados.linhas, criadas: dados.criadas, atualizadas: dados.atualizadas,
    };
    // O histórico é opcional: nada aqui — nem a tabela faltando, nem uma falha
    // de rede — pode impedir que a importação seja concluída.
    try {
      return client.from("importacoes").insert(reg).then(function (resp) {
        if (!resp.error) importacoes.push(Object.assign({ criado_em: new Date().toISOString() }, reg));
      }).catch(function () { /* segue sem registrar */ });
    } catch (e) {
      return Promise.resolve();
    }
  }

  // Bloco "Última importação: …" com histórico recolhível.
  function blocoUltimaImportacao(aba, tipo) {
    var ult = ultimaImportacao(aba, tipo);
    var wrap = el("div", { class: "imp-info" });
    if (!ult) {
      wrap.appendChild(el("span", { class: "imp-info__texto", text: "Nenhuma importação registrada ainda para " + tipo + "." }));
      return wrap;
    }
    wrap.appendChild(el("span", {
      class: "imp-info__texto",
      text: "Última importação: " + formatarDataHora(ult.criado_em) +
        (ult.arquivo ? " · " + ult.arquivo : "") +
        " · " + (ult.linhas || 0) + " linha(s): " + (ult.criadas || 0) + " nova(s), " + (ult.atualizadas || 0) + " atualizada(s)" +
        (ult.usuario ? " · por " + ult.usuario : ""),
    }));

    var historico = importacoes.filter(function (i) { return i.aba === aba && i.tipo === tipo; });
    if (historico.length > 1) {
      var link = el("button", { class: "imp-info__link", type: "button", text: "ver histórico" });
      var lista = el("ul", { class: "imp-hist oculto" });
      historico.sort(function (a, b) { return (b.criado_em || "").localeCompare(a.criado_em || ""); });
      historico.slice(0, 10).forEach(function (i) {
        lista.appendChild(el("li", {
          text: formatarDataHora(i.criado_em) + " · " + (i.arquivo || "(sem nome)") +
            " · " + (i.linhas || 0) + " linha(s), " + (i.criadas || 0) + " nova(s), " + (i.atualizadas || 0) + " atualizada(s)",
        }));
      });
      link.addEventListener("click", function () {
        var aberto = !lista.classList.contains("oculto");
        lista.classList.toggle("oculto", aberto);
        link.textContent = aberto ? "ver histórico" : "esconder histórico";
      });
      wrap.appendChild(link);
      wrap.appendChild(lista);
    }
    return wrap;
  }

  // Upsert que sobrevive a colunas ainda não criadas no banco: se o Supabase
  // reclamar de uma coluna nova, reenvia sem ela em vez de perder a importação.
  function upsertResiliente(tabela, rows, opcionais) {
    return client.from(tabela).upsert(rows, { onConflict: "tipo,chave" }).then(function (resp) {
      if (!resp.error) return resp;
      var msg = String(resp.error.message || "");
      var faltando = opcionais.filter(function (campo) { return msg.indexOf(campo) !== -1; });
      if (!faltando.length) throw resp.error;
      var limpas = rows.map(function (r) {
        var copia = {};
        Object.keys(r).forEach(function (k) { if (faltando.indexOf(k) === -1) copia[k] = r[k]; });
        return copia;
      });
      return client.from(tabela).upsert(limpas, { onConflict: "tipo,chave" }).then(function (r2) {
        if (r2.error) throw r2.error;
        return r2;
      });
    });
  }

  function importarCSV(tipo, text, arquivo) {
    var parsed = parseCSV(text);
    var agora = new Date().toISOString();
    var criadas = 0, atualizadas = 0;
    // Índices das fichas que já existem. Reconhecer a MESMA pessoa não pode
    // depender só do e-mail: se o endereço mudou (corrigido aqui ou na
    // plataforma), a ficha antiga precisa ser reencontrada pelo CPF — senão a
    // importação cria uma segunda ficha para a mesma pessoa.
    var porChave = {}, porCPF = {}, porEmail = {}, porCPFMovido = {};
    candidatos.forEach(function (c) {
      if (c.tipo !== tipo) {
        // Ficha movida à mão para o outro lado (a pessoa se inscreveu aqui mas
        // vai atuar lá). O CSV desta região continua trazendo essa pessoa: sem
        // reconhecê-la, a importação criaria uma segunda ficha e a mudança
        // seria desfeita na prática.
        if (c.editado && c.editado.tipo) {
          var dm = soDigitos(c.cpf);
          if (dm.length === 11 && !porCPFMovido[dm]) porCPFMovido[dm] = c;
        }
        return;
      }
      porChave[c.chave] = c;
      var d = soDigitos(c.cpf);
      if (d.length === 11 && !porCPF[d]) porCPF[d] = c;
      if (c.email_norm && !porEmail[c.email_norm]) porEmail[c.email_norm] = c;
    });
    // Nome NÃO entra nesta busca de propósito: dois homônimos seriam fundidos
    // numa ficha só, o que é pior do que uma ficha duplicada.
    function fichaExistente(c) {
      var d = soDigitos(c.cpf);
      if (d.length === 11 && porCPF[d]) return porCPF[d];
      if (porChave[c.chave]) return porChave[c.chave];
      if (c.email_norm && porEmail[c.email_norm]) return porEmail[c.email_norm];
      if (d.length === 11 && porCPFMovido[d]) return porCPFMovido[d];
      return null;
    }

    var mapa = {};
    parsed.rows.forEach(function (row, idx) {
      var c = linhaParaCandidato(tipo, row, idx);
      if (!c) return;
      var ex = fichaExistente(c);
      // Achou a ficha: mantém a identidade dela (a `chave` nunca muda), para o
      // upsert atualizar a linha existente em vez de criar outra.
      if (ex) c.chave = ex.chave;
      if (ex) atualizadas++; else criadas++;
      c.importado_em = agora;
      c.editado = (ex && ex.editado) || {};
      if (ex) {
        // Já existe: reimportar atualiza a inscrição e PREENCHE etapas que ainda
        // estão vazias (semeia o cenário atual da planilha), mas NÃO sobrescreve
        // etapas já definidas no painel/sistema.
        CAMPOS_ETAPA.forEach(function (campo) { c[campo] = ex[campo] || c[campo] || null; });
        CAMPOS_IDENTIDADE.forEach(function (campo) { if (!c[campo] && ex[campo]) c[campo] = ex[campo]; });
        // O que foi corrigido à mão no painel PREVALECE sobre a planilha.
        Object.keys(c.editado).forEach(function (campo) {
          if (c.editado[campo] && campo !== "chave") c[campo] = ex[campo];
        });
      }
      mapa[c.chave] = c; // deduplica por chave (mantém a última ocorrência)
    });
    var rows = Object.keys(mapa).map(function (k) { return mapa[k]; });
    if (!rows.length) return Promise.reject(new Error("Nenhuma linha válida encontrada no CSV."));
    return upsertResiliente(candTabela(), rows, ["importado_em", "ordem", "editado", "data_inscricao"])
      .then(function () {
        return registrarImportacao({
          aba: "candidatos", tipo: tipo, arquivo: arquivo,
          linhas: rows.length, criadas: criadas, atualizadas: atualizadas,
        });
      })
      .then(function () { return { total: rows.length, criadas: criadas, atualizadas: atualizadas }; });
  }

  // Salva uma etapa editada no painel (otimista: já atualiza a memória).
  function atualizarEtapa(cand, campo, valor, elmInput) {
    var anterior = cand[campo];
    cand[campo] = valor || null;
    var patch = { updated_at: new Date().toISOString() };
    patch[campo] = valor || null;
    if (elmInput) elmInput.classList.add("cand-edit--salvando");
    client.from(candTabela()).update(patch).eq("id", cand.id).then(function (resp) {
      if (elmInput) elmInput.classList.remove("cand-edit--salvando");
      if (resp.error) {
        cand[campo] = anterior; // reverte
        if (elmInput) { elmInput.value = anterior || ""; elmInput.classList.add("cand-edit--erro"); }
        mostrarStatus("#cand-status", "Não foi possível salvar a alteração: " + (resp.error.message || resp.error));
      } else if (elmInput) {
        elmInput.classList.remove("cand-edit--erro");
        elmInput.classList.add("cand-edit--ok");
        setTimeout(function () { elmInput.classList.remove("cand-edit--ok"); }, 900);
      }
    });
  }

  // ---------- Exportar a planilha de candidatos ----------
  // Devolve a planilha COMPLETA: as 5 colunas de controle já preenchidas pelo
  // sistema, seguidas de todas as colunas originais da inscrição (guardadas na
  // coluna `inscricao` desde a importação). Correções feitas no painel entram
  // no lugar dos valores originais.
  var COLS_CONTROLE = [
    "Convocação para Entrevista",
    "Resultado",
    "Data da Entrevista",
    "Convocação para Cadastro",
    "Data do Envio para Convocação para Cadastro",
  ];

  function statusConvocacaoEntrevista(c) {
    if (c.email_bounce) return "E-mail não encontrado";
    if (jaConvocadoEntrevista(c)) return "Enviado";
    return "Não Enviado";
  }

  function planilhaCandidatos(tipo) {
    var lista = candidatos.filter(function (c) { return c.tipo === tipo; }).sort(porOrdemPlanilha);
    if (!lista.length) return null;

    // Colunas originais: união das chaves das inscrições, na ordem em que
    // apareceram, sem repetir as de controle.
    var colsOriginais = [];
    var vistas = {};
    COLS_CONTROLE.forEach(function (h) { vistas[normCol(h)] = true; });
    vistas[normCol("Resultado Entrevista")] = true; // variante do arquivo da Capital
    lista.forEach(function (c) {
      Object.keys(c.inscricao || {}).forEach(function (k) {
        var n = normCol(k);
        if (!n || vistas[n]) return;
        vistas[n] = true;
        colsOriginais.push(k);
      });
    });

    var aoa = [COLS_CONTROLE.concat(colsOriginais)];
    lista.forEach(function (c) {
      var ent = casarEntrevista(c);
      var data = ent ? formatarData(ent.data_entrevista) : (c.data_entrevista || "");
      var linha = [
        statusConvocacaoEntrevista(c),
        resultadoDoCandidato(c, ent),
        data === "—" ? "" : data,
        jaConvocadoCadastro(c) ? "Enviado" : "Não Enviado",
        c.data_convocacao_cadastro || "",
      ];
      var orig = c.inscricao || {};
      colsOriginais.forEach(function (k) {
        var n = normCol(k);
        // O que foi corrigido no painel prevalece sobre o valor original.
        if (n === normCol("Nome completo") || n === normCol("Nome")) linha.push(c.nome || orig[k] || "");
        else if (n === normCol("E-mail") || n === normCol("Email")) linha.push(c.email || orig[k] || "");
        else if (n === normCol("CPF")) linha.push(c.cpf || orig[k] || "");
        else if (COLS_REGIAO.some(function (r) { return normCol(r) === n; })) linha.push(c.regiao || orig[k] || "");
        else linha.push(orig[k] !== undefined ? orig[k] : "");
      });
      aoa.push(linha);
    });
    return aoa;
  }

  function exportarCandidatos(tipo) {
    var aoa = planilhaCandidatos(tipo);
    if (!aoa) { alert("Não há candidatos para exportar em " + tipo + "."); return; }
    var hoje = new Date().toISOString().slice(0, 10);
    window.Exportador.csv("candidatos_" + tipo + "_" + hoje + ".csv", aoa);
  }

  // ---------- Edição da ficha do candidato (só admin) ----------
  // Campos editáveis no painel. O que for salvo aqui fica "travado": a próxima
  // importação de CSV não sobrescreve.
  var RESULTADOS = ["SELECIONADO", "SELECIONADO COM RESSALVA", "REPROVADO", "NÃO COMPARECEU"];
  var ENVIO_OPCOES = ["Enviado", "Não Enviado"];

  function camposEdicao(cand) {
    var campos = [
      { id: "nome", rot: "Nome" },
      { id: "email", rot: "E-mail",
        dica: "Ao trocar o e-mail, a ficha continua marcada para reenvio até um envio dar certo." },
      { id: "cpf", rot: "CPF", cpf: true, dica: "Chave que liga a inscrição, a entrevista e a formação." },
      {
        // Quem se inscreveu para um lado e vai atuar no outro: mover a ficha
        // aqui coloca a pessoa na aba certa e faz as etapas seguintes
        // (cadastro e formação) irem para o lado correto.
        id: "tipo", rot: "Região de atuação", opcoes: ["capital", "interior"],
        rotulos: { capital: "Capital", interior: "Interior" },
        dica: "Mover a ficha para o outro lado. A importação de CSV respeita esta escolha.",
      },
      { id: "regiao", rot: "Região (Interior)", dica: "Usada quando a atuação é no Interior." },
    ];
    return campos.concat([
      { id: "convocacao_entrevista", rot: "Convocação entrevista", opcoes: ENVIO_OPCOES },
      { id: "data_convocacao_entrevista", rot: "Data da convocação", dica: "dd/mm/aaaa" },
      { id: "resultado_entrevista", rot: "Resultado da entrevista", opcoes: RESULTADOS,
        dica: "Só é usado quando não há entrevista casada no sistema." },
      { id: "data_entrevista", rot: "Data da entrevista", dica: "dd/mm/aaaa" },
      { id: "convocacao_cadastro", rot: "Convocação cadastro", opcoes: ENVIO_OPCOES },
      { id: "data_convocacao_cadastro", rot: "Data da convocação de cadastro", dica: "dd/mm/aaaa" },
      { id: "email_bounce", rot: "Falha de entrega", opcoes: ["E-mail não existe", "Falha na entrega"],
        dica: "Deixe em branco para limpar a marcação de e-mail inválido." },
    ]);
  }

  function abrirEdicaoCandidato(cand) {
    if (!ehAdmin()) return;
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: "Editar ficha — " + (cand.nome || "(sem nome)") }));
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: (cand.tipo === "capital" ? "Capital" : "Interior") +
        (dataInscricaoBR(cand) ? " · inscrição em " + dataInscricaoBR(cand) : "") +
        " · o que você salvar aqui passa a valer sobre a planilha nas próximas importações.",
    }));

    var travas = cand.editado || {};
    var form = el("form", { class: "edicao" });
    var entradas = {};

    camposEdicao(cand).forEach(function (c) {
      var linha = el("div", { class: "edicao__campo" });
      var rot = el("label", { class: "edicao__rot", for: "ed_" + c.id, text: c.rot });
      if (travas[c.id]) rot.appendChild(el("span", { class: "edicao__trava", text: "✎ editado" }));
      linha.appendChild(rot);

      var entrada;
      if (c.opcoes) {
        entrada = el("select", { class: "edicao__entrada", id: "ed_" + c.id });
        if (c.id !== "tipo") entrada.appendChild(el("option", { value: "", text: "— em branco —" }));
        c.opcoes.forEach(function (o) {
          entrada.appendChild(el("option", { value: o, text: (c.rotulos && c.rotulos[o]) || o }));
        });
        // Valor fora da lista (veio da planilha): entra como opção extra.
        if (cand[c.id] && c.opcoes.indexOf(cand[c.id]) === -1) {
          entrada.appendChild(el("option", { value: cand[c.id], text: cand[c.id] }));
        }
        entrada.value = cand[c.id] || "";
      } else if (c.cpf) {
        entrada = el("input", {
          class: "edicao__entrada", type: "text", id: "ed_" + c.id, inputmode: "numeric",
          maxlength: "14", placeholder: "000.000.000-00", value: cand.cpf ? formatarCPF(cand.cpf) : "",
        });
        entrada.addEventListener("input", function () { entrada.value = mascaraCPF(entrada.value); });
      } else {
        entrada = el("input", { class: "edicao__entrada", type: "text", id: "ed_" + c.id, value: cand[c.id] || "" });
      }
      linha.appendChild(entrada);
      if (c.dica) linha.appendChild(el("p", { class: "edicao__dica", text: c.dica }));
      entradas[c.id] = entrada;
      form.appendChild(linha);
    });

    var msg = el("p", { class: "edicao__msg" });
    var acoes = el("div", { class: "edicao__acoes" });
    var salvar = el("button", { class: "btn btn--pequeno", type: "submit", text: "Salvar alterações" });
    var cancelar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", fecharModal);
    acoes.appendChild(salvar);
    acoes.appendChild(cancelar);
    if (Object.keys(travas).length) {
      var destravar = el("button", {
        class: "btn btn--secundario btn--pequeno", type: "button", text: "Voltar a seguir a planilha",
      });
      destravar.addEventListener("click", function () {
        if (!confirm("Destravar todos os campos? A próxima importação de CSV voltará a sobrescrever esta ficha.")) return;
        salvarEdicaoCandidato(cand, {}, {}, msg, salvar, true);
      });
      acoes.appendChild(destravar);
    }
    form.appendChild(acoes);
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var patch = {};
      var novasTravas = {};
      camposEdicao(cand).forEach(function (c) {
        var valor = entradas[c.id].value.trim();
        var atual = cand[c.id] || "";
        // No CPF, o que importa são os dígitos (a máscara não conta como mudança).
        var mudou = c.cpf ? soDigitos(valor) !== soDigitos(atual) : valor !== atual;
        if (mudou) {
          patch[c.id] = valor || null;
          novasTravas[c.id] = true;
        }
      });
      if (!Object.keys(patch).length) { msg.textContent = "Nada foi alterado."; return; }
      // E-mail alterado: atualiza também a forma normalizada (usada no casamento
      // e nas falhas de entrega). A `chave` NÃO muda, para a reimportação do CSV
      // continuar encontrando esta mesma ficha.
      if (patch.email !== undefined) {
        patch.email_norm = normEmail(patch.email) || null;
        // A marca de falha de entrega NÃO sai aqui. Ela é a prova de que a
        // convocação não chegou: apagá-la ao corrigir o endereço fazia a ficha
        // voltar a exibir "enviado em tal dia", sem botão de reenvio, para uma
        // pessoa que nunca recebeu nada. Sai só quando um envio der certo (ou
        // se você limpar o campo "Falha de entrega" à mão).
      }
      salvarEdicaoCandidato(cand, patch, novasTravas, msg, salvar, false);
    });

    alvo.appendChild(form);
    mostrar($("#modal"), true);
  }

  function salvarEdicaoCandidato(cand, patch, novasTravas, msg, botao, limparTravas) {
    var travas = limparTravas ? {} : Object.assign({}, cand.editado || {}, novasTravas);
    var envio = Object.assign({}, patch, { editado: travas, updated_at: new Date().toISOString() });
    botao.disabled = true;
    msg.className = "edicao__msg";
    msg.textContent = "Salvando…";
    client.from(candTabela()).update(envio).eq("id", cand.id).then(function (resp) {
      botao.disabled = false;
      if (resp.error) {
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = /row-level security|permission/i.test(resp.error.message || "")
          ? "Sem permissão para editar. Só administradores podem alterar dados."
          : "Não foi possível salvar: " + (resp.error.message || resp.error);
        return;
      }
      Object.keys(patch).forEach(function (k) { cand[k] = patch[k]; });
      cand.editado = travas;
      fecharModal();
      renderPainelCandidatos();
    });
  }

  // ---------- Convocações por e-mail ----------
  function hojeBR() {
    var d = new Date();
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }
  function backendConvocacao() { return cfg.CONVOCACAO_BACKEND_URL || ""; }
  function primeiroNome(nome) { return (String(nome || "").trim().split(/\s+/)[0]) || ""; }

  function emailConvocacaoEntrevista(cand) {
    var links = (cfg.AGENDA_LINKS || [])
      .map(function (l, i) { return "Link para agendamento " + (i + 1) + ": " + l; })
      .join("\n");
    return {
      para: cand.email,
      assunto: "Convite para Entrevista - Processo Seletivo RBCIP",
      corpo:
        "Prezado(a),\n\n" +
        "Espero que este e-mail o(a) encontre bem.\n\n" +
        "Estamos iniciando nosso processo seletivo para oportunidades em São Paulo e região, e gostaríamos de convidá-lo(a) para uma entrevista, conforme seu interesse e inscrição na plataforma SIPE.\n\n" +
        "Para darmos continuidade, por favor, acesse um dos links abaixo e escolha o horário de sua preferência. Pedimos a gentileza de reservar apenas uma opção na agenda.\n\n" +
        links + "\n\n" +
        "A ordem dos links não interfere na ordem em que as entrevistas serão realizadas. Agende sua entrevista no que melhor se adequar aos seus horários.\n\n" +
        "Caso tenha alguma dúvida ou ocorra algum imprevisto, fique à vontade para responder a este e-mail.\n\n" +
        "Atenciosamente,",
    };
  }
  function emailConvocacaoCadastro(cand) {
    var link = cand.tipo === "interior" ? cfg.CADASTRO_LINK_INTERIOR : cfg.CADASTRO_LINK_CAPITAL;
    return {
      para: cand.email,
      assunto: "Cadastro de Bolsista - Processo Seletivo RBCIP",
      corpo:
        "Olá, " + primeiroNome(cand.nome) + "!\n\n" +
        "Sou o Lucas, da RBCIP. Você foi aprovado(a) em nossa entrevista.\n\n" +
        "Solicitamos que preencha o cadastro de bolsista no link abaixo para que possamos prosseguir com o seu termo de bolsa. Após o preenchimento, agendaremos um treinamento online para você participar e, após a conclusão dele, poderá iniciar as atividades.\n\n" +
        "Coordenador do Projeto: Marcelo Fiche\n\n" +
        "Cadastro de Bolsista: " + (link || "") + "\n\n" +
        "Além disso, é essencial que você envie os seus antecedentes criminais nas esferas Estadual e Federal para o e-mail rh@rbcip.org. O seu termo de bolsa só poderá ser gerado após o recebimento do cadastro e dos antecedentes.",
    };
  }

  // Pedido de cadastro na região certa. Quando a pessoa se cadastrou na
  // plataforma de um lado e foi entrevistada no outro, o caminho não é o
  // sistema remendar o cadastro por dentro: é ela refazer o cadastro no link
  // do projeto certo, para que a inscrição nasça correta na origem.
  function nomeRegiao(tipo) { return tipo === "interior" ? "Interior" : "Capital"; }
  function emRegiao(tipo) { return tipo === "interior" ? "no Interior" : "na Capital"; }
  function doRegiao(tipo) { return tipo === "interior" ? "do Interior" : "da Capital"; }
  function linkPlataforma(tipo) {
    return (tipo === "interior" ? cfg.PLATAFORMA_CADASTRO_INTERIOR : cfg.PLATAFORMA_CADASTRO_CAPITAL) || "";
  }
  function emailCadastroRegiao(cand, tipoCerto) {
    var errado = tipoCerto === "interior" ? "capital" : "interior";
    return {
      para: cand.email,
      assunto: "Inscrição no projeto " + doRegiao(tipoCerto) + " - Processo Seletivo RBCIP",
      corpo:
        "Olá, " + primeiroNome(cand.nome) + "!\n\n" +
        "Sou o Lucas, da RBCIP. Obrigado pela sua participação em nossa entrevista.\n\n" +
        "Na entrevista, foi registrado o seu interesse em atuar no projeto " + doRegiao(tipoCerto) +
        ". Como a sua inscrição na plataforma foi feita no projeto " + doRegiao(errado) +
        ", e cada projeto tem a sua própria inscrição, precisamos que você se inscreva no projeto " +
        doRegiao(tipoCerto) + " para seguirmos com as próximas etapas:\n\n" +
        "Inscrição na plataforma (" + nomeRegiao(tipoCerto) + "): " + linkPlataforma(tipoCerto) + "\n\n" +
        "É o mesmo formulário que você já preencheu, apenas no link do projeto correto. Não é necessário " +
        "fazer uma nova entrevista: assim que a inscrição for concluída, damos sequência ao seu processo.\n\n" +
        "Caso tenha alguma dúvida, fique à vontade para responder a este e-mail.\n\n" +
        "Atenciosamente,",
    };
  }

  // Envia via Web App do Apps Script (que valida o login e manda pelo Gmail).
  // Chamada genérica ao Web App do Apps Script (envia o token de login junto).
  function chamarBackend(extra) {
    var url = backendConvocacao();
    if (!url) {
      return Promise.reject(new Error("Envio ainda não configurado (veja docs/APPS-SCRIPT-CONVOCACAO.md)."));
    }
    return client.auth.getSession().then(function (resp) {
      var token = resp.data && resp.data.session && resp.data.session.access_token;
      if (!token) throw new Error("Sessão expirada. Entre novamente.");
      var payload = { token: token };
      Object.keys(extra || {}).forEach(function (k) { payload[k] = extra[k]; });
      return fetch(url, {
        method: "POST",
        // text/plain evita o "preflight" de CORS com o Apps Script
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || "Falha no servidor.");
          return res;
        });
    });
  }
  function enviarConvocacao(mensagens) { return chamarBackend({ mensagens: mensagens }); }

  // Pergunta ao Apps Script quais e-mails voltaram com falha de entrega (bounces).
  function verificarEntregas(btn) {
    if (!exigirAdmin("Verificar entregas")) return;
    if (!backendConvocacao()) { alert("Envio ainda não configurado. Veja docs/APPS-SCRIPT-CONVOCACAO.md."); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Verificando…'; }
    chamarBackend({ acao: "bounces", dias: 14 }).then(function (res) {
      var falhas = res.falhas || {}; // { email_minusculo: "motivo" }
      var marcados = [];
      candidatos.forEach(function (c) {
        var motivo = c.email_norm ? falhas[c.email_norm] : null;
        if (motivo && c.email_bounce !== motivo) { c.email_bounce = motivo; marcados.push(c); }
      });
      if (!marcados.length) {
        renderPainelCandidatos();
        alert("Nenhuma falha de entrega nova encontrada.\n(As falhas podem levar alguns minutos para chegar após o envio.)");
        return;
      }
      return Promise.all(marcados.map(function (c) {
        return client.from(candTabela()).update({ email_bounce: c.email_bounce, updated_at: new Date().toISOString() }).eq("id", c.id);
      })).then(function () {
        renderPainelCandidatos();
        alert(marcados.length + " e-mail(s) com falha de entrega marcados:\n\n" +
          marcados.map(function (c) { return "✗ " + c.email + " — " + c.email_bounce; }).join("\n"));
      });
    }).catch(function (e) { renderPainelCandidatos(); alert("Não foi possível verificar entregas: " + (e.message || e)); });
  }

  function convocarEntrevistaTodos(btn) {
    if (!exigirAdmin("Convocar para entrevista")) return;
    if (!backendConvocacao()) { alert("Envio ainda não configurado. Veja docs/APPS-SCRIPT-CONVOCACAO.md."); return; }
    var pendentes = candidatos.filter(function (c) { return c.tipo === candTipo && c.email && !jaConvocadoEntrevista(c); });
    if (!pendentes.length) { alert("Não há candidatos pendentes de convocação para entrevista."); return; }
    if (!confirm("Enviar convocação de ENTREVISTA para " + pendentes.length + " candidato(s) ainda não convocados (" + candTipo + ")?")) return;

    carregandoConvocacao(btn, true);
    var hoje = hojeBR();
    enviarConvocacao(pendentes.map(emailConvocacaoEntrevista)).then(function (res) {
      var enviados = (res && typeof res.enviados === "number") ? res.enviados : pendentes.length;
      if (enviados <= 0) {
        renderPainelCandidatos();
        alert("Nenhum e-mail foi enviado — nada foi marcado.\n" + diagnosticoEnvio(res) +
          "\nVeja o recibo no seu e-mail e em Apps Script → Execuções. Guia: docs/APPS-SCRIPT-CONVOCACAO.md");
        return;
      }
      var ids = pendentes.map(function (c) { c.data_convocacao_entrevista = hoje; c.convocacao_entrevista = "Enviado"; return c.id; });
      return client.from(candTabela())
        .update({ data_convocacao_entrevista: hoje, convocacao_entrevista: "Enviado", updated_at: new Date().toISOString() })
        .in("id", ids)
        .then(function () {
          renderPainelCandidatos();
          alert("Convocação de entrevista concluída.\n\n" + resumoEnvio(res, enviados, pendentes.length) +
            "\n\nOs e-mails vão para os CANDIDATOS (confira sua pasta Enviados).");
        });
    }).catch(function (e) { renderPainelCandidatos(); alert("Não foi possível enviar: " + (e.message || e)); });
  }

  // Envio individual da convocação de ENTREVISTA. Serve para reenviar depois de
  // corrigir um e-mail que voltou com falha de entrega: quando o envio dá certo,
  // a marca de falha é apagada e a data é atualizada — fica registrado que
  // desta vez funcionou.
  function convocarEntrevistaIndividual(cand, btn) {
    if (!exigirAdmin("Convocar para entrevista")) return;
    if (!backendConvocacao()) { alert("Envio ainda não configurado. Veja docs/APPS-SCRIPT-CONVOCACAO.md."); return; }
    if (!cand.email) { alert("Candidato sem e-mail cadastrado."); return; }
    var reenvio = !!cand.email_bounce;
    if (!confirm((reenvio ? "REENVIAR" : "Enviar") + " a convocação de ENTREVISTA para " +
      (cand.nome || "") + " (" + cand.email + ")?")) return;

    carregandoConvocacao(btn, true);
    enviarConvocacao([emailConvocacaoEntrevista(cand)]).then(function (res) {
      var enviados = (res && typeof res.enviados === "number") ? res.enviados : 1;
      if (enviados <= 0) {
        renderPainelCandidatos();
        alert("Nenhum e-mail foi enviado — nada foi marcado.\n" + diagnosticoEnvio(res));
        return;
      }
      var hoje = hojeBR();
      var patch = {
        data_convocacao_entrevista: hoje,
        convocacao_entrevista: "Enviado",
        email_bounce: null, // deu certo com o endereço atual
        updated_at: new Date().toISOString(),
      };
      cand.data_convocacao_entrevista = hoje;
      cand.convocacao_entrevista = "Enviado";
      cand.email_bounce = null;
      return client.from(candTabela()).update(patch).eq("id", cand.id).then(function () {
        renderPainelCandidatos();
        alert("Convocação de entrevista enviada.\n\n" + resumoEnvio(res, enviados, 1) +
          "\n\nA marca de falha de entrega foi removida. Se este endereço também " +
          "falhar, use \"Verificar entregas\" daqui a alguns minutos.");
      });
    }).catch(function (e) { renderPainelCandidatos(); alert("Não foi possível enviar: " + (e.message || e)); });
  }

  // Update que sobrevive a uma coluna que ainda não existe no banco: se o
  // Postgres recusar um campo novo, regrava sem ele em vez de perder tudo (o
  // e-mail já saiu — não dá para desfazer o envio por causa de um SQL pendente).
  function atualizarResiliente(tabela, id, patch, opcionais) {
    return client.from(tabela).update(patch).eq("id", id).then(function (resp) {
      if (!resp.error) return { ignorados: [] };
      var msg = String(resp.error.message || "");
      var faltando = (opcionais || []).filter(function (campo) { return msg.indexOf(campo) !== -1; });
      if (!faltando.length) throw resp.error;
      var limpo = {};
      Object.keys(patch).forEach(function (k) { if (faltando.indexOf(k) === -1) limpo[k] = patch[k]; });
      return client.from(tabela).update(limpo).eq("id", id).then(function (r2) {
        if (r2.error) throw r2.error;
        return { ignorados: faltando };
      });
    });
  }

  // Pede à pessoa que refaça o cadastro na plataforma do projeto certo.
  function pedirCadastroRegiao(cand, tipoCerto, btn) {
    if (!exigirAdmin("Solicitar inscrição na outra região")) return;
    if (!backendConvocacao()) { alert("Envio ainda não configurado. Veja docs/APPS-SCRIPT-CONVOCACAO.md."); return; }
    if (!cand.email) { alert("Candidato sem e-mail cadastrado."); return; }
    var link = linkPlataforma(tipoCerto);
    if (!link) {
      alert("Falta o link de cadastro da plataforma para " + nomeRegiao(tipoCerto) +
        ".\nPreencha PLATAFORMA_CADASTRO_" + tipoCerto.toUpperCase() + " em js/config.js.");
      return;
    }
    var jaPedido = !!(cand.pedido_regiao && cand.pedido_regiao.em);
    var resAtual = resultadoDoCandidato(cand, casarEntrevista(cand));
    if (!confirm(
      (jaPedido ? "REENVIAR" : "Enviar") + " para " + (cand.nome || "") + " (" + cand.email + ")\n" +
      "a solicitação de inscrição no projeto " + doRegiao(tipoCerto) + "?\n\n" +
      "Link: " + link + "\n" +
      "Resultado da entrevista: " + (resAtual || "—") + "\n\n" +
      "A pessoa se inscreve no projeto certo e passa a aparecer na aba de " +
      nomeRegiao(tipoCerto) + " na próxima importação de CSV. A convocação para o " +
      "cadastro de bolsista sai de lá."
    )) return;

    carregandoConvocacao(btn, true);
    enviarConvocacao([emailCadastroRegiao(cand, tipoCerto)]).then(function (res) {
      var enviados = (res && typeof res.enviados === "number") ? res.enviados : 1;
      if (enviados <= 0) {
        renderPainelCandidatos();
        alert("Nenhum e-mail foi enviado — nada foi marcado.\n" + diagnosticoEnvio(res));
        return;
      }
      var pedido = { em: hojeBR(), tipo: tipoCerto, por: usuarioEmail || null };
      cand.pedido_regiao = pedido;
      cand.email_bounce = null; // chegou com o endereço atual
      return atualizarResiliente(
        candTabela(),
        cand.id,
        { pedido_regiao: pedido, email_bounce: null, updated_at: new Date().toISOString() },
        ["pedido_regiao", "email_bounce"]
      ).then(function (r) {
        renderPainelCandidatos();
        var aviso = "Solicitação de inscrição enviada.\n\n" + resumoEnvio(res, enviados, 1) +
          "\n\nQuando a inscrição " + emRegiao(tipoCerto) + " for feita, ela chega na próxima " +
          "importação de CSV — e a convocação para o cadastro de bolsista passa a sair de lá.";
        if (r.ignorados.indexOf("pedido_regiao") !== -1) {
          aviso += "\n\n⚠ O envio não ficou registrado no banco: rode sql/regiao-divergente.sql " +
            "no Supabase para criar a coluna. A marca some ao atualizar a página.";
        }
        alert(aviso);
      });
    }).catch(function (e) { renderPainelCandidatos(); alert("Não foi possível enviar: " + (e.message || e)); });
  }

  function botaoPedirCadastro(cand, tipoCerto, rotulo) {
    var b = el("button", { class: "btn btn--secundario btn--pequeno cand-pedir", type: "button", text: rotulo });
    b.addEventListener("click", function () { pedirCadastroRegiao(cand, tipoCerto, b); });
    return b;
  }

  // A pessoa já tem ficha do outro lado? (recadastro concluído na plataforma).
  // Casa por CPF; sem CPF, pelo e-mail normalizado.
  // A ficha do outro lado que ASSUMIU esta pessoa: ela foi entrevistada lá e
  // já se inscreveu lá. Desse momento em diante é aquela ficha que a
  // representa — esta fica só como histórico da inscrição na região errada, e
  // não pode mais aparecer como pendência (fila de reserva, convocação) aqui.
  function fichaQueAssumiu(cand) {
    var ent = casarEntrevista(cand);
    if (!ent || ent.tipo === cand.tipo) return null;
    var outra = fichaDoOutroLado(cand);
    return (outra && outra.tipo === ent.tipo) ? outra : null;
  }

  function fichaDoOutroLado(cand) {
    var cpf = soDigitos(cand.cpf);
    var mail = cand.email_norm || normEmail(cand.email);
    if (cpf.length !== 11 && !mail) return null;
    var achada = null;
    candidatos.forEach(function (o) {
      if (achada || o.tipo === cand.tipo || o.id === cand.id) return;
      var mesmo = cpf.length === 11
        ? soDigitos(o.cpf) === cpf
        : (o.email_norm || normEmail(o.email)) === mail;
      if (mesmo) achada = o;
    });
    return achada;
  }

  // Telefone da inscrição: a plataforma guarda DDD e número em colunas separadas.
  function telefoneDaInscricao(row) {
    var ddd = soDigitos(pegaCol(row || {}, ["Telefone (que tenha WhatsApp) - DDD", "DDD"]));
    var num = soDigitos(pegaCol(row || {}, [
      "Telefone (que tenha WhatsApp) - Número", "Telefone (que tenha WhatsApp) - Numero", "Celular", "Telefone",
    ]));
    if (!num) return "";
    if (num.length > 9 && !ddd) { ddd = num.slice(0, 2); num = num.slice(2); }
    var meio = num.length > 8 ? num.slice(0, 5) : num.slice(0, 4);
    var fim = num.length > 8 ? num.slice(5) : num.slice(4);
    return (ddd ? "(" + ddd + ") " : "") + meio + (fim ? "-" + fim : "");
  }

  // ---------- Entrada na aba Formação ----------
  // Ao convocar para o cadastro de bolsista, a pessoa passa a ser acompanhada
  // na Formação. Nome, CPF, telefone e e-mail já são nossos desde a inscrição —
  // não há nada para buscar em planilha nenhuma.
  function garantirFichaFormacao(cand) {
    if (!client) return Promise.resolve();
    var cpfD = soDigitos(cand.cpf);
    var chave = (cpfD.length === 11 ? cpfD : "") || normEmail(cand.email) || normStr(cand.nome);
    if (!chave) return Promise.resolve();
    // Já acompanhada? Não mexe — preserva grupo, treinamento e o que mais houver.
    var existe = formacao.some(function (f) { return f.tipo === cand.tipo && f.chave === chave; });
    if (existe) return Promise.resolve();

    var maiorOrdem = formacao.reduce(function (m, f) {
      return f.tipo === cand.tipo ? Math.max(m, f.ordem || 0) : m;
    }, 0);
    var ficha = {
      tipo: cand.tipo,
      chave: chave,
      ordem: maiorOrdem + 1,
      nome: cand.nome || null,
      cpf: cand.cpf || null,
      telefone: telefoneDaInscricao(cand.inscricao) || null,
      email: cand.email || null,
      email_norm: cand.email_norm || normEmail(cand.email) || null,
      // Sem o sufixo "(região)": é assim que a planilha de controle e a tabela
      // de supervisores escrevem, e é por esse nome que as duas se encontram.
      regiao: cand.tipo === "interior" ? (regiaoCurta(cand.regiao) || null) : null,
      candidato_id: cand.id || null,
      // A data de entrada NÃO é carimbada aqui. Convocar é convidar; a pessoa
      // entra no projeto quando PREENCHE o Cadastro de Bolsista, e essa data
      // vem do carimbo do próprio formulário, na sincronização. Usar o dia da
      // convocação daria uma data adiantada em dias ou semanas.
      origem: { criado_por: "convocação de cadastro", em: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
    return upsertResiliente(formTabela(), [ficha], ["candidato_id", "ordem", "importado_em"])
      .then(function () { return carregarFormacao(); })
      .catch(function (e) {
        // A convocação já foi enviada: uma falha aqui não pode virar erro geral.
        mostrarStatus("#form-status", "Não foi possível abrir a ficha de formação: " + (e.message || e));
      });
  }

  function convocarCadastro(cand, btn) {
    if (!exigirAdmin("Convocar para cadastro")) return;
    if (!backendConvocacao()) { alert("Envio ainda não configurado. Veja docs/APPS-SCRIPT-CONVOCACAO.md."); return; }
    if (!cand.email) { alert("Candidato sem e-mail cadastrado."); return; }
    var reenvioCad = !!cand.email_bounce;
    // Entrevista de um lado e ficha do outro: convocar por aqui manda a pessoa
    // para a formação do lado errado. Avisa antes, não depois.
    var entCad = casarEntrevista(cand);
    // Sem vaga na região: dizer o número antes do envio, não depois.
    var vagasCad = vagasDe(cand.tipo, cand.regiao);
    var alertaVaga = (vagasCad !== null && vagasCad <= 0)
      ? "\n\nATENÇÃO: " + (cand.tipo === "capital" ? "a Capital" : regiaoCurta(cand.regiao)) +
        " já está com " + ocupacaoDe(cand.tipo, cand.regiao).total + " de " +
        metaDe(cand.tipo, cand.regiao) + " (ativos + aguardando termo). Convocando, " +
        "a região passa da meta."
      : "";
    var alertaLado = (entCad && entCad.tipo !== cand.tipo)
      ? "\n\nATENÇÃO: a entrevista foi feita no formulário " + doRegiao(entCad.tipo) +
        ", mas esta ficha é " + doRegiao(cand.tipo) + ". Convocando por aqui, a ficha de " +
        "formação nasce " + emRegiao(cand.tipo) + " — com o supervisor e a planilha de controle " +
        "dessa região."
      : "";
    if (!confirm((reenvioCad ? "REENVIAR" : "Enviar") + " a convocação de CADASTRO para " +
      (cand.nome || "") + " (" + cand.email + ")?" + alertaVaga + alertaLado)) return;

    carregandoConvocacao(btn, true);
    enviarConvocacao([emailConvocacaoCadastro(cand)]).then(function (res) {
      var enviados = (res && typeof res.enviados === "number") ? res.enviados : 1;
      if (enviados <= 0) {
        renderPainelCandidatos();
        alert("Nenhum e-mail foi enviado — nada foi marcado.\n" + diagnosticoEnvio(res) +
          "\nVeja o recibo no seu e-mail e em Apps Script → Execuções.");
        return;
      }
      var hoje = hojeBR();
      cand.data_convocacao_cadastro = hoje;
      cand.convocacao_cadastro = "Enviado";
      cand.email_bounce = null; // deu certo com o endereço atual
      return client.from(candTabela())
        .update({
          data_convocacao_cadastro: hoje,
          convocacao_cadastro: "Enviado",
          email_bounce: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cand.id)
        .then(function () { return garantirFichaFormacao(cand); })
        .then(function () {
          renderPainelCandidatos();
          alert("Convocação de cadastro concluída.\n\n" + resumoEnvio(res, enviados, 1) +
            "\n\n" + (cand.nome || "A pessoa") + " passou a ser acompanhada na aba Formação.");
        });
    }).catch(function (e) { renderPainelCandidatos(); alert("Não foi possível enviar: " + (e.message || e)); });
  }

  // Resumo do envio (enviadas, não enviadas e falhas) para o aviso de conclusão.
  function resumoEnvio(res, enviados, tentativas) {
    var recebidas = (res && typeof res.recebidas === "number") ? res.recebidas : tentativas;
    var naoEnviadas = Math.max(0, (recebidas || tentativas || 0) - enviados);
    var linhas = ["✓ Enviadas: " + enviados, "✗ Não enviadas: " + naoEnviadas];
    if (res && res.erros && res.erros.length) {
      linhas.push("Falhas:\n   " + res.erros.join("\n   "));
    }
    if (res && res.recibo) linhas.push("Recibo: " + reciboCurto(res.recibo));
    return linhas.join("\n");
  }

  // O recibo é um extra: quando ele falha, os e-mails já foram enviados. Traduz
  // o erro técnico do Apps Script para algo curto e acionável.
  function reciboCurto(txt) {
    var t = String(txt || "");
    if (/script\.send_mail|MailApp/i.test(t)) {
      return "não enviado — no Apps Script, troque MailApp.sendEmail por GmailApp.sendEmail " +
        "na parte do recibo e publique uma nova versão (docs/APPS-SCRIPT-CONVOCACAO.md). " +
        "As convocações acima saíram normalmente.";
    }
    return t.length > 160 ? t.slice(0, 160) + "…" : t;
  }

  // Resumo de diagnóstico da resposta do backend (para os avisos de falha).
  function diagnosticoEnvio(res) {
    if (!res) return "";
    var l = [];
    if (typeof res.recebidas === "number") l.push("O servidor recebeu " + res.recebidas + " mensagem(ns) e enviou " + (res.enviados || 0) + ".");
    if (res.erros && res.erros.length) l.push("Falhas: " + res.erros.join(" | "));
    return l.length ? l.join("\n") + "\n" : "";
  }

  // Estado de carregando em um botão de convocação (spinner + desabilitado).
  function carregandoConvocacao(btn, sim) {
    if (!btn) return;
    if (sim) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Enviando…';
    }
  }

  function renderPainelCandidatos() {
    var painel = $("#painel-candidatos");
    if (!painel) return;
    painel.innerHTML = "";

    // --- Projeto: a primeira decisão de quem abre a aba ---
    painel.appendChild(seletorDeProjeto(candTipo, function (t) {
      return candidatos.filter(function (c) { return c.tipo === t; }).length;
    }, "candidato", function (t) {
      candTipo = t; candBusca = ""; renderPainelCandidatos();
    }));

    var doTipo = candidatos.filter(function (c) { return c.tipo === candTipo; });
    doTipo.sort(porOrdemPlanilha);

    if (!doTipo.length) {
      painel.appendChild(el("p", {
        class: "cand-vazio",
        text: "Nenhum candidato importado ainda para " + nomeRegiao(candTipo) +
          (ehAdmin() ? ". Envie o CSV de inscrição no bloco abaixo." : "."),
      }));
      // O registro de importação (quem enviou qual arquivo, e o histórico) é
      // controle de quem importa. Para os outros perfis é ruído — e expõe o
      // e-mail de outra pessoa sem nenhuma serventia.
      if (ehAdmin()) painel.appendChild(blocoImportar("candidatos", true));
      return;
    }

    // --- Ações da aba ---
    // Atenção: a convocação geral considera TODOS do tipo, não só os filtrados
    // pela busca — o número no botão e a confirmação deixam isso explícito.
    var pendEntr = doTipo.filter(function (c) { return c.email && !jaConvocadoEntrevista(c); }).length;
    // Convocar em massa, verificar entregas e baixar a planilha são ações de
    // administrador: para os outros perfis a barra nem é construída (escondê-la
    // com CSS deixava os botões no HTML, ao alcance de um clique no inspetor).
    if (ehAdmin()) {
      var acoes = el("div", { class: "cand-acoes" });
      var btnGeral = el("button", {
        class: "btn btn--pequeno",
        type: "button",
        text: "✉ Convocar todos para entrevista (" + pendEntr + " pendente" + (pendEntr === 1 ? "" : "s") + ")",
      });
      if (!pendEntr) btnGeral.disabled = true;
      btnGeral.addEventListener("click", function () { convocarEntrevistaTodos(btnGeral); });
      acoes.appendChild(btnGeral);

      var btnExp = el("button", {
        class: "btn btn--secundario btn--pequeno", type: "button", text: "⬇ Baixar CSV",
        title: "Planilha completa de " + candTipo + ": colunas de controle preenchidas + todas as colunas da inscrição",
      });
      btnExp.addEventListener("click", function () { exportarCandidatos(candTipo); });
      acoes.appendChild(btnExp);

      var btnMaisC = menuSuspenso("⚙ Mais", "Conferência de entregas e importação", [
        {
          rotulo: "🔎 Verificar entregas",
          titulo: "Consulta as respostas do servidor de e-mail e marca os endereços que recusaram",
          acao: function () { verificarEntregas(btnMaisC.querySelector("button")); },
        },
        null,
        {
          rotulo: "📥 Importar planilha (CSV)",
          titulo: "Abre o bloco de importação no fim da página",
          acao: function () {
            var d = painel.querySelector(".recolhe--imp");
            if (!d) return;
            d.setAttribute("open", "open");
            d.scrollIntoView({ block: "center" });
          },
        },
      ]);
      acoes.appendChild(btnMaisC);

      if (!backendConvocacao()) {
        acoes.appendChild(el("span", { class: "cand-status", text: "Envio ainda não configurado — veja docs/APPS-SCRIPT-CONVOCACAO.md" }));
      }
      painel.appendChild(acoes);
    }

    // --- Metas e vagas (fechado: aqui é consulta, não leitura diária) ---
    painel.appendChild(blocoMetas(candTipo));

    // --- Lista ---
    painel.appendChild(cabecalhoDaLista("Candidatos — " + nomeRegiao(candTipo)));

    // --- Busca (nome, e-mail, CPF ou região) ---
    var buscaWrap = el("div", { class: "painel__barra" });
    var inpBusca = el("input", {
      class: "painel__busca",
      type: "search",
      placeholder: "Buscar por nome, e-mail, CPF ou região…",
      value: candBusca,
    });
    inpBusca.addEventListener("input", function () {
      candBusca = inpBusca.value;
      renderPainelCandidatos();
      var novo = $("#painel-candidatos").querySelector(".painel__busca");
      if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
    });
    buscaWrap.appendChild(inpBusca);
    painel.appendChild(buscaWrap);

    var termo = normStr(candBusca);
    var termoCPF = soDigitos(candBusca);
    var lista = !termo ? doTipo : doTipo.filter(function (c) {
      var texto = [c.nome, c.email, c.regiao, regiaoNaTabela(c.regiao)].some(function (v) { return normStr(v).indexOf(termo) !== -1; });
      var porCPF = termoCPF.length >= 3 && soDigitos(c.cpf).indexOf(termoCPF) !== -1;
      return texto || porCPF;
    });

    if (!lista.length) {
      painel.appendChild(el("p", { class: "cand-vazio", text: "Nenhum candidato encontrado para esta busca." }));
      if (ehAdmin()) painel.appendChild(blocoImportar("candidatos", false));
      return;
    }

    var cols = ["Nome", "E-mail", "CPF"];
    if (candTipo === "interior") cols.push("Região");
    cols = cols.concat(["Convocação entrevista", "Resultado", "Data entrevista", "Convocação cadastro"]);
    if (ehAdmin()) cols.push("Editar");

    // Como cada coluna se ordena. As de etapa (convocações) vão por estágio, e
    // não por texto: o que se procura é "quem ainda está pendente".
    var chavesCand = {
      "Nome": function (c) { return normStr(c.nome); },
      "E-mail": function (c) { return normStr(c.email); },
      "CPF": function (c) { return soDigitos(c.cpf); },
      "Região": function (c) { return normStr(regiaoNaTabela(c.regiao)); },
      "Convocação entrevista": function (c) {
        if (c.email_bounce) return "1 falha";
        if (c.data_convocacao_entrevista) return "3 " + chaveData(c.data_convocacao_entrevista);
        if (c.convocacao_entrevista === "Enviado" || casarEntrevista(c)) return "3";
        return "0 pendente";
      },
      "Resultado": function (c) { return normStr(resultadoDoCandidato(c, casarEntrevista(c))); },
      "Data entrevista": function (c) {
        var e = casarEntrevista(c);
        return chaveData(e ? e.data_entrevista : c.data_entrevista);
      },
      "Convocação cadastro": function (c) {
        if (c.data_convocacao_cadastro) return "3 " + chaveData(c.data_convocacao_cadastro);
        if (c.convocacao_cadastro === "Enviado") return "3";
        var selec = normStr(resultadoDoCandidato(c, casarEntrevista(c))).indexOf("selecionado") === 0;
        if (!selec) return "";              // não se aplica: vai para o fim
        return emReserva(c) ? "1 reserva" : "0 pendente";
      },
    };
    if (candTipo !== "interior") delete chavesCand["Região"];

    var estadoCand = ordemLista.candidatos;
    lista = ordenarLista(lista, estadoCand, chavesCand);
    painel.appendChild(seletorDeOrdem(cols, estadoCand, chavesCand, renderPainelCandidatos));

    var tabela = el("table", { class: "tabela tabela--cand" });
    var thead = el("thead");
    thead.appendChild(cabecalhoOrdenavel(cols, estadoCand, chavesCand, renderPainelCandidatos));
    tabela.appendChild(thead);

    var tbody = el("tbody");
    var casados = 0;
    lista.forEach(function (c) {
      var ent = casarEntrevista(c);
      if (ent) casados++;
      var tr = el("tr", { class: "tabela__tr" });
      var editados = Object.keys(c.editado || {}).length;
      var tdNome = el("td", { class: "tabela__td cand-td-nome" });
      tdNome.appendChild(el("span", { text: c.nome || "—" }));
      if (editados) {
        tdNome.appendChild(el("span", {
          class: "cand-editado",
          title: editados + " campo(s) editado(s) no sistema — a planilha não sobrescreve",
          text: "✎ editado",
        }));
      }
      tr.appendChild(tdNome);
      // E-mail (com aviso de falha de entrega, se houver).
      var tdEmail = el("td", { class: "tabela__td cand-email", "data-label": "E-mail", title: c.email || "" });
      tdEmail.appendChild(el("span", { text: c.email || "—" }));
      // A falha era do endereço ANTIGO: depois da correção, repeti-la embaixo do
      // endereço novo acusaria de inválido um e-mail que ainda não foi testado.
      if (c.email_bounce && !(c.editado && c.editado.email)) {
        tdEmail.appendChild(el("div", { class: "cand-bounce", text: "✗ " + c.email_bounce }));
      }
      tr.appendChild(tdEmail);
      tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "CPF", text: formatarCPF(c.cpf) }));
      if (candTipo === "interior") {
        // Nome curto: "Baixada Santista (Santos / Praia Grande / Guarujá)"
        // empilhava cinco linhas numa coluna espremida. O nome inteiro fica no
        // "passe o mouse".
        tr.appendChild(el("td", {
          class: "tabela__td col-regiao", "data-label": "Região", title: c.regiao || "",
          text: regiaoNaTabela(c.regiao),
        }));
      }

      // Convocação entrevista: falha de entrega tem prioridade; senão data/Enviado/pendente.
      var tdConvE = el("td", { class: "tabela__td", "data-label": "Convocação entrevista" });
      if (c.email_bounce) {
        // Falhou: mostra o motivo e, para o admin, o botão de reenviar. Se o
        // e-mail já foi corrigido à mão, o motivo antigo confunde (o endereço
        // errado não existe mais) — o que importa é que falta reenviar.
        if (c.editado && c.editado.email) {
          tdConvE.appendChild(tagPendente("corrigido — reenviar",
            "O endereço foi corrigido aqui no painel. A convocação anterior não chegou (" +
            c.email_bounce + "); reenvie para o endereço novo."));
        } else {
          tdConvE.appendChild(el("span", { class: "cand-bounce", text: "✗ " + c.email_bounce }));
        }
        if (ehAdmin() && c.email) {
          var btnRe = el("button", { class: "btn btn--secundario btn--pequeno cand-reenviar", type: "button", text: "✉ Reenviar" });
          btnRe.addEventListener("click", function () { convocarEntrevistaIndividual(c, btnRe); });
          tdConvE.appendChild(btnRe);
        }
      } else if (c.data_convocacao_entrevista) {
        tdConvE.appendChild(el("span", { class: "cand-enviado", text: "✓ " + c.data_convocacao_entrevista }));
      } else if (c.convocacao_entrevista === "Enviado") {
        tdConvE.appendChild(el("span", { class: "cand-enviado", text: "✓ Enviado" }));
      } else if (ent) {
        // Entrevistada sem convite registrado nesta ficha: o convite saiu por
        // outra ficha (recadastro na região certa) ou antes de o sistema
        // registrar isso. Dizer "pendente" seria mentir sobre uma etapa vencida.
        tdConvE.appendChild(el("span", {
          class: "cand-enviado",
          title: "A entrevista foi realizada, então esta etapa já passou. O convite não " +
            "está registrado nesta ficha — saiu pela ficha anterior ou antes de o sistema registrar.",
          text: "✓ entrevista realizada",
        }));
      } else {
        tdConvE.appendChild(tagPendente("pendente",
          "Ainda não recebeu a convocação para a entrevista."));
      }
      tr.appendChild(tdConvE);

      // Resultado: prioriza a entrevista casada (sistema); senão o valor da planilha.
      var res = resultadoDoCandidato(c, ent);
      var tdRes = el("td", { class: "tabela__td", "data-label": "Resultado" });
      // Recadastro já feito do outro lado? Se sim, esta ficha é só o histórico
      // do cadastro errado — quem manda dali para frente é a ficha de lá.
      var recadastrada = fichaQueAssumiu(c);
      if (ent) {
        tdRes.appendChild(tagResultado(res, "sistema"));
        // Entrevista feita do outro lado: avisa, porque as etapas seguintes
        // (cadastro e formação) vão para o lado da FICHA, não da entrevista.
        if (ent.tipo !== c.tipo) {
          var certo = ent.tipo;
          var caixa = el("div", { class: "cand-divergencia" });
          caixa.appendChild(el("span", {
            class: "cand-outro-lado",
            title: "A inscrição é " + doRegiao(c.tipo) +
              ", mas a entrevista foi feita no formulário " + doRegiao(certo) +
              ". O caminho certo é a pessoa refazer o cadastro na plataforma " + doRegiao(certo) + ".",
            text: "⇄ entrevista: " + nomeRegiao(certo),
          }));
          if (recadastrada) {
            caixa.appendChild(el("span", {
              class: "cand-recadastrado",
              title: "A inscrição " + emRegiao(certo) + " foi feita e já existe ficha na aba de " +
                nomeRegiao(certo) + ". As próximas etapas seguem por lá.",
              text: "✓ inscrição feita " + emRegiao(certo),
            }));
          } else if (c.pedido_regiao && c.pedido_regiao.em) {
            caixa.appendChild(el("span", {
              class: "cand-pedido",
              title: "Solicitação de inscrição " + emRegiao(c.pedido_regiao.tipo || certo) + " enviada em " +
                c.pedido_regiao.em + (c.pedido_regiao.por ? " por " + c.pedido_regiao.por : "") +
                ". Assim que a inscrição for feita, aparece aqui a marca de inscrição concluída.",
              text: "✉ inscrição solicitada em " + c.pedido_regiao.em,
            }));
          }
          tdRes.appendChild(caixa);
        }
      } else if (c.resultado_entrevista) {
        tdRes.appendChild(tagResultado(c.resultado_entrevista, "planilha"));
      } else {
        tdRes.textContent = "—";
      }
      tr.appendChild(tdRes);

      var data = ent ? ent.data_entrevista : c.data_entrevista;
      tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "Data entrevista", text: data ? formatarData(data) : "—" }));

      // Convocação cadastro: já enviada (data/status), ou botão (só p/ selecionados), ou —.
      var tdConvC = el("td", { class: "tabela__td", "data-label": "Convocação cadastro" });
      var selecionado = res.toUpperCase().indexOf("SELECIONADO") === 0;
      var cadastroEnviado = !!(c.data_convocacao_cadastro || c.convocacao_cadastro === "Enviado");
      if (cadastroEnviado) {
        tdConvC.appendChild(el("span", {
          class: "cand-enviado",
          text: c.data_convocacao_cadastro ? "✓ Enviado em " + c.data_convocacao_cadastro : "✓ Enviado",
        }));
        // Se o e-mail voltou com falha, esse "enviado" não chegou: permite reenviar.
        if (c.email_bounce && ehAdmin() && c.email) {
          var btnReCad = el("button", { class: "btn btn--secundario btn--pequeno cand-reenviar", type: "button", text: "✉ Reenviar" });
          btnReCad.addEventListener("click", function () { convocarCadastro(c, btnReCad); });
          tdConvC.appendChild(btnReCad);
        }
      } else if (selecionado && !recadastrada && emReserva(c)) {
        // Região sem vaga: o próximo passo não é convocar, é esperar abrir vaga
        // (ou decidir conscientemente convocar assim mesmo).
        var vagasReg = ocupacaoDe(c.tipo, c.regiao);
        var caixaRes = el("div", { class: "cand-divergencia" });
        caixaRes.appendChild(el("span", {
          class: "tag tag--ambar tag--com-icone cand-reserva",
          title: (c.tipo === "capital" ? "Capital" : regiaoCurta(c.regiao)) + " está com " +
            vagasReg.total + " de " + metaDe(c.tipo, c.regiao) + " (ativos + aguardando termo). " +
            "Quando alguém for desligado, a vaga abre.",
          text: "⏸ Reserva",
        }));
        if (ehAdmin() && c.email) {
          var btnMesmo = el("button", {
            class: "btn btn--secundario btn--pequeno", type: "button", text: "Convocar mesmo assim",
          });
          btnMesmo.addEventListener("click", function () { convocarCadastro(c, btnMesmo); });
          caixaRes.appendChild(btnMesmo);
        }
        tdConvC.appendChild(caixaRes);
      } else if (selecionado && recadastrada) {
        // Já existe ficha do lado certo: convocar por aqui criaria a pessoa
        // duas vezes na Formação, e do lado errado.
        tdConvC.appendChild(el("span", {
          class: "cand-pendente",
          title: "A inscrição " + emRegiao(recadastrada.tipo) + " foi feita e tem ficha na aba de " +
            nomeRegiao(recadastrada.tipo) + ". Convoque para o cadastro de bolsista por lá.",
          text: "→ convocar " + emRegiao(recadastrada.tipo),
        }));
      } else if (selecionado && ent && ent.tipo !== c.tipo) {
        // Inscrição de um lado, entrevista do outro: o próximo passo NÃO é
        // convocar daqui (a ficha de formação nasceria na região errada) — é a
        // pessoa se inscrever no projeto certo. Por isso o botão é outro.
        var certoCad = ent.tipo;
        var jaSolicitado = !!(c.pedido_regiao && c.pedido_regiao.em);
        if (ehAdmin() && c.email) {
          tdConvC.appendChild(botaoPedirCadastro(c, certoCad,
            jaSolicitado ? "✉ Reenviar solicitação" : "✉ Solicitar inscrição " + emRegiao(certoCad)));
        } else {
          tdConvC.appendChild(el("span", {
            class: "cand-pendente",
            title: "A entrevista foi feita no formulário " + doRegiao(certoCad) +
              ". A pessoa precisa se inscrever na plataforma " + doRegiao(certoCad) + " antes da convocação.",
            text: "aguarda inscrição " + emRegiao(certoCad),
          }));
        }
      } else if (selecionado && ehAdmin() && c.email) {
        var btnCad = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "✉ Convocar cadastro" });
        btnCad.addEventListener("click", function () { convocarCadastro(c, btnCad); });
        tdConvC.appendChild(btnCad);
      } else if (selecionado) {
        // Sem permissão (ou sem e-mail): mostra o ESTADO, não o botão. Quem só
        // lê precisa saber que falta convocar — não precisa poder convocar.
        tdConvC.appendChild(tagPendente("pendente",
          c.email ? "Selecionado, aguardando a convocação para o cadastro de bolsista."
            : "Selecionado, mas sem e-mail cadastrado — não há para onde enviar a convocação."));
      } else {
        tdConvC.appendChild(el("span", { class: "cand-pendente", text: "—" }));
      }
      tr.appendChild(tdConvC);

      if (ehAdmin()) {
        var tdEd = el("td", { class: "tabela__td cand-td-editar", "data-label": "Editar" });
        var btnEd = botaoLapis("Editar a ficha de " + (c.nome || "este candidato"));
        btnEd.addEventListener("click", function () { abrirEdicaoCandidato(c); });
        tdEd.appendChild(btnEd);
        tr.appendChild(tdEd);
      }
      tbody.appendChild(tr);
    });
    tabela.appendChild(tbody);

    var resumo = el("p", { class: "cand-resumo" });
    resumo.appendChild(el("span", {
      text: lista.length + (termo ? " de " + doTipo.length : "") + " candidatos · " +
        casados + " com entrevista casada automaticamente pelo sistema · " +
        notaDaOrdem(lista, estadoCand),
    }));
    resumo.appendChild(legendaFontes());
    painel.appendChild(resumo);
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    painel.appendChild(wrap);

    if (ehAdmin()) painel.appendChild(blocoImportar("candidatos", false));
  }

  // ============================================================
  //  Formação (bolsistas em treinamento/trabalho)
  //  Espelha as planilhas formacao_capital / formacao_interior e liga cada
  //  bolsista à entrevista feita no sistema pelo CPF (chave-mestra).
  // ============================================================
  var formacao = [];
  var formTipo = "capital";
  // Quem está sendo listado: "projeto" (ativos + aguardando termo) ou
  // "desligados". Desligar não apaga ninguém — muda de lista.
  var formVer = "projeto";
  var formMsg = "";
  var formBusca = "";

  function formTabela() { return cfg.FORMACAO_TABELA || "formacao"; }

  // Converte uma linha do CSV de formação numa ficha de bolsista.
  // Os dois formatos (Capital e Interior) são lidos pelo mesmo mapeamento:
  // a Capital tem "Grupo" e um treinamento só; o Interior tem "Região" e dois.
  function linhaParaFormacao(tipo, row, idx) {
    var nome = pegaCol(row, ["Nome completo", "Nome"]);
    var cpf = pegaCol(row, ["CPF"]);
    var email = pegaCol(row, ["Email", "E-mail"]);
    var emailN = normEmail(email);
    var cpfD = soDigitos(cpf);
    var chave = (cpfD.length === 11 ? cpfD : "") || emailN || normStr(nome);
    if (!chave) return null;
    return {
      tipo: tipo,
      chave: chave,
      ordem: idx + 1,
      nome: nome || null,
      cpf: cpf || null,
      telefone: pegaCol(row, ["Telefone", "Celular"]) || null,
      email: email || null,
      email_norm: emailN || null,
      grupo: pegaCol(row, ["Grupo"]) || null,
      regiao: pegaCol(row, COLS_REGIAO) || null,
      supervisor: pegaCol(row, ["Supervisor"]) || null,
      status: pegaCol(row, ["Status"]) || null,
      cadastro_bolsista: pegaCol(row, ["Cadastro de Bolsista"]) || null,
      // Um treinamento só: qualquer uma das colunas antigas cai no mesmo campo.
      treinamento_online: null,
      data_treinamento_online: null,
      // Na Capital a coluna se chama "Treinamento Presencial/Online" (é o único).
      treinamento_presencial: pegaCol(row, [
        "Treinamento", "Treinamento Presencial", "Treinamento Presencial/Online", "Treinamento Online",
      ]) || null,
      data_treinamento_presencial: pegaCol(row, [
        "Data do Treinamento", "Data do Treinamento Presencial", "Data do Treinamento Online",
      ]) || null,
      termo_bolsa: pegaCol(row, ["Termo de Bolsa"]) || null,
      termo_link: pegaCol(row, ["Documento do Termo de Bolsa"]) || null,
      origem: row,
      updated_at: new Date().toISOString(),
    };
  }

  function importarFormacaoCSV(tipo, text, arquivo) {
    var parsed = parseCSV(text);
    var agora = new Date().toISOString();
    var jaExistem = {};
    formacao.forEach(function (f) { if (f.tipo === tipo) jaExistem[f.chave] = true; });

    // Campos que a pessoa preenche no painel: uma reimportação não pode
    // desfazer o que foi definido aqui dentro.
    var CAMPOS_MANUAIS = [
      "grupo", "treinamento_online", "data_treinamento_online",
      "treinamento_presencial", "data_treinamento_presencial",
    ];
    var porChave = {};
    formacao.forEach(function (x) { if (x.tipo === tipo) porChave[x.chave] = x; });

    var mapa = {};
    var criadas = 0, atualizadas = 0;
    parsed.rows.forEach(function (row, idx) {
      var f = linhaParaFormacao(tipo, row, idx);
      if (!f) return;
      if (!mapa[f.chave]) { if (jaExistem[f.chave]) atualizadas++; else criadas++; }
      f.importado_em = agora;
      var ex = porChave[f.chave];
      if (ex) {
        CAMPOS_MANUAIS.forEach(function (campo) { if (ex[campo]) f[campo] = ex[campo]; });
        // Identificação, termo e cadastro: arquivo sem a coluna (ou com ela
        // vazia) não apaga o que existe. O "Realizado" do cadastro costuma vir
        // da sincronização, que lê o formulário de verdade — um CSV antigo não
        // pode desfazer isso em silêncio.
        ["nome", "cpf", "telefone", "email", "email_norm", "regiao",
          "termo_link", "termo_bolsa", "cadastro_bolsista"]
          .forEach(function (campo) { if (!f[campo] && ex[campo]) f[campo] = ex[campo]; });
      }
      mapa[f.chave] = f; // deduplica por CPF/e-mail/nome
    });
    var rows = Object.keys(mapa).map(function (k) { return mapa[k]; });
    if (!rows.length) return Promise.reject(new Error("Nenhuma linha válida encontrada no CSV."));
    return upsertResiliente(formTabela(), rows, ["importado_em", "ordem"])
      .then(function () {
        return registrarImportacao({
          aba: "formacao", tipo: tipo, arquivo: arquivo,
          linhas: rows.length, criadas: criadas, atualizadas: atualizadas,
        });
      })
      .then(function () { return { total: rows.length, criadas: criadas, atualizadas: atualizadas }; });
  }

  function carregarFormacao() {
    if (!client) return Promise.resolve();
    return client.from(formTabela()).select("*").then(function (resp) {
      if (resp.error) {
        mostrarStatus("#form-status", /does not exist|relation/i.test(resp.error.message || "")
          ? "Tabela ainda não criada — rode sql/formacao.sql no Supabase."
          : "Não foi possível carregar a formação: " + (resp.error.message || resp.error));
        return;
      }
      formacao = resp.data || [];
      var badge = $("#cont-formacao");
      if (badge) badge.textContent = formacao.length;
      renderPainelFormacao();
      // A aba Termos de Bolsa lê as mesmas fichas: sem isto ela ficaria zerada
      // até a próxima vez que a tela inteira fosse redesenhada.
      renderPainelTermos();
    });
  }

  // ---------- Supervisores (por grupo na Capital, por região no Interior) ----------
  var supervisores = [];

  function carregarSupervisores() {
    if (!client) return Promise.resolve();
    try {
      return client.from("supervisores").select("*").then(function (resp) {
        supervisores = (!resp.error && resp.data) ? resp.data : [];
      }).catch(function () { supervisores = []; });
    } catch (e) { supervisores = []; return Promise.resolve(); }
  }

  // ---------- Metas por região e vagas ----------
  // A meta diz quantos entrevistadores cada região precisa ter. Ela muda com o
  // tempo, então mora no banco e é editada no painel — nunca no código.
  //
  // Ocupa vaga quem está na Formação e NÃO foi desligado (Ativo + Aguardando
  // termo): quem recebeu a convocação de cadastro e ainda espera o termo já
  // está comprometido com a região. Desligar alguém devolve a vaga sozinho.
  var metas = [];

  function carregarMetas() {
    if (!client) return Promise.resolve();
    try {
      return client.from("metas").select("*").then(function (resp) {
        metas = (!resp.error && resp.data) ? resp.data : [];
      }).catch(function () { metas = []; });
    } catch (e) { metas = []; return Promise.resolve(); }
  }

  // Capital tem uma meta só; no Interior, uma por região (comparada sem acento
  // e sem o sufixo "(região)", que aparece em umas planilhas e não em outras).
  function chaveMeta(tipo, regiao) {
    return tipo === "capital" ? "capital" : normStr(regiaoCurta(regiao));
  }
  function registroMeta(tipo, regiao) {
    var k = chaveMeta(tipo, regiao);
    return metas.filter(function (m) {
      return m.tipo === tipo && chaveMeta(tipo, m.regiao) === k;
    })[0] || null;
  }
  function metaDe(tipo, regiao) {
    var r = registroMeta(tipo, regiao);
    return (r && typeof r.meta === "number") ? r.meta : null;
  }

  function ocupacaoDe(tipo, regiao) {
    var k = chaveMeta(tipo, regiao);
    var ativos = 0, aguardando = 0;
    formacao.forEach(function (f) {
      if (f.tipo !== tipo || chaveMeta(tipo, f.regiao) !== k) return;
      var st = situacaoFormacao(f);
      if (st === "Ativo") ativos++;
      else if (st !== "Desligado") aguardando++;
    });
    return { ativos: ativos, aguardando: aguardando, total: ativos + aguardando };
  }

  // null = região sem meta definida (nada é bloqueado, funciona como antes).
  function vagasDe(tipo, regiao) {
    var meta = metaDe(tipo, regiao);
    if (meta === null) return null;
    return meta - ocupacaoDe(tipo, regiao).total;
  }

  // Aprovados ainda não convocados para o cadastro: a fila da região.
  function reservaDe(tipo, regiao) {
    var k = chaveMeta(tipo, regiao);
    return candidatos.filter(function (c) {
      if (c.tipo !== tipo || chaveMeta(tipo, c.regiao) !== k) return false;
      if (jaConvocadoCadastro(c)) return false;
      // Quem se inscreveu de novo na região certa é acompanhado por lá: a
      // ficha antiga não é fila de ninguém.
      if (fichaQueAssumiu(c)) return false;
      var res = resultadoDoCandidato(c, casarEntrevista(c));
      return res.indexOf("SELECIONADO") === 0;
    }).sort(function (a, b) { return notaDoCandidato(b) - notaDoCandidato(a); });
  }
  function notaDoCandidato(c) {
    var e = casarEntrevista(c);
    return (e && typeof e.pontuacao_total === "number") ? e.pontuacao_total : -1;
  }

  // Sem vaga o próximo aprovado entra na reserva em vez de ser convocado.
  function emReserva(c) {
    var v = vagasDe(c.tipo, c.regiao);
    return v !== null && v <= 0;
  }

  // Regiões que aparecem no controle de metas: as conhecidas do sistema mais
  // as que já existem nos dados (uma região nova numa planilha não pode ficar
  // invisível só porque ainda não está na lista).
  function regioesDaMeta(tipo) {
    if (tipo === "capital") return ["Capital"];
    var vistas = {}, saida = [];
    function juntar(nome) {
      var curto = regiaoCurta(nome);
      if (!curto || curto === "—") return;
      var k = normStr(curto);
      if (vistas[k]) return;
      vistas[k] = true;
      saida.push(curto);
    }
    Object.keys(REGIOES).forEach(juntar);
    metas.forEach(function (m) { if (m.tipo === "interior") juntar(m.regiao); });
    formacao.forEach(function (f) { if (f.tipo === "interior") juntar(f.regiao); });
    candidatos.forEach(function (c) { if (c.tipo === "interior") juntar(c.regiao); });
    return saida.sort(function (a, b) { return normStr(a).localeCompare(normStr(b)); });
  }

  // Bloco "Metas e vagas". Vem fechado por padrão (é referência, não leitura
  // diária), mas o resumo do cabeçalho já diz se alguma região fechou.
  function blocoMetas(tipo) {
    var regioes = regioesDaMeta(tipo);
    var comMeta = regioes.filter(function (r) { return metaDe(tipo, r) !== null; });
    var lotadas = comMeta.filter(function (r) { return vagasDe(tipo, r) <= 0; });
    var vagasTotais = comMeta.reduce(function (s, r) { return s + Math.max(0, vagasDe(tipo, r)); }, 0);

    // Sempre fechado ao abrir a aba: é consulta, não leitura diária. O resumo
    // no cabeçalho já responde "tem vaga?" sem precisar abrir.
    var caixa = el("details", { class: "metas" });
    // O nome do projeto entra no resumo porque a aba de dados pode mostrar os
    // dois blocos (Capital e Interior) um embaixo do outro.
    var resumo = el("summary", { class: "metas__resumo" });
    var seta = el("span", { class: "metas__seta", "aria-hidden": "true" });
    seta.innerHTML = '<svg viewBox="0 0 16 16" focusable="false">' +
      '<path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    resumo.appendChild(seta);
    resumo.appendChild(el("span", { class: "metas__titulo", text: "Metas e vagas" }));
    resumo.appendChild(el("span", { class: "metas__projeto", text: nomeRegiao(tipo) }));
    if (!comMeta.length) {
      resumo.appendChild(el("span", { class: "metas__nenhuma", text: "nenhuma meta definida ainda" }));
    } else {
      resumo.appendChild(el("span", {
        class: "tag " + (vagasTotais ? "tag--verde" : "tag--cinza") + " metas__chip",
        text: vagasTotais + " vaga(s) em aberto",
      }));
      if (lotadas.length) {
        resumo.appendChild(el("span", {
          class: "tag tag--ambar metas__chip",
          text: lotadas.length + (lotadas.length === 1 ? " região sem vaga" : " regiões sem vaga"),
        }));
      }
    }
    caixa.appendChild(resumo);

    var tabela = el("table", { class: "metas__tab" });
    var thead = el("tr", {}, [
      el("th", { text: tipo === "capital" ? "Projeto" : "Região" }),
      el("th", { text: "Meta" }),
      el("th", { text: "Ocupadas" }),
      el("th", { text: "Vagas" }),
      el("th", { text: "Reserva" }),
    ]);
    tabela.appendChild(el("thead", {}, [thead]));
    var corpo = el("tbody");
    var ocultas = 0;
    regioes.forEach(function (r) {
      var meta = metaDe(tipo, r);
      var oc = ocupacaoDe(tipo, r);
      var vagas = vagasDe(tipo, r);
      var reserva = reservaDe(tipo, r);
      // Região sem meta, sem bolsista e sem fila não tem o que mostrar: entra
      // só na contagem do rodapé (e continua na lista de edição de metas).
      if (meta === null && !oc.total && !reserva.length) { ocultas++; return; }
      // Os `data-label` fazem cada linha virar um cartão no celular (a tabela
      // de cinco colunas não cabe na tela do telefone).
      var tr = el("tr");
      tr.appendChild(el("td", { class: "metas__reg", text: r }));
      tr.appendChild(el("td", { "data-label": "Meta", text: meta === null ? "—" : String(meta) }));
      // Número grande + detalhe em letra miúda: no celular o detalhe cai numa
      // linha só embaixo, em vez de quebrar o "(2 ativo(s) + 0 aguardando)".
      var tdO = el("td", {
        "data-label": "Ocupadas",
        title: oc.ativos + " ativo(s) + " + oc.aguardando + " aguardando termo",
      });
      tdO.appendChild(el("span", { class: "metas__oc", text: String(oc.total) }));
      if (oc.total) {
        tdO.appendChild(el("span", {
          class: "metas__oc-det",
          text: oc.ativos + " ativo(s) + " + oc.aguardando + " aguardando",
        }));
      }
      tr.appendChild(tdO);
      var tdV = el("td", { "data-label": "Vagas" });
      if (meta === null) tdV.appendChild(el("span", { class: "cand-pendente", text: "sem meta" }));
      else if (vagas > 0) tdV.appendChild(el("span", { class: "tag tag--verde", text: vagas + " vaga(s)" }));
      else tdV.appendChild(el("span", { class: "tag tag--ambar", text: vagas === 0 ? "sem vaga" : "excedente de " + (-vagas) }));
      tr.appendChild(tdV);
      var tdR = el("td", { "data-label": "Reserva" });
      if (!reserva.length) tdR.appendChild(el("span", { class: "cand-pendente", text: "—" }));
      else {
        var bR = el("button", {
          class: "btn btn--secundario btn--pequeno", type: "button",
          text: reserva.length + " na fila",
          title: "Ver a fila de aprovados ainda não convocados, do maior para o menor desempenho",
        });
        bR.addEventListener("click", function () { abrirReserva(tipo, r); });
        tdR.appendChild(bR);
      }
      tr.appendChild(tdR);
      corpo.appendChild(tr);
    });
    tabela.appendChild(corpo);
    caixa.appendChild(tabela);

    if (ehAdmin()) {
      var bEd = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "⚙ Editar metas" });
      bEd.addEventListener("click", function () { abrirMetas(tipo); });
      caixa.appendChild(el("div", { class: "metas__acoes" }, [bEd]));
    }
    caixa.appendChild(el("p", {
      class: "metas__nota",
      text: "Ocupam vaga os bolsistas ativos e os que aguardam o termo de bolsa. " +
        "Quem é desligado devolve a vaga. Região sem meta não bloqueia convocação." +
        (ocultas ? " (" + ocultas + " região(ões) sem meta, sem bolsista e sem fila não aparecem aqui.)" : ""),
    }));
    return caixa;
  }

  function abrirMetas(tipo) {
    if (!ehAdmin()) return;
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: "Metas — " + (tipo === "capital" ? "Capital" : "Interior") }));
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: "Quantos entrevistadores cada região precisa ter. Deixe em branco para não " +
        "controlar vagas naquela região. Vale a partir do momento em que você salvar.",
    }));

    var form = el("form", { class: "edicao" });
    var entradas = [];
    regioesDaMeta(tipo).forEach(function (r) {
      var meta = metaDe(tipo, r);
      var linha = el("div", { class: "edicao__campo" });
      linha.appendChild(el("label", { class: "edicao__rot", text: r }));
      var entrada = el("input", {
        class: "edicao__entrada", type: "number", min: "0", step: "1",
        value: meta === null ? "" : String(meta), placeholder: "sem meta",
      });
      linha.appendChild(entrada);
      form.appendChild(linha);
      entradas.push({ regiao: r, entrada: entrada, atual: meta });
    });

    var msg = el("p", { class: "edicao__msg" });
    var salvar = el("button", { class: "btn btn--pequeno", type: "submit", text: "Salvar" });
    var cancelar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", fecharModal);
    form.appendChild(el("div", { class: "edicao__acoes" }, [salvar, cancelar]));
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var linhas_ = [];
      entradas.forEach(function (item) {
        var txt = item.entrada.value.trim();
        var valor = txt === "" ? null : parseInt(txt, 10);
        if (valor !== null && (isNaN(valor) || valor < 0)) return;
        if (valor === item.atual) return;
        linhas_.push({
          tipo: tipo,
          regiao: tipo === "capital" ? "Capital" : item.regiao,
          meta: valor,
          atualizado_em: new Date().toISOString(),
          atualizado_por: usuarioEmail || null,
        });
      });
      if (!linhas_.length) { msg.textContent = "Nada foi alterado."; return; }
      salvar.disabled = true;
      msg.textContent = "Salvando…";
      client.from("metas").upsert(linhas_, { onConflict: "tipo,regiao" }).then(function (resp) {
        salvar.disabled = false;
        if (resp && resp.error) {
          msg.className = "edicao__msg edicao__msg--erro";
          msg.textContent = /relation .* does not exist|schema cache/i.test(resp.error.message || "")
            ? "A tabela de metas ainda não existe: rode sql/metas.sql no Supabase."
            : "Não foi possível salvar: " + (resp.error.message || resp.error);
          return;
        }
        carregarMetas().then(function () {
          fecharModal();
          renderPainelCandidatos();
          renderPainelFormacao();
        });
      });
    });

    alvo.appendChild(form);
    mostrar($("#modal"), true);
  }

  // A fila de reserva de uma região: quem já foi aprovado e ainda não recebeu a
  // convocação de cadastro, do maior para o menor desempenho na entrevista.
  function abrirReserva(tipo, regiao) {
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    var vagas = vagasDe(tipo, regiao);
    alvo.appendChild(el("h2", { class: "modal__titulo", text: "Fila de reserva — " + regiao }));
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: vagas === null ? "Região sem meta definida."
        : (vagas > 0 ? vagas + " vaga(s) em aberto." : "Sem vaga: a região está com " +
          ocupacaoDe(tipo, regiao).total + " de " + metaDe(tipo, regiao) + "."),
    }));

    var lista = reservaDe(tipo, regiao);
    // Quem não é administrador vê a fila (é informação: quem está esperando e
    // em que ordem), mas sem a coluna de ação — não há o que ele possa fazer
    // ali, e uma coluna vazia só parece um botão que sumiu.
    var podeConvocar = ehAdmin();
    var tabela = el("table", { class: "metas__tab" });
    var cab = [el("th", { text: "#" }), el("th", { text: "Nome" }), el("th", { text: "Nota" }),
      el("th", { text: "Entrevista" })];
    if (podeConvocar) cab.push(el("th", { text: "" }));
    tabela.appendChild(el("thead", {}, [el("tr", {}, cab)]));
    var corpo = el("tbody");
    lista.forEach(function (c, i) {
      var ent = casarEntrevista(c);
      var tr = el("tr");
      tr.appendChild(el("td", { text: String(i + 1) }));
      tr.appendChild(el("td", { class: "metas__reg", text: c.nome || "(sem nome)" }));
      tr.appendChild(el("td", { text: ent && ent.pontuacao_total != null ? ent.pontuacao_total + "/" + (ent.pontuacao_maxima || 36) : "—" }));
      tr.appendChild(el("td", { text: ent ? formatarData(ent.data_entrevista) : "—" }));
      if (podeConvocar) {
        var tdA = el("td");
        if (c.email) {
          var b = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "✉ Convocar cadastro" });
          b.addEventListener("click", function () { fecharModal(); convocarCadastro(c, b); });
          tdA.appendChild(b);
        }
        tr.appendChild(tdA);
      }
      corpo.appendChild(tr);
    });
    tabela.appendChild(corpo);
    alvo.appendChild(lista.length ? tabela : el("p", { class: "vazio", text: "Ninguém na fila." }));
    if (!podeConvocar && lista.length) {
      alvo.appendChild(el("p", {
        class: "metas__nota",
        text: "Convocar para o cadastro é ação do administrador.",
      }));
    }
    mostrar($("#modal"), true);
  }

  // A "chave" do bolsista: o grupo na Capital, a região no Interior.
  function chaveSupervisao(f) {
    return (f.tipo === "capital" ? f.grupo : f.regiao) || "";
  }
  // Supervisor deduzido da tabela; se ainda não houver cadastro, mostra o que
  // veio da planilha para não perder a informação.
  //
  // A comparação tira o sufixo "(região)": a plataforma escreve "Ribeirão Preto
  // (região)" e a tabela de supervisores, "Ribeirão Preto". Comparando cru, a
  // ficha ficava sem supervisor sem nenhum aviso — o supervisor existia, só não
  // era encontrado.
  function supervisorDe(f) {
    var bruto = chaveSupervisao(f);
    var chave = bruto ? normStr(regiaoCurta(bruto)) : "";
    if (chave) {
      var achado = supervisores.filter(function (s) {
        return s.tipo === f.tipo && s.ativo !== false && normStr(regiaoCurta(s.chave)) === chave;
      })[0];
      if (achado) return achado.nome;
    }
    return f.supervisor || "";
  }
  function chavesSupervisao(tipo) {
    return supervisores.filter(function (s) { return s.tipo === tipo; })
      .map(function (s) { return s.chave; })
      .sort(function (a, b) { return normStr(a).localeCompare(normStr(b)); });
  }

  // ---------- Situação do bolsista ----------
  // Calculada, nunca digitada: desligamento vence tudo; depois o termo de bolsa
  // decide entre ativo e ainda em preparação.
  function situacaoFormacao(f) {
    if (f.desligado_em) return "Desligado";
    if (f.termo_link) return "Ativo";
    return "Aguardando termo";
  }
  function situacaoClasse(st) {
    if (st === "Ativo") return "tag tag--verde-forte";
    if (st === "Desligado") return "tag tag--vermelho";
    return "tag tag--cinza";
  }

  // Cada situação com o seu ícone: dá para ler a coluna inteira de relance,
  // sem depender só da cor.
  var ICONES_SITUACAO = {
    "Ativo":
      '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M5.2 8.2l1.9 1.9 3.7-4" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Aguardando termo":
      '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M8 4.4V8l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Desligado":
      '<svg class="tag__icone" viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M5.4 8h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  // Marcador do grupo com a bolinha na cor do próprio grupo. A bolinha (em vez
  // de pintar o fundo) mantém o texto legível inclusive no grupo Branco, e
  // grupos novos entram sozinhos com uma cor neutra até ganharem estilo.
  var CORES_GRUPO = ["verde", "amarelo", "vermelho", "branco", "azul", "roxo", "laranja", "rosa", "cinza", "preto"];
  function tagGrupo(nome) {
    if (!nome) return el("span", { class: "cand-pendente", text: "—" });
    var cor = CORES_GRUPO.filter(function (c) { return normStr(nome).indexOf(c) !== -1; })[0] || "neutro";
    var tag = el("span", { class: "grupo-tag grupo-tag--" + cor, title: "Grupo " + nome });
    tag.appendChild(el("span", { class: "grupo-tag__cor" }));
    tag.appendChild(el("span", { text: nome }));
    return tag;
  }

  function tagSituacao(st, titulo) {
    var tag = el("span", { class: situacaoClasse(st) + " tag--com-icone", title: titulo || "" });
    tag.innerHTML = ICONES_SITUACAO[st] || "";
    tag.appendChild(el("span", { text: st }));
    return tag;
  }
  function ehRealizado(v) { return normStr(v) === "realizado"; }

  // ---------- Treinamento: um só, para os dois projetos ----------
  // O valor mora em `treinamento_presencial` (a coluna que a planilha de
  // controle chama de "Treinamento Presencial/Online"). O campo antigo
  // `treinamento_online` só é lido, para não perder o que já foi marcado
  // enquanto existiam dois — sql/treinamento-unico.sql junta os dois de vez.
  function treinamentoDe(f) { return f.treinamento_presencial || f.treinamento_online || ""; }
  function dataTreinamentoDe(f) {
    return f.data_treinamento_presencial || f.data_treinamento_online || "";
  }
  function fezTreinamento(f) { return ehRealizado(treinamentoDe(f)); }
  function formatarCPF(v) {
    var d = soDigitos(v);
    if (d.length !== 11) return v || "—";
    return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
  }
  // Máscara aplicada enquanto se digita o CPF (000.000.000-00).
  function mascaraCPF(v) {
    var d = soDigitos(v).slice(0, 11);
    if (d.length > 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
    if (d.length > 6) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
    if (d.length > 3) return d.slice(0, 3) + "." + d.slice(3);
    return d;
  }

  // Célula de etapa (Realizado / Não Realizado), com data quando houver.
  function celulaEtapa(rotulo, valor, data) {
    var td = el("td", { class: "tabela__td", "data-label": rotulo });
    var caixa = el("span", { class: "form-etapa" });
    if (!valor) {
      // Em branco não é "não sei": na planilha de controle, só quem concluiu
      // recebe "Realizado". Quem está em branco ainda não fez.
      caixa.appendChild(el("span", { class: "cand-pendente", text: "Não Realizado" }));
    } else if (ehRealizado(valor)) {
      caixa.appendChild(el("span", { class: "cand-enviado", text: "✓ Realizado" }));
      if (data) caixa.appendChild(el("span", { class: "form-data", text: data }));
    } else {
      caixa.appendChild(el("span", { class: "cand-pendente", text: valor }));
    }
    td.appendChild(caixa);
    return td;
  }

  // Entrevista feita no sistema para este bolsista (casa pelo CPF; sem CPF, pelo nome).
  function entrevistaDoBolsista(f) {
    var cpf = soDigitos(f.cpf);
    var achadas = [];
    if (cpf.length === 11) {
      achadas = linhas.filter(function (r) { return soDigitos(cpfEntrevista(r)) === cpf; });
    }
    if (!achadas.length && f.email_norm) {
      achadas = linhas.filter(function (r) {
        return r.respostas && normEmail(r.respostas.cid) === f.email_norm;
      });
    }
    if (!achadas.length && f.nome) {
      var alvo = normStr(f.nome);
      achadas = linhas.filter(function (r) { return normStr(r.candidato) === alvo; });
    }
    if (!achadas.length) return null;
    achadas.sort(function (a, b) { return (b.created_at || "").localeCompare(a.created_at || ""); });
    return achadas[0];
  }

  // ---------- Sincronização com as planilhas (cadastro e termos) ----------
  // O Apps Script lê as três planilhas e devolve só CPFs e links; o casamento
  // com as fichas acontece aqui, por CPF.
  //
  // Regra de segurança: nada é APAGADO por sincronização. Se uma planilha vier
  // vazia (ID errado, permissão, aba trocada), o pior que acontece é nada mudar
  // — nunca marcar todo mundo como pendente ou remover um termo já emitido.
  var sincronizacoes = [];

  function carregarSincronizacoes() {
    if (!client) return Promise.resolve();
    try {
      return client.from("sincronizacoes").select("*").then(function (resp) {
        sincronizacoes = (!resp.error && resp.data) ? resp.data : [];
      }).catch(function () { sincronizacoes = []; });
    } catch (e) { sincronizacoes = []; return Promise.resolve(); }
  }

  function registrarSincronizacao(lidos, atualizadas, detalhe) {
    if (!client) return Promise.resolve();
    var reg = {
      origem: "manual", usuario: usuarioEmail || null,
      lidos: lidos || null, atualizadas: atualizadas, detalhe: detalhe || null,
    };
    try {
      return client.from("sincronizacoes").insert(reg).then(function (resp) {
        if (!resp.error) sincronizacoes.push(Object.assign({ criado_em: new Date().toISOString() }, reg));
      }).catch(function () { /* registro é opcional */ });
    } catch (e) { return Promise.resolve(); }
  }

  // Linha "Última sincronização" — vale tanto para a manual quanto para a que
  // roda sozinha pelo Apps Script.
  function blocoUltimaSincronizacao() {
    var wrap = el("div", { class: "imp-info" });
    if (!sincronizacoes.length) {
      wrap.appendChild(el("span", {
        class: "imp-info__texto",
        text: "Nenhuma sincronização registrada ainda com as planilhas.",
      }));
      return wrap;
    }
    var lista = sincronizacoes.slice().sort(function (a, b) {
      return (b.criado_em || "").localeCompare(a.criado_em || "");
    });
    var u = lista[0];
    var l = u.lidos || {};
    wrap.appendChild(el("span", {
      class: "imp-info__texto",
      text: "Última sincronização: " + formatarDataHora(u.criado_em) +
        " · " + (u.origem === "automatica" ? "automática" : "manual") +
        " · " + (u.atualizadas || 0) + " ficha(s) atualizada(s)" +
        (l.cadastros !== undefined ? " · ponte: " + l.cadastros + " cadastros, " +
          ((l.termos_capital || 0) + (l.termos_interior || 0)) + " termos" : "") +
        (u.detalhe ? " · FALHOU: " + String(u.detalhe).slice(0, 120) : ""),
    }));
    return wrap;
  }

  function sincronizarFormacao(btn) {
    if (!exigirAdmin("Sincronizar planilhas")) return;
    if (!backendConvocacao()) { alert("Sincronização ainda não configurada. Veja docs/APPS-SCRIPT-CONVOCACAO.md."); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Sincronizando…'; }

    chamarBackend({ acao: "sincronizar" }).then(function (res) {
      var dados = res.dados || {};
      var cadastros = {};
      (dados.cadastros || []).forEach(function (c) { cadastros[soDigitos(c)] = true; });
      // Data em que cada pessoa PREENCHEU o cadastro de bolsista (coluna F da
      // ponte). É ela que vira a entrada no projeto. Script antigo não manda
      // este campo — aí o painel só segue sem as datas, sem quebrar nada.
      var datasCad = {};
      Object.keys(dados.datas_cadastro || {}).forEach(function (c) {
        datasCad[soDigitos(c)] = dados.datas_cadastro[c];
      });
      var termos = dados.termos || {};
      var totalCad = Object.keys(cadastros).length;

      var mudancas = [];
      var semCpf = 0, semTermo = 0, entradasPreenchidas = 0;
      formacao.forEach(function (f) {
        var cpf = soDigitos(f.cpf);
        if (cpf.length !== 11) { semCpf++; return; }
        var patch = {};

        // Preencheu o formulário de cadastro de bolsista?
        if (totalCad && cadastros[cpf] && !ehRealizado(f.cadastro_bolsista)) {
          patch.cadastro_bolsista = "Realizado";
        }

        // O dia do preenchimento é a entrada no projeto. Só completa o que está
        // vazio: data já registrada (à mão, ou numa sincronização anterior) não
        // é sobrescrita — quem corrigiu à mão tinha um motivo.
        if (datasCad[cpf] && !f.data_entrada) {
          patch.data_entrada = datasCad[cpf];
          entradasPreenchidas++;
        }

        // Termo de bolsa emitido?
        var mapa = termos[f.tipo] || {};
        var link = mapa[cpf];
        if (link && link !== f.termo_link) {
          patch.termo_link = link;
          patch.termo_bolsa = "Emitido";
        } else if (!link && !f.termo_link) {
          semTermo++;
        }

        if (Object.keys(patch).length) {
          Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
          patch.updated_at = new Date().toISOString();
          mudancas.push({ ficha: f, patch: patch });
        }
      });

      // O que veio de CADA aba da ponte: se uma delas vier vazia ou com número
      // estranho, o problema aparece aqui e não nos dados do painel.
      var lidos = dados.lidos || {};
      var resumo = "Planilha-ponte" + (lidos.aba ? ' (aba "' + lidos.aba + '", ' + lidos.linhas + " linhas)" : "") + ":\n" +
        "· cadastros de bolsista: " + (lidos.cadastros !== undefined ? lidos.cadastros : totalCad) + " CPF(s)\n" +
        "· datas de cadastro (coluna F): " +
          (lidos.datas_cadastro !== undefined ? lidos.datas_cadastro : Object.keys(datasCad).length) + "\n" +
        "· termos Capital: " + (lidos.termos_capital !== undefined ? lidos.termos_capital : Object.keys(termos.capital || {}).length) + "\n" +
        "· termos Interior: " + (lidos.termos_interior !== undefined ? lidos.termos_interior : Object.keys(termos.interior || {}).length) + "\n\n" +
        "Fichas atualizadas: " + mudancas.length + "\n" +
        "Datas de entrada preenchidas agora: " + entradasPreenchidas + "\n" +
        "Ainda sem termo: " + semTermo +
        (semCpf ? "\nSem CPF na ficha (não dá para casar): " + semCpf : "") +
        "\n\nSe algum número acima parecer errado, confira o IMPORTRANGE da coluna " +
        "correspondente antes de confiar no resultado.";

      if (!mudancas.length) {
        return registrarSincronizacao(lidos, 0, null).then(function () {
          renderPainelFormacao();
          alert("Nada mudou desde a última sincronização.\n\n" + resumo);
        });
      }
      return Promise.all(mudancas.map(function (m) {
        return atualizarResiliente(formTabela(), m.ficha.id, m.patch, ["data_entrada"]);
      })).then(function (resps) {
        var erro = resps.filter(function (r) { return r && r.error; })[0];
        return registrarSincronizacao(lidos, mudancas.length,
          erro ? String(erro.error.message || erro.error) : null
        ).then(function () {
          return carregarFormacao();
        }).then(function () {
          if (erro) {
            alert("Sincronizado em parte — algumas fichas não puderam ser gravadas:\n" +
              (erro.error.message || erro.error));
            return;
          }
          alert("Sincronização concluída.\n\n" + resumo);
        });
      });
    }).catch(function (e) {
      renderPainelFormacao();
      alert("Não foi possível sincronizar: " + (e.message || e) + "\n\n" + dicaDaSincronizacao(e));
    });
  }

  // O erro mais comum não é o script estar errado: é ele ter sido recolado por
  // cima, apagando o ID da planilha que só existia naquele código.
  function dicaDaSincronizacao(erro) {
    var texto = String((erro && erro.message) || erro || "");
    if (/PLANILHA_PONTE|planilha-ponte/i.test(texto)) {
      return "O ID da planilha-ponte está em branco no Apps Script. Isso costuma " +
        "acontecer depois de recolar o código por cima: o valor que estava ali se perde.\n\n" +
        "Preencha de novo em Apps Script → Configurações do projeto → Propriedades do " +
        "script (PLANILHA_PONTE = id da planilha) — assim ele sobrevive às próximas " +
        "atualizações do código — e publique uma nova versão.";
    }
    if (/ROBO_EMAIL|ROBO_SENHA|robô|robo/i.test(texto)) {
      return "Falta a conta do robô (ROBO_EMAIL / ROBO_SENHA) no Apps Script. " +
        "Guarde-a nas Propriedades do script para não se perder ao atualizar o código.";
    }
    return "Confira se os IDs das planilhas estão preenchidos no Apps Script e se ele " +
      "foi publicado em nova versão.";
  }

  // ---------- Exportar a planilha de formação ----------
  // Reproduz o layout da planilha de controle (inclusive a coluna "Nome"
  // repetida) para o arquivo cair direto no seu fluxo, e acrescenta ao final o
  // que só existe no sistema: facilitador e desligamento.
  // `regiao` opcional: quando vem, a planilha sai só com quem é daquela região
  // (no Interior) ou daquele grupo (na Capital).
  function planilhaFormacao(tipo, regiao, semDesligados) {
    var alvo = regiao ? normStr(regiaoCurta(regiao)) : "";
    var lista = formacao.filter(function (f) {
      if (f.tipo !== tipo) return false;
      if (semDesligados && situacaoFormacao(f) === "Desligado") return false;
      if (!alvo) return true;
      return normStr(regiaoCurta(chaveSupervisao(f))) === alvo;
    }).sort(porOrdemPlanilha);
    if (!lista.length) return null;

    var cabecalho = ["Status", tipo === "capital" ? "Grupo" : "Região", "Nome",
      "CPF", "Telefone", "Email", "Entrada no projeto", "Cadastro de Bolsista", "Supervisor"];
    cabecalho.push("Treinamento", "Data do Treinamento");
    cabecalho.push("Termo de Bolsa", "Documento do Termo de Bolsa",
      "Facilitador", "Desligado em", "Motivo do desligamento");

    var aoa = [cabecalho];
    lista.forEach(function (f) {
      var linha = [
        situacaoFormacao(f),
        (tipo === "capital" ? (f.grupo || "") : regiaoCurta(f.regiao).replace("—", "")),
        f.nome || "",
        f.cpf || "", f.telefone || "", f.email || "",
        f.data_entrada || "", f.cadastro_bolsista || "", supervisorDe(f) || "",
      ];
      linha.push(treinamentoDe(f), dataTreinamentoDe(f));
      linha.push(f.termo_link ? "Emitido" : (f.termo_bolsa || "Não Emitido"), f.termo_link || "",
        f.facilitador || "", f.desligado_em || "", f.desligado_motivo || "");
      aoa.push(linha);
    });
    return aoa;
  }

  function exportarFormacao(tipo) {
    var aoa = planilhaFormacao(tipo);
    if (!aoa) { alert("Não há bolsistas para exportar em " + tipo + "."); return; }
    var hoje = new Date().toISOString().slice(0, 10);
    window.Exportador.csv("formacao_" + tipo + "_" + hoje + ".csv", aoa);
  }

  // Nome de arquivo sem acento, espaço ou barra (as regiões têm todos os três:
  // "São José dos Campos / Vale do Paraíba").
  function nomeArquivo(txt) {
    return normStr(txt).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "todos";
  }
  // O .xlsx por região vai para o supervisor: leva só quem está no projeto.
  // Desligado é histórico do controle central, não lista de trabalho.
  function exportarFormacaoXlsx(tipo, regiao) {
    var aoa = planilhaFormacao(tipo, regiao, true);
    if (!aoa) { alert("Não há bolsistas ativos em " + (regiao || tipo) + "."); return; }
    var hoje = new Date().toISOString().slice(0, 10);
    var rotulo = regiao ? regiaoCurta(regiao) : (tipo === "capital" ? "Capital" : "Interior");
    // O Excel recusa nome de aba com mais de 31 caracteres ou com : \ / ? * [ ]
    var aba = String(rotulo).replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
    window.Exportador.xlsx("formacao_" + nomeArquivo(rotulo) + "_" + hoje + ".xlsx", aba, aoa);
  }

  // Lista para o menu de download: cada região/grupo com quantos bolsistas tem.
  function gruposDaFormacao(tipo) {
    var mapa = {}, ordem = [];
    formacao.forEach(function (f) {
      if (f.tipo !== tipo) return;
      if (situacaoFormacao(f) === "Desligado") return; // o arquivo também não os leva
      var nome = regiaoCurta(chaveSupervisao(f));
      if (!nome || nome === "—") nome = "(sem " + (tipo === "capital" ? "grupo" : "região") + ")";
      var k = normStr(nome);
      if (!mapa[k]) { mapa[k] = { nome: nome, qtd: 0 }; ordem.push(k); }
      mapa[k].qtd++;
    });
    return ordem.map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return normStr(a.nome).localeCompare(normStr(b.nome)); });
  }

  var fecharMenus = [];
  var menusLigados = false;
  // Os painéis são remontados do zero a cada render, então os fechadores de
  // menus antigos apontariam para nós que já saíram da tela. Em vez de manter
  // um só menu registrado, a lista é podada por `isConnected` — assim vários
  // menus podem conviver na mesma barra sem vazar ouvintes.
  function podarMenus() {
    fecharMenus = fecharMenus.filter(function (m) { return m.no.isConnected; });
  }
  // Não poda aqui: no momento do registro o menu ainda está sendo montado e
  // fora do documento — podar agora derrubaria os irmãos recém-criados. A
  // limpeza acontece na hora de fechar, quando todos já estão na tela.
  function registrarMenu(no, fechar) {
    fecharMenus.push({ no: no, fechar: fechar });
    ligarFechamentoDeMenus();
  }
  function ligarFechamentoDeMenus() {
    if (menusLigados) return;
    menusLigados = true;
    function todos() {
      podarMenus();
      fecharMenus.forEach(function (m) { m.fechar(); });
    }
    document.addEventListener("click", todos);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") todos(); });
  }

  // Botão que abre uma lista de opções. `itens` recebe
  // { rotulo, titulo, acao } ou null (linha separadora).
  function menuSuspenso(rotulo, titulo, itens, opcoes) {
    opcoes = opcoes || {};
    var wrap = el("div", { class: "menu-baixar" });
    var btn = el("button", {
      class: "btn " + (opcoes.classe || "btn--secundario") + " btn--pequeno", type: "button",
      "aria-haspopup": "true", "aria-expanded": "false",
      text: rotulo + " ▾",
      title: titulo || "",
    });
    var lista = el("div", { class: "menu-baixar__lista oculto" });
    function fechar() { lista.classList.add("oculto"); btn.setAttribute("aria-expanded", "false"); }

    itens.forEach(function (it) {
      if (!it) { lista.appendChild(el("div", { class: "menu-baixar__sep" })); return; }
      if (it.cabecalho) {
        lista.appendChild(el("div", { class: "menu-baixar__cab", text: it.cabecalho }));
        return;
      }
      var b = el("button", {
        class: "menu-baixar__item", type: "button", text: it.rotulo, title: it.titulo || "",
      });
      b.addEventListener("click", function () { fechar(); it.acao(); });
      lista.appendChild(b);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var abrindo = lista.classList.contains("oculto");
      // Abrir um menu fecha o outro que estiver aberto na mesma barra.
      podarMenus();
      fecharMenus.forEach(function (m) { if (m.no !== wrap) m.fechar(); });
      lista.classList.toggle("oculto", !abrindo);
      btn.setAttribute("aria-expanded", abrindo ? "true" : "false");
    });
    lista.addEventListener("click", function (e) { e.stopPropagation(); });
    registrarMenu(wrap, fechar);

    wrap.appendChild(btn);
    wrap.appendChild(lista);
    return wrap;
  }

  // Opções de download da formação: a planilha inteira e uma linha por
  // grupo/região, tudo sob um único botão "Baixar".
  function itensDeDownload(tipo) {
    var rot = tipo === "capital" ? "grupo" : "região";
    var todos = formacao.filter(function (f) {
      return f.tipo === tipo && situacaoFormacao(f) !== "Desligado";
    }).length;
    var itens = [
      { cabecalho: "Planilha inteira" },
      {
        rotulo: "CSV — " + nomeRegiao(tipo) + " (inclui desligados)",
        titulo: "Planilha de formação no mesmo layout do seu controle",
        acao: function () { exportarFormacao(tipo); },
      },
      {
        rotulo: "Excel — " + (tipo === "capital" ? "Capital inteira" : "Interior inteiro") +
          " (" + todos + ")",
        titulo: "Só quem está no projeto",
        acao: function () { exportarFormacaoXlsx(tipo, ""); },
      },
    ];
    var grupos = gruposDaFormacao(tipo);
    if (grupos.length) {
      itens.push(null);
      itens.push({ cabecalho: "Excel por " + rot });
      grupos.forEach(function (g) {
        itens.push({
          rotulo: g.nome + " (" + g.qtd + ")",
          titulo: "Planilha em Excel só com os entrevistadores de " + g.nome,
          acao: function () { exportarFormacaoXlsx(tipo, g.nome); },
        });
      });
    }
    return itens;
  }

  // ---------- Completar a ficha com o que o sistema já sabe ----------
  // Fichas que vieram da planilha costumam estar sem CPF, telefone ou e-mail
  // porque a busca por nome do Sheets falhou. Esses dados existem na inscrição
  // do candidato: aqui eles são copiados para a ficha, sem sobrescrever nada
  // que já esteja preenchido.
  function fichaDoCandidato(f) {
    var cpf = soDigitos(f.cpf);
    if (cpf.length === 11) {
      var porCpf = candidatos.filter(function (c) { return soDigitos(c.cpf) === cpf; })[0];
      if (porCpf) return porCpf;
    }
    if (f.email_norm) {
      var porEmail = candidatos.filter(function (c) { return c.email_norm === f.email_norm; })[0];
      if (porEmail) return porEmail;
    }
    if (f.nome) {
      var alvo = normStr(f.nome);
      var porNome = candidatos.filter(function (c) { return normStr(c.nome) === alvo; });
      if (porNome.length === 1) return porNome[0]; // nome ambíguo não serve
    }
    return null;
  }

  function completarPelaInscricao(btn) {
    if (!exigirAdmin("Completar pela inscrição")) return;
    var lista = formacao.filter(function (f) { return f.tipo === formTipo; });
    var mudancas = [], semFicha = [];
    lista.forEach(function (f) {
      var falta = !f.cpf || !f.telefone || !f.email;
      if (!falta) return;
      var cand = fichaDoCandidato(f);
      if (!cand) { semFicha.push(f.nome || "(sem nome)"); return; }
      var patch = {};
      if (!f.cpf && cand.cpf) patch.cpf = cand.cpf;
      if (!f.email && cand.email) { patch.email = cand.email; patch.email_norm = cand.email_norm || normEmail(cand.email); }
      if (!f.telefone) {
        var tel = telefoneDaInscricao(cand.inscricao);
        if (tel) patch.telefone = tel;
      }
      if (!f.regiao && cand.regiao) patch.regiao = cand.regiao;
      if (!f.candidato_id && cand.id) patch.candidato_id = cand.id;
      if (Object.keys(patch).length) {
        Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
        patch.updated_at = new Date().toISOString();
        mudancas.push({ ficha: f, patch: patch });
      }
    });

    if (!mudancas.length) {
      alert("Nenhuma ficha para completar em " + formTipo + "." +
        (semFicha.length ? "\n\nSem inscrição correspondente: " + semFicha.length +
          "\n· " + semFicha.slice(0, 10).join("\n· ") : ""));
      return;
    }
    if (!confirm("Completar " + mudancas.length + " ficha(s) com CPF, telefone e e-mail da inscrição?")) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Completando…'; }

    Promise.all(mudancas.map(function (m) {
      return client.from(formTabela()).update(m.patch).eq("id", m.ficha.id);
    })).then(function (resps) {
      var erro = resps.filter(function (r) { return r && r.error; })[0];
      return carregarFormacao().then(function () {
        alert(erro
          ? "Completado em parte. Erro: " + (erro.error.message || erro.error)
          : mudancas.length + " ficha(s) completada(s) com os dados da inscrição." +
            (semFicha.length ? "\n\nSem inscrição correspondente: " + semFicha.length +
              "\n· " + semFicha.slice(0, 10).join("\n· ") : ""));
      });
    }).catch(function (e) {
      renderPainelFormacao();
      alert("Não foi possível completar: " + (e.message || e));
    });
  }

  // ---------- Edição da ficha de formação (só admin) ----------
  var OPCOES_TREINO = ["Realizado", "Não Realizado"];

  function camposFormacao(f) {
    var campos = [];
    if (f.tipo === "capital") {
      campos.push({ id: "grupo", rot: "Grupo", opcoes: chavesSupervisao("capital"),
        dica: "Define o supervisor automaticamente." });
    } else {
      campos.push({ id: "regiao", rot: "Região", opcoes: chavesSupervisao("interior"),
        dica: "Define o supervisor automaticamente." });
    }
    // Supervisor mexe no grupo e nada mais: os outros campos nem aparecem no
    // formulário, para não haver caixa que ele preenche e o banco recusa. E
    // como ele só PREENCHE grupo vazio, some também a opção "— em branco —":
    // deixar em branco seria apagar, o que não é dele.
    if (!ehAdmin()) {
      campos[0].semBranco = true;
      campos[0].dica = "Define o supervisor automaticamente. Depois de definido, " +
        "só o administrador troca de grupo.";
      return campos;
    }
    campos.push({ id: "data_entrada", rot: "Data de entrada no projeto",
      dica: "dd/mm/aaaa — o dia em que preencheu o Cadastro de Bolsista. Chega sozinha na " +
        "sincronização; a partir dela a pessoa conta como entrevistador nos relatórios." });
    campos.push({ id: "cadastro_bolsista", rot: "Cadastro de bolsista", opcoes: OPCOES_TREINO });
    // Um treinamento só, para os dois projetos: conta qualquer treinamento
    // realizado. Fica no campo que a planilha chama de "Treinamento
    // Presencial/Online"; `valor` mostra também o que estiver no campo antigo,
    // e salvar move para o campo único — a ficha se conserta sozinha.
    campos.push({ id: "treinamento_presencial", rot: "Treinamento", opcoes: OPCOES_TREINO,
      valor: treinamentoDe(f), dica: "Qualquer treinamento realizado (online ou presencial)." });
    campos.push({ id: "data_treinamento_presencial", rot: "Data do treinamento", dica: "dd/mm/aaaa",
      valor: dataTreinamentoDe(f) });
    campos.push({ id: "facilitador", rot: "Facilitador do treinamento", dica: "Quem conduziu." });
    campos.push({ id: "termo_link", rot: "Link do termo de bolsa",
      dica: "Preenchido pela planilha de termos. Ter link = bolsista ativo." });
    // Desligamento NÃO entra aqui: é ação própria, com botão e tela próprios.
    // Misturado entre treinamento e termo, era fácil desligar alguém sem
    // perceber — e desligar não é "editar um campo", é tirar do projeto.
    return campos;
  }

  function abrirEdicaoFormacao(f) {
    if (!podeEditarGrupo(f)) return;
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: (f.nome || "(sem nome)") }));
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: (f.tipo === "capital" ? "Capital" : "Interior") + " · " + formatarCPF(f.cpf) +
        " · situação: " + situacaoFormacao(f) + " (calculada pelo termo e pelo desligamento)",
    }));
    if (!ehAdmin()) {
      alvo.appendChild(el("p", {
        class: "modal__meta",
        text: "Perfil supervisor: aqui você define o grupo de quem ainda não tem. " +
          "Depois de definido, trocar de grupo e os demais campos da ficha são do administrador.",
      }));
    }

    var form = el("form", { class: "edicao" });
    var entradas = {};
    camposFormacao(f).forEach(function (c) {
      var atual = c.valor !== undefined ? (c.valor || "") : (f[c.id] || "");
      var linha = el("div", { class: "edicao__campo" });
      linha.appendChild(el("label", { class: "edicao__rot", for: "fm_" + c.id, text: c.rot }));
      var entrada;
      if (c.opcoes) {
        entrada = el("select", { class: "edicao__entrada", id: "fm_" + c.id });
        // `semBranco`: campo que só pode ser PREENCHIDO (supervisor definindo o
        // grupo). Sem a opção vazia, e sem começar em nenhuma escolha feita.
        entrada.appendChild(el("option", {
          value: "", text: c.semBranco ? "— escolha —" : "— em branco —",
        }));
        c.opcoes.forEach(function (o) { entrada.appendChild(el("option", { value: o, text: o })); });
        if (atual && c.opcoes.indexOf(atual) === -1) {
          entrada.appendChild(el("option", { value: atual, text: atual }));
        }
        entrada.value = atual;
        if (c.semBranco) entrada.required = true;
      } else {
        entrada = el("input", { class: "edicao__entrada", type: "text", id: "fm_" + c.id, value: atual });
      }
      linha.appendChild(entrada);
      if (c.dica) linha.appendChild(el("p", { class: "edicao__dica", text: c.dica }));
      entradas[c.id] = entrada;
      form.appendChild(linha);
    });

    var msg = el("p", { class: "edicao__msg" });
    var salvar = el("button", { class: "btn btn--pequeno", type: "submit", text: "Salvar alterações" });
    var cancelar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", fecharModal);
    form.appendChild(el("div", { class: "edicao__acoes" }, [salvar, cancelar]));
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var patch = {};
      camposFormacao(f).forEach(function (c) {
        var valor = entradas[c.id].value.trim();
        if (valor !== (f[c.id] || "")) patch[c.id] = valor || null;
      });
      if (!Object.keys(patch).length) { msg.textContent = "Nada foi alterado."; return; }
      salvar.disabled = true;
      msg.className = "edicao__msg";
      msg.textContent = "Salvando…";
      // O supervisor não tem permissão de update na tabela (e não deve ter: o
      // RLS decide por linha, e liberar a linha liberaria a ficha inteira). Ele
      // grava pela função `definir_grupo`, que só sabe mexer no grupo.
      var gravar = ehAdmin()
        ? client.from(formTabela()).update(
            Object.assign({}, patch, { updated_at: new Date().toISOString() })).eq("id", f.id)
        : client.rpc("definir_grupo", { p_id: f.id, p_grupo: patch.grupo || null });
      Promise.resolve(gravar).then(function (resp) {
        salvar.disabled = false;
        if (resp && resp.error) {
          msg.className = "edicao__msg edicao__msg--erro";
          msg.textContent = mensagemDeErroAoSalvarFormacao(resp.error);
          return;
        }
        Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
        fecharModal();
        renderPainelFormacao();
      });
    });

    alvo.appendChild(form);
    // Desligar é ação de administrador: o supervisor nem vê a zona de risco.
    if (ehAdmin()) {
      alvo.appendChild(blocoDesligamento(f));
      alvo.appendChild(blocoHistoricoDaFicha(f));
    }
    mostrar($("#modal"), true);
  }

  // ---------- Datas de entrada das fichas antigas ----------
  // Quem entrou antes do sistema não tem data em lugar nenhum. Sem ela, a
  // pessoa não aparece em nenhuma contagem por mês — e um relatório com gente
  // faltando é pior do que relatório nenhum. Daí esta tela.
  function abrirDatasDeEntrada(tipo) {
    if (!ehAdmin()) return;
    var pendentes = formacao.filter(function (f) {
      return f.tipo === tipo && !f.data_entrada;
    }).sort(porOrdemPlanilha);

    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: "Datas de entrada — " +
      (tipo === "capital" ? "Capital" : "Interior") }));
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: "Quando cada pessoa passou a atuar no projeto — o dia em que preencheu o " +
        "Cadastro de Bolsista. Essa data chega sozinha em “🔄 Sincronizar planilhas”, do " +
        "carimbo do próprio formulário; use esta tela só para quem a sincronização não " +
        "alcança (cadastro feito fora do formulário, ou CPF que não casa).",
    }));
    if (!pendentes.length) {
      alvo.appendChild(el("p", { class: "vazio", text: "Todas as fichas já têm data de entrada." }));
      mostrar($("#modal"), true);
      return;
    }

    // Atalho: o caso comum é uma turma inteira ter começado no mesmo dia.
    var atalho = el("div", { class: "cand-acoes" });
    var campoTodos = el("input", {
      class: "edicao__entrada", type: "text", placeholder: "dd/mm/aaaa", id: "ent-todos",
    });
    var bTodos = el("button", {
      class: "btn btn--secundario btn--pequeno", type: "button", text: "Aplicar a todas",
    });
    atalho.appendChild(el("span", { class: "viz-filtro__rotulo", text: "Preencher todas com:" }));
    atalho.appendChild(campoTodos);
    atalho.appendChild(bTodos);
    alvo.appendChild(atalho);

    var form = el("form", { class: "edicao" });
    var tabela = el("table", { class: "tabela tabela--cand metas__tab" });
    tabela.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "Nome" }),
      el("th", { text: tipo === "capital" ? "Grupo" : "Região" }),
      el("th", { text: "Entrada (dd/mm/aaaa)" }),
    ])]));
    var corpo = el("tbody");
    var entradas = [];
    pendentes.forEach(function (f) {
      var inp = el("input", { class: "edicao__entrada", type: "text", placeholder: "dd/mm/aaaa" });
      entradas.push({ ficha: f, inp: inp });
      var tr = el("tr");
      tr.appendChild(el("td", { class: "metas__reg", text: f.nome || "(sem nome)" }));
      tr.appendChild(el("td", { text: regiaoCurta(chaveSupervisao(f)) || "—" }));
      tr.appendChild(el("td", {}, [inp]));
      corpo.appendChild(tr);
    });
    tabela.appendChild(corpo);
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    form.appendChild(wrap);

    bTodos.addEventListener("click", function () {
      entradas.forEach(function (e) { e.inp.value = campoTodos.value; });
    });

    var msg = el("p", { class: "edicao__msg" });
    var salvar = el("button", { class: "btn btn--pequeno", type: "submit", text: "Salvar datas" });
    var cancelar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", fecharModal);
    form.appendChild(el("div", { class: "edicao__acoes" }, [salvar, cancelar]));
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var mudancas = [], invalidas = [];
      entradas.forEach(function (item) {
        var v = item.inp.value.trim();
        if (!v) return;
        // Uma data mal digitada gravada aqui vira número errado no relatório
        // depois, sem ninguém perceber. Melhor recusar agora.
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v) || !normalizarDataHora(v)) {
          invalidas.push(item.ficha.nome || "(sem nome)");
          return;
        }
        mudancas.push({ ficha: item.ficha, data: v });
      });
      if (invalidas.length) {
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = "Data inválida em: " + invalidas.slice(0, 5).join(", ") +
          (invalidas.length > 5 ? " e mais " + (invalidas.length - 5) : "") + ". Use dd/mm/aaaa.";
        return;
      }
      if (!mudancas.length) { msg.textContent = "Nenhuma data preenchida."; return; }
      salvar.disabled = true;
      msg.className = "edicao__msg";
      msg.textContent = "Salvando " + mudancas.length + " data(s)…";
      Promise.all(mudancas.map(function (m) {
        return atualizarResiliente(formTabela(), m.ficha.id,
          { data_entrada: m.data, updated_at: new Date().toISOString() }, ["data_entrada"]);
      })).then(function (resultados) {
        // `atualizarResiliente` grava sem os campos que o banco não tem, para
        // não travar o painel. Aqui isso significaria gravar NADA — então o
        // silêncio vira aviso, em vez de um "salvo" que não salvou.
        var semColuna = resultados.some(function (r) {
          return r && r.ignorados && r.ignorados.indexOf("data_entrada") !== -1;
        });
        if (semColuna) throw new Error("SEM_COLUNA");
        return carregarFormacao().then(fecharModal);
      }).catch(function (erro) {
        salvar.disabled = false;
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = String(erro && erro.message) === "SEM_COLUNA"
          ? "Nada foi salvo: a coluna data_entrada ainda não existe no banco. " +
            "Rode sql/historico.sql no SQL Editor do Supabase e tente de novo."
          : "Não foi possível salvar: " + ((erro && erro.message) || erro);
      });
    });

    alvo.appendChild(form);
    mostrar($("#modal"), true);
  }

  // ---------- Histórico de uma ficha ----------
  // Vem da tabela `historico`, preenchida por gatilho no banco: pega o que foi
  // feito no painel, na importação de CSV, na sincronização e até no SQL
  // Editor. Nenhum caminho de alteração escapa.
  var ROTULO_CAMPO = {
    grupo: "Grupo", regiao: "Região", supervisor: "Supervisor",
    nome: "Nome", cpf: "CPF", telefone: "Telefone", email: "E-mail",
    status: "Status", cadastro_bolsista: "Cadastro de bolsista",
    treinamento_presencial: "Treinamento", treinamento_online: "Treinamento (online)",
    data_treinamento_presencial: "Data do treinamento",
    data_treinamento_online: "Data do treinamento (online)",
    facilitador: "Facilitador", termo_bolsa: "Termo de bolsa",
    termo_link: "Documento do termo", data_entrada: "Entrada no projeto",
    desligado_em: "Desligado em", desligado_motivo: "Motivo do desligamento",
    candidato_id: "Vínculo com a inscrição",
  };

  function blocoHistoricoDaFicha(f) {
    var sec = el("section", { class: "pagina__secao hist-ficha" });
    sec.appendChild(el("h3", { class: "pagina__secao-titulo", text: "Histórico desta ficha" }));
    var corpo = el("p", { class: "pagina__secao-sub", text: "Carregando…" });
    sec.appendChild(corpo);
    if (!client || !f.id) { corpo.textContent = "Sem histórico para mostrar."; return sec; }

    // O histórico é informação de apoio: se a leitura falhar por qualquer
    // motivo, ela avisa e some — nunca derruba o formulário de edição, que é o
    // que a pessoa veio fazer aqui.
    var consulta;
    try {
      consulta = client.from("historico").select("em,evento,campo,de,para,quem").eq("registro_id", f.id);
    } catch (e) {
      corpo.textContent = "Não foi possível ler o histórico: " + (e.message || e);
      return sec;
    }
    Promise.resolve(consulta)
      .then(function (resp) {
        resp = resp || {};
        if (resp.error) {
          corpo.textContent = /historico|does not exist|PGRST/i.test(resp.error.message || "")
            ? "O histórico começa depois de rodar sql/historico.sql no Supabase."
            : "Não foi possível ler o histórico: " + (resp.error.message || resp.error);
          return;
        }
        var itens = (resp.data || []).slice().sort(function (a, b) {
          return String(b.em).localeCompare(String(a.em));
        });
        sec.removeChild(corpo);
        if (!itens.length) {
          sec.appendChild(el("p", {
            class: "pagina__secao-sub",
            text: "Nada registrado ainda. O histórico guarda o que mudar a partir de agora.",
          }));
          return;
        }
        var lista = el("ul", { class: "hist-ficha__lista" });
        itens.slice(0, 60).forEach(function (h) {
          lista.appendChild(itemDoHistorico(h));
        });
        sec.appendChild(lista);
        if (itens.length > 60) {
          sec.appendChild(el("p", {
            class: "grafico__nota",
            text: "Mostrando as 60 alterações mais recentes de " + itens.length + ".",
          }));
        }
      })
      .catch(function (e) {
        corpo.textContent = "Não foi possível ler o histórico: " + (e.message || e);
      });
    return sec;
  }

  function itemDoHistorico(h) {
    var li = el("li", { class: "hist-ficha__item" });
    li.appendChild(el("span", { class: "hist-ficha__quando", text: formatarDataHora(h.em) }));
    var texto = el("span", { class: "hist-ficha__texto" });
    if (h.evento === "criado") {
      texto.appendChild(el("strong", { text: "Ficha criada" }));
    } else if (h.evento === "apagado") {
      texto.appendChild(el("strong", { text: "Ficha apagada" }));
    } else {
      texto.appendChild(el("strong", { text: ROTULO_CAMPO[h.campo] || h.campo }));
      texto.appendChild(el("span", { text: ": " }));
      texto.appendChild(el("span", { class: "hist-ficha__de", text: h.de || "(vazio)" }));
      texto.appendChild(el("span", { class: "hist-ficha__seta", "aria-hidden": "true", text: " → " }));
      texto.appendChild(el("span", { class: "hist-ficha__para", text: h.para || "(vazio)" }));
    }
    li.appendChild(texto);
    li.appendChild(h.quem
      ? el("span", { class: "hist-ficha__quem", text: h.quem })
      : el("span", { class: "hist-ficha__quem hist-sql", title: "Alteração feita direto no banco, sem usuário logado.", text: "SQL Editor" }));
    return li;
  }

  // Diz o que aconteceu em vez de "erro ao salvar": quase sempre é ou falta de
  // permissão, ou um SQL que ainda não foi rodado no Supabase.
  function mensagemDeErroAoSalvarFormacao(erro) {
    var texto = (erro && (erro.message || erro.hint || erro)) || "";
    if (/function .*definir_grupo|PGRST202|schema cache/i.test(String(texto) + (erro && erro.code || ""))) {
      return "A função definir_grupo ainda não existe no banco. Peça ao administrador para rodar " +
        "sql/perfil-supervisor.sql no Supabase — sem ela o supervisor não consegue gravar o grupo.";
    }
    // A função do banco devolve o motivo redigido (ex.: "já está no grupo
    // Verde…"); repetir a frase dela é melhor do que um texto genérico.
    if (/já está no grupo|não pode deixar o campo em branco|só existe na Capital/i.test(String(texto))) {
      return String(texto);
    }
    if (/row-level security|permission|42501|Sem permiss/i.test(String(texto))) {
      return ehSupervisor()
        ? "Sem permissão. O supervisor só define o grupo de bolsistas da Capital que ainda não têm grupo."
        : "Sem permissão para editar. Só administradores podem alterar dados.";
    }
    return "Não foi possível salvar: " + texto;
  }

  // ---------- Desligamento (ação própria, separada da edição) ----------
  var MOTIVOS_DESLIGAMENTO = [
    "Desistência",
    "Abandono (sem retorno)",
    "Baixo desempenho",
    "Indisponibilidade de horário",
    "Mudança de cidade/região",
    "Fim da participação no projeto",
    "Outro",
  ];

  function blocoDesligamento(f) {
    var caixa = el("div", { class: "zona-risco" });
    if (!f.desligado_em) {
      caixa.appendChild(el("p", {
        class: "zona-risco__texto",
        text: "Encerrar a participação desta pessoa no projeto. A vaga da região é liberada " +
          "e a ficha passa para a lista de desligados.",
      }));
      var b = el("button", { class: "btn btn--perigo btn--pequeno", type: "button", text: "⛔ Desligar bolsista" });
      b.addEventListener("click", function () { abrirDesligamento(f); });
      caixa.appendChild(b);
      return caixa;
    }
    caixa.classList.add("zona-risco--desligado");
    caixa.appendChild(el("p", {
      class: "zona-risco__texto",
      text: "Desligado em " + f.desligado_em + (f.desligado_motivo ? " — " + f.desligado_motivo : "") + ".",
    }));
    var bEd = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Corrigir desligamento" });
    bEd.addEventListener("click", function () { abrirDesligamento(f); });
    caixa.appendChild(bEd);
    var bRev = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "↩ Reverter desligamento" });
    bRev.addEventListener("click", function () {
      if (!confirm("Reverter o desligamento de " + (f.nome || "") + "?\n\n" +
        "A pessoa volta para a lista de quem está no projeto e ocupa vaga de novo em " +
        (f.tipo === "capital" ? "Capital" : regiaoCurta(f.regiao)) + ".")) return;
      salvarDesligamento(f, { desligado_em: null, desligado_motivo: null }, bRev);
    });
    caixa.appendChild(bRev);
    return caixa;
  }

  function abrirDesligamento(f) {
    if (!ehAdmin()) return;
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: "Desligar — " + (f.nome || "(sem nome)") }));
    var oc = ocupacaoDe(f.tipo, f.regiao);
    var meta = metaDe(f.tipo, f.regiao);
    var ondeFica = f.tipo === "capital" ? "Capital" : regiaoCurta(f.regiao);
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: ondeFica + (meta === null ? " (sem meta definida)" : " · " + oc.total + " de " + meta + " ocupadas hoje") +
        " · a ficha sai da lista de quem está no projeto e passa para a de desligados.",
    }));

    var form = el("form", { class: "edicao" });

    var lData = el("div", { class: "edicao__campo" });
    lData.appendChild(el("label", { class: "edicao__rot", for: "dl_data", text: "Data do desligamento" }));
    var iData = el("input", {
      class: "edicao__entrada", type: "text", id: "dl_data",
      value: f.desligado_em || hojeBR(), placeholder: "dd/mm/aaaa",
    });
    lData.appendChild(iData);
    lData.appendChild(el("p", { class: "edicao__dica", text: "Já vem com a data de hoje — troque se a saída foi antes." }));
    form.appendChild(lData);

    var lMot = el("div", { class: "edicao__campo" });
    lMot.appendChild(el("label", { class: "edicao__rot", for: "dl_motivo", text: "Motivo do desligamento" }));
    var sMot = el("select", { class: "edicao__entrada", id: "dl_motivo" });
    sMot.appendChild(el("option", { value: "", text: "— escolha —" }));
    MOTIVOS_DESLIGAMENTO.forEach(function (m) { sMot.appendChild(el("option", { value: m, text: m })); });
    var motivoAtual = f.desligado_motivo || "";
    var conhecido = MOTIVOS_DESLIGAMENTO.indexOf(motivoAtual) !== -1;
    sMot.value = motivoAtual ? (conhecido ? motivoAtual : "Outro") : "";
    lMot.appendChild(sMot);
    form.appendChild(lMot);

    var lOutro = el("div", { class: "edicao__campo" + (sMot.value === "Outro" ? "" : " oculto") });
    lOutro.appendChild(el("label", { class: "edicao__rot", for: "dl_outro", text: "Qual?" }));
    var iOutro = el("input", {
      class: "edicao__entrada", type: "text", id: "dl_outro",
      value: conhecido ? "" : motivoAtual, placeholder: "descreva em poucas palavras",
    });
    lOutro.appendChild(iOutro);
    form.appendChild(lOutro);
    sMot.addEventListener("change", function () {
      lOutro.classList.toggle("oculto", sMot.value !== "Outro");
      if (sMot.value === "Outro") iOutro.focus();
    });

    var msg = el("p", { class: "edicao__msg" });
    var salvar = el("button", { class: "btn btn--perigo btn--pequeno", type: "submit", text: "⛔ Confirmar desligamento" });
    var cancelar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", function () { abrirEdicaoFormacao(f); });
    form.appendChild(el("div", { class: "edicao__acoes" }, [salvar, cancelar]));
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = iData.value.trim();
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) {
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = "Informe a data no formato dd/mm/aaaa.";
        return;
      }
      var motivo = sMot.value === "Outro" ? iOutro.value.trim() : sMot.value;
      if (!motivo) {
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = "Escolha (ou escreva) o motivo — é o que explica a vaga aberta depois.";
        return;
      }
      var vagaTexto = meta === null ? "" :
        "\n\nA região fica com " + Math.max(0, meta - (oc.total - 1)) + " vaga(s) em aberto.";
      if (!confirm("Desligar " + (f.nome || "") + " em " + data + "?\nMotivo: " + motivo + vagaTexto)) return;
      msg.className = "edicao__msg";
      msg.textContent = "Salvando…";
      salvar.disabled = true;
      salvarDesligamento(f, { desligado_em: data, desligado_motivo: motivo }, salvar, msg);
    });

    alvo.appendChild(form);
    mostrar($("#modal"), true);
  }

  function salvarDesligamento(f, patch, botao, msg) {
    var envio = Object.assign({}, patch, { updated_at: new Date().toISOString() });
    return client.from(formTabela()).update(envio).eq("id", f.id).then(function (resp) {
      if (botao) botao.disabled = false;
      if (resp.error) {
        var txt = /row-level security|permission/i.test(resp.error.message || "")
          ? "Sem permissão. Só administradores podem desligar."
          : "Não foi possível salvar: " + (resp.error.message || resp.error);
        if (msg) { msg.className = "edicao__msg edicao__msg--erro"; msg.textContent = txt; }
        else alert(txt);
        return;
      }
      Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
      // Desligado sai da lista de quem está no projeto; revertido, volta para ela.
      formVer = patch.desligado_em ? "desligados" : "projeto";
      fecharModal();
      renderPainelFormacao();
      renderDados();
    });
  }

  // ---------- Quem supervisiona cada grupo / região ----------
  function abrirSupervisores(tipo) {
    if (!ehAdmin()) return;
    var alvo = $("#modal-conteudo");
    alvo.innerHTML = "";
    alvo.appendChild(el("h2", { class: "modal__titulo", text: "Supervisores — " + (tipo === "capital" ? "Capital" : "Interior") }));
    alvo.appendChild(el("p", {
      class: "modal__meta",
      text: tipo === "capital"
        ? "Cada grupo tem um supervisor. Trocar aqui muda o supervisor de todos os bolsistas do grupo."
        : "Cada região tem um supervisor. Trocar aqui muda o supervisor de todos os bolsistas da região.",
    }));

    var lista = supervisores.filter(function (s) { return s.tipo === tipo; })
      .sort(function (a, b) { return normStr(a.chave).localeCompare(normStr(b.chave)); });

    var form = el("form", { class: "edicao" });
    var entradas = [];
    lista.forEach(function (s) {
      var linha = el("div", { class: "edicao__campo" });
      linha.appendChild(el("label", { class: "edicao__rot", text: s.chave }));
      var entrada = el("input", { class: "edicao__entrada", type: "text", value: s.nome || "" });
      linha.appendChild(entrada);
      entradas.push({ reg: s, entrada: entrada });
      form.appendChild(linha);
    });

    // Novo grupo/região
    var nova = el("div", { class: "edicao__campo edicao__campo--novo" });
    nova.appendChild(el("label", { class: "edicao__rot", text: tipo === "capital" ? "Novo grupo" : "Nova região" }));
    var chaveNova = el("input", { class: "edicao__entrada", type: "text", placeholder: tipo === "capital" ? "ex.: Azul" : "ex.: Marília" });
    var nomeNovo = el("input", { class: "edicao__entrada", type: "text", placeholder: "nome do supervisor" });
    nova.appendChild(chaveNova);
    nova.appendChild(nomeNovo);
    form.appendChild(nova);

    var msg = el("p", { class: "edicao__msg" });
    var salvar = el("button", { class: "btn btn--pequeno", type: "submit", text: "Salvar" });
    var cancelar = el("button", { class: "btn btn--secundario btn--pequeno", type: "button", text: "Cancelar" });
    cancelar.addEventListener("click", fecharModal);
    form.appendChild(el("div", { class: "edicao__acoes" }, [salvar, cancelar]));
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var tarefas = [];
      entradas.forEach(function (item) {
        var novo = item.entrada.value.trim();
        if (novo !== (item.reg.nome || "")) {
          tarefas.push(client.from("supervisores").update({ nome: novo }).eq("id", item.reg.id));
        }
      });
      var ch = chaveNova.value.trim(), nm = nomeNovo.value.trim();
      if (ch && nm) tarefas.push(client.from("supervisores").insert({ tipo: tipo, chave: ch, nome: nm }));
      if (!tarefas.length) { msg.textContent = "Nada foi alterado."; return; }
      salvar.disabled = true;
      msg.textContent = "Salvando…";
      Promise.all(tarefas).then(function (resps) {
        var erro = resps.filter(function (r) { return r && r.error; })[0];
        salvar.disabled = false;
        if (erro) {
          msg.className = "edicao__msg edicao__msg--erro";
          msg.textContent = "Não foi possível salvar: " + (erro.error.message || erro.error);
          return;
        }
        carregarSupervisores().then(function () {
          fecharModal();
          renderPainelFormacao();
        });
      });
    });

    alvo.appendChild(form);
    mostrar($("#modal"), true);
  }

  // ============================================================
  //  Aba TERMOS DE BOLSA  (admin e financeiro)
  //
  //  A pergunta que esta aba responde é uma só: de quem falta o termo, e quem
  //  já está pronto para recebê-lo. "Apto" = cadastro de bolsista preenchido e
  //  treinamento realizado, sem termo e sem desligamento — a mesma definição da
  //  view `aptos_para_termo` no banco, que o aviso por e-mail usa.
  // ============================================================
  var termosTipo = "todos";    // todos | capital | interior
  var termosVer = "pendentes"; // pendentes | aptos | ativos
  var termosBusca = "";

  function aptoParaTermo(f) {
    return !f.desligado_em && !f.termo_link &&
      ehRealizado(f.cadastro_bolsista) && fezTreinamento(f);
  }
  // Pendente = está no projeto e ainda não tem termo (apto ou não).
  function pendenteDeTermo(f) {
    return !f.desligado_em && !f.termo_link;
  }

  function formacaoDosTermos() {
    var lista = formacao.filter(function (f) { return !f.desligado_em; });
    if (termosTipo !== "todos") {
      lista = lista.filter(function (f) { return f.tipo === termosTipo; });
    }
    return lista;
  }

  function renderPainelTermos() {
    var painel = $("#painel-termos");
    if (!painel) return;
    painel.innerHTML = "";
    if (!podeVerTermos()) return;

    var base = formacaoDosTermos();
    var pendentes = base.filter(pendenteDeTermo);
    var aptos = base.filter(aptoParaTermo);
    var ativos = base.filter(function (f) { return !!f.termo_link; });

    // O contador da aba mostra o que espera ação: pendentes de termo.
    var cont = $("#cont-termos");
    if (cont) cont.textContent = String(formacao.filter(function (f) {
      return pendenteDeTermo(f);
    }).length);

    // --- Projeto: a primeira decisão de quem abre a aba ---
    var noProjetoDe = function (t) {
      return formacao.filter(function (f) {
        return situacaoFormacao(f) !== "Desligado" && (t === "todos" || f.tipo === t);
      }).length;
    };
    painel.appendChild(seletorSegmentado("Projeto", [
      { id: "todos", nome: "Capital e Interior", detalhe: noProjetoDe("todos") + " no projeto" },
      { id: "capital", nome: "Capital", detalhe: noProjetoDe("capital") + " no projeto" },
      { id: "interior", nome: "Interior", detalhe: noProjetoDe("interior") + " no projeto" },
    ], termosTipo, function (id) { termosTipo = id; termosBusca = ""; renderPainelTermos(); }));

    painel.appendChild(el("p", {
      class: "painel__nota",
      text: "Quem já tem termo de bolsa e quem ainda não tem. “Apto” é quem preencheu o " +
        "cadastro de bolsista e fez o treinamento: falta só o termo para começar a atuar.",
    }));

    // --- Números ---
    painel.appendChild(el("div", { class: "stats stats--form" }, [
      statCard("No projeto", base.length),
      statCard("Com termo", ativos.length),
      statCard("Sem termo", pendentes.length),
      statCard("Aptos (só falta o termo)", aptos.length),
      statCard("Aguardando etapa", pendentes.length - aptos.length),
    ]));

    // --- Ações do administrador ---
    if (ehAdmin()) {
      var acoes = el("div", { class: "cand-acoes" });
      var naoAvisados = aptos.filter(function (f) { return !f.aviso_apto_em; });
      var bAviso = el("button", {
        class: "btn btn--pequeno", type: "button",
        text: "✉ Avisar o financeiro (" + naoAvisados.length + ")",
        title: naoAvisados.length
          ? "Envia um e-mail ao pessoal do financeiro com quem ficou apto e ainda não foi avisado"
          : "Ninguém apto sem aviso no momento",
      });
      if (!naoAvisados.length) bAviso.disabled = true;
      bAviso.addEventListener("click", function () { avisarFinanceiro(bAviso); });
      acoes.appendChild(bAviso);

      var bExp = el("button", {
        class: "btn btn--secundario btn--pequeno", type: "button", text: "⬇ Baixar .xlsx",
        title: "Planilha em Excel com a lista do recorte escolhido",
      });
      bExp.addEventListener("click", function () { exportarTermos(); });
      acoes.appendChild(bExp);
      painel.appendChild(acoes);
      painel.appendChild(blocoAutomacaoAviso());
    }

    // --- Recorte da lista ---
    var vistas = [
      { id: "pendentes", rot: "Sem termo", lista: pendentes },
      { id: "aptos", rot: "Aptos", lista: aptos },
      { id: "ativos", rot: "Com termo", lista: ativos },
    ];
    painel.appendChild(cabecalhoDaLista(
      "Termos — " + (termosTipo === "todos" ? "Capital e Interior" : nomeRegiao(termosTipo)),
      vistas.map(function (v) { return { id: v.id, rot: v.rot, qtd: v.lista.length }; }),
      termosVer,
      function (id) { termosVer = id; renderPainelTermos(); }
    ));

    var lista = (vistas.filter(function (v) { return v.id === termosVer; })[0] || vistas[0]).lista;

    // --- Busca ---
    var buscaWrap = el("div", { class: "painel__barra" });
    var inp = el("input", {
      class: "painel__busca", type: "search", value: termosBusca,
      placeholder: "Buscar por nome, CPF, e-mail, grupo ou região…",
    });
    inp.addEventListener("input", function () {
      termosBusca = inp.value;
      renderPainelTermos();
      var novo = $("#painel-termos").querySelector(".painel__busca");
      if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
    });
    buscaWrap.appendChild(inp);
    painel.appendChild(buscaWrap);

    var termo = normStr(termosBusca);
    var termoCPF = soDigitos(termosBusca);
    if (termo) {
      lista = lista.filter(function (f) {
        var texto = [f.nome, f.email, f.grupo, f.regiao, regiaoNaTabela(f.regiao), supervisorDe(f)]
          .some(function (v) { return normStr(v).indexOf(termo) !== -1; });
        return texto || (termoCPF.length >= 3 && soDigitos(f.cpf).indexOf(termoCPF) !== -1);
      });
    }
    lista = lista.slice().sort(porOrdemPlanilha);

    if (!lista.length) {
      painel.appendChild(el("p", {
        class: "cand-vazio",
        text: termosBusca ? "Ninguém encontrado para esta busca."
          : termosVer === "aptos" ? "Ninguém apto no momento: todo mundo sem termo ainda tem " +
            "cadastro ou treinamento pendente."
          : "Nenhuma ficha neste recorte.",
      }));
      return;
    }

    // --- Tabela ---
    var cols = ["Nome", "Projeto", "Grupo / Região", "CPF", "E-mail",
      "Cadastro", "Treinamento", "Termo de bolsa", "Entrada no projeto"];
    var chavesTermos = {
      "Nome": function (f) { return normStr(f.nome); },
      "Projeto": function (f) { return f.tipo === "capital" ? "Capital" : "Interior"; },
      "Grupo / Região": function (f) { return normStr(regiaoNaTabela(chaveSupervisao(f))); },
      "CPF": function (f) { return soDigitos(f.cpf); },
      "E-mail": function (f) { return normStr(f.email); },
      "Cadastro": function (f) { return ehRealizado(f.cadastro_bolsista) ? "1" : "0"; },
      "Treinamento": function (f) {
        return (fezTreinamento(f) ? "1 " : "0 ") + chaveData(dataTreinamentoDe(f));
      },
      "Termo de bolsa": function (f) {
        return f.termo_link ? "2" : aptoParaTermo(f) ? "1 apto" : "0";
      },
      "Entrada no projeto": function (f) { return chaveData(f.data_entrada); },
    };
    var estadoTermos = ordemLista.termos;
    lista = ordenarLista(lista, estadoTermos, chavesTermos);
    painel.appendChild(seletorDeOrdem(cols, estadoTermos, chavesTermos, renderPainelTermos));

    var tabela = el("table", { class: "tabela tabela--cand tabela--termos" });
    tabela.appendChild(el("thead", {}, [
      cabecalhoOrdenavel(cols, estadoTermos, chavesTermos, renderPainelTermos),
    ]));

    var tbody = el("tbody");
    lista.forEach(function (f) {
      var tr = el("tr", { class: "tabela__tr" });

      var tdNome = el("td", { class: "tabela__td cand-td-nome" });
      tdNome.appendChild(el("span", { text: f.nome || "—" }));
      if (aptoParaTermo(f)) {
        tdNome.appendChild(el("span", {
          class: "termo-apto",
          title: "Cadastro e treinamento feitos. Falta só o termo de bolsa." +
            (f.aviso_apto_em ? " Financeiro avisado em " + formatarDataHora(f.aviso_apto_em) + "."
              : " O financeiro ainda não foi avisado."),
          text: f.aviso_apto_em ? "✓ apto — financeiro avisado" : "★ apto — avisar financeiro",
        }));
      }
      tr.appendChild(tdNome);

      tr.appendChild(el("td", { class: "tabela__td", "data-label": "Projeto",
        text: f.tipo === "capital" ? "Capital" : "Interior" }));
      tr.appendChild(el("td", { class: "tabela__td col-regiao", "data-label": "Grupo / Região",
        title: chaveSupervisao(f) || "", text: regiaoNaTabela(chaveSupervisao(f)) }));
      tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "CPF",
        text: formatarCPF(f.cpf) }));
      tr.appendChild(el("td", { class: "tabela__td cand-email", "data-label": "E-mail",
        text: f.email || "—" }));
      tr.appendChild(celulaEtapa("Cadastro", f.cadastro_bolsista));
      tr.appendChild(celulaEtapa("Treinamento", treinamentoDe(f), dataTreinamentoDe(f)));

      var tdTermo = el("td", { class: "tabela__td", "data-label": "Termo de bolsa" });
      if (f.termo_link) {
        tdTermo.appendChild(el("a", {
          class: "form-termo", href: f.termo_link, target: "_blank", rel: "noopener",
          text: "📄 " + (f.termo_bolsa || "Emitido"),
        }));
      } else {
        tdTermo.appendChild(aptoParaTermo(f)
          ? tagPendente("aguardando termo", "Cadastro e treinamento feitos: o termo é o próximo passo.")
          : tagNaoApto("Falta cadastro de bolsista ou treinamento antes do termo."));
      }
      tr.appendChild(tdTermo);

      tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "Entrada no projeto",
        text: f.data_entrada || "—" }));
      tbody.appendChild(tr);
    });
    tabela.appendChild(tbody);

    painel.appendChild(el("p", {
      class: "cand-resumo",
      text: lista.length + " ficha(s) exibida(s) · " + notaDaOrdem(lista, estadoTermos),
    }));
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    painel.appendChild(wrap);
  }

  // O aviso é automático — mas só se o gatilho estiver instalado no Apps
  // Script. Sem esta linha, "automático desligado" e "automático ligado, nada a
  // avisar" seriam a mesma tela silenciosa, e o botão viraria obrigação sem
  // ninguém perceber.
  var statusAutomacao = null; // null = ainda não consultado

  function blocoAutomacaoAviso() {
    var caixa = el("p", { class: "cand-resumo automacao" });
    if (!backendConvocacao()) {
      caixa.appendChild(el("span", {
        text: "Envio automático indisponível: o Apps Script ainda não está configurado " +
          "(veja docs/APPS-SCRIPT-CONVOCACAO.md).",
      }));
      return caixa;
    }
    if (statusAutomacao) {
      caixa.appendChild(textoDaAutomacao(statusAutomacao));
      return caixa;
    }
    caixa.appendChild(el("span", { text: "Verificando o envio automático…" }));
    chamarBackend({ acao: "status_automacao" }).then(function (res) {
      statusAutomacao = (res && res.gatilhos) || {};
      caixa.innerHTML = "";
      caixa.appendChild(textoDaAutomacao(statusAutomacao));
    }).catch(function () {
      // Script antigo não conhece a ação: dizer isso é melhor do que afirmar
      // que está ligado ou desligado sem saber.
      caixa.innerHTML = "";
      caixa.appendChild(el("span", {
        text: "Não foi possível conferir o envio automático. Se o Apps Script for de uma " +
          "versão anterior, republique-o para o painel conseguir checar.",
      }));
    });
    return caixa;
  }

  function textoDaAutomacao(g) {
    var span = el("span");
    if (g.aviso) {
      span.appendChild(el("strong", { class: "automacao--ok", text: "✓ Envio automático ligado" }));
      span.appendChild(el("span", {
        text: " — o financeiro é avisado de hora em hora, sem ninguém clicar. " +
          "O botão acima serve para não esperar a próxima rodada.",
      }));
      return span;
    }
    if (g.sincronizacao) {
      span.appendChild(el("strong", { class: "automacao--ok", text: "✓ Envio automático ligado" }));
      span.appendChild(el("span", {
        text: " — junto com a sincronização das planilhas, de 6 em 6 horas. Para avisar de " +
          "hora em hora, rode instalarGatilhoAviso() uma vez no Apps Script.",
      }));
      return span;
    }
    span.appendChild(el("strong", { class: "automacao--off", text: "⚠ Envio automático desligado" }));
    span.appendChild(el("span", {
      text: " — nenhum aviso sai sozinho: só pelo botão acima. Para ligar, abra o Apps Script " +
        "e rode a função instalarGatilhoAviso() uma vez (menu Executar).",
    }));
    return span;
  }

  function exportarTermos() {
    var base = formacaoDosTermos();
    var aoa = [["Nome", "Projeto", "Grupo / Região", "CPF", "E-mail", "Cadastro de bolsista",
      "Treinamento", "Termo de bolsa", "Documento do termo", "Entrada no projeto", "Situação"]];
    base.slice().sort(porOrdemPlanilha).forEach(function (f) {
      aoa.push([
        f.nome || "", f.tipo === "capital" ? "Capital" : "Interior",
        regiaoCurta(chaveSupervisao(f)) || "", formatarCPF(f.cpf), f.email || "",
        f.cadastro_bolsista || "Não Realizado", treinamentoDe(f) || "Não Realizado",
        f.termo_link ? "Emitido" : "Não emitido", f.termo_link || "", f.data_entrada || "",
        f.termo_link ? "Com termo" : aptoParaTermo(f) ? "Apto — aguardando termo" : "Etapa pendente",
      ]);
    });
    var hoje = new Date().toISOString().slice(0, 10);
    window.Exportador.xlsx("termos-de-bolsa_" + hoje + ".xlsx", "Termos", aoa);
  }

  // Manda ao financeiro a lista de quem ficou apto e ainda não foi avisado. A
  // rotina automática do Apps Script faz o mesmo de tempos em tempos; este
  // botão serve para não esperar o próximo ciclo.
  function avisarFinanceiro(btn) {
    if (!exigirAdmin("Avisar o financeiro")) return;
    if (!backendConvocacao()) {
      alert("Envio ainda não configurado. Veja docs/APPS-SCRIPT-CONVOCACAO.md.");
      return;
    }
    var aptos = formacao.filter(function (f) { return aptoParaTermo(f) && !f.aviso_apto_em; });
    if (!aptos.length) { alert("Ninguém apto sem aviso no momento."); return; }
    if (!confirm("Avisar o financeiro sobre " + aptos.length + " pessoa(s) apta(s)?\n\n" +
      aptos.slice(0, 10).map(function (f) { return "· " + (f.nome || "(sem nome)"); }).join("\n") +
      (aptos.length > 10 ? "\n· e mais " + (aptos.length - 10) : ""))) return;

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Enviando…'; }
    chamarBackend({ acao: "avisar_aptos" }).then(function (res) {
      return carregarFormacao().then(function () {
        alert("Aviso enviado.\n\nPessoas no aviso: " + (res.avisados != null ? res.avisados : aptos.length) +
          "\nDestinatários: " + ((res.destinatarios || []).join(", ") || "(nenhum)") +
          (res.destinatarios && !res.destinatarios.length
            ? "\n\nNinguém na lista do financeiro: inclua e-mails em app_financeiro (sql/perfil-financeiro.sql)."
            : ""));
      });
    }).catch(function (e) {
      renderPainelTermos();
      alert("Não foi possível avisar: " + (e.message || e) + "\n\n" + dicaDaSincronizacao(e));
    });
  }

  // Bloco de importação (abas Candidatos e Formação): enviar o CSV e ver os
  // registros de importação — e, na Formação, o da última sincronização. É
  // tarefa ocasional e de admin, então vive recolhido no fim da aba; abrir é um
  // clique, e nada foi retirado.
  function blocoImportar(aba, aberto) {
    var eForm = aba === "formacao";
    var caixa = el("details", { class: "recolhe recolhe--imp" });
    // Recém-importado, o bloco fica aberto: o "✓ 45 linha(s) importada(s)" é a
    // resposta ao que a pessoa acabou de fazer e não pode nascer escondido.
    if (aberto || (eForm ? formMsg : candMsg)) caixa.setAttribute("open", "open");
    var resumo = el("summary", { class: "recolhe__resumo" });
    var seta = el("span", { class: "recolhe__seta", "aria-hidden": "true" });
    seta.innerHTML = '<svg viewBox="0 0 16 16" focusable="false">' +
      '<path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    resumo.appendChild(seta);
    resumo.appendChild(el("span", { class: "recolhe__titulo", text: "Importar planilha e registros" }));
    resumo.appendChild(el("span", {
      class: "recolhe__nota",
      text: eForm ? "envio de CSV, última importação e última sincronização"
        : "envio de CSV e histórico de importações",
    }));
    caixa.appendChild(resumo);

    var tipoAtual = eForm ? formTipo : candTipo;
    var corpo = el("div", { class: "recolhe__corpo" });
    var barra = el("div", { class: "cand-importar" });
    barra.appendChild(el("span", {
      class: "cand-imp-rot", text: eForm ? "Importar formação:" : "Importar inscrições:",
    }));
    var selTipo = el("select", { class: "viz-select", id: eForm ? "form-imp-tipo" : "cand-imp-tipo" });
    selTipo.appendChild(el("option", { value: "capital", text: "Capital" }));
    selTipo.appendChild(el("option", { value: "interior", text: "Interior" }));
    selTipo.value = tipoAtual;
    var file = el("input", { type: "file", accept: ".csv,text/csv", class: "cand-file" });
    var btn = el("button", { class: "btn btn--pequeno", type: "button", text: "Enviar CSV" });
    var idStatus = eForm ? "form-status" : "cand-status";
    var status = el("span", { class: "cand-status", id: idStatus, text: eForm ? formMsg : candMsg });
    btn.addEventListener("click", function () {
      var f = file.files && file.files[0];
      if (!f) { status.textContent = "Escolha um arquivo CSV primeiro."; return; }
      var tipo = selTipo.value;
      btn.disabled = true; status.textContent = "Lendo arquivo…";
      var reader = new FileReader();
      reader.onload = function () {
        var envio = eForm
          ? importarFormacaoCSV(tipo, String(reader.result), f.name)
          : importarCSV(tipo, String(reader.result), f.name);
        envio.then(function (r) {
          var msg = "✓ " + r.total + " linha(s) importada(s) (" + tipo + "): " +
            r.criadas + " nova(s), " + r.atualizadas + " atualizada(s).";
          if (eForm) { formMsg = msg; formTipo = tipo; carregarFormacao(); }
          else { candMsg = msg; candTipo = tipo; carregarCandidatos(); }
        }).catch(function (e) {
          btn.disabled = false;
          mostrarStatus("#" + idStatus, "Erro ao importar: " + (e.message || e));
        });
      };
      reader.onerror = function () { btn.disabled = false; status.textContent = "Não foi possível ler o arquivo."; };
      reader.readAsText(f, "utf-8");
    });
    barra.appendChild(selTipo);
    barra.appendChild(file);
    barra.appendChild(btn);
    barra.appendChild(status);
    corpo.appendChild(barra);
    corpo.appendChild(blocoUltimaImportacao(aba, tipoAtual));
    if (eForm) corpo.appendChild(blocoUltimaSincronizacao());
    caixa.appendChild(corpo);
    return caixa;
  }

  function renderPainelFormacao() {
    var painel = $("#painel-formacao");
    if (!painel) return;
    painel.innerHTML = "";

    painel.appendChild(seletorDeProjeto(formTipo, function (t) {
      return formacao.filter(function (f) { return f.tipo === t; }).length;
    }, "bolsista", function (t) {
      formTipo = t; formBusca = ""; renderPainelFormacao();
    }));

    var doTipo = formacao.filter(function (f) { return f.tipo === formTipo; });
    if (!doTipo.length) {
      painel.appendChild(el("p", {
        class: "cand-vazio",
        text: "Nenhum bolsista importado ainda para " + nomeRegiao(formTipo) +
          (ehAdmin() ? ". Envie o CSV de formação no bloco abaixo." : "."),
      }));
      if (ehAdmin()) painel.appendChild(blocoImportar("formacao", true));
      return;
    }

    // --- Resumo (Ativos, termo emitido, treinamento pendente…) ---
    var ativos = doTipo.filter(function (f) { return situacaoFormacao(f) === "Ativo"; }).length;
    var aguardandoTermo = doTipo.filter(function (f) { return situacaoFormacao(f) === "Aguardando termo"; }).length;
    var desligados = doTipo.filter(function (f) { return !!f.desligado_em; }).length;
    var comTermo = doTipo.filter(function (f) { return !!f.termo_link; }).length;
    var semCadastro = doTipo.filter(function (f) { return !ehRealizado(f.cadastro_bolsista); }).length;
    var semTreino = doTipo.filter(function (f) {
      return !fezTreinamento(f);
    }).length;
    var stats = el("div", { class: "stats stats--form" }, [
      statCard("Bolsistas", doTipo.length),
      statCard("Ativos", ativos),
      // Pela situação, e não por subtração: quem foi desligado COM termo
      // emitido era descontado duas vezes e o número saía menor do que é.
      statCard("Aguardando termo", aguardandoTermo),
      statCard("Cadastro pendente", semCadastro),
      statCard("Sem treinamento", semTreino),
      desligados ? statCard("Desligados", desligados) : null,
    ]);
    painel.appendChild(stats);

    // --- Ações da aba ---
    // Três controles no lugar de seis botões soltos: a rotina (sincronizar),
    // os downloads e o resto. Nada saiu — só deixou de disputar espaço com o
    // que se usa todo dia.
    if (ehAdmin()) {
      var acoesForm = el("div", { class: "cand-acoes" });
      var btnSinc = el("button", {
        class: "btn btn--pequeno", type: "button", text: "🔄 Sincronizar planilhas",
        title: "Lê o cadastro de bolsista e os termos de bolsa, e atualiza as fichas pelo CPF",
      });
      btnSinc.addEventListener("click", function () { sincronizarFormacao(btnSinc); });
      acoesForm.appendChild(btnSinc);

      acoesForm.appendChild(menuSuspenso(
        "⬇ Baixar",
        "Planilha de formação em CSV ou Excel, inteira ou por " +
          (formTipo === "capital" ? "grupo" : "região"),
        itensDeDownload(formTipo)
      ));

      // O relatório de entradas e saídas só conta quem tem data de entrada. As
      // fichas anteriores ao sistema não têm — o item é o caminho para
      // completá-las, e some quando não sobra nenhuma.
      var semEntrada = doTipo.filter(function (f) { return !f.data_entrada; }).length;
      var faltando = doTipo.filter(function (f) { return !f.cpf || !f.telefone || !f.email; }).length;
      var maisItens = [{
        rotulo: "👥 Supervisores " + (formTipo === "capital" ? "por grupo" : "por região"),
        titulo: "Quem responde por cada " + (formTipo === "capital" ? "grupo" : "região"),
        acao: function () { abrirSupervisores(formTipo); },
      }];
      if (semEntrada) {
        maisItens.push({
          rotulo: "📅 Datas de entrada (" + semEntrada + ")",
          titulo: "Completar à mão quem a sincronização não alcançou — é a data de entrada " +
            "que permite contar os entrevistadores de meses passados",
          acao: function () { abrirDatasDeEntrada(formTipo); },
        });
      }
      if (faltando) {
        maisItens.push({
          rotulo: "🧩 Completar pela inscrição (" + faltando + ")",
          titulo: "Preenche CPF, telefone e e-mail que faltam usando os dados da inscrição",
          // O botão que mostra o "Completando…" é o gatilho do menu — o
          // painel é remontado ao fim, então ele volta ao normal sozinho.
          acao: function () { completarPelaInscricao(btnMais.querySelector("button")); },
        });
      }
      maisItens.push(null);
      maisItens.push({
        rotulo: "📥 Importar planilha (CSV)",
        titulo: "Abre o bloco de importação no fim da página",
        acao: function () {
          var d = painel.querySelector(".recolhe--imp");
          if (!d) return;
          d.setAttribute("open", "open");
          d.scrollIntoView({ block: "center" });
        },
      });
      var btnMais = menuSuspenso("⚙ Mais", "Supervisores, pendências e importação", maisItens);
      acoesForm.appendChild(btnMais);
      painel.appendChild(acoesForm);
    }

    // --- Metas e vagas: a Formação é onde a ocupação acontece ---
    painel.appendChild(blocoMetas(formTipo));

    // --- Lista: no projeto x desligados ---
    var noProjeto = doTipo.filter(function (f) { return situacaoFormacao(f) !== "Desligado"; });
    var saidos = doTipo.filter(function (f) { return situacaoFormacao(f) === "Desligado"; });
    painel.appendChild(cabecalhoDaLista("Bolsistas — " + nomeRegiao(formTipo), [
      { id: "projeto", rot: "No projeto", qtd: noProjeto.length },
      { id: "desligados", rot: "Desligados", qtd: saidos.length },
    ], formVer, function (id) { formVer = id; renderPainelFormacao(); }));
    doTipo = formVer === "desligados" ? saidos : noProjeto;

    // --- Busca ---
    var buscaWrap = el("div", { class: "painel__barra" });
    var inp = el("input", {
      class: "painel__busca",
      type: "search",
      placeholder: "Buscar por nome, CPF, e-mail, supervisor ou região…",
      value: formBusca,
    });
    inp.addEventListener("input", function () {
      formBusca = inp.value;
      renderPainelFormacao();
      var novo = $("#painel-formacao").querySelector(".painel__busca");
      if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
    });
    buscaWrap.appendChild(inp);
    painel.appendChild(buscaWrap);

    var termo = normStr(formBusca);
    var termoCPF = soDigitos(formBusca);
    var lista = !termo ? doTipo : doTipo.filter(function (f) {
      var texto = [f.nome, f.email, supervisorDe(f), f.regiao, regiaoNaTabela(f.regiao), f.grupo]
        .some(function (v) { return normStr(v).indexOf(termo) !== -1; });
      var porCPF = termoCPF.length >= 3 && soDigitos(f.cpf).indexOf(termoCPF) !== -1;
      return texto || porCPF;
    });
    lista = lista.slice().sort(porOrdemPlanilha);

    if (!lista.length) {
      painel.appendChild(el("p", {
        class: "cand-vazio",
        text: formBusca ? "Nenhum bolsista encontrado para esta busca."
          : formVer === "desligados" ? "Ninguém foi desligado nesta região."
          : "Nenhum bolsista no projeto nesta região.",
      }));
      if (ehAdmin()) painel.appendChild(blocoImportar("formacao", false));
      return;
    }

    // --- Tabela ---
    var cols = ["Nome", "Situação"];
    cols.push(formTipo === "capital" ? "Grupo" : "Região");
    cols = cols.concat(["CPF", "Telefone", "E-mail", "Supervisor", "Cadastro"]);
    cols.push("Treinamento");
    cols.push("Termo de bolsa");
    // Na lista de desligados, o que importa é quando saiu e por quê.
    if (formVer === "desligados") cols.push("Desligado em", "Motivo");
    // O supervisor só tem coluna de ação na Capital. O cabeçalho dela é "Ação"
    // e não "Grupo" porque já existe uma coluna Grupo (a que mostra o valor) —
    // duas com o mesmo nome confundem.
    var editavel = temColunaDeGrupo(formTipo);
    if (editavel) cols.push(ehAdmin() ? "Editar" : "Ação");

    // Cadastro, Treinamento e Termo ordenam por etapa cumprida (pendente
    // primeiro), que é o que se procura ao clicar nessas colunas.
    var chavesForm = {
      "Nome": function (f) { return normStr(f.nome); },
      "Situação": function (f) { return normStr(situacaoFormacao(f)); },
      "Grupo": function (f) { return normStr(regiaoCurta(f.grupo)); },
      "Região": function (f) { return normStr(regiaoNaTabela(f.regiao)); },
      "CPF": function (f) { return soDigitos(f.cpf); },
      "Telefone": function (f) { return soDigitos(f.telefone); },
      "E-mail": function (f) { return normStr(f.email); },
      "Supervisor": function (f) { return normStr(supervisorDe(f)); },
      "Cadastro": function (f) { return ehRealizado(f.cadastro_bolsista) ? "1" : "0"; },
      "Treinamento": function (f) {
        return (fezTreinamento(f) ? "1 " : "0 ") + chaveData(dataTreinamentoDe(f));
      },
      "Termo de bolsa": function (f) {
        return f.termo_link ? "2" : aptoParaTermo(f) ? "1 apto" : "0";
      },
      "Desligado em": function (f) { return chaveData(f.desligado_em); },
      "Motivo": function (f) { return normStr(f.desligado_motivo); },
    };
    delete chavesForm[formTipo === "capital" ? "Região" : "Grupo"];

    var estadoForm = ordemLista.formacao;
    lista = ordenarLista(lista, estadoForm, chavesForm);
    painel.appendChild(seletorDeOrdem(cols, estadoForm, chavesForm, renderPainelFormacao));

    var tabela = el("table", { class: "tabela tabela--cand tabela--form" });
    var thead = el("thead");
    thead.appendChild(cabecalhoOrdenavel(cols, estadoForm, chavesForm, renderPainelFormacao));
    tabela.appendChild(thead);

    var tbody = el("tbody");
    var casados = 0;
    lista.forEach(function (f) {
      var ent = entrevistaDoBolsista(f);
      if (ent) casados++;
      var tr = el("tr", { class: "tabela__tr" });

      var tdNome = el("td", { class: "tabela__td cand-td-nome" });
      tdNome.appendChild(el("span", { text: f.nome || "—" }));
      if (ent) tdNome.appendChild(el("span", { class: "cand-fonte cand-fonte--sistema", text: "entrevista no sistema" }));
      tr.appendChild(tdNome);

      var st = situacaoFormacao(f);
      var tdSt = el("td", { class: "tabela__td", "data-label": "Status" });
      tdSt.appendChild(tagSituacao(st, f.desligado_em
        ? "Desligado em " + f.desligado_em + (f.desligado_motivo ? " — " + f.desligado_motivo : "")
        : (st === "Ativo" ? "Termo de bolsa emitido" : "Ainda sem termo de bolsa")));
      tr.appendChild(tdSt);

      if (formTipo === "capital") {
        var tdGrupo = el("td", { class: "tabela__td", "data-label": "Grupo" });
        tdGrupo.appendChild(tagGrupo(f.grupo));
        tr.appendChild(tdGrupo);
      } else {
        tr.appendChild(el("td", {
          class: "tabela__td col-regiao", "data-label": "Região",
          title: f.regiao || "", text: regiaoNaTabela(f.regiao),
        }));
      }

      tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "CPF", text: formatarCPF(f.cpf) }));
      tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "Telefone", text: f.telefone || "—" }));
      tr.appendChild(el("td", { class: "tabela__td cand-email", "data-label": "E-mail", text: f.email || "—" }));
      tr.appendChild(el("td", { class: "tabela__td", "data-label": "Supervisor", text: supervisorDe(f) || "—" }));
      tr.appendChild(celulaEtapa("Cadastro", f.cadastro_bolsista));

      tr.appendChild(celulaEtapa("Treinamento", treinamentoDe(f), dataTreinamentoDe(f)));

      // Termo de bolsa: link do documento quando existe (é o que define "Ativo").
      var tdTermo = el("td", { class: "tabela__td", "data-label": "Termo de bolsa" });
      if (f.termo_link) {
        tdTermo.appendChild(el("a", {
          class: "form-termo", href: f.termo_link, target: "_blank", rel: "noopener",
          text: "📄 " + (f.termo_bolsa || "Emitido"),
        }));
      } else {
        // Sem link é sem termo, venha o que vier escrito na planilha
        // ("Não Emitido", "não emitido", vazio): um texto só para toda a coluna.
        tdTermo.appendChild(el("span", { class: "cand-pendente", text: "Não emitido" }));
      }
      tr.appendChild(tdTermo);

      if (formVer === "desligados") {
        tr.appendChild(el("td", { class: "tabela__td col-firme", "data-label": "Desligado em", text: f.desligado_em || "—" }));
        tr.appendChild(el("td", { class: "tabela__td", "data-label": "Motivo", text: f.desligado_motivo || "—" }));
      }

      if (editavel) {
        var tdEd = el("td", {
          class: "tabela__td cand-td-editar",
          "data-label": ehAdmin() ? "Editar" : "Ação",
        });
        if (podeEditarGrupo(f)) {
          // Só o lápis: a coluna inteira dizia "Editar" em cada linha e era o
          // que empurrava a tabela para fora da tela. O cabeçalho e o
          // aria-label continuam nomeando a ação.
          var btnEd = ehAdmin()
            ? botaoLapis("Editar a ficha de " + (f.nome || "este bolsista"))
            : el("button", {
                class: "btn btn--secundario btn--pequeno", type: "button",
                text: "+ Definir grupo",
              });
          btnEd.addEventListener("click", function () { abrirEdicaoFormacao(f); });
          tdEd.appendChild(btnEd);
        } else {
          // Supervisor diante de quem já tem grupo: nada a fazer aqui.
          tdEd.appendChild(el("span", {
            class: "cand-pendente",
            title: "Já está no grupo " + f.grupo + ". Trocar de grupo é ação do administrador.",
            text: "—",
          }));
        }
        tr.appendChild(tdEd);
      }
      tbody.appendChild(tr);
    });
    tabela.appendChild(tbody);

    painel.appendChild(el("p", {
      class: "cand-resumo",
      text: lista.length + " bolsista(s) exibido(s) · " + casados + " com entrevista casada pelo CPF · " +
        notaDaOrdem(lista, estadoForm),
    }));
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    painel.appendChild(wrap);

    if (ehAdmin()) painel.appendChild(blocoImportar("formacao", false));
  }

  // ---------- Abas ----------
  function configurarAbas() {
    Array.prototype.forEach.call(document.querySelectorAll(".aba"), function (aba) {
      aba.addEventListener("click", function () {
        Array.prototype.forEach.call(document.querySelectorAll(".aba"), function (a) { a.classList.remove("aba--ativa"); });
        aba.classList.add("aba--ativa");
        var alvo = aba.getAttribute("data-aba");
        mostrar($("#painel-capital"), alvo === "capital");
        mostrar($("#painel-interior"), alvo === "interior");
        mostrar($("#painel-candidatos"), alvo === "candidatos");
        mostrar($("#painel-formacao"), alvo === "formacao");
        mostrar($("#painel-dados"), alvo === "dados");
        mostrar($("#painel-termos"), alvo === "termos");
        aplicarLarguraDaAba(alvo);
        // No celular a barra de abas rola de lado: traz a aba escolhida para o
        // meio, senão a ativa pode ficar meio fora da tela depois do clique.
        if (aba.scrollIntoView) {
          try { aba.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }
          catch (e) { aba.scrollIntoView(); }
        }
      });
    });
  }

  // ---------- Visualização de dados ----------
  // Qual etapa está sendo olhada: inscricoes | entrevistas | formacao.
  var vizAba = "inscricoes";
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

  // ---------- Linha do tempo das entrevistas ----------
  function isoData(d) { return d.toISOString().slice(0, 10); }
  function ddmm(d) {
    return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }

  // Conta entrevistas por dia. Se o período for longo, agrupa por semana para a
  // linha não virar um serrilhado ilegível. Dias sem entrevista entram como
  // zero, senão a linha "encurtaria" o tempo parado.
  var UN_ENTREVISTA = { um: "entrevista", varios: "entrevistas" };
  var UN_INSCRICAO = { um: "inscrição", varios: "inscrições" };

  function serieDiaria(valores, unidade) {
    var porDia = {};
    valores.forEach(function (v) {
      // Aceita "AAAA-MM-DD" e "AAAA-MM-DD HH:MM" (a data da inscrição tem hora).
      var d = String(v || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      porDia[d] = (porDia[d] || 0) + 1;
    });
    var datas = Object.keys(porDia).sort();
    if (datas.length < 2) return null; // com um dia só não há linha do tempo

    var ini = new Date(datas[0] + "T00:00:00Z");
    var fim = new Date(datas[datas.length - 1] + "T00:00:00Z");
    var dias = Math.round((fim - ini) / 86400000) + 1;
    var passo = dias > 45 ? 7 : 1;
    var pontos = [];
    for (var i = 0; i < dias; i += passo) {
      var inicioBloco = new Date(ini.getTime() + i * 86400000);
      var soma = 0;
      for (var j = 0; j < passo && i + j < dias; j++) {
        soma += porDia[isoData(new Date(ini.getTime() + (i + j) * 86400000))] || 0;
      }
      pontos.push({
        rotulo: ddmm(inicioBloco),
        valor: soma,
        titulo: (passo === 1 ? "" : "Semana de ") + ddmm(inicioBloco) + ": " + soma + " " +
          (soma === 1 ? unidade.um : unidade.varios),
      });
    }
    return { pontos: pontos, porSemana: passo > 1, unidade: unidade };
  }

  function serieEntrevistas(lista) {
    return serieDiaria(lista.map(function (r) { return r.data_entrevista; }), UN_ENTREVISTA);
  }
  function serieInscricoes(lista) {
    return serieDiaria(lista.map(function (c) { return c.data_inscricao; }), UN_INSCRICAO);
  }

  function graficoLinha(titulo, serie) {
    var card = el("div", { class: "grafico grafico--largo" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: titulo }));
    var un = (serie && serie.unidade) || UN_ENTREVISTA;
    if (!serie || serie.pontos.length < 2) {
      card.appendChild(el("p", { class: "vazio", text: "É preciso ter " + un.varios + " em pelo menos dois dias." }));
      return card;
    }
    var pts = serie.pontos;
    var max = pts.reduce(function (m, p) { return Math.max(m, p.valor); }, 0) || 1;
    var W = 720, H = 240, ml = 34, mr = 14, mt = 14, mb = 30;
    var larg = W - ml - mr, alt = H - mt - mb;
    function x(i) { return ml + (pts.length === 1 ? larg / 2 : (i * larg) / (pts.length - 1)); }
    function y(v) { return mt + alt - (v / max) * alt; }

    // Eixo Y: no máximo 4 marcas, sempre em números inteiros.
    var passoY = Math.max(1, Math.ceil(max / 4));
    var marcas = [];
    for (var v = 0; v <= max; v += passoY) marcas.push(v);
    if (marcas[marcas.length - 1] !== max) marcas.push(max);

    var svg = ['<svg class="linha-tempo" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + titulo + '">'];
    marcas.forEach(function (v) {
      svg.push('<line class="linha-tempo__grade" x1="' + ml + '" y1="' + y(v) + '" x2="' + (W - mr) + '" y2="' + y(v) + '"/>');
      svg.push('<text class="linha-tempo__eixo" x="' + (ml - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + "</text>");
    });

    var caminho = pts.map(function (p, i) { return x(i).toFixed(1) + "," + y(p.valor).toFixed(1); }).join(" ");
    svg.push('<polygon class="linha-tempo__area" points="' + ml + "," + y(0) + " " + caminho + " " + (W - mr) + "," + y(0) + '"/>');
    svg.push('<polyline class="linha-tempo__linha" points="' + caminho + '"/>');

    // Rótulos do eixo X: no máximo ~8, para não embolar.
    var salto = Math.ceil(pts.length / 8);
    pts.forEach(function (p, i) {
      svg.push('<circle class="linha-tempo__ponto" cx="' + x(i).toFixed(1) + '" cy="' + y(p.valor).toFixed(1) + '" r="3.5">' +
        "<title>" + p.titulo + "</title></circle>");
      if (i % salto === 0 || i === pts.length - 1) {
        svg.push('<text class="linha-tempo__eixo" x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + p.rotulo + "</text>");
      }
    });
    svg.push("</svg>");

    var caixa = el("div", { class: "linha-tempo__caixa" });
    caixa.innerHTML = svg.join("");
    card.appendChild(caixa);
    var total = pts.reduce(function (s, p) { return s + p.valor; }, 0);
    card.appendChild(el("p", {
      class: "linha-tempo__nota",
      text: total + " " + un.varios + " · " + (serie.porSemana ? "agrupadas por semana" : "por dia") +
        " · de " + pts[0].rotulo + " a " + pts[pts.length - 1].rotulo,
    }));
    return card;
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
    card.appendChild(el("h3", { class: "grafico__titulo", text: "Entrevistados por região (mapa)" }));
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
        : "O número ao lado de cada ponto indica a quantidade de entrevistados (a Capital aparece em roxo).",
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

  // ---------- Funil do processo (dados da aba Candidatos) ----------
  // Segue os filtros de Tipo e Região da tela. O filtro de PERÍODO não se
  // aplica: as inscrições não têm data — ele vale só para as entrevistas.
  function candidatosDaViz() {
    var lista = candidatosDoTipoViz();
    // Período: agora as inscrições têm data (coluna `data_envio` do arquivo da
    // plataforma). Fichas importadas antes disso não têm data e ficam de fora
    // quando há período escolhido — o rodapé da seção diz quantas são, para o
    // número menor não parecer perda de dado.
    if (vizDe) lista = lista.filter(function (c) { return diaInscricao(c) && diaInscricao(c) >= vizDe; });
    if (vizAte) lista = lista.filter(function (c) { return diaInscricao(c) && diaInscricao(c) <= vizAte; });
    return lista;
  }
  function diaInscricao(c) { return String(c.data_inscricao || "").slice(0, 10); }

  function blocoFunilCandidatos() {
    var bloco = el("section", { class: "viz-secao" });
    var lista = candidatosDaViz();
    if (!lista.length) return bloco; // sem inscrições importadas, nada a mostrar

    bloco.appendChild(el("h2", { class: "viz-secao__titulo", text: "Inscrições no SIPE" }));

    var resultados = lista.map(function (c) { return resultadoDoCandidato(c); });
    var convocados = lista.filter(jaConvocadoEntrevista).length;
    var compareceram = resultados.filter(function (r) { return r && r !== "NÃO COMPARECEU"; }).length;
    var faltaram = resultados.filter(function (r) { return r === "NÃO COMPARECEU"; }).length;
    var selecionados = resultados.filter(function (r) { return r.indexOf("SELECIONADO") === 0; }).length;
    var reprovados = resultados.filter(function (r) { return r === "REPROVADO"; }).length;
    var cadastro = lista.filter(jaConvocadoCadastro).length;
    var semEmail = lista.filter(function (c) { return !!c.email_bounce; }).length;
    var aguardando = convocados - compareceram - faltaram;

    function pct(parte, todo) { return todo ? Math.round((parte / todo) * 100) + "%" : "—"; }

    bloco.appendChild(el("div", { class: "stats" }, [
      statCard("Inscritos", lista.length),
      statCard("Convocados p/ entrevista", convocados),
      statCard("Entrevistados", compareceram),
      statCard("Selecionados", selecionados),
      statCard("Taxa de seleção", pct(selecionados, compareceram)),
    ]));

    var grid = el("div", { class: "graficos" });
    grid.appendChild(graficoBarras("Etapas do processo", [
      { label: "Cadastrados no SIPE", valor: lista.length },
      { label: "Convocados p/ entrevista", valor: convocados },
      { label: "Entrevistados", valor: compareceram },
      { label: "Selecionados", valor: selecionados },
      { label: "Convocados p/ cadastro", valor: cadastro },
    ]));

    var perdas = [
      { label: "Sem agendamento", valor: Math.max(0, aguardando) },
      { label: "Não compareceram", valor: faltaram },
      { label: "Reprovados", valor: reprovados },
      { label: "E-mail inválido", valor: semEmail },
      { label: "Ainda não convocados", valor: lista.length - convocados },
    ].filter(function (d) { return d.valor > 0; });
    if (perdas.length) grid.appendChild(graficoBarras("Onde os candidatos estão parados", perdas));

    // Inscritos por região (só faz sentido no Interior, que tem região).
    var porRegiao = contarPor(lista, function (c) { return c.regiao; });
    var regioes = Object.keys(porRegiao)
      .map(function (nome) { return { label: nome.replace(/ \(região\)$/, ""), valor: porRegiao[nome] }; })
      .sort(function (a, b) { return b.valor - a.valor; });
    if (regioes.length > 1) grid.appendChild(graficoBarras("Cadastrados no SIPE por região (interior)", regioes));

    // Ritmo das inscrições ao longo do tempo (coluna `data_envio` do arquivo).
    var serieInsc = serieInscricoes(lista);
    if (serieInsc) grid.appendChild(graficoLinha("Inscrições ao longo do tempo", serieInsc));

    bloco.appendChild(grid);

    // Quantas fichas têm data de inscrição — dizer isso evita que um número
    // menor no gráfico do que nos cartões pareça dado perdido.
    // Conta sobre TODAS as fichas do tipo (sem o período): o que interessa aqui
    // é quantas ainda não têm data, não quantas ficaram fora da janela.
    var semData = candidatosDoTipoViz().filter(function (c) { return !diaInscricao(c); }).length;
    var nota = "Fonte: aba Candidatos.";
    if (vizDe || vizAte) {
      nota += " Período aplicado pela data de inscrição" +
        (semData > 0 ? "; " + semData + " ficha(s) sem essa data ficaram de fora." : ".");
    } else if (semData > 0) {
      nota += " " + semData + " ficha(s) ainda não têm data de inscrição — são as importadas " +
        "antes de o arquivo da plataforma trazer a coluna data_envio. Reimporte os CSVs para completar.";
    }
    var assumidas = assumidasNoOutroLado();
    if (assumidas) {
      nota += " " + assumidas + " ficha(s) de quem se inscreveu de novo na outra região ficam " +
        "de fora daqui: a pessoa é contada do lado em que vai atuar.";
    }
    bloco.appendChild(el("p", { class: "viz-secao__nota", text: nota }));
    return bloco;
  }

  // Mesma seleção de candidatosDaViz, mas SEM o período — serve para contar
  // quantas fichas ficaram de fora por não ter data de inscrição.
  function candidatosDoTipoViz() {
    var lista = candidatos.slice();
    if (vizTipo !== "todos") lista = lista.filter(function (c) { return c.tipo === vizTipo; });
    if (vizRegiao) lista = lista.filter(function (c) { return c.regiao === vizRegiao; });
    // Quem se inscreveu de novo na região certa é contado lá, uma vez só. Sem
    // isso a mesma pessoa apareceria como duas selecionadas.
    return lista.filter(function (c) { return !fichaQueAssumiu(c); });
  }
  function assumidasNoOutroLado() {
    var n = 0;
    candidatos.forEach(function (c) {
      if (vizTipo !== "todos" && c.tipo !== vizTipo) return;
      if (vizRegiao && c.regiao !== vizRegiao) return;
      if (fichaQueAssumiu(c)) n++;
    });
    return n;
  }

  // ---------- Seção Formação (aba Visualização de dados) ----------
  function formacaoDaViz() {
    var lista = formacao.slice();
    if (vizTipo !== "todos") lista = lista.filter(function (f) { return f.tipo === vizTipo; });
    if (vizRegiao) {
      var alvo = normStr(regiaoCurta(vizRegiao));
      lista = lista.filter(function (f) { return normStr(regiaoCurta(f.regiao)) === alvo; });
    }
    return lista;
  }

  // ============================================================
  //  Entradas e saídas mês a mês
  //
  //  Responde "quantos entrevistadores tínhamos em maio?" sem depender da
  //  memória de ninguém: com a data de entrada e a de saída de cada pessoa, o
  //  número de qualquer mês passado é uma conta.
  //
  //      ativos no fim do mês = entrou até o fim do mês
  //                             e (não saiu, ou saiu depois do fim do mês)
  // ============================================================
  var MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun",
                  "jul", "ago", "set", "out", "nov", "dez"];

  // "15/07/2026" → "2026-07". Aceita também o formato ISO, caso a data tenha
  // vindo da planilha em vez do painel.
  function mesDe(txt) {
    var iso = normalizarDataHora(txt);
    return iso ? iso.slice(0, 7) : "";
  }
  function rotuloDoMes(ym) {
    var p = ym.split("-");
    return MESES_PT[Number(p[1]) - 1] + "/" + p[0];
  }
  function mesAtual() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function proximoMes(ym) {
    var a = Number(ym.slice(0, 4));
    var m = Number(ym.slice(5, 7)) + 1;
    if (m > 12) { m = 1; a++; }
    return a + "-" + String(m).padStart(2, "0");
  }

  // Uma linha por mês, do primeiro movimento até hoje. `semData` conta as
  // fichas que não entram em conta nenhuma — o número tem de aparecer na tela,
  // senão o relatório mente por omissão.
  function movimentacaoPorMes(lista) {
    var comData = [], semData = 0;
    lista.forEach(function (f) {
      var entrou = mesDe(f.data_entrada);
      if (!entrou) { semData++; return; }
      comData.push({ entrou: entrou, saiu: mesDe(f.desligado_em) });
    });
    if (!comData.length) return { meses: [], semData: semData, total: lista.length };

    var primeiro = comData.reduce(function (m, f) {
      return !m || f.entrou < m ? f.entrou : m;
    }, "");
    var ultimo = mesAtual();
    // Uma saída lançada com data futura não pode sumir do relatório.
    comData.forEach(function (f) { if (f.saiu && f.saiu > ultimo) ultimo = f.saiu; });

    var meses = [];
    for (var ym = primeiro; ym <= ultimo; ym = proximoMes(ym)) {
      var entradas = 0, saidas = 0, ativos = 0;
      comData.forEach(function (f) {
        if (f.entrou === ym) entradas++;
        if (f.saiu === ym) saidas++;
        if (f.entrou <= ym && (!f.saiu || f.saiu > ym)) ativos++;
      });
      meses.push({ ym: ym, rot: rotuloDoMes(ym), entradas: entradas, saidas: saidas, ativos: ativos });
      if (meses.length > 240) break; // trava contra data absurda na planilha
    }
    return { meses: meses, semData: semData, total: lista.length };
  }

  function blocoMovimentacao() {
    var bloco = el("section", { class: "viz-secao" });
    var lista = formacaoDaViz();
    if (!lista.length) {
      bloco.appendChild(el("p", {
        class: "vazio",
        text: "Nenhum bolsista na Formação com os filtros atuais.",
      }));
      return bloco;
    }

    bloco.appendChild(el("p", {
      class: "pagina__sub",
      text: "Quantas pessoas entraram, quantas saíram e quantas estavam no projeto ao fim de " +
        "cada mês. Vale para o filtro de tipo e região escolhido acima; o filtro de período " +
        "não se aplica aqui, porque a tabela já é mês a mês.",
    }));

    var dados = movimentacaoPorMes(lista);
    if (!dados.meses.length) {
      bloco.appendChild(el("div", { class: "aviso-sistema" }, [
        el("p", { class: "aviso-sistema__titulo", text: "Ainda não dá para montar o quadro por mês" }),
        el("p", {
          class: "aviso-sistema__texto",
          text: "Nenhuma das " + lista.length + " fichas tem data de entrada preenchida. " +
            "Na aba Formação, clique em “🔄 Sincronizar planilhas”: a data vem do carimbo do " +
            "Cadastro de Bolsista. O que sobrar sem data, complete em “📅 Datas de entrada”.",
        }),
      ]));
      return bloco;
    }

    // --- Números do mês corrente, para leitura rápida ---
    var ultimo = dados.meses[dados.meses.length - 1];
    var doAno = dados.meses.filter(function (m) { return m.ym.slice(0, 4) === ultimo.ym.slice(0, 4); });
    var somaE = doAno.reduce(function (s, m) { return s + m.entradas; }, 0);
    var somaS = doAno.reduce(function (s, m) { return s + m.saidas; }, 0);
    bloco.appendChild(el("div", { class: "stats" }, [
      statCard("No projeto hoje", ultimo.ativos),
      statCard("Entradas em " + ultimo.rot, ultimo.entradas),
      statCard("Saídas em " + ultimo.rot, ultimo.saidas),
      statCard("Entradas em " + ultimo.ym.slice(0, 4), somaE),
      statCard("Saídas em " + ultimo.ym.slice(0, 4), somaS),
    ]));

    // --- Gráfico: entradas × saídas por mês ---
    bloco.appendChild(graficoBarras("Pessoas no projeto ao fim de cada mês",
      dados.meses.map(function (m) {
        return { label: m.rot, valor: m.ativos,
                 titulo: m.rot + ": " + m.ativos + " no projeto · +" + m.entradas + " entrada(s), −" + m.saidas + " saída(s)" };
      })));

    // --- Tabela mês a mês ---
    var tabela = el("table", { class: "tabela tabela--cand tabela--mov" });
    var trh = el("tr");
    ["Mês", "Entradas", "Saídas", "Saldo", "No projeto no fim do mês"].forEach(function (c) {
      trh.appendChild(el("th", { class: "tabela__th", text: c }));
    });
    tabela.appendChild(el("thead", {}, [trh]));
    var corpo = el("tbody");
    dados.meses.slice().reverse().forEach(function (m) {
      var saldo = m.entradas - m.saidas;
      var tr = el("tr", { class: "tabela__tr" });
      tr.appendChild(el("td", { class: "tabela__td cand-td-nome col-firme", text: m.rot }));
      tr.appendChild(el("td", { class: "tabela__td tabela__td--num", "data-label": "Entradas",
        text: m.entradas ? "+" + m.entradas : "—" }));
      tr.appendChild(el("td", { class: "tabela__td tabela__td--num", "data-label": "Saídas",
        text: m.saidas ? "−" + m.saidas : "—" }));
      var tdS = el("td", { class: "tabela__td tabela__td--num", "data-label": "Saldo" });
      tdS.appendChild(saldo === 0
        ? el("span", { class: "cand-pendente", text: "0" })
        : el("span", {
            class: "tag " + (saldo > 0 ? "tag--verde" : "tag--vermelho"),
            text: (saldo > 0 ? "+" : "−") + Math.abs(saldo),
          }));
      tr.appendChild(tdS);
      tr.appendChild(el("td", { class: "tabela__td tabela__td--num", "data-label": "No projeto no fim do mês",
        text: String(m.ativos) }));
      corpo.appendChild(tr);
    });
    tabela.appendChild(corpo);
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    bloco.appendChild(wrap);

    // --- Rodapé: o que ficou de fora, e o botão de levar para a planilha ---
    if (dados.semData) {
      bloco.appendChild(el("p", {
        class: "grafico__nota",
        text: "⚠ " + dados.semData + " de " + dados.total + " ficha(s) não têm data de entrada e " +
          "ficaram fora de todas as contas acima. Preencha em Formação → “Datas de entrada”.",
      }));
    }
    var acoes = el("div", { class: "cand-acoes" });
    var bx = el("button", {
      class: "btn btn--secundario btn--pequeno", type: "button", text: "⬇ Baixar .xlsx",
      title: "Planilha com o quadro mês a mês, para responder pedidos por e-mail",
    });
    bx.addEventListener("click", function () { exportarMovimentacao(dados); });
    acoes.appendChild(bx);
    bloco.appendChild(acoes);
    return bloco;
  }

  function exportarMovimentacao(dados) {
    var recorte = (vizTipo === "todos" ? "Capital e Interior" : vizTipo === "capital" ? "Capital" : "Interior") +
      (vizRegiao ? " · " + regiaoCurta(vizRegiao) : "");
    var aoa = [
      ["Entradas e saídas por mês — " + recorte],
      ["Gerado em " + formatarDataHora(new Date().toISOString())],
      [],
      ["Mês", "Entradas", "Saídas", "Saldo", "No projeto no fim do mês"],
    ];
    dados.meses.forEach(function (m) {
      aoa.push([m.rot, m.entradas, m.saidas, m.entradas - m.saidas, m.ativos]);
    });
    if (dados.semData) {
      aoa.push([]);
      aoa.push([dados.semData + " de " + dados.total +
        " ficha(s) sem data de entrada ficaram fora destas contas."]);
    }
    var hoje = new Date().toISOString().slice(0, 10);
    window.Exportador.xlsx("entradas-e-saidas_" + hoje + ".xlsx", "Movimentação", aoa);
  }

  // Barra que se compara com uma meta: o preenchimento é a fração da meta, e o
  // rótulo mostra os dois números — "8 / 12" diz mais do que qualquer cor.
  function graficoProgresso(titulo, dados, nota) {
    var card = el("div", { class: "grafico" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: titulo }));
    if (!dados.length) {
      card.appendChild(el("p", { class: "vazio", text: "Nenhuma região com meta definida." }));
      return card;
    }
    dados.forEach(function (d) {
      var falta = d.meta - d.valor;
      var pct = d.meta > 0 ? Math.min(100, Math.round((d.valor / d.meta) * 100)) : (d.valor ? 100 : 0);
      var estado = falta > 0 ? "faltam " + falta + (falta === 1 ? "" : "")
        : falta === 0 ? "completa"
        : (-falta) + " acima da meta";
      if (falta === 1) estado = "falta 1";
      var classe = falta > 0 ? "" : (falta === 0 ? " prog__preench--cheia" : " prog__preench--acima");

      var item = el("div", { class: "prog" });
      var topo = el("div", { class: "prog__topo" });
      topo.appendChild(el("span", { class: "prog__nome", text: d.label, title: d.label }));
      var num = el("span", { class: "prog__num" });
      num.appendChild(el("strong", { text: d.valor + "/" + d.meta }));
      num.appendChild(el("span", { text: " · " + estado }));
      topo.appendChild(num);
      item.appendChild(topo);

      var trilho = el("div", { class: "prog__trilho" });
      var preench = el("div", {
        class: "prog__preench" + classe,
        title: d.valor + " de " + d.meta + " (" + pct + "%)",
      });
      preench.style.width = pct + "%";
      trilho.appendChild(preench);
      item.appendChild(trilho);
      card.appendChild(item);
    });
    if (nota) card.appendChild(el("p", { class: "grafico__nota", text: nota }));
    return card;
  }

  // Barras com cor por significado (verde = ativo, âmbar = pendente…) e a
  // porcentagem ao lado do número: "92" sozinho não diz se é muito ou pouco.
  function graficoBarrasCores(titulo, dados) {
    var total = dados.reduce(function (s2, d) { return s2 + d.valor; }, 0);
    var max = dados.reduce(function (m, d) { return Math.max(m, d.valor); }, 0) || 1;
    var card = el("div", { class: "grafico" });
    card.appendChild(el("h3", { class: "grafico__titulo", text: titulo }));
    if (!total) {
      card.appendChild(el("p", { class: "vazio", text: "Sem dados." }));
      return card;
    }
    dados.forEach(function (d) {
      var pct = Math.round((d.valor / total) * 100);
      var linha = el("div", { class: "barra" });
      linha.appendChild(el("span", { class: "barra__rotulo", text: d.label, title: d.label }));
      var trilho = el("div", { class: "barra__trilho" });
      var preench = el("div", {
        class: "barra__preench" + (d.cor ? " barra__preench--" + d.cor : ""),
        title: d.valor + " de " + total + " (" + pct + "%)",
      });
      preench.style.width = Math.round((d.valor / max) * 100) + "%";
      trilho.appendChild(preench);
      linha.appendChild(trilho);
      var val = el("span", { class: "barra__valor barra__valor--pct" });
      val.appendChild(el("strong", { text: String(d.valor) }));
      val.appendChild(el("span", { class: "barra__pct", text: pct + "%" }));
      linha.appendChild(val);
      card.appendChild(linha);
    });
    return card;
  }

  function blocoFormacaoViz() {
    var bloco = el("section", { class: "viz-secao" });
    var lista = formacaoDaViz();
    if (!lista.length) {
      bloco.appendChild(el("p", {
        class: "vazio",
        text: "Nenhum bolsista na Formação com os filtros atuais. As fichas nascem ao convocar " +
          "alguém para o cadastro de bolsista, ou ao importar o CSV de formação.",
      }));
      return bloco;
    }

    var ativos = lista.filter(function (f) { return situacaoFormacao(f) === "Ativo"; });
    var aguardando = lista.filter(function (f) { return situacaoFormacao(f) === "Aguardando termo"; });
    var desligados = lista.filter(function (f) { return situacaoFormacao(f) === "Desligado"; });
    var naProjeto = ativos.length + aguardando.length;
    var comCadastro = lista.filter(function (f) { return ehRealizado(f.cadastro_bolsista); });
    var comTreino = lista.filter(function (f) {
      return fezTreinamento(f);
    });

    // Meta e ocupação das regiões que estão dentro do filtro.
    var tipos = vizTipo === "todos" ? ["capital", "interior"] : [vizTipo];
    var metaTotal = 0, ocupTotal = 0, semMeta = 0;
    var porRegiao = [];
    tipos.forEach(function (t) {
      regioesDaMeta(t).forEach(function (r) {
        if (vizRegiao && normStr(regiaoCurta(vizRegiao)) !== normStr(r)) return;
        var meta = metaDe(t, r);
        var oc = ocupacaoDe(t, r).total;
        if (meta === null) { if (oc) semMeta += oc; return; }
        metaTotal += meta;
        ocupTotal += oc;
        // Meta zero e ninguém dentro: linha que não informa nada.
        if (!meta && !oc) return;
        porRegiao.push({ label: r, valor: oc, meta: meta });
      });
    });
    var ocupacaoPct = metaTotal ? Math.round((ocupTotal / metaTotal) * 100) + "%" : "—";

    bloco.appendChild(el("div", { class: "stats" }, [
      statCard("No projeto", naProjeto),
      statCard("Ativos (com termo)", ativos.length),
      statCard("Aguardando termo", aguardando.length),
      statCard("Desligados", desligados.length),
      statCard("Ocupação das metas", ocupacaoPct),
    ]));

    // Metas e vagas por região (o mesmo bloco das outras abas, já aberto).
    tipos.forEach(function (t) { bloco.appendChild(blocoMetas(t)); });

    var grid = el("div", { class: "graficos" });

    if (porRegiao.length) {
      // Quem tem mais gente faltando primeiro: é onde há trabalho a fazer.
      // As completas e as acima da meta descem para o fim da lista.
      porRegiao.sort(function (a, b) {
        var fa = a.meta - a.valor, fb = b.meta - b.valor;
        if (fa !== fb) return fb - fa;
        return normStr(a.label).localeCompare(normStr(b.label));
      });
      grid.appendChild(graficoProgresso(
        vizTipo === "capital" ? "Ocupação da meta (Capital)"
          : vizTipo === "interior" ? "Ocupação da meta por região"
          : "Ocupação das metas",
        porRegiao,
        "Ocupam vaga os ativos e os que aguardam termo. Total: " + ocupTotal + " de " + metaTotal +
          (semMeta ? " · " + semMeta + " bolsista(s) em região sem meta definida." : ".")
      ));
    }

    grid.appendChild(graficoBarrasCores("Situação dos bolsistas", [
      { label: "Ativos (termo emitido)", valor: ativos.length, cor: "verde" },
      { label: "Aguardando termo", valor: aguardando.length, cor: "ambar" },
      { label: "Desligados", valor: desligados.length, cor: "cinza" },
    ]));

    // O que falta: a lista de pendências do dia a dia.
    var pendencias = [
      { label: "Sem cadastro", valor: lista.length - comCadastro.length - desligados.length },
      { label: "Sem treinamento", valor: naProjeto - comTreino.filter(function (f) { return situacaoFormacao(f) !== "Desligado"; }).length },
      { label: "Sem termo", valor: aguardando.length },
      { label: "Sem CPF na ficha", valor: lista.filter(function (f) { return soDigitos(f.cpf).length !== 11; }).length },
    ].filter(function (d) { return d.valor > 0; });
    if (pendencias.length) grid.appendChild(graficoBarras("Pendências (não aptos para atuar)", pendencias));

    // Distribuição de quem está no projeto. Capital e Interior em gráficos
    // separados: grupo e região são coisas diferentes e não se comparam.
    var noProjeto = lista.filter(function (f) { return situacaoFormacao(f) !== "Desligado"; });
    function distribuicao(titulo, fichas, chaveDe) {
      var cont = contarPor(fichas, chaveDe);
      var chaves = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; });
      if (!chaves.length) return;
      grid.appendChild(graficoBarras(titulo, chaves.map(function (k) {
        return { label: k, valor: cont[k] };
      })));
    }
    if (vizTipo !== "interior") {
      distribuicao("Bolsistas por grupo (Capital)",
        noProjeto.filter(function (f) { return f.tipo === "capital"; }),
        function (f) { return f.grupo || "(sem grupo)"; });
    }
    if (vizTipo !== "capital") {
      distribuicao("Bolsistas por região (Interior)",
        noProjeto.filter(function (f) { return f.tipo === "interior"; }),
        function (f) { return regiaoCurta(f.regiao); });
    }

    var porSup = contarPor(noProjeto, function (f) { return supervisorDe(f) || "(sem supervisor)"; });
    var chavesSup = Object.keys(porSup).sort(function (a, b) { return porSup[b] - porSup[a]; });
    if (chavesSup.length) {
      grid.appendChild(graficoBarras("Bolsistas por supervisor", chavesSup.map(function (k) {
        return { label: k, valor: porSup[k] };
      })));
    }

    if (desligados.length) {
      var porMotivo = contarPor(desligados, function (f) { return f.desligado_motivo || "(sem motivo registrado)"; });
      grid.appendChild(graficoBarras("Desligamentos por motivo", Object.keys(porMotivo)
        .sort(function (a, b) { return porMotivo[b] - porMotivo[a]; })
        .map(function (k) { return { label: k, valor: porMotivo[k] }; })));
    }

    bloco.appendChild(grid);
    bloco.appendChild(el("p", {
      class: "viz-secao__nota",
      text: "Fonte: aba Formação. Os filtros de tipo e região valem aqui; o de período não, " +
        "porque a ficha de formação não tem uma data única que sirva de referência.",
    }));
    return bloco;
  }

  function renderDados() {
    var painel = $("#painel-dados");
    // Supervisor não tem esta aba: além de o botão sumir, o painel nem chega a
    // ser montado — não existe conteúdo escondido para alguém revelar.
    if (!podeVerDados()) { painel.innerHTML = ""; return; }
    painel.innerHTML = "";

    // ----- Escolhas principais: qual relatório e qual projeto -----
    // Antes as duas viviam em barras diferentes e com desenhos diferentes (uma
    // acima e outra abaixo dos filtros), e ninguém achava onde trocar de
    // projeto. Agora são o mesmo controle, lado a lado, no topo.
    var topo = el("div", { class: "topo-controles" });
    topo.appendChild(seletorSegmentado("Relatório", [
      { id: "inscricoes", nome: "Inscrições no SIPE" },
      { id: "entrevistas", nome: "Entrevistas" },
      { id: "formacao", nome: "Formação" },
      { id: "movimentacao", nome: "Entradas e saídas" },
    ], vizAba, function (id) { vizAba = id; renderDados(); }));
    topo.appendChild(seletorSegmentado("Projeto", [
      { id: "todos", nome: "Capital e Interior" },
      { id: "capital", nome: "Capital" },
      { id: "interior", nome: "Interior" },
    ], vizTipo, function (t) {
      vizTipo = t;
      if (t === "capital") vizRegiao = "";
      renderDados();
    }));
    painel.appendChild(topo);

    // ----- Barra de filtros (período e região) -----
    var barra = el("div", { class: "viz-filtros" });

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

    if (vizAba === "inscricoes") { painel.appendChild(blocoFunilCandidatos()); return; }
    if (vizAba === "formacao") { painel.appendChild(blocoFormacaoViz()); return; }
    if (vizAba === "movimentacao") { painel.appendChild(blocoMovimentacao()); return; }

    var lista = filtrarViz();
    var avaliados = lista.filter(function (r) { return !r.nao_compareceu && !r.nao_cumpre_requisitos; });
    var comNota = avaliados.filter(function (r) { return r.pontuacao_total != null; });
    var media = comNota.length
      ? Math.round((comNota.reduce(function (s, r) { return s + r.pontuacao_total; }, 0) / comNota.length) * 10) / 10
      : "—";

    // ----- Entrevistas realizadas no sistema -----
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

    // Ritmo das entrevistas ao longo do tempo (ocupa a linha inteira do grid).
    var serie = serieEntrevistas(lista);
    if (serie) grid.appendChild(graficoLinha("Entrevistas ao longo do tempo", serie));

    // Inscritos por região (leitura precisa dos números do interior) — do maior ao menor
    var regioesOrdenadas = Object.keys(REGIOES)
      .map(function (nome) { return { label: nome.replace(/ \(região\)$/, ""), valor: contRegiao[nome] || 0 }; })
      .filter(function (d) { return d.valor > 0; })
      .sort(function (a, b) { return b.valor - a.valor; });
    if (regioesOrdenadas.length) {
      grid.appendChild(graficoBarras("Entrevistados por região (interior)", regioesOrdenadas));
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
    renderPainelCandidatos();
    renderPainelFormacao();
    renderDados();
    renderPainelTermos();
  }

  // ============================================================
  //  PÁGINA: MEU PERFIL
  // ============================================================

  var AVISO_SISTEMA =
    "Este sistema foi desenvolvido para apoiar a equipe na gestão das etapas do " +
    "processo seletivo do projeto de São Paulo. Ele não substitui o SIPE nem o ALOK, " +
    "que permanecem as ferramentas oficiais do projeto e são a fonte de referência " +
    "para os registros institucionais.";

  // O que cada perfil pode e não pode. É a mesma regra aplicada nas telas e no
  // banco, escrita aqui em português para quem usa conferir o próprio acesso.
  function permissoesDoPerfil() {
    if (ehAdmin()) {
      return {
        pode: [
          "Ver todas as abas, incluindo a Visualização de dados",
          "Importar as planilhas de inscrição e de formação",
          "Enviar convocações de entrevista e de cadastro",
          "Editar fichas de candidatos e de bolsistas",
          "Definir e trocar o grupo dos bolsistas da Capital",
          "Desligar bolsistas e reverter desligamentos",
          "Definir metas por região e consultar a fila de reserva",
          "Sincronizar as planilhas e baixar os arquivos por região",
          "Acompanhar os termos de bolsa e avisar o financeiro de quem ficou apto",
          "Gerenciar usuários e perfis de acesso",
        ],
        naoPode: [],
      };
    }
    if (ehFinanceiro()) {
      return {
        pode: [
          "Ver todas as abas, incluindo a Visualização de dados",
          "Ver a aba Termos de Bolsa, com os termos ativos e os pendentes",
          "Acompanhar quem está apto e só depende do termo para atuar",
          "Receber por e-mail o aviso de quem ficou apto",
          "Consultar metas, vagas e a fila de reserva",
        ],
        naoPode: [
          "Importar planilhas ou sincronizar",
          "Enviar convocações",
          "Editar qualquer ficha, inclusive lançar o termo de bolsa",
          "Definir ou trocar grupos",
          "Desligar bolsistas",
          "Alterar metas ou supervisores",
        ],
      };
    }
    if (ehSupervisor()) {
      return {
        pode: [
          "Ver as abas Candidatos, Entrevistas Capital, Entrevistas Interior e Formação",
          "Consultar metas, vagas e a fila de reserva",
          "Definir o grupo de bolsistas da Capital que ainda não têm grupo",
        ],
        naoPode: [
          "Ver a aba Visualização de dados",
          "Trocar o grupo de quem já tem grupo definido",
          "Importar planilhas ou sincronizar",
          "Enviar convocações",
          "Editar os demais campos das fichas",
          "Desligar bolsistas",
          "Alterar metas ou supervisores",
        ],
      };
    }
    return {
      pode: [
        "Ver todas as abas, incluindo a Visualização de dados",
        "Consultar metas, vagas e a fila de reserva",
        "Baixar os detalhes de uma entrevista em PDF",
      ],
      naoPode: [
        "Importar planilhas ou sincronizar",
        "Enviar convocações",
        "Editar qualquer ficha",
        "Definir ou trocar grupos",
        "Desligar bolsistas",
        "Alterar metas ou supervisores",
      ],
    };
  }

  function blocoAvisoSistema() {
    var caixa = el("div", { class: "aviso-sistema" });
    caixa.appendChild(el("p", { class: "aviso-sistema__titulo", text: "Sobre este sistema" }));
    caixa.appendChild(el("p", { class: "aviso-sistema__texto", text: AVISO_SISTEMA }));
    return caixa;
  }

  function renderMeuPerfil() {
    var alvo = $("#pagina");
    alvo.innerHTML = "";
    alvo.appendChild(cabecalhoDaPagina("Meu perfil",
      "Seu acesso ao painel: qual perfil você tem, o que ele permite e onde trocar sua senha."));
    alvo.appendChild(blocoAvisoSistema());

    // --- Quem é você ---
    var cab = el("div", { class: "cartao" });
    var linha = el("div", { class: "perfil-cab" });
    linha.appendChild(el("span", {
      class: "perfil-cab__avatar", "aria-hidden": "true",
      text: (usuarioEmail || "?").charAt(0).toUpperCase(),
    }));
    var ident = el("div");
    ident.appendChild(el("div", { class: "perfil-cab__email", text: usuarioEmail || "(sem e-mail)" }));
    var sub = el("div", { class: "perfil-cab__linha" });
    sub.appendChild(el("span", { class: classeDoSelo(), text: nomeDoPerfil() }));
    sub.appendChild(el("span", { class: "pagina__secao-sub", text: descricaoDoPerfil() }));
    ident.appendChild(sub);
    linha.appendChild(ident);
    cab.appendChild(linha);
    alvo.appendChild(cab);

    // --- O que este perfil permite ---
    var secPerm = el("section", { class: "pagina__secao" });
    secPerm.appendChild(el("h3", { class: "pagina__secao-titulo", text: "Permissões do seu perfil" }));
    secPerm.appendChild(el("p", {
      class: "pagina__secao-sub",
      text: "As mesmas regras valem na tela e no banco de dados — esconder um botão não " +
        "libera nem bloqueia nada por si só.",
    }));
    var perm = permissoesDoPerfil();
    var grade = el("div", { class: "cartao permissoes" });
    grade.appendChild(colunaDePermissoes("Você pode", perm.pode, true));
    if (perm.naoPode.length) grade.appendChild(colunaDePermissoes("Você não pode", perm.naoPode, false));
    secPerm.appendChild(grade);
    if (!ehAdmin()) {
      secPerm.appendChild(el("p", {
        class: "pagina__secao-sub",
        text: "Precisa de mais acesso? Fale com um administrador do painel.",
      }));
    }
    alvo.appendChild(secPerm);

    // --- Trocar a senha ---
    alvo.appendChild(blocoTrocarSenha());
  }

  function descricaoDoPerfil() {
    if (ehAdmin()) return "Acesso completo ao painel.";
    if (ehSupervisor()) return "Leitura de tudo, com uma edição liberada.";
    if (ehFinanceiro()) return "Leitura de tudo, mais a aba Termos de Bolsa.";
    return "Somente leitura.";
  }

  function colunaDePermissoes(rotulo, itens, positiva) {
    var col = el("div", { class: "permissoes__col" });
    col.appendChild(el("p", { class: "permissoes__rot", text: rotulo }));
    var ul = el("ul", { class: "permissoes__lista" });
    itens.forEach(function (t) {
      var li = el("li");
      li.appendChild(el("span", {
        class: "permissoes__marca " + (positiva ? "permissoes__marca--sim" : "permissoes__marca--nao"),
        "aria-hidden": "true",
        text: positiva ? "✓" : "✕",
      }));
      li.appendChild(el("span", { text: t }));
      ul.appendChild(li);
    });
    col.appendChild(ul);
    return col;
  }

  var SENHA_MINIMA = 8;

  function blocoTrocarSenha() {
    var sec = el("section", { class: "pagina__secao" });
    sec.appendChild(el("h3", { class: "pagina__secao-titulo", text: "Alterar senha" }));
    sec.appendChild(el("p", {
      class: "pagina__secao-sub",
      text: "Escolha a senha que quiser, com pelo menos " + SENHA_MINIMA +
        " caracteres. A troca vale já no próximo login, em qualquer aparelho.",
    }));

    var cartao = el("div", { class: "cartao" });
    var form = el("form", { class: "edicao cartao__form" });
    // Sem `required`/`minlength`: a validação nativa do navegador aparece num
    // balão fora do fluxo da página e, em alguns navegadores, em inglês. As
    // conferências ficam no submit, com a mensagem em português logo abaixo.
    var nova = el("input", {
      class: "edicao__entrada", type: "password", id: "senha-nova",
      autocomplete: "new-password",
    });
    var conf = el("input", {
      class: "edicao__entrada", type: "password", id: "senha-conf",
      autocomplete: "new-password",
    });
    [["Nova senha", nova], ["Repita a nova senha", conf]].forEach(function (par) {
      var campo = el("div", { class: "edicao__campo" });
      campo.appendChild(el("label", { class: "edicao__rot", for: par[1].id, text: par[0] }));
      campo.appendChild(par[1]);
      form.appendChild(campo);
    });

    var msg = el("p", { class: "edicao__msg" });
    var salvar = el("button", { class: "btn btn--pequeno", type: "submit", text: "Salvar nova senha" });
    form.appendChild(el("div", { class: "edicao__acoes" }, [salvar]));
    form.appendChild(msg);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.className = "edicao__msg";
      if (nova.value.length < SENHA_MINIMA) {
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = "A senha precisa ter pelo menos " + SENHA_MINIMA + " caracteres.";
        return;
      }
      // Conferir a repetição evita o pior caso: gravar um erro de digitação e
      // descobrir só no próximo login, já sem a senha antiga.
      if (nova.value !== conf.value) {
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = "As duas senhas não são iguais.";
        return;
      }
      salvar.disabled = true;
      msg.textContent = "Salvando…";
      client.auth.updateUser({ password: nova.value }).then(function (resp) {
        salvar.disabled = false;
        if (resp && resp.error) {
          msg.className = "edicao__msg edicao__msg--erro";
          msg.textContent = "Não foi possível trocar a senha: " +
            (resp.error.message || resp.error);
          return;
        }
        nova.value = ""; conf.value = "";
        msg.textContent = "✓ Senha alterada. Use a nova senha no próximo login.";
      }).catch(function (erro) {
        salvar.disabled = false;
        msg.className = "edicao__msg edicao__msg--erro";
        msg.textContent = "Não foi possível trocar a senha: " + (erro.message || erro);
      });
    });

    cartao.appendChild(form);
    sec.appendChild(cartao);
    return sec;
  }

  // ============================================================
  //  PÁGINA: GERENCIAR USUÁRIOS  (só admin)
  // ============================================================

  var PERFIS = [
    { id: "admin", rot: "Administrador" },
    { id: "supervisor", rot: "Supervisor" },
    { id: "financeiro", rot: "Financeiro" },
    { id: "leitor", rot: "Somente leitura" },
  ];

  function rotuloDoPerfil(id) {
    var achado = PERFIS.filter(function (p) { return p.id === id; })[0];
    return achado ? achado.rot : id;
  }

  function classeDoSeloPerfil(id) {
    return "selo-perfil" + (id === "admin" ? " selo-perfil--admin"
      : id === "supervisor" ? " selo-perfil--supervisor"
      : id === "financeiro" ? " selo-perfil--financeiro" : "");
  }

  function renderUsuarios() {
    var alvo = $("#pagina");
    alvo.innerHTML = "";
    alvo.appendChild(cabecalhoDaPagina("Gerenciar usuários",
      "Quem tem conta no painel, que acesso cada um tem, quando entrou pela última " +
      "vez e o histórico de mudanças de perfil."));
    var corpo = el("div", { id: "usuarios-corpo" });
    corpo.appendChild(el("p", { class: "dash__carregando", text: "Carregando usuários…" }));
    alvo.appendChild(corpo);

    Promise.all([
      client.rpc("listar_usuarios"),
      client.from("app_perfil_log").select("em,quem,alvo,acao,perfil"),
    ]).then(function (r) {
      desenharUsuarios(corpo, r[0], r[1]);
    }).catch(function (erro) {
      corpo.innerHTML = "";
      corpo.appendChild(avisoDeSqlFaltando(erro));
    });
  }

  // Quando o SQL ainda não foi rodado, dizer QUAL arquivo falta é mais útil do
  // que repetir a mensagem crua do Postgres.
  function avisoDeSqlFaltando(erro) {
    var texto = String((erro && (erro.message || erro.hint)) || erro || "");
    var caixa = el("div", { class: "aviso-sistema" });
    caixa.appendChild(el("p", { class: "aviso-sistema__titulo", text: "Falta rodar um arquivo SQL" }));
    caixa.appendChild(el("p", {
      class: "aviso-sistema__texto",
      text: "Esta página depende de sql/usuarios.sql, que ainda não existe no banco. " +
        "Rode o arquivo no SQL Editor do Supabase e recarregue. Detalhe técnico: " + texto,
    }));
    return caixa;
  }

  function desenharUsuarios(corpo, respUsuarios, respLog) {
    corpo.innerHTML = "";
    if (respUsuarios && respUsuarios.error) {
      corpo.appendChild(avisoDeSqlFaltando(respUsuarios.error));
      return;
    }
    var usuarios = (respUsuarios && respUsuarios.data) || [];
    if (!usuarios.length) {
      corpo.appendChild(el("p", {
        class: "cand-vazio",
        text: "Nenhuma conta encontrada. Contas são criadas no Supabase, " +
          "em Authentication → Users.",
      }));
      return;
    }

    // --- Resumo ---
    var conta = function (p) { return usuarios.filter(function (u) { return u.perfil === p; }).length; };
    var nunca = usuarios.filter(function (u) { return !u.ultimo_acesso; }).length;
    corpo.appendChild(el("div", { class: "stats usuarios-resumo" }, [
      statCard("Contas", usuarios.length),
      statCard("Administradores", conta("admin")),
      statCard("Supervisores", conta("supervisor")),
      statCard("Financeiro", conta("financeiro")),
      statCard("Somente leitura", conta("leitor")),
      nunca ? statCard("Nunca acessaram", nunca) : null,
    ]));

    // --- Tabela de contas ---
    var sec = el("section", { class: "pagina__secao" });
    sec.appendChild(el("h3", { class: "pagina__secao-titulo", text: "Contas" }));
    sec.appendChild(el("p", {
      class: "pagina__secao-sub",
      text: "Trocar o perfil aqui vale na hora. Criar ou apagar uma conta continua " +
        "sendo no Supabase, em Authentication → Users — é lá que a senha é definida.",
    }));

    var cols = ["E-mail", "Perfil", "Último acesso", "Conta criada", "E-mail confirmado", "Alterar perfil"];
    var tabela = el("table", { class: "tabela tabela--cand tabela--usuarios" });
    var trh = el("tr");
    cols.forEach(function (c) { trh.appendChild(el("th", { class: "tabela__th", text: c })); });
    tabela.appendChild(el("thead", {}, [trh]));

    var tbody = el("tbody");
    usuarios.forEach(function (u) {
      var euMesmo = normEmail(u.email) === normEmail(usuarioEmail);
      var tr = el("tr", { class: "tabela__tr" });

      var tdEmail = el("td", { class: "tabela__td cand-td-nome" });
      tdEmail.appendChild(el("span", { class: "usu-email", text: u.email }));
      if (euMesmo) tdEmail.appendChild(el("span", { class: "usu-eu", text: "você" }));
      tr.appendChild(tdEmail);

      var tdPerfil = el("td", { class: "tabela__td", "data-label": "Perfil" });
      tdPerfil.appendChild(el("span", {
        class: classeDoSeloPerfil(u.perfil), text: rotuloDoPerfil(u.perfil),
      }));
      tr.appendChild(tdPerfil);

      var tdAcesso = el("td", { class: "tabela__td col-firme", "data-label": "Último acesso" });
      if (u.ultimo_acesso) tdAcesso.appendChild(el("span", { text: formatarDataHora(u.ultimo_acesso) }));
      else tdAcesso.appendChild(el("span", { class: "usu-nunca", text: "nunca entrou" }));
      tr.appendChild(tdAcesso);

      tr.appendChild(el("td", {
        class: "tabela__td col-firme", "data-label": "Conta criada",
        text: formatarDataHora(u.criado_em),
      }));

      var tdConf = el("td", { class: "tabela__td", "data-label": "E-mail confirmado" });
      tdConf.appendChild(u.confirmado
        ? el("span", { class: "tag tag--verde", text: "Confirmado" })
        : tagPendente("não confirmado",
            "A conta existe, mas o e-mail não foi confirmado. No Supabase, em " +
            "Authentication → Users, marque Auto Confirm User."));
      tr.appendChild(tdConf);

      var tdAcao = el("td", { class: "tabela__td", "data-label": "Alterar perfil" });
      tdAcao.appendChild(seletorDePerfil(u, euMesmo));
      tr.appendChild(tdAcao);

      tbody.appendChild(tr);
    });
    tabela.appendChild(tbody);
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    sec.appendChild(wrap);
    corpo.appendChild(sec);

    // --- Histórico ---
    corpo.appendChild(secaoHistorico(respLog));
  }

  function seletorDePerfil(u, euMesmo) {
    var sel = el("select", { class: "viz-select usu-select" });
    PERFIS.forEach(function (p) {
      var op = el("option", { value: p.id, text: p.rot });
      // O banco recusa (e deve recusar) tirar o próprio acesso de admin; aqui a
      // opção nem fica escolhível, para o erro não ser a forma de descobrir.
      if (euMesmo && p.id !== "admin") op.disabled = true;
      sel.appendChild(op);
    });
    sel.value = u.perfil;
    if (euMesmo) {
      sel.title = "Você não pode remover o próprio acesso de administrador. " +
        "Peça a outro administrador.";
    }
    sel.addEventListener("change", function () {
      var novo = sel.value;
      if (novo === u.perfil) return;
      if (!confirm("Alterar o perfil de " + u.email + "\n\nde " + rotuloDoPerfil(u.perfil) +
          " para " + rotuloDoPerfil(novo) + "?")) {
        sel.value = u.perfil;
        return;
      }
      sel.disabled = true;
      client.rpc("definir_perfil", { p_email: u.email, p_perfil: novo }).then(function (resp) {
        sel.disabled = false;
        if (resp && resp.error) {
          alert("Não foi possível alterar: " + (resp.error.message || resp.error));
          sel.value = u.perfil;
          return;
        }
        u.perfil = novo;
        // Mexeu no próprio acesso? O painel inteiro muda: recarrega o perfil.
        if (normEmail(u.email) === normEmail(usuarioEmail)) {
          resolverAdmin().then(function () {
            marcarSeloAdmin();
            aplicarPerfilNasAbas();
            renderUsuarios();
          });
        } else {
          renderUsuarios();
        }
      }).catch(function (erro) {
        sel.disabled = false;
        sel.value = u.perfil;
        alert("Não foi possível alterar: " + (erro.message || erro));
      });
    });
    return sel;
  }

  function secaoHistorico(respLog) {
    var sec = el("section", { class: "pagina__secao" });
    sec.appendChild(el("h3", { class: "pagina__secao-titulo", text: "Histórico de alterações de perfil" }));
    sec.appendChild(el("p", {
      class: "pagina__secao-sub",
      text: "Quem ganhou ou perdeu acesso, quando e por quem. Mudanças feitas direto " +
        "no SQL Editor aparecem sem autor, porque ali não há usuário logado.",
    }));

    if (respLog && respLog.error) {
      sec.appendChild(el("p", {
        class: "cand-vazio",
        text: "Histórico indisponível: rode sql/usuarios.sql no Supabase.",
      }));
      return sec;
    }
    var itens = ((respLog && respLog.data) || []).slice().sort(function (a, b) {
      return String(b.em).localeCompare(String(a.em));
    });
    if (!itens.length) {
      sec.appendChild(el("p", {
        class: "cand-vazio",
        text: "Nenhuma alteração registrada ainda. O histórico começa a partir de " +
          "quando sql/usuarios.sql foi rodado.",
      }));
      return sec;
    }

    var tabela = el("table", { class: "tabela tabela--cand tabela--hist" });
    var trh = el("tr");
    ["Quando", "Quem alterou", "Conta", "O que mudou"].forEach(function (c) {
      trh.appendChild(el("th", { class: "tabela__th", text: c }));
    });
    tabela.appendChild(el("thead", {}, [trh]));
    var tbody = el("tbody");
    itens.slice(0, 200).forEach(function (h) {
      var tr = el("tr", { class: "tabela__tr" });
      tr.appendChild(el("td", {
        class: "tabela__td cand-td-nome col-firme", text: formatarDataHora(h.em),
      }));
      var tdQuem = el("td", { class: "tabela__td", "data-label": "Quem alterou" });
      tdQuem.appendChild(h.quem
        ? el("span", { class: "hist__quem", text: h.quem })
        : el("span", { class: "hist-sql", title: "Alteração feita direto no banco, sem usuário logado.", text: "SQL Editor" }));
      tr.appendChild(tdQuem);
      tr.appendChild(el("td", { class: "tabela__td", "data-label": "Conta", text: h.alvo }));
      var tdO = el("td", { class: "tabela__td", "data-label": "O que mudou" });
      tdO.appendChild(el("span", {
        class: "tag " + (h.acao === "concedido" ? "tag--verde" : "tag--cinza"),
        text: (h.acao === "concedido" ? "+ " : "− ") + rotuloDoPerfil(h.perfil),
      }));
      tr.appendChild(tdO);
      tbody.appendChild(tr);
    });
    tabela.appendChild(tbody);
    var wrap = el("div", { class: "tabela-wrap" });
    wrap.appendChild(tabela);
    sec.appendChild(wrap);
    if (itens.length > 200) {
      sec.appendChild(el("p", {
        class: "cand-resumo",
        text: "Mostrando as 200 alterações mais recentes de " + itens.length + ".",
      }));
    }
    return sec;
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
    var selo = $("#app-versao");
    if (selo) selo.textContent = cfg.VERSAO ? "v" + cfg.VERSAO : "";

    client.auth.getSession().then(function (resp) {
      var session = resp.data && resp.data.session;
      if (session) entrarDashboard(session);
      else mostrarLogin();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
