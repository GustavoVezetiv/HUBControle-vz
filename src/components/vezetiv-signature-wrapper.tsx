"use client";

import { useEffect, useState } from "react";



export function VezetivSignatureWrapper() {
  const [theme, setTheme] = useState<string>("light");

  useEffect(() => {
    // Inicializa com o tema salvo
    const stored = window.localStorage.getItem("hub-vz-theme");
    setTheme(stored === "dark" ? "dark" : "light");

    // Observa mudanças no DOM caso o usuário altere o tema no toggle
    const observer = new MutationObserver(() => {
      const currentTheme = document.documentElement.dataset.theme;
      if (currentTheme) {
        setTheme(currentTheme);
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="mt-8 flex justify-center w-full">
      <vezetiv-signature theme={theme} size="sm"></vezetiv-signature>
    </div>
  );
}
