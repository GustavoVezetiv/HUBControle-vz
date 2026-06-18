import { NextResponse } from "next/server";

import { syncConnectedGoogleTasksUsers } from "@/features/weekly-review/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  return handleCronSync(request);
}

export async function POST(request: Request) {
  return handleCronSync(request);
}

async function handleCronSync(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 503 });
  }

  if (!isAuthorizedCronRequest(request, cronSecret)) {
    return NextResponse.json({ error: "Chamada não autorizada." }, { status: 401 });
  }

  const supabase = createAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin não está configurado." }, { status: 500 });
  }

  const result = await syncConnectedGoogleTasksUsers(supabase);

  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error?.message ?? "Não foi possível executar sync automático." }, { status: 500 });
  }

  return NextResponse.json(result.data);
}

function isAuthorizedCronRequest(request: Request, cronSecret: string) {
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${cronSecret}`) {
    return true;
  }

  const url = new URL(request.url);
  return url.searchParams.get("secret") === cronSecret;
}
