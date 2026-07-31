/**
 * Estrutura (schema) dos formulários de Entrevista Estruturada — RBCIP.
 *
 * Ambos os formulários referem-se APENAS ao perfil Avaliador (Entrevistador).
 * Capital e Interior compartilham exatamente os mesmos blocos de avaliação
 * (Blocos 1 a 4 + observação final); diferem somente na seção de Elegibilidade.
 *
 * Para manter: cada pergunta é um objeto. Para adicionar/editar uma pergunta,
 * basta alterar o array correspondente. Os campos `id` são as chaves usadas
 * para gravar as respostas no Supabase (não altere-os sem necessidade).
 *
 * Tipos de pergunta suportados:
 *   - "texto"     : campo de uma linha
 *   - "data"      : campo de data
 *   - "textarea"  : campo de múltiplas linhas
 *   - "radio"     : escolha única entre opcoes[]
 *   - "escala"    : nota de 1 a 5 (STAR)
 *   - "flag"      : marcador destacado (checkbox), ex.: candidato faltante
 *   - "titulo-bloco": apenas um subtítulo dentro da seção (não é resposta)
 */

const LEGENDA_STAR =
  "Pontuação: 1 = Não se aplica/Não respondeu; 2 = Resposta fraca/Superficial; " +
  "3 ou 4 = Resposta aceitável/Parcial; 5 = Resposta excelente/Exemplar.";

const OPCOES_SIM_NAO = ["Sim", "Não"];
const OPCOES_APTO = ["Apto", "Não Apto"];
const OPCOES_RECOMENDACAO = [
  "Aprovado - Forte Recomendação",
  "Aprovado - Recomendação",
  "Aprovado - Recomendação com Ressalvas",
  "Reprovado",
];

/** Cabeçalho comum aos dois formulários (dados de identificação). */
function secaoIdentificacao() {
  return {
    titulo: "Identificação",
    perguntas: [
      { id: "nome_candidato", tipo: "texto", label: "Nome do Candidato", obrigatorio: true },
      {
        id: "data_entrevista",
        tipo: "data",
        label: "Data da Entrevista",
        obrigatorio: true,
      },
      { id: "nome_entrevistador", tipo: "texto", label: "Nome do Entrevistador", obrigatorio: true },
      {
        id: "nao_compareceu",
        tipo: "flag",
        label: "Candidato NÃO compareceu",
        textoFlag: "MARCAR COMO CANDIDATO FALTANTE",
      },
    ],
  };
}

/**
 * Blocos de avaliação do perfil Avaliador (Entrevistador).
 * Idênticos para Capital e Interior.
 */
