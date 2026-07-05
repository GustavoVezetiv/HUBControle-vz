import type { Json, VoiceCaptureSession, VoiceCaptureSuggestion } from "@/lib/supabase/types";

export type VoiceCaptureAiResult = {
  summary: string;
  suggestedTasks: VoiceCaptureSuggestedTask[];
  looseIdeas: string[];
  reminders: string[];
  uncertainties: string[];
};

export type VoiceCaptureSuggestedTask = {
  title: string;
  description: string;
  suggestedListName: string;
  confidence: "alta" | "media" | "baixa";
  reason: string;
};

export type VoiceCaptureSessionWithSuggestions = VoiceCaptureSession & {
  suggestions: VoiceCaptureSuggestion[];
};

export type ProcessVoiceCaptureResult = {
  session: VoiceCaptureSession;
  suggestions: VoiceCaptureSuggestion[];
};

export type VoiceCaptureProcessingError = {
  message: string;
  technical?: string;
};

export function isVoiceCaptureAiResult(value: unknown): value is VoiceCaptureAiResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === "string" &&
    Array.isArray(record.suggestedTasks) &&
    Array.isArray(record.looseIdeas) &&
    Array.isArray(record.reminders) &&
    Array.isArray(record.uncertainties)
  );
}

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
