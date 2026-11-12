"use client";
import { useLayoutEffect, useRef } from "react";
import { useSystemPreferences } from "@/features/settings/preferences-context";
export function usePaginationScroll(page: number) {
  const { paginationScroll } = useSystemPreferences();
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  useLayoutEffect(() => {
    if (!requested.current) return;
    requested.current = false;
    if (paginationScroll === "keep") return;
    const target = paginationScroll === "bottom" ? bottomRef.current : topRef.current;
    target?.scrollIntoView({
      block: paginationScroll === "bottom" ? "end" : "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [page, paginationScroll]);
  return {
    topRef,
    bottomRef,
    changePage: (update: () => void) => {
      requested.current = true;
      update();
    },
  };
}
