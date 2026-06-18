import { NextResponse } from "next/server";

import { syncGoogleTasksForUser } from "@/features/weekly-review/sync";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase não está configurado." }, { status: 500 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Sessão não encontrada." }, { status: 401 });
  }

  const result = await syncGoogleTasksForUser(supabase, auth.user.id);

  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error?.message ?? "Não foi possível sincronizar." }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
