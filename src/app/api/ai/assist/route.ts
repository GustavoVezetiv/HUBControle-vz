import { NextResponse } from "next/server";

import { generateDecisionAssistantResponse, type AiAssistantTarget } from "@/features/ai/assistant";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

type AssistRequest = {
  target?: AiAssistantTarget;
  payload?: Json;
};

const allowedTargets: AiAssistantTarget[] = [
  "dashboard_briefing",
  "diagnostic_alert",
  "goals_review",
  "planned_purchases_review",
];

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase não está configurado." }, { status: 500 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AssistRequest;
  if (!body.target || !allowedTargets.includes(body.target)) {
    return NextResponse.json({ error: "Alvo da IA inválido." }, { status: 400 });
  }

  const result = await generateDecisionAssistantResponse(supabase, auth.user.id, body.target, body.payload ?? {});
  if (result.error) {
    return NextResponse.json(
      {
        error: result.error.message,
        technical: result.error.technical,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ result: result.data });
}
