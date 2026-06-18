"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { CategoryIcon } from "@/features/shared/category-icons";
import type { Category } from "@/lib/supabase/types";

type FieldShellProps = {
  label: string;
  children: React.ReactNode;
};

export function FieldShell({ label, children }: FieldShellProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-800 dark:text-slate-200">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const inputClassName =
  "hub-input w-full rounded-md border border-ink-950/10 bg-white px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-mint-500 focus:ring-4 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-ink-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-mint-400 dark:focus:ring-mint-400/20 dark:disabled:bg-slate-800 dark:disabled:text-slate-500";

export function CrudFeedback({
  feedback,
}: {
  feedback: { type: "success" | "error"; message: string } | null;
}) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className={[
        "rounded-md border px-4 py-3 text-sm leading-6",
        feedback.type === "success"
          ? "border-mint-600/20 bg-mint-100 text-mint-600"
          : "border-danger-600/20 bg-danger-100 text-danger-600",
      ].join(" ")}
    >
      {feedback.message}
    </div>
  );
}

type ModalProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  headerAction?: React.ReactNode;
};

export function Modal({ title, description, children, onClose, headerAction }: ModalProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [hasForm, setHasForm] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "Enter" && shouldSubmitModalForm(event)) {
        const form = findTargetForm(event.target, sectionRef.current);
        const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

        if (!form || submitButton?.disabled || form.getAttribute("aria-busy") === "true") {
          return;
        }

        event.preventDefault();
        form.requestSubmit();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setHasForm(Boolean(sectionRef.current?.querySelector("form")));
  }, [children]);

  function submitFirstForm() {
    const form = sectionRef.current?.querySelector("form");
    form?.requestSubmit();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/45 px-4 py-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={sectionRef}
        className="hub-modal max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-ink-950/10 bg-white shadow-soft"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="hub-modal-header sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-950/10 bg-white px-6 py-4">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-ink-950">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-ink-600">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerAction ?? (hasForm ? (
              <ActionButton type="button" onClick={submitFirstForm}>
                Salvar
              </ActionButton>
            ) : null)}
            <button
              type="button"
              onClick={onClose}
              className="hub-action hub-action-secondary rounded-md border border-ink-950/10 px-3 py-2 text-sm font-semibold text-ink-600 transition hover:border-danger-600 hover:text-danger-600"
            >
              Fechar
            </button>
          </div>
        </div>
        <div className="px-6 py-5">{children}</div>
      </section>
    </div>
  );
}

export function ActionButton({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const className =
    variant === "primary"
      ? "hub-action-primary bg-slate-950 text-white hover:bg-slate-800"
      : variant === "danger"
        ? "hub-action-danger border border-danger-600/20 bg-danger-100 text-danger-600 hover:border-danger-600"
        : "hub-action-secondary border border-ink-950/10 bg-white text-ink-950 hover:border-mint-500 hover:text-mint-600";

  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        "hub-action",
        className,
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

export function ViewPreferenceActions({
  onSave,
  onRestore,
  onClearFilters,
  disabled = false,
}: {
  onSave: () => void;
  onRestore: () => void;
  onClearFilters?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton type="button" variant="secondary" onClick={onSave} disabled={disabled}>
        Salvar visualização padrão
      </ActionButton>
      <ActionButton type="button" variant="secondary" onClick={onRestore} disabled={disabled}>
        Restaurar padrão
      </ActionButton>
      {onClearFilters ? (
        <ActionButton type="button" variant="secondary" onClick={onClearFilters} disabled={disabled}>
          Limpar filtros
        </ActionButton>
      ) : null}
    </div>
  );
}

export function BooleanBadge({ value }: { value: boolean }) {
  return <StatusBadge tone={value ? "success" : "neutral"}>{value ? "Sim" : "Não"}</StatusBadge>;
}

export function TextBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: StatusTone }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}

export type CategoryBadgeCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon">;

