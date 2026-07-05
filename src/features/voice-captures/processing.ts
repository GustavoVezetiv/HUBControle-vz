import type { AppSupabaseClient } from "@/features/shared/types";
import {
  isVoiceCaptureAiResult,
  toJson,
  type ProcessVoiceCaptureResult,
  type VoiceCaptureAiResult,
  type VoiceCaptureProcessingError,
} from "@/features/voice-captures/types";
import type { Database, VoiceCaptureSession, VoiceCaptureSuggestion } from "@/lib/supabase/types";

const VOICE_CAPTURE_TRANSCRIPTION_MODEL = process.env.VOICE_CAPTURE_TRANSCRIPTION_MODEL ?? "gemini-2.5-flash";
const VOICE_CAPTURE_ORGANIZATION_MODEL = process.env.VOICE_CAPTURE_ORGANIZATION_MODEL ?? "gemini-2.5-flash";
const VOICE_CAPTURE_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.VOICE_CAPTURE_MAX_OUTPUT_TOKENS ?? "2500", 10);
const VOICE_CAPTURE_THINKING_BUDGET = Number.parseInt(process.env.VOICE_CAPTURE_THINKING_BUDGET ?? "0", 10);

export async function processVoiceCapture(
  client: AppSupabaseClient,
  userId: string,
  sessionId: string,
): Promise<{ data: ProcessVoiceCaptureResult | null; error: VoiceCaptureProcessingError | null }> {
  const sessionResult = await client
    .from("voice_capture_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionResult.error) {
    console.error("[voice-captures] Failed to load voice capture session", sessionResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível carregar a captura de voz.",
        technical: sessionResult.error.message,
      },
    };
  }

  const session = sessionResult.data as VoiceCaptureSession | null;

  if (!session) {
    return { data: null, error: { message: "Captura de voz não encontrada." } };
  }

  if (!["received", "failed", "transcription_pending", "transcribing", "transcribed"].includes(session.status)) {
    return {
      data: null,
      error: { message: "Esta captura não está em um status processável." },
    };
  }

  const audioResult = await downloadCaptureAudio(client, session);
  if (audioResult.error || !audioResult.data) {
    await markSessionFailed(client, session.id, "transcription_status", audioResult.error?.technical ?? audioResult.error?.message ?? "Audio download failed");
    return { data: null, error: audioResult.error ?? { message: "Não foi possível baixar o áudio." } };
  }

  await client
    .from("voice_capture_sessions")
    .update({
      status: "transcribing",
      transcription_status: "processing",
      processing_error: null,
    })
    .eq("user_id", userId)
    .eq("id", session.id);

  const transcriptionResult = await transcribeAudioWithGemini(audioResult.data);

  if (transcriptionResult.error || !transcriptionResult.data) {
    await markSessionFailed(
      client,
      session.id,
      "transcription_status",
      transcriptionResult.error?.technical ?? transcriptionResult.error?.message ?? "Transcription failed",
    );
    return { data: null, error: transcriptionResult.error ?? { message: "Não foi possível transcrever o áudio." } };
  }

  const transcriptionText = transcriptionResult.data.trim();

  const transcriptSaveResult = await client
    .from("voice_capture_sessions")
    .update({
      status: "transcribed",
      transcription_status: "completed",
      transcription_text: transcriptionText,
      ai_extraction_status: "processing",
      task_review_status: "not_started",
      processing_error: null,
    })
    .eq("user_id", userId)
    .eq("id", session.id)
    .select("*")
    .single();

  if (transcriptSaveResult.error) {
    console.error("[voice-captures] Failed to save transcription", transcriptSaveResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível salvar a transcrição.",
        technical: transcriptSaveResult.error.message,
      },
    };
  }

  const aiResult = await organizeTranscriptionWithGemini(transcriptionText);

  if (aiResult.error || !aiResult.data) {
    await client
      .from("voice_capture_sessions")
      .update({
        ai_extraction_status: "failed",
        processing_error: aiResult.error?.technical ?? aiResult.error?.message ?? "AI organization failed",
      })
      .eq("user_id", userId)
      .eq("id", session.id);
    return { data: null, error: aiResult.error ?? { message: "Não foi possível organizar a transcrição." } };
  }

  const finalSessionResult = await saveAiResult(client, userId, session.id, aiResult.data);

  if (finalSessionResult.error || !finalSessionResult.data) {
    return {
      data: null,
      error: finalSessionResult.error ?? { message: "Não foi possível salvar as sugestões." },
    };
  }

  return { data: finalSessionResult.data, error: null };
}

