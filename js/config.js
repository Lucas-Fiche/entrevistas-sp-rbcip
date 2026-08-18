/**
 * Configuração do Supabase.
 *
 * Preencha os dois valores abaixo com os dados do SEU projeto Supabase:
 *   1. Acesse https://app.supabase.com  ->  seu projeto
 *   2. Settings  ->  API
 *   3. Copie "Project URL"  para SUPABASE_URL
 *   4. Copie a chave "anon public"  para SUPABASE_ANON_KEY
 *
 * A chave "anon public" pode ficar exposta no front-end: o acesso é controlado
 * pelas políticas de Row Level Security (RLS) definidas em sql/schema.sql.
 *
 * Enquanto os valores estiverem em branco, o formulário funciona em MODO DE TESTE:
 * as respostas são apenas guardadas no navegador (localStorage), permitindo
 * validar a experiência antes de conectar o banco.
 */
window.SUPABASE_CONFIG = {
  SUPABASE_URL: "https://gnqzcmzyupetpvlhsfsu.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_MEhaRpgmqmEW8wkh39N3Wg_brzS5bX_",
  // Nome da tabela onde as entrevistas serão gravadas.
  TABELA: "entrevistas",

  // ---- Convocações por e-mail (aba Candidatos) ----
  // URL do Web App do Google Apps Script que envia os e-mails pelo Gmail.
  // Deixe em branco até publicar o script (veja docs/APPS-SCRIPT-CONVOCACAO.md).
  // Enquanto estiver em branco, os botões de convocação ficam desativados.
  CONVOCACAO_BACKEND_URL: "",

  // Link de agendamento do Google Agenda usado no e-mail de convocação p/ entrevista.
  AGENDA_LINK: "",

  // Links de cadastro de bolsista (usados no e-mail de convocação p/ cadastro).
  CADASTRO_LINK_CAPITAL: "https://sp.rbcip.org/link/c2/cadastro/bolsista/",
  CADASTRO_LINK_INTERIOR: "https://sp.rbcip.org/link/c2interior/cadastro/bolsista/",
};
