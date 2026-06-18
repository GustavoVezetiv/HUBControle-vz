import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildGoogleTasksAuthUrl } from "@/features/weekly-review/google-tasks-auth";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/supabase/config";

export async function GET() {
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.redirect(new URL("/login", "http://localhost:3000"));
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.redirect(new URL("/login", "http://localhost:3000"));
  }

  const state = crypto.randomBytes(24).toString("hex");
  const authUrl = buildGoogleTasksAuthUrl(state);

  if (authUrl.error || !authUrl.url) {
    return NextResponse.redirect(new URL(`/dashboard/weekly-review?google_error=${encodeURIComponent(authUrl.error ?? "Configuração OAuth inválida.")}`, getSiteUrl()));
  }

  const cookieStore = await cookies();
  cookieStore.set("hub_vz_google_tasks_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl.url);
}