async function downloadCaptureAudio(
  client: AppSupabaseClient,
  session: VoiceCaptureSession,
): Promise<{ data: { base64: string; mimeType: string } | null; error: VoiceCaptureProcessingError | null }> {
  const { data, error } = await client.storage
    .from(session.audio_storage_bucket)
    .download(session.audio_storage_path);

  if (error || !data) {
    console.error("[voice-captures] Failed to download capture audio", error);
    return {
      data: null,
      error: {
        message: "Não foi possível baixar o áudio da captura.",
        technical: error?.message,
      },
    };
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return {
    data: {
      base64: buffer.toString("base64"),
      mimeType: session.audio_content_type || data.type || "audio/webm",
    },
    error: null,
  };
}

async function transcribeAudioWithGemini(audio: {
  base64: string;
  mimeType: string;
}): Promise<{ data: string | null; error: VoiceCaptureProcessingError | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      data: null,
      error: {
        message: "GEMINI_API_KEY não configurada.",
        technical: "Missing GEMINI_API_KEY",
      },
    };
  }

  const prompt = [
    "Transcreva fielmente o áudio em português do Brasil.",
    "Preserve o sentido original e não invente conteúdo.",
    "Se houver trechos inaudíveis, marque como [inaudível].",
    "Retorne somente o texto bruto da fala.",
  ].join("\n");

  const response = await requestGemini(VOICE_CAPTURE_TRANSCRIPTION_MODEL, apiKey, {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: audio.mimeType,
              data: audio.base64,
            },
          },
        ],
      },
    ],
    generationConfig: createGenerationConfig(),
  });

  if (response.error || !response.text) {
    return {
      data: null,
      error: response.error ?? { message: "Gemini respondeu sem transcrição." },
    };
  }

  return { data: response.text, error: null };
}

async function organizeTranscriptionWithGemini(
  transcriptionText: string,
): Promise<{ data: VoiceCaptureAiResult | null; error: VoiceCaptureProcessingError | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      data: null,
      error: {
        message: "GEMINI_API_KEY não configurada.",
        technical: "Missing GEMINI_API_KEY",
      },
    };
  }

  const prompt = [
    "Você organiza capturas de voz do Hub Vezetiv.dev para revisão manual.",
    "Use somente a transcrição recebida. Não invente compromissos, datas, pessoas ou tarefas.",
    "Se a fala estiver ambígua, registre em uncertainties.",
    "Se parecer reflexão, ideia ou desabafo, não force como tarefa.",
    "Não crie nada no Google Tasks. Gere apenas sugestões revisáveis.",
    "Responda somente JSON válido neste formato:",
    '{"summary":"","suggestedTasks":[{"title":"","description":"","suggestedListName":"","confidence":"alta|media|baixa","reason":""}],"looseIdeas":[],"reminders":[],"uncertainties":[]}',
    "",
    "Transcrição:",
    transcriptionText,
  ].join("\n");

  const response = await requestGemini(VOICE_CAPTURE_ORGANIZATION_MODEL, apiKey, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      ...createGenerationConfig(),
      responseMimeType: "application/json",
    },
  });

  if (response.error || !response.text) {
    return {
      data: null,
      error: response.error ?? { message: "Gemini respondeu sem organização estruturada." },
    };
  }

  const parsed = parseAiJson(response.text);

  if (!isVoiceCaptureAiResult(parsed)) {
    console.error("[voice-captures] Invalid AI organization result", response.text);
    return {
      data: null,
      error: {
        message: "A IA retornou um formato inválido para revisão.",
        technical: "Invalid voice capture AI JSON shape",
      },
    };
  }

  return {
    data: normalizeAiResult(parsed),
    error: null,
  };
}

