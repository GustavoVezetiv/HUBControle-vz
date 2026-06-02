"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";

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
      <span className="text-sm font-medium text-ink-800">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const inputClassName =
  "w-full rounded-md border border-ink-950/10 bg-white px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-mint-500 focus:ring-4 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-ink-600";

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
};

export function Modal({ title, description, children, onClose }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/45 px-4 py-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-ink-950/10 bg-white p-6 shadow-soft"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-ink-950">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-ink-600">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ink-950/10 px-3 py-2 text-sm font-semibold text-ink-600 transition hover:border-danger-600 hover:text-danger-600"
          >
            Fechar
          </button>
        </div>
        <div className="mt-5">{children}</div>
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
      ? "bg-ink-950 text-white hover:bg-ink-800"
      : variant === "danger"
        ? "border border-danger-600/20 bg-danger-100 text-danger-600 hover:border-danger-600"
        : "border border-ink-950/10 bg-white text-ink-950 hover:border-mint-500 hover:text-mint-600";

  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
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
      } as CSSProperties : undefined}
    >
      {icon ? <CategoryIcon value={icon} /> : null}
      <span className="truncate">{label}</span>
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
      className="text-left font-medium text-ink-950 underline-offset-4 transition hover:text-mint-600 hover:underline"
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
}: {
  selectedCount: number;
  deleting: boolean;
  onClear: () => void;
  onDelete: () => void;
}) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-950/10 bg-slate-50 px-4 py-3">
      <p className="text-sm font-medium text-ink-800">
        {selectedCount} item(ns) selecionado(s)
      </p>
      <div className="flex gap-2">
        <ActionButton type="button" variant="secondary" onClick={onClear} disabled={deleting}>
          Limpar seleção
        </ActionButton>
        <ActionButton type="button" variant="danger" onClick={onDelete} disabled={deleting}>
          {deleting ? "Excluindo..." : "Excluir selecionados"}
        </ActionButton>
      </div>
    </div>
  );
}

export function RowSelectionHint() {
  return (
    <p className="mb-3 text-xs font-medium text-ink-600">
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
      className="w-full min-w-28 rounded-md border border-ink-950/10 bg-white px-2 py-1 text-sm text-ink-950"
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
      className="w-full min-w-32 rounded-md border border-ink-950/10 bg-white px-2 py-1 text-sm text-ink-950"
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
