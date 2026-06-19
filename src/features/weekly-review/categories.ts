export const initialRoutineCategories = [
  { name: "Trabalho", color: "#2563eb" },
  { name: "Profissional", color: "#0891b2" },
  { name: "Projetos e conhecimentos", color: "#7c3aed" },
  { name: "Pessoal", color: "#16a34a" },
  { name: "Cursos", color: "#ea580c" },
  { name: "Sem previsão", color: "#64748b" },
  { name: "Lugares e coisas para fazer", color: "#db2777" },
  { name: "Jogos", color: "#9333ea" },
  { name: "Coisas para assistir", color: "#dc2626" },
] as const;

export type RoutineListContextType =
  | "execution"
  | "priority_queue"
  | "backlog"
  | "reference"
  | "leisure"
  | "content"
  | "places";

export type RoutineListContext = {
  categoryName: string;
  listType: RoutineListContextType;
  label: string;
};

const normalizedContextMatchers: Array<{
  categoryName: string;
  listType: RoutineListContextType;
  label: string;
  matches: RegExp[];
}> = [
  {
    categoryName: "Trabalho",
    listType: "execution",
    label: "Execucao de trabalho",
    matches: [/\btrabalho\b/, /\bjob\b/, /\bcliente\b/, /\bempresa\b/],
  },
  {
    categoryName: "Profissional",
    listType: "execution",
    label: "Execucao profissional",
    matches: [/\bprofissional\b/, /\bcarreira\b/, /\bportfolio\b/, /\bcurriculo\b/, /\blinkedin\b/],
  },
  {
    categoryName: "Projetos e conhecimentos",
    listType: "execution",
    label: "Projetos e conhecimentos",
    matches: [/\bprojetos?\b/, /\bconhecimentos?\b/, /\bestud(?:o|ar)\b/, /\bpesquis(?:a|ar)\b/, /\bdocs?\b/],
  },
  {
    categoryName: "Cursos",
    listType: "execution",
    label: "Cursos",
    matches: [/\bcursos?\b/, /\baulas?\b/, /\bformacao\b/, /\bcertificacao\b/],
  },
  {
    categoryName: "Pessoal",
    listType: "execution",
    label: "Pessoal",
    matches: [/\bpessoal\b/, /\bcasa\b/, /\bfamilia\b/, /\bsaude\b/],
  },
  {
    categoryName: "Jogos",
    listType: "leisure",
    label: "Lazer e jogos",
    matches: [/\bjogos?\b/, /\bgames?\b/, /\bboard\b/, /\brpg\b/, /\bmesa\b/],
  },
  {
    categoryName: "Coisas para assistir",
    listType: "content",
    label: "Conteudo para assistir",
    matches: [/\bassistir\b/, /\bfilmes?\b/, /\bseries?\b/, /\byoutube\b/, /\bvideos?\b/, /\banime\b/],
  },
  {
    categoryName: "Lugares e coisas para fazer",
    listType: "places",
    label: "Lugares e coisas para fazer",
    matches: [/\blugares?\b/, /\brole\b/, /\broles\b/, /\bpasseios?\b/, /\bvisitar\b/, /\bfazer\b/],
  },
  {
    categoryName: "Sem previsão",
    listType: "backlog",
    label: "Backlog ou sem previsao",
    matches: [/\bsem previsao\b/, /\bbacklog\b/, /\bdepois\b/, /\bideias?\b/, /\breferencia\b/],
  },
];

export function detectRoutineCategoryId(
  value: {
    title: string;
    notes?: string | null;
    listTitle?: string | null;
  },
  categories: Array<{ id: string; name: string }>,
) {
  const inferredName = inferRoutineCategoryName(value);
  return categories.find((item) => item.name === inferredName)?.id ?? categories.find((item) => item.name === "Sem previsão")?.id ?? null;
}

export function inferRoutineCategoryName(value: {
  title: string;
  notes?: string | null;
  listTitle?: string | null;
}) {
  const listContext = inferRoutineListContext(value.listTitle);
  if (listContext) return listContext.categoryName;

  const text = normalizeRoutineText(`${value.title} ${value.notes ?? ""}`);
  const matchedContext = normalizedContextMatchers.find((context) => context.matches.some((pattern) => pattern.test(text)));
  return matchedContext?.categoryName ?? "Sem previsão";
}

export function inferRoutineListContext(listTitle?: string | null): RoutineListContext | null {
  const normalized = normalizeRoutineText(listTitle ?? "");
  if (!normalized) return null;
  if (isPriorityQueueTitle(normalized)) {
    return {
      categoryName: "Sem previsão",
      listType: "priority_queue",
      label: "Fila de prioridade",
    };
  }

  const matchedContext = normalizedContextMatchers.find((context) => context.matches.some((pattern) => pattern.test(normalized)));
  if (!matchedContext) return null;

  return {
    categoryName: matchedContext.categoryName,
    listType: matchedContext.listType,
    label: matchedContext.label,
  };
}

export function isPriorityQueueTitle(title: string) {
  const normalized = normalizeRoutineText(title);
  return normalized.includes("geral") || normalized.includes("hoje");
}

function normalizeRoutineText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