async function saveAiResult(
  client: AppSupabaseClient,
  userId: string,
  sessionId: string,
  aiResult: VoiceCaptureAiResult,
): Promise<{ data: ProcessVoiceCaptureResult | null; error: VoiceCaptureProcessingError | null }> {
  const previousSuggestionsResult = await client
    .from("voice_capture_suggestions")
    .update({ status: "archived" })
    .eq("user_id", userId)
    .eq("voice_capture_session_id", sessionId)
    .eq("status", "pending");

  if (previousSuggestionsResult.error) {
    console.error("[voice-captures] Failed to archive previous suggestions", previousSuggestionsResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível preparar a revisão das sugestões.",
        technical: previousSuggestionsResult.error.message,
      },
    };
  }

  const suggestionRows = buildSuggestionRows(userId, sessionId, aiResult);

  const suggestionsResult = suggestionRows.length
    ? await client.from("voice_capture_suggestions").insert(suggestionRows).select("*")
    : { data: [], error: null };

  if (suggestionsResult.error) {
    console.error("[voice-captures] Failed to save AI suggestions", suggestionsResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível salvar sugestões para revisão.",
        technical: suggestionsResult.error.message,
      },
    };
  }

  const sessionResult = await client
    .from("voice_capture_sessions")
    .update({
      ai_summary: aiResult.summary,
      ai_extraction_result: toJson(aiResult),
      ai_extraction_status: "completed",
      task_review_status: "pending",
      processing_error: null,
      processed_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (sessionResult.error) {
    console.error("[voice-captures] Failed to save AI result on session", sessionResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível atualizar a sessão processada.",
        technical: sessionResult.error.message,
      },
    };
  }

  return {
    data: {
      session: sessionResult.data as VoiceCaptureSession,
      suggestions: (suggestionsResult.data ?? []) as VoiceCaptureSuggestion[],
    },
    error: null,
  };
}

function buildSuggestionRows(userId: string, sessionId: string, aiResult: VoiceCaptureAiResult) {
  const taskRows = aiResult.suggestedTasks.map((task) => ({
    user_id: userId,
    voice_capture_session_id: sessionId,
    suggestion_type: "task",
    title: task.title,
    description: task.description || null,
    suggested_list_name: task.suggestedListName || null,
    confidence: task.confidence,
    reason: task.reason || null,
    status: "pending",
    raw_data: toJson(task),
  }));

  const ideaRows = aiResult.looseIdeas.map((idea) => ({
    user_id: userId,
    voice_capture_session_id: sessionId,
    suggestion_type: "loose_idea",
    title: idea,
    description: null,
    suggested_list_name: null,
    confidence: "media",
    reason: "Ideia solta extraída da captura de voz.",
    status: "pending",
    raw_data: toJson({ value: idea }),
  }));

  const reminderRows = aiResult.reminders.map((reminder) => ({
    user_id: userId,
    voice_capture_session_id: sessionId,
    suggestion_type: "reminder",
    title: reminder,
    description: null,
    suggested_list_name: null,
    confidence: "media",
    reason: "Lembrete sugerido pela captura de voz.",
    status: "pending",
    raw_data: toJson({ value: reminder }),
  }));

  const uncertaintyRows = aiResult.uncertainties.map((uncertainty) => ({
    user_id: userId,
    voice_capture_session_id: sessionId,
    suggestion_type: "uncertainty",
    title: uncertainty,
    description: null,
    suggested_list_name: null,
    confidence: "baixa",
    reason: "Trecho ambíguo que exige revisão manual.",
    status: "pending",
    raw_data: toJson({ value: uncertainty }),
  }));

  return [...taskRows, ...ideaRows, ...reminderRows, ...uncertaintyRows];
}

