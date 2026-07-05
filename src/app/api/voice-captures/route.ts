import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getVoiceCaptureAuthenticatedContext, voiceCaptureErrorResponse } from "@/features/voice-captures/api-auth";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";

const VOICE_CAPTURE_BUCKET = "voice-captures";
const VOICE_CAPTURE_SOURCE = "vozetiv-capture-mobile";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

type ParsedVoiceCaptureForm = {
  audio: File;
  localId: string;
  createdAt: string;
  durationSeconds: number;
  targetDurationSeconds: number | null;
  source: typeof VOICE_CAPTURE_SOURCE;
};

type ValidationErrorDetail = {
  field: string;
  message: string;
};

export async function POST(request: Request) {
  const auth = await getVoiceCaptureAuthenticatedContext(request);

  if ("response" in auth) {
    return auth.response;
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (error) {
    console.error("[voice-captures] Invalid multipart payload", error);
    return voiceCaptureErrorResponse(400, "invalid_form_data", "Envie a captura como multipart/form-data.");
  }

  const parsed = parseVoiceCaptureFormData(formData);

  if ("errors" in parsed) {
    return voiceCaptureErrorResponse(400, "validation_error", "Dados da captura inválidos.", parsed.errors);
  }

  const existingCapture = await findExistingCapture(auth.supabase, auth.user.id, parsed.localId, parsed.source);

  if ("response" in existingCapture) {
    return existingCapture.response;
  }

  if (existingCapture.capture) {
    return NextResponse.json({
      id: existingCapture.capture.id,
      status: existingCapture.capture.status,
      message: "Capture received",
    });
  }

  const sessionId = crypto.randomUUID();
  const audioStoragePath = buildAudioStoragePath(auth.user.id, sessionId, parsed.audio);
  const audioContentType = parsed.audio.type || "application/octet-stream";
  const audioBuffer = Buffer.from(await parsed.audio.arrayBuffer());

  const { error: uploadError } = await auth.supabase.storage
    .from(VOICE_CAPTURE_BUCKET)
    .upload(audioStoragePath, audioBuffer, {
      cacheControl: "3600",
      contentType: audioContentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[voice-captures] Failed to upload audio", uploadError);
    return voiceCaptureErrorResponse(500, "audio_upload_failed", "Não foi possível salvar o áudio da captura.");
  }

  const { data: createdSession, error: insertError } = await auth.supabase
    .from("voice_capture_sessions")
    .insert({
      id: sessionId,
      user_id: auth.user.id,
      source_app: parsed.source,
      local_capture_id: parsed.localId,
      audio_storage_bucket: VOICE_CAPTURE_BUCKET,
      audio_storage_path: audioStoragePath,
      audio_file_name: parsed.audio.name || null,
      audio_content_type: audioContentType,
      audio_size_bytes: parsed.audio.size,
      created_at_mobile: parsed.createdAt,
      duration_seconds: parsed.durationSeconds,
      target_duration_seconds: parsed.targetDurationSeconds,
      status: "received",
      transcription_status: "not_started",
      transcription_text: null,
      ai_extraction_status: "not_started",
      task_review_status: "not_started",
      metadata: {
        source: parsed.source,
        localId: parsed.localId,
        originalFileName: parsed.audio.name || null,
      },
    })
    .select("id, status")
    .single();

  if (insertError || !createdSession) {
    console.error("[voice-captures] Failed to create voice capture session", insertError);
    await cleanupUploadedAudio(auth.supabase, audioStoragePath);
    return voiceCaptureErrorResponse(
      500,
      "session_create_failed",
      "Não foi possível registrar a sessão da captura no Hub.",
    );
  }

  return NextResponse.json(
    {
      id: createdSession.id,
      status: "received",
      message: "Capture received",
    },
    { status: 201 },
  );
}

function parseVoiceCaptureFormData(
  formData: FormData,
): ParsedVoiceCaptureForm | { errors: ValidationErrorDetail[] } {
  const errors: ValidationErrorDetail[] = [];
  const audio = formData.get("audio");
  const localId = stringField(formData, "localId");
  const createdAt = stringField(formData, "createdAt");
  const durationSeconds = numberField(formData, "durationSeconds");
  const targetDurationSeconds = optionalNumberField(formData, "targetDurationSeconds");
  const source = stringField(formData, "source");
  const normalizedCreatedAt = normalizeIsoDate(createdAt);

  if (!(audio instanceof File)) {
    errors.push({ field: "audio", message: "Arquivo de áudio obrigatório." });
  } else {
    if (audio.size <= 0) {
      errors.push({ field: "audio", message: "Arquivo de áudio vazio." });
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      errors.push({ field: "audio", message: "Arquivo de áudio maior que 50 MB." });
    }
  }

  if (!localId) {
    errors.push({ field: "localId", message: "ID local da captura é obrigatório." });
  }

  if (!normalizedCreatedAt) {
    errors.push({ field: "createdAt", message: "Data da captura deve ser uma data ISO válida." });
  }

  if (durationSeconds === null || durationSeconds < 0) {
    errors.push({ field: "durationSeconds", message: "Duração deve ser um número maior ou igual a zero." });
  }

  if (targetDurationSeconds !== null && targetDurationSeconds < 0) {
    errors.push({
      field: "targetDurationSeconds",
      message: "Duração alvo deve ser um número maior ou igual a zero.",
    });
  }

  if (source !== VOICE_CAPTURE_SOURCE) {
    errors.push({ field: "source", message: `Origem deve ser "${VOICE_CAPTURE_SOURCE}".` });
  }

  if (errors.length > 0 || !(audio instanceof File) || !normalizedCreatedAt || durationSeconds === null) {
    return { errors };
  }

  return {
    audio,
    localId,
    createdAt: normalizedCreatedAt,
    durationSeconds,
    targetDurationSeconds,
    source: VOICE_CAPTURE_SOURCE,
  };
}

async function findExistingCapture(
  supabase: SupabaseClient<Database>,
  userId: string,
  localId: string,
  source: string,
): Promise<{ capture: { id: string; status: string } | null } | { response: NextResponse }> {
  const { data, error } = await supabase
    .from("voice_capture_sessions")
    .select("id, status")
    .eq("user_id", userId)
    .eq("source_app", source)
    .eq("local_capture_id", localId)
    .maybeSingle();

  if (error) {
    console.error("[voice-captures] Failed to check duplicate capture", error);
    return {
      response: voiceCaptureErrorResponse(500, "duplicate_check_failed", "Não foi possível verificar captura existente."),
    };
  }

  return { capture: data };
}

async function cleanupUploadedAudio(supabase: SupabaseClient<Database>, audioStoragePath: string) {
  const { error } = await supabase.storage.from(VOICE_CAPTURE_BUCKET).remove([audioStoragePath]);

  if (error) {
    console.error("[voice-captures] Failed to cleanup uploaded audio after DB error", error);
  }
}

function stringField(formData: FormData, field: string) {
  const value = formData.get(field);

  return typeof value === "string" ? value.trim() : "";
}

function numberField(formData: FormData, field: string) {
  const raw = stringField(formData, field);

  if (!raw) {
    return null;
  }

  const parsed = Number(raw.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumberField(formData: FormData, field: string) {
  const raw = stringField(formData, field);

  if (!raw) {
    return null;
  }

  const parsed = Number(raw.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : -1;
}

function normalizeIsoDate(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function buildAudioStoragePath(userId: string, sessionId: string, audio: File) {
  const fallbackName = `capture.${extensionFromContentType(audio.type)}`;
  const fileName = sanitizeFileName(audio.name || fallbackName) || fallbackName;

  return `${userId}/${sessionId}/${fileName}`;
}

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function extensionFromContentType(contentType: string) {
  switch (contentType) {
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return "webm";
  }
}
