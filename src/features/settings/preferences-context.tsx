"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { defaultSystemPreferences, loadSystemPreferences } from "./system-preferences";
const Context = createContext(defaultSystemPreferences);
export function SystemPreferencesProvider({
  userId,
  children,
}: {
  userId?: string | null;
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = useState(defaultSystemPreferences);
  useEffect(() => {
    const update = () => setPreferences(loadSystemPreferences(userId));
    update();
    window.addEventListener("hubvz:preferences-updated", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("hubvz:preferences-updated", update);
      window.removeEventListener("storage", update);
    };
  }, [userId]);
  return <Context.Provider value={preferences}>{children}</Context.Provider>;
}
export const useSystemPreferences = () => useContext(Context);
