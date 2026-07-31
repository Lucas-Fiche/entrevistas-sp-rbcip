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
};
