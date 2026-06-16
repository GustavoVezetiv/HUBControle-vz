"use client";

export type ViewPreferenceRecord = Record<string, unknown>;

export function viewPreferenceKey(screen: string, userId?: string | null) {
  return userId ? `hubvz:view-preferences:${screen}:${userId}` : `hubvz:view-preferences:${screen}`;
}

export function loadViewPreference<T extends ViewPreferenceRecord>(
  screen: string,
  userId?: string | null,
): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(viewPreferenceKey(screen, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as T) : null;
  } catch (error) {
    console.error("Erro técnico ao carregar preferência de visualização:", error);
    return null;
  }
}

export function saveViewPreference<T extends ViewPreferenceRecord>(
  screen: string,
  userId: string | null | undefined,
  value: T,
) {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(viewPreferenceKey(screen, userId), JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("Erro técnico ao salvar preferência de visualização:", error);
    return false;
  }
}

export function clearViewPreference(screen: string, userId?: string | null) {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.removeItem(viewPreferenceKey(screen, userId));
    return true;
  } catch (error) {
    console.error("Erro técnico ao restaurar preferência de visualização:", error);
    return false;
  }
}

export function preferenceString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function preferenceText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function preferenceRecord<T extends ViewPreferenceRecord>(value: unknown, fallback: T): T {
  return isRecord(value) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is ViewPreferenceRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
