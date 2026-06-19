"use client";

import dynamic from "next/dynamic";

export const PlaceMapPicker = dynamic(
  () => import("@/features/places/components/place-map-picker").then((mod) => mod.PlaceMapPicker),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-ink-950/10 bg-slate-50 px-4 py-10 text-sm text-ink-600 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300">
        Carregando mapa...
      </div>
    ),
  },
);