function secaoAvaliador() {
  return {
    titulo: "Perfil Avaliador (Entrevistador)",
    perguntas: [
      // ---------- Bloco 1 ----------
      {
        tipo: "titulo-bloco",
        label: "Bloco 1: Competências Técnicas e Comportamentais - STAR",
        ajuda:
          "Avaliar a experiência e as competências essenciais para a função de Avaliador (Entrevistador). " +
          LEGENDA_STAR,
      },
      {
        id: "exp_entrevistas",
        tipo: "textarea",
        label: "Experiência com Entrevistas e Coleta de Dados",
        ajuda:
          "Conte-me sobre um momento em que você precisou conduzir entrevistas ou coletar dados sensíveis ou complexos. Qual foi a sua estratégia para estabelecer rapport e garantir a precisão das informações?",
        obrigatorio: true,
      },
      { id: "exp_entrevistas_nota", tipo: "escala", label: "Experiência com Entrevistas e Coleta de Dados: Avaliação do Candidato", obrigatorio: true },

      {
        id: "exp_publico_v1",
        tipo: "textarea",
        label: "Experiência com Atendimento ao Público (v1)",
        ajuda:
          "Descreva uma situação em que você teve que lidar com um entrevistado ou público resistente ou com dificuldades de comunicação. Como você gerenciou a situação para atingir o objetivo da interação?",
        obrigatorio: true,
      },
      { id: "exp_publico_v1_nota", tipo: "escala", label: "Experiência com Atendimento ao Público (v1): Avaliação do Candidato", obrigatorio: true },

      {
        id: "exp_publico_v2",
        tipo: "textarea",
        label: "Experiência com Atendimento ao Público (v2)",
        ajuda:
          "Descreva uma situação em que você teve que lidar com um entrevistado ou público resistente ou com dificuldades de comunicação. Como você gerenciou a situação para atingir o objetivo da interação?",
        obrigatorio: true,
      },
      { id: "exp_publico_v2_nota", tipo: "escala", label: "Experiência com Atendimento ao Público (v2): Avaliação do Candidato", obrigatorio: true },

      {
        id: "exp_organizacao_dados",
        tipo: "textarea",
        label: "Experiência com Organização de Dados",
        ajuda:
          "Dê um exemplo de como você organizou um grande volume de dados coletados (sistemas/planilhas). Quais ferramentas utilizou e como assegurou a integridade?",
        obrigatorio: true,
      },
      { id: "exp_organizacao_dados_nota", tipo: "escala", label: "Experiência com Organização de Dados: Avaliação do Candidato", obrigatorio: true },

      {
        id: "comprometimento",
        tipo: "textarea",
        label: "Comprometimento e Disponibilidade Real",
        ajuda:
          "O projeto exige deslocamentos diários, muitas vezes acima de 50 km. Como você organizaria sua rotina para garantir pontualidade e cumprimento de prazos? Já teve alguma experiência similar?",
        obrigatorio: true,
      },
      { id: "comprometimento_nota", tipo: "escala", label: "Comprometimento e Disponibilidade Real: Avaliação do Candidato", obrigatorio: true },

      {
        id: "tolerancia_rotina",
        tipo: "textarea",
        label: "Tolerância à Rotina Operacional",
        ajuda:
          "O trabalho de campo envolve repetição, deslocamentos longos e imprevistos. Como você lida com tarefas operacionais e rotineiras? Dê um exemplo.",
        obrigatorio: true,
      },
      { id: "tolerancia_rotina_nota", tipo: "escala", label: "Tolerância à Rotina Operacional: Avaliação do Candidato", obrigatorio: true },

      // ---------- Bloco 2 ----------
      {
        tipo: "titulo-bloco",
        label: "Bloco 2: Competências Críticas e Éticas",
        ajuda: "Confirmar o alinhamento ético e a ausência de conflito de interesses.",
      },
      {
        id: "beneficio_proprio",
        tipo: "textarea",
        label: "Benefício Próprio",
        ajuda:
          "Durante uma entrevista, você percebe que o entrevistado tenta adaptar respostas para obter algum benefício. O que você faz?",
        obrigatorio: true,
      },
      { id: "beneficio_proprio_aval", tipo: "radio", label: "Benefício Próprio: Avaliação do Candidato", opcoes: OPCOES_APTO, obrigatorio: true },

      {
        id: "agilizar_coleta",
        tipo: "textarea",
        label: "Agilizar Coleta",
        ajuda:
          'Um gestor local pede que você "agilize" a coleta, flexibilizando etapas do protocolo. Como você reage?',
        obrigatorio: true,
      },
      { id: "agilizar_coleta_aval", tipo: "radio", label: "Agilizar Coleta: Avaliação do Candidato", opcoes: OPCOES_APTO, obrigatorio: true },

      {
        id: "postura_profissional",
        tipo: "textarea",
        label: "Postura Profissional",
        ajuda:
          "Relate uma situação em que você precisou manter postura profissional mesmo sob pressão, desconforto ou conflito.",
        obrigatorio: true,
      },
      { id: "postura_profissional_aval", tipo: "radio", label: "Postura Profissional: Avaliação do Candidato", opcoes: OPCOES_APTO, obrigatorio: true },

      // ---------- Bloco 3 ----------
      {
        tipo: "titulo-bloco",
        label: "Bloco 3: Ética e LGPD",
        ajuda: "Confirmar o alinhamento ético e a ausência de conflito de interesses.",
      },
      {
        id: "conflito_interesses",
        tipo: "radio",
        label: "Conflito de Interesses",
        ajuda:
          "O candidato confirma que NÃO possui conflito de interesses com as Secretarias de Estado do Governo em SP?",
        opcoes: OPCOES_SIM_NAO,
        obrigatorio: true,
      },
      { id: "conflito_interesses_aval", tipo: "radio", label: "Conflito de Interesses: Avaliação do Candidato", opcoes: OPCOES_APTO, obrigatorio: true },

      {
        id: "lgpd_etica",
        tipo: "textarea",
        label: "LGPD e Ética",
        ajuda:
          "Qual a sua compreensão sobre a importância da liderança ética, da LGPD e da confidencialidade na gestão de uma equipe de campo?",
        obrigatorio: true,
      },
      { id: "lgpd_etica_aval", tipo: "radio", label: "LGPD e Ética: Avaliação do Candidato", opcoes: OPCOES_APTO, obrigatorio: true },

      // ---------- Bloco 4 ----------
      {
        tipo: "titulo-bloco",
        label: "Bloco 4: Fechamento",
      },
      {
        id: "recomendacao_final",
        tipo: "radio",
        label: "Recomendação Final",
        opcoes: OPCOES_RECOMENDACAO,
        obrigatorio: true,
      },
      {
        id: "justificativa_recomendacao",
        tipo: "textarea",
        label: "Justificativa da Recomendação",
        obrigatorio: true,
      },
    ],
  };
}

