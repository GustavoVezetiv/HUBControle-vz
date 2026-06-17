import { NextResponse } from "next/server";

import { generateWeeklyAiAnalysis } from "@/features/weekly-review/ai-analysis";
import { createClient } from "@/lib/supabase/server";

type AnalyzeRequest = {
  weekStart?: string;
  weekEnd?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase não está configurado." }, { status: 500 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AnalyzeRequest;
  const weekStart = body.weekStart;
  const weekEnd = body.weekEnd;

  if (!isValidDate(weekStart) || !isValidDate(weekEnd) || weekStart > weekEnd) {
    return NextResponse.json({ error: "Período da semana inválido." }, { status: 400 });
  }

  const result = await generateWeeklyAiAnalysis(supabase, auth.user.id, weekStart, weekEnd);

  if (result.error) {
    return NextResponse.json(
      {
        error: result.error.message,
        technical: result.error.technical,
        summary: result.data,
      },
      { status: result.data ? 200 : 400 },
    );
  }

  return NextResponse.json({ summary: result.data });
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && value === parsed.toISOString().slice(0, 10);
}
