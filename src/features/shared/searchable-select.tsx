"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
  icon?: ReactNode;
};

export function normalizeOptionSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function SearchableSelect({
  options,
  value,
  onChange,
  label,
  placeholder = "Selecione",
  required = false,
  disabled = false,
  clearable = true,
}: {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = options.find((option) => option.value === value);
  const needle = normalizeOptionSearch(query);
  const filtered = options.filter(
    (option) =>
      !needle ||
      normalizeOptionSearch(
        `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`,
      ).includes(needle),
  );
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));

  useEffect(() => {
    input.current?.setCustomValidity(
      required && !value ? "Selecione uma opção da lista." : "",
    );
  }, [required, value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open, query]);

  function choose(option: SearchableOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  return (
    <div
      ref={wrapper}
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <div className="hub-input flex min-h-12 items-center gap-2 rounded-md border border-ink-950/10 px-3 focus-within:border-mint-500 focus-within:ring-4 focus-within:ring-mint-100 dark:focus-within:ring-mint-400/20">
        {selected?.icon && (
          <span className="shrink-0" aria-hidden="true">
            {selected.icon}
          </span>
        )}
        <div className="min-w-0 flex-1 py-2">
          <input
            ref={input}
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={
              open && filtered.length ? `${id}-option-${activeIndex}` : undefined
            }
            aria-required={required}
            disabled={disabled}
            autoComplete="off"
            className="w-full min-w-0 bg-transparent text-sm text-ink-950 outline-none placeholder:text-ink-500 dark:text-slate-100"
            placeholder={open ? "Digite para buscar…" : placeholder}
            value={open ? query : (selected?.label ?? "")}
            onFocus={() => {
              setOpen(true);
              setQuery("");
              setActive(0);
            }}
            onClick={() => {
              if (!open) {
                setOpen(true);
                setQuery("");
                setActive(0);
              }
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onInvalid={() => {
              setOpen(true);
              input.current?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive(
                  open
                    ? Math.max(
                        0,
                        Math.min(
                          filtered.length - 1,
                          activeIndex + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      )
                    : 0,
                );
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                event.stopPropagation();
                if (filtered[activeIndex]) choose(filtered[activeIndex]);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setQuery("");
              } else if (event.key === "Tab") {
                setOpen(false);
                setQuery("");
              }
            }}
          />
          {!open && selected?.description && (
            <p className="truncate text-xs text-ink-600 dark:text-slate-400">
              {selected.description}
            </p>
          )}
        </div>
        {clearable && value && !disabled && (
          <button
            type="button"
            aria-label={`Limpar ${label.toLowerCase()}`}
            className="rounded p-1 text-ink-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              onChange("");
              setQuery("");
              setActive(0);
              input.current?.focus();
              setOpen(true);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Abrir opções de ${label.toLowerCase()}`}
          disabled={disabled}
          className="rounded p-1 text-ink-600 dark:text-slate-300"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            if (open) setOpen(false);
            else {
              input.current?.focus();
              setOpen(true);
              setQuery("");
            }
          }}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && !disabled && (
        <div className="hub-card absolute z-30 mt-1 w-full min-w-56 rounded-md border border-ink-950/10 p-1 shadow-xl dark:border-white/15">
          <div
            className="px-3 py-2 text-xs text-ink-500 dark:text-slate-400"
            aria-live="polite"
          >
            {filtered.length} opção(ões) · ↑ ↓ e Enter para escolher
          </div>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {filtered.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm"
                style={{
                  color: "rgb(var(--hub-ink-950))",
                  backgroundColor:
                    index === activeIndex ? "var(--hub-surface-muted)" : "transparent",
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                {option.icon && (
                  <span className="shrink-0" aria-hidden="true">
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.label}</span>
                  {option.description && (
                    <span className="block text-xs text-ink-600 dark:text-slate-400">
                      {option.description}
                    </span>
                  )}
                </span>
                {option.value === value && (
                  <Check className="h-4 w-4 shrink-0 text-mint-600" aria-hidden="true" />
                )}
              </button>
            ))}
            {!filtered.length && (
              <p className="px-3 py-4 text-sm text-ink-600 dark:text-slate-300">
                Nenhuma opção encontrada. Apague ou altere a busca.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
