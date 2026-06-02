"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const storageKey = "hub-vz-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    const nextTheme: ThemeMode = stored === "dark" ? "dark" : "light";
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }, []);

  function handleToggle() {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="rounded-md border border-ink-950/10 bg-white px-3 py-2 text-sm font-semibold text-ink-950 transition hover:border-mint-500 hover:text-mint-600"
      aria-label={`Tema atual: ${theme === "dark" ? "Escuro" : "Claro"}. Alternar tema.`}
    >
      {theme === "dark" ? "Escuro" : "Claro"}
    </button>
  );
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}