/** Seção final comum (observação adicional, opcional). */
function secaoEnvio() {
  return {
    titulo: "Enviar Formulário",
    perguntas: [
      {
        id: "observacao_adicional",
        tipo: "textarea",
        label: "Alguma observação adicional que não foi coberta nas seções anteriores?",
        obrigatorio: false,
      },
    ],
  };
}

/** Marcador comum de reprovação (fim da seção de elegibilidade). */
function flagNaoCumpreRequisitos() {
  return {
    id: "nao_cumpre_requisitos",
    tipo: "flag",
    label: "Candidato NÃO cumpre os requisitos",
    textoFlag: "MARCAR COMO REPROVADO",
  };
}

/* ============================================================
 *  FORMULÁRIO — CAPITAL
 * ============================================================ */
const FORM_CAPITAL = {
  id: "capital",
  titulo: "Formulário de Entrevista Estruturada — Processo Seletivo RBCIP",
  subtitulo: "Entrevista realizada online, duração de 20 min, gravada para transcrição.",
  regiao: "Capital",
  secoes: [
    secaoIdentificacao(),
    {
      titulo: "Elegibilidade e Disponibilidade",
      descricao: "Confirmar os requisitos básicos e logísticos, conforme o Formulário de Inscrição.",
      perguntas: [
        {
          id: "residencia",
          tipo: "radio",
          label: "Residência",
          ajuda:
            "Confirma residência na cidade de São Paulo, na região central ou a até 50 km da Praça da Sé?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        {
          id: "cnh",
          tipo: "radio",
          label: "CNH",
          ajuda: "Possui CNH categoria B válida e disponibilidade para utilizá-la no trabalho de campo?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        {
          id: "disponibilidade_horaria",
          tipo: "radio",
          label: "Disponibilidade Horária",
          ajuda:
            "Confirma disponibilidade para 8 horas diárias em dias úteis e para atuar fora da Região Central de São Paulo, se necessário?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        {
          id: "inicio_imediato",
          tipo: "radio",
          label: "Início Imediato",
          ajuda:
            "Confirma disponibilidade para participar do treinamento nas datas previstas no edital e para início imediato após a seleção?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        flagNaoCumpreRequisitos(),
      ],
    },
    secaoAvaliador(),
    secaoEnvio(),
  ],
};

/* ============================================================
 *  FORMULÁRIO — INTERIOR
 * ============================================================ */
const FORM_INTERIOR = {
  id: "interior",
  titulo: "Formulário de Entrevista Estruturada (Interior) — Processo Seletivo RBCIP",
  subtitulo: "Entrevista realizada online, duração de 20 min, gravada para transcrição.",
  regiao: "Interior",
  secoes: [
    secaoIdentificacao(),
    {
      titulo: "Elegibilidade e Disponibilidade",
      descricao: "Confirmar os requisitos básicos e logísticos, conforme o Formulário de Inscrição.",
      perguntas: [
        {
          id: "residencia_cidade",
          tipo: "texto",
          label: "Residência",
          ajuda: "Em qual cidade o candidato reside?",
          obrigatorio: true,
        },
        {
          id: "cnh",
          tipo: "radio",
          label: "CNH",
          ajuda: "Possui CNH categoria B válida e disponibilidade para utilizá-la no trabalho de campo?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        {
          id: "disponibilidade_formacao",
          tipo: "radio",
          label: "Disponibilidade",
          ajuda: "Confirma disponibilidade para participar de formação obrigatória, caso seja selecionado?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        {
          id: "disponibilidade_horario",
          tipo: "radio",
          label: "Disponibilidade de Horário",
          ajuda:
            "Você confirma ter disponibilidade de 8 horas diárias, em dias úteis, períodos matutino e vespertino para esta atividade?",
          opcoes: OPCOES_SIM_NAO,
          obrigatorio: true,
        },
        flagNaoCumpreRequisitos(),
      ],
    },
    secaoAvaliador(),
    secaoEnvio(),
  ],
};

const FORMULARIOS = {
  capital: FORM_CAPITAL,
  interior: FORM_INTERIOR,
};

window.FORMULARIOS = FORMULARIOS;
