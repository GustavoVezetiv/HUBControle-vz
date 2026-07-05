import { NextResponse } from "next/server";

import { getVoiceCaptureAuthenticatedContext, voiceCaptureErrorResponse } from "@/features/voice-captures/api-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await getVoiceCaptureAuthenticatedContext(request);

  if ("response" in auth) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!id) {
    return voiceCaptureErrorResponse(400, "missing_capture_id", "Captura não informada.");
  }

  const { data: capture, error: captureError } = await auth.supabase
    .from("voice_capture_sessions")
    .select("id, status, transcription_status, ai_extraction_status, task_review_status, processing_error")
    .eq("user_id", auth.user.id)
    .eq("id", id)
    .maybeSingle();

  if (captureError) {
    console.error("[voice-captures] Failed to load capture status", captureError);
    return voiceCaptureErrorResponse(500, "capture_status_failed", "Não foi possível consultar o status da captura.");
  }

  if (!capture) {
    return voiceCaptureErrorResponse(404, "capture_not_found", "Captura não encontrada.");
  }

  const { count, error: suggestionsError } = await auth.supabase
    .from("voice_capture_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("voice_capture_session_id", id)
    .neq("status", "archived");

  if (suggestionsError) {
    console.error("[voice-captures] Failed to count capture suggestions", suggestionsError);
    return voiceCaptureErrorResponse(500, "suggestions_count_failed", "Não foi possível contar sugestões da captura.");
  }

  return NextResponse.json({
    id: capture.id,
    status: capture.status,
    transcriptionStatus: capture.transcription_status,
    aiExtractionStatus: capture.ai_extraction_status,
    taskReviewStatus: capture.task_review_status,
    processingError: capture.processing_error,
    suggestionsCount: count ?? 0,
  });
}
