import { NextResponse } from "next/server";

import { listVoiceCaptureSessions } from "@/features/voice-captures/queries";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase não está configurado." }, { status: 500 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
  }

  const result = await listVoiceCaptureSessions(supabase, auth.user.id);

  if (result.error) {
    return NextResponse.json({ error: "Não foi possível listar capturas de voz.", technical: result.error }, { status: 400 });
  }

  return NextResponse.json({ captures: result.data });
}