export function CategoryBadge({ category }: { category?: CategoryBadgeCategory | null }) {
  const color = category?.color?.trim();
  const icon = category?.icon?.trim();
  const label = category?.name || "Sem categoria";
  const safeColor = color && isValidHexColor(color) ? color : null;
  const textColor = safeColor ? getReadableTextColor(safeColor) : undefined;

  return (
    <span
      className={[
        "hub-category-badge inline-flex max-w-[13rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        safeColor ? "border-transparent" : "border-ink-950/10 bg-slate-100 text-ink-700",
      ].join(" ")}
      style={safeColor ? {
        "--category-color": safeColor,
        "--category-text": textColor,
        backgroundColor: safeColor,
        borderColor: safeColor,
        color: textColor,
      } as CSSProperties : undefined}
    >
      {icon ? <CategoryIcon value={icon} /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function CategorySelect({
  categories,
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder = "Sem categoria",
}: {
  categories: CategoryBadgeCategory[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedCategory = categories.find((category) => category.id === value) ?? null;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function selectCategory(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          inputClassName,
          "flex items-center justify-between gap-3 text-left",
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        ].join(" ")}
        onClick={() => !disabled && setOpen((current) => !current)}
      >
        <CategoryOptionContent category={selectedCategory} placeholder={placeholder} />
        <span className="text-xs text-ink-600">▾</span>
      </button>
      {required ? <input tabIndex={-1} className="sr-only" required value={value} onChange={() => undefined} /> : null}
      {open ? (
        <div
          role="listbox"
          className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-ink-950/10 bg-white p-1 shadow-soft dark:border-slate-700 dark:bg-slate-900"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => selectCategory("")}
          >
            <CategoryOptionContent category={null} placeholder={placeholder} />
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="option"
              aria-selected={category.id === value}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800"
              onClick={() => selectCategory(category.id)}
            >
              <CategoryOptionContent category={category} placeholder={placeholder} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CategoryOptionContent({
  category,
  placeholder,
}: {
  category: CategoryBadgeCategory | null;
  placeholder: string;
}) {
  const color = category?.color?.trim();
  const safeColor = color && isValidHexColor(color) ? color : "#cbd5e1";

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-ink-950/10"
        style={{ backgroundColor: safeColor, color: getReadableTextColor(safeColor) }}
      >
        {category?.icon ? <CategoryIcon value={category.icon} /> : null}
      </span>
      <span className="truncate">{category?.name ?? placeholder}</span>
    </span>
  );
}

export function TitleButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left font-medium text-ink-950 underline-offset-4 transition hover:text-mint-600 hover:underline dark:text-slate-100 dark:hover:text-mint-300"
    >
      {children}
    </button>
  );
}

export function BulkActionsBar({
  selectedCount,
  deleting,
  onClear,
  onDelete,
  deleteLabel = "Arquivar selecionados",
  deletingLabel = "Arquivando...",
  children,
}: {
  selectedCount: number;
  deleting: boolean;
  onClear: () => void;
  onDelete: () => void;
  deleteLabel?: string;
  deletingLabel?: string;
  children?: React.ReactNode;
}) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/75">
      <p className="text-sm font-medium text-ink-800 dark:text-slate-200">
        {selectedCount} item(ns) selecionado(s)
      </p>
      <div className="flex flex-wrap gap-2">
        {children}
        <ActionButton type="button" variant="secondary" onClick={onClear} disabled={deleting}>
          Limpar seleção
        </ActionButton>
        <ActionButton type="button" variant="danger" onClick={onDelete} disabled={deleting}>
          {deleting ? deletingLabel : deleteLabel}
        </ActionButton>
      </div>
    </div>
  );
}

export function RowSelectionHint() {
  return (
    <p className="mb-3 text-xs font-medium text-ink-600 dark:text-slate-300">
      Use Ctrl + clique na linha para selecionar rapidamente.
    </p>
  );
}

export function shouldToggleRowSelection(event: MouseEvent<HTMLElement>) {
  if (!event.ctrlKey && !event.metaKey) {
    return false;
  }

  const target = event.target;

  if (target instanceof HTMLElement && target.closest("button,input,select,textarea,a,label")) {
    return false;
  }

  return true;
}

export function QuickEditInput({
  value,
  type = "text",
  onCommit,
}: {
  value: string;
  type?: "text" | "number" | "date";
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  return (
    <input
      className="hub-input w-full min-w-28 rounded-md border border-ink-950/10 bg-white px-2 py-1 text-sm text-ink-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      type={type}
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

export function QuickEditSelect({
  value,
  options,
  onCommit,
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (value: string) => void;
}) {
  return (
    <select
      className="hub-input w-full min-w-32 rounded-md border border-ink-950/10 bg-white px-2 py-1 text-sm text-ink-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      value={value}
      onChange={(event) => onCommit(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function isValidHexColor(value: string) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function getReadableTextColor(hex: string) {
  const normalized = normalizeHex(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.58 ? "#0f172a" : "#ffffff";
}

function normalizeHex(hex: string) {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  return hex;
}

function shouldSubmitModalForm(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return false;
  if (target.closest("[data-confirmation-modal='true']")) return false;
  if (target instanceof HTMLTextAreaElement) return false;
  if (target instanceof HTMLButtonElement) return false;

  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "file", "radio", "reset", "submit"].includes(target.type);
  }

  return target instanceof HTMLSelectElement;
}

function findTargetForm(target: EventTarget | null, root: HTMLElement | null) {
  if (target instanceof HTMLElement) {
    const closestForm = target.closest("form");
    if (closestForm && root?.contains(closestForm)) {
      return closestForm;
    }
  }

  return root?.querySelector("form") ?? null;
}
