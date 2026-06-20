"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { loadSystemPreferences } from "@/features/settings/system-preferences";
import { createClient } from "@/lib/supabase/client";
import { getAuthRedirectUrl } from "@/lib/supabase/config";

type AuthFormProps = {
  isConfigured: boolean;
};

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ isConfigured }: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;

    let active = true;

    async function redirectAuthenticatedUser() {
      try {
        const supabase = createClient();
        const { data, error: sessionError } = await supabase.auth.getUser();
        if (!active || sessionError || !data.user) return;

        router.replace(loadSystemPreferences(data.user.id).initialScreen);
        router.refresh();
      } catch (authError) {
        console.error("Erro técnico ao verificar sessão na tela de login:", authError);
      }
    }

    void redirectAuthenticatedUser();

    return () => {
      active = false;
    };
  }, [isConfigured, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isConfigured) {
      setError("Supabase ainda não está configurado. Preencha o .env.local primeiro.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();

      if (mode === "sign-in") {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError(signInError.message);
          return;
        }

        const targetRoute = loadSystemPreferences(signInData.user?.id).initialScreen;
        router.push(targetRoute);
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl("/login"),
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (data.session) {
        const targetRoute = loadSystemPreferences(data.session.user.id).initialScreen;
        router.push(targetRoute);
        router.refresh();
        return;
      }

      setMessage("Cadastro criado. Confira seu e-mail se a confirmação estiver ativa.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Erro inesperado de autenticação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
      {!isConfigured ? (
        <div className="rounded-md border border-amberRisk-500/30 bg-amberRisk-100 px-4 py-3 text-sm leading-6 text-amberRisk-500">
          Configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no
          `.env.local` para habilitar login real.
        </div>
      ) : null}

      <div className="grid grid-cols-2 rounded-md border border-ink-950/10 bg-slate-100 p-1 dark:border-white/10 dark:bg-white/5">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className={[
            "rounded px-3 py-2 text-sm font-semibold transition",
            mode === "sign-in"
              ? "bg-white text-ink-950 shadow-sm dark:bg-slate-900 dark:text-slate-100"
              : "text-ink-600 dark:text-slate-300",
          ].join(" ")}
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          className={[
            "rounded px-3 py-2 text-sm font-semibold transition",
            mode === "sign-up"
              ? "bg-white text-ink-950 shadow-sm dark:bg-slate-900 dark:text-slate-100"
              : "text-ink-600 dark:text-slate-300",
          ].join(" ")}
        >
          Criar conta
        </button>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-ink-800">E-mail</span>
        <input
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          placeholder="voce@email.com"
          className="mt-2 w-full rounded-md border border-ink-950/10 bg-white px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-mint-500 focus:ring-4 focus:ring-mint-100"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-800">Senha</span>
        <input
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          placeholder="••••••••"
          className="mt-2 w-full rounded-md border border-ink-950/10 bg-white px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-mint-500 focus:ring-4 focus:ring-mint-100"
        />
      </label>

      {error ? (
        <div className="rounded-md border border-danger-600/20 bg-danger-100 px-4 py-3 text-sm leading-6 text-danger-600">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-md border border-mint-600/20 bg-mint-100 px-4 py-3 text-sm leading-6 text-mint-600">
          {message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading || !isConfigured}
        className="hub-action hub-action-primary inline-flex w-full items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Processando..." : mode === "sign-in" ? "Entrar" : "Criar conta"}
      </button>
    </form>
  );
}
