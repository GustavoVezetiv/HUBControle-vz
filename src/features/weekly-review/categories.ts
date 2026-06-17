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

export function detectRoutineCategoryId(
  value: {
    title: string;
    notes?: string | null;
    listTitle?: string | null;
  },
  categories: Array<{ id: string; name: string }>,
) {
  const text = `${value.title} ${value.notes ?? ""} ${value.listTitle ?? ""}`.toLowerCase();
  const category = categories.find((item) => {
    const name = item.name.toLowerCase();
    if (name === "trabalho") return /trabalho|job|cliente|empresa|reuniao|reunião/.test(text);
    if (name === "profissional") return /profissional|carreira|portfolio|portfólio|curriculo|currículo/.test(text);
    if (name === "projetos e conhecimentos") return /projeto|estudar|pesquisar|conhecimento|doc|docs/.test(text);
    if (name === "pessoal") return /pessoal|casa|familia|família|saude|saúde/.test(text);
    if (name === "cursos") return /curso|aula|formacao|formação|certificacao|certificação/.test(text);
    if (name === "lugares e coisas para fazer") return /lugar|visitar|ir em|comprar|fazer/.test(text);
    if (name === "jogos") return /jogo|game|board|rpg|mesa/.test(text);
    if (name === "coisas para assistir") return /assistir|filme|serie|série|youtube|video|vídeo/.test(text);
    return false;
  });

  return category?.id ?? categories.find((item) => item.name === "Sem previsão")?.id ?? null;
}

export function isPriorityQueueTitle(title: string) {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return normalized.includes("geral") || normalized.includes("hoje");
}
