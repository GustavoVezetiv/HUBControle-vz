"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { defaultSystemPreferences, loadSystemPreferences, shortcutOptions, type ShortcutId } from "@/features/settings/system-preferences";

type DashboardFavoriteShortcutsProps = {
  userId: string;
};

export function DashboardFavoriteShortcuts({ userId }: DashboardFavoriteShortcutsProps) {
  const [shortcutIds, setShortcutIds] = useState<ShortcutId[]>(defaultSystemPreferences.favoriteShortcuts);

  useEffect(() => {
    setShortcutIds(loadSystemPreferences(userId).favoriteShortcuts);
  }, [userId]);

  const shortcuts = shortcutIds
    .map((id) => shortcutOptions.find((option) => option.id === id) ?? null)
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {shortcuts.map((action) => (
        <Link
          key={action.id}
          href={action.href}
          className="rounded-lg border border-ink-950/10 bg-white p-4 text-sm font-semibold text-ink-950 transition hover:border-mint-500 hover:shadow-sm dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p>{action.label}</p>
              <p className="mt-1 text-xs font-normal text-ink-600 dark:text-slate-300">{action.description}</p>
            </div>
            <span className="text-lg text-mint-600">+</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
