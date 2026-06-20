import type { Json, Profile } from "@/lib/supabase/types";

export type AiAnalysisTone = "direct" | "balanced" | "supportive";
export type AiDetailLevel = "short" | "standard" | "deep";

export type AiUserPreferences = {
  areasOfLife: string[];
  objectives: string;
  priorities: string;
  routineNotes: string;
  importantCategories: string[];
  analysisTone: AiAnalysisTone;
  detailLevel: AiDetailLevel;
  priorityAreas: string[];
  nonUrgentAreas: string[];
  considerNotes: string;
  avoidNotes: string;
  useFinancialHistory: boolean;
  useTaskHistory: boolean;
  usePlacesHistory: boolean;
};

export const aiAreaOptions = [
  "Trabalho",
  "Profissional",
  "Projetos e conhecimentos",
  "Cursos",
  "Pessoal",
  "Saúde",
  "Finanças",
  "Lazer",
  "Roles e lugares",
  "Coisas para assistir",
  "Jogos",
] as const;

export const aiToneOptions: Array<{ value: AiAnalysisTone; label: string }> = [
  { value: "direct", label: "Direto" },
  { value: "balanced", label: "Equilibrado" },
  { value: "supportive", label: "Apoio prático" },
];

export const aiDetailLevelOptions: Array<{ value: AiDetailLevel; label: string }> = [
  { value: "short", label: "Curto" },
  { value: "standard", label: "Padrão" },
  { value: "deep", label: "Mais detalhado" },
];

export const defaultAiUserPreferences: AiUserPreferences = {
  areasOfLife: [...aiAreaOptions],
  objectives: "",
  priorities: "",
  routineNotes: "",
  importantCategories: [],
  analysisTone: "balanced",
  detailLevel: "standard",
  priorityAreas: ["Trabalho", "Profissional", "Finanças"],
  nonUrgentAreas: ["Coisas para assistir", "Jogos"],
  considerNotes: "",
  avoidNotes: "",
  useFinancialHistory: true,
  useTaskHistory: true,
  usePlacesHistory: false,
};

export function profileToAiPreferences(profile: Pick<Profile, "ai_preferences"> | null | undefined): AiUserPreferences {
  return normalizeAiUserPreferences(profile?.ai_preferences ?? null);
}

export function aiPreferencesToJson(value: AiUserPreferences): Json {
  return normalizeAiUserPreferences(value) as unknown as Json;
}

export function normalizeAiUserPreferences(value: unknown): AiUserPreferences {
  const record = isRecord(value) ? value : {};

  return {
    areasOfLife: normalizeStringArray(record.areasOfLife, defaultAiUserPreferences.areasOfLife),
    objectives: normalizeText(record.objectives),
    priorities: normalizeText(record.priorities),
    routineNotes: normalizeText(record.routineNotes),
    importantCategories: normalizeStringArray(record.importantCategories, defaultAiUserPreferences.importantCategories),
    analysisTone: record.analysisTone === "direct" || record.analysisTone === "supportive" ? record.analysisTone : "balanced",
    detailLevel: record.detailLevel === "short" || record.detailLevel === "deep" ? record.detailLevel : "standard",
    priorityAreas: normalizeStringArray(record.priorityAreas, defaultAiUserPreferences.priorityAreas),
    nonUrgentAreas: normalizeStringArray(record.nonUrgentAreas, defaultAiUserPreferences.nonUrgentAreas),
    considerNotes: normalizeText(record.considerNotes),
    avoidNotes: normalizeText(record.avoidNotes),
    useFinancialHistory: typeof record.useFinancialHistory === "boolean" ? record.useFinancialHistory : true,
    useTaskHistory: typeof record.useTaskHistory === "boolean" ? record.useTaskHistory : true,
    usePlacesHistory: typeof record.usePlacesHistory === "boolean" ? record.usePlacesHistory : false,
  };
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
