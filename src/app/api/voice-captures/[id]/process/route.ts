import { NextResponse } from "next/server";

import { processVoiceCapture } from "@/features/voice-captures/processing";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase não está configurado." }, { status: 500 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
  }

  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: "Captura não informada." }, { status: 400 });
  }

  const result = await processVoiceCapture(supabase, auth.user.id, id);

  if (result.error || !result.data) {
    return NextResponse.json(
      {
        error: result.error?.message ?? "Não foi possível processar a captura.",
        technical: result.error?.technical,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    id: result.data.session.id,
    status: result.data.session.status,
    transcriptionStatus: result.data.session.transcription_status,
    aiExtractionStatus: result.data.session.ai_extraction_status,
    taskReviewStatus: result.data.session.task_review_status,
    suggestionsCount: result.data.suggestions.length,
  });
}
