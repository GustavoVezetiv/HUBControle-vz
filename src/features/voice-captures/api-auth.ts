import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient as createCookieSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type AuthenticatedContext = {
  supabase: SupabaseClient<Database>;
  user: User;
};

export async function getVoiceCaptureAuthenticatedContext(
  request: Request,
): Promise<AuthenticatedContext | { response: NextResponse }> {
  const config = getSupabaseConfig();

  if (!config) {
    return {
      response: voiceCaptureErrorResponse(500, "supabase_not_configured", "Supabase não está configurado."),
    };
  }

  const authorization = request.headers.get("authorization");
  const hasAuthorization = Boolean(authorization?.trim());

  if (hasAuthorization && !authorization?.toLowerCase().startsWith("bearer ")) {
    return {
      response: voiceCaptureErrorResponse(
        401,
        "invalid_authorization_header",
        "Authorization inválido. Use o formato: Bearer <access_token>.",
      ),
    };
  }

  const supabase = authorization?.toLowerCase().startsWith("bearer ")
    ? createSupabaseClient<Database>(config.url, config.anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      })
    : await createCookieSupabaseClient();

  if (!supabase) {
    return {
      response: voiceCaptureErrorResponse(500, "supabase_not_configured", "Supabase não está configurado."),
    };
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    if (error) {
      console.error("[voice-captures] Authentication failed", error);
    }

    return {
      response: voiceCaptureErrorResponse(
        401,
        hasAuthorization ? "invalid_access_token" : "missing_session",
        hasAuthorization
          ? "Token inválido ou expirado. Faça login novamente no app e envie Authorization: Bearer <access_token>."
          : "Sessão não encontrada. No app mobile, envie Authorization: Bearer <access_token>.",
      ),
    };
  }

  return { supabase, user: data.user };
}

export function voiceCaptureErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: Array<{ field: string; message: string }>,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status },
  );
}