async function markSessionFailed(
  client: AppSupabaseClient,
  sessionId: string,
  statusField: "transcription_status" | "ai_extraction_status",
  technicalError: string,
) {
  type VoiceCaptureSessionUpdate = Database["public"]["Tables"]["voice_capture_sessions"]["Update"];
  const updatePayload =
    statusField === "transcription_status"
      ? ({
          status: "failed",
          transcription_status: "failed",
          processing_error: technicalError,
        } satisfies VoiceCaptureSessionUpdate)
      : ({
          ai_extraction_status: "failed",
          processing_error: technicalError,
        } satisfies VoiceCaptureSessionUpdate);

  const { error } = await client.from("voice_capture_sessions").update(updatePayload).eq("id", sessionId);

  if (error) {
    console.error("[voice-captures] Failed to mark session as failed", error);
  }
}

function normalizeAiResult(value: VoiceCaptureAiResult): VoiceCaptureAiResult {
  return {
    summary: value.summary.trim(),
    suggestedTasks: value.suggestedTasks
      .filter((task) => task.title?.trim())
      .map((task) => ({
        title: task.title.trim(),
        description: task.description?.trim() ?? "",
        suggestedListName: task.suggestedListName?.trim() ?? "",
        confidence: normalizeConfidence(task.confidence),
        reason: task.reason?.trim() ?? "",
      })),
    looseIdeas: normalizeStringArray(value.looseIdeas),
    reminders: normalizeStringArray(value.reminders),
    uncertainties: normalizeStringArray(value.uncertainties),
  };
}

function normalizeStringArray(values: unknown[]) {
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeConfidence(value: unknown): "alta" | "media" | "baixa" {
  return value === "alta" || value === "media" || value === "baixa" ? value : "baixa";
}

function parseAiJson(value: string): unknown {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function createGenerationConfig() {
  return {
    temperature: 0.2,
    maxOutputTokens: Number.isFinite(VOICE_CAPTURE_MAX_OUTPUT_TOKENS) ? VOICE_CAPTURE_MAX_OUTPUT_TOKENS : 2500,
    thinkingConfig: {
      thinkingBudget: Number.isFinite(VOICE_CAPTURE_THINKING_BUDGET) ? VOICE_CAPTURE_THINKING_BUDGET : 0,
    },
  };
}

async function requestGemini(
  model: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ text: string | null; error: VoiceCaptureProcessingError | null }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("[voice-captures] Gemini API error", payload);
      return {
        text: null,
        error: {
          message: "Não foi possível processar a captura com Gemini.",
          technical: extractGeminiError(payload) ?? `HTTP ${response.status}`,
        },
      };
    }

    return { text: extractGeminiText(payload), error: null };
  } catch (error) {
    console.error("[voice-captures] Gemini request failed", error);
    return {
      text: null,
      error: {
        message: "Não foi possível chamar o Gemini.",
        technical: error instanceof Error ? error.message : "Unknown Gemini request error",
      },
    };
  }
}

function extractGeminiText(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("candidates" in payload) || !Array.isArray(payload.candidates)) return null;
  const candidate = payload.candidates[0];
  if (!candidate || typeof candidate !== "object" || !("content" in candidate)) return null;
  const content = candidate.content;
  if (!content || typeof content !== "object" || !("parts" in content) || !Array.isArray(content.parts)) return null;
  return content.parts
    .map((part: unknown) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function extractGeminiError(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
  const error = payload.error;
  if (!error || typeof error !== "object" || !("message" in error) || typeof error.message !== "string") return null;
  return error.message;
}
