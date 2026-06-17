import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  encryptToken,
  exchangeGoogleTasksCode,
  getGoogleTasksReadonlyScope,
  tokenExpiresAt,
} from "@/features/weekly-review/google-tasks-auth";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const redirectBase = getSiteUrl();
  const searchParams = request.nextUrl.searchParams;
  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  const savedState = cookieStore.get("hub_vz_google_tasks_state")?.value;
  cookieStore.delete("hub_vz_google_tasks_state");

  if (error) {
    return NextResponse.redirect(`${redirectBase}/dashboard/weekly-review?google_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${redirectBase}/dashboard/weekly-review?google_error=${encodeURIComponent("Estado OAuth inválido. Tente conectar novamente.")}`);
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(`${redirectBase}/login`);
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.redirect(`${redirectBase}/login`);
  }

  const tokenResult = await exchangeGoogleTasksCode(code);
  if (tokenResult.error || !tokenResult.data) {
    return NextResponse.redirect(`${redirectBase}/dashboard/weekly-review?google_error=${encodeURIComponent(tokenResult.error ?? "Não foi possível conectar.")}`);
  }

  const existingResult = await supabase
    .from("routine_google_connections")
    .select("encrypted_refresh_token")
    .eq("user_id", auth.user.id)
    .eq("provider", "google_tasks")
    .maybeSingle();

  if (existingResult.error) {
    console.error("Erro técnico ao buscar conexão Google Tasks existente:", existingResult.error);
    return NextResponse.redirect(`${redirectBase}/dashboard/weekly-review?google_error=${encodeURIComponent("Não foi possível salvar a conexão.")}`);
  }

  const encryptedRefreshToken = tokenResult.data.refresh_token
    ? encryptToken(tokenResult.data.refresh_token)
    : existingResult.data?.encrypted_refresh_token ?? null;

  const upsertResult = await supabase.from("routine_google_connections").upsert(
    {
      user_id: auth.user.id,
      provider: "google_tasks",
      status: encryptedRefreshToken ? "connected" : "error",
      scope: tokenResult.data.scope ?? getGoogleTasksReadonlyScope(),
      encrypted_access_token: encryptToken(tokenResult.data.access_token),
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: tokenExpiresAt(tokenResult.data.expires_in),
      connected_at: new Date().toISOString(),
      last_sync_error: encryptedRefreshToken ? null : "Google não retornou refresh token. Reconecte autorizando acesso offline.",
      raw_json: {
        token_type: tokenResult.data.token_type,
        scope: tokenResult.data.scope,
        has_refresh_token: Boolean(tokenResult.data.refresh_token),
      },
    },
    { onConflict: "user_id,provider" },
  );

  if (upsertResult.error) {
    console.error("Erro técnico ao salvar conexão Google Tasks:", upsertResult.error);
    return NextResponse.redirect(`${redirectBase}/dashboard/weekly-review?google_error=${encodeURIComponent("Não foi possível salvar a conexão.")}`);
  }

  const status = encryptedRefreshToken ? "connected" : "missing_refresh_token";
  return NextResponse.redirect(`${redirectBase}/dashboard/weekly-review?google=${status}`);
}
