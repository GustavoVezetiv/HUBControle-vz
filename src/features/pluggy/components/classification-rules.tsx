"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { SearchableSelect } from "@/features/shared/searchable-select";
import type { PluggyDashboard as Dashboard } from "../service";
import type { Ownership } from "../types";
import { HistoryRuleBatch } from "./history-rule-batch";
import { previewClassificationRule } from "../rule-preview";
const ownerships = {
  personal: "Pessoal",
  third_party: "Terceiro",
  family: "Familiar",
  shared: "Compartilhada",
};

export function RulesPanel({
  data,
  disabled,
  onSave,
}: {
  data: Dashboard;
  disabled: boolean;
  onSave: (rule: unknown) => Promise<boolean>;
}) {
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ownership, setOwnership] = useState<Ownership | "">("");
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const preview = previewClassificationRule(data, {
    pattern,
    categoryId,
    ownership: ownership || null,
    id: ruleId,
  });
  return (
    <div className="space-y-6">
      <HistoryRuleBatch
        data={data}
        disabled={disabled}
        onSave={onSave}
        onEdit={(pattern, categoryId) => {
          setPattern(pattern);
          setCategoryId(categoryId);
          setRuleId(null);
          setOwnership("");
          setEditing(true);
        }}
      />
      <div className="flex items-center justify-between border-t border-ink-950/15 pt-5">
        <h2 className="text-base font-semibold">
          Minhas regras <span className="text-ink-600">{data.rules.length}</span>
        </h2>
        <ActionButton
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            setRuleId(null);
            setPattern("");
            setCategoryId("");
            setOwnership("");
            setEditing(true);
          }}
        >
          <Plus aria-hidden className="mr-2 h-4 w-4" />
          Nova regra
        </ActionButton>
      </div>
      {editing ? (
        <section
          aria-label="Editar regra de classificação"
          className="space-y-3 border-l-2 border-sky-500 bg-[var(--hub-surface-muted)] p-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{ruleId ? "Editar regra" : "Nova regra"}</h3>
            <button
              type="button"
              aria-label="Fechar edição de regra"
              className="p-2"
              onClick={() => setEditing(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              Descrição contém
              <input
                className={`${inputClassName} mt-1`}
                value={pattern}
                maxLength={120}
                onChange={(event) => setPattern(event.target.value)}
                placeholder="MICROSOFT"
              />
            </label>
            <div className="text-sm">
              <p className="mb-1">Categoria Hub</p>
              <SearchableSelect
                label="Categoria da regra"
                value={categoryId}
                onChange={setCategoryId}
                options={data.categories
                  .filter((category) => ["expense", "income"].includes(category.type))
                  .map((category) => ({ value: category.id, label: category.name }))}
              />
            </div>
            <label className="text-sm">
              Titularidade opcional
              <select
                className={`${inputClassName} mt-1`}
                value={ownership}
                onChange={(event) => setOwnership(event.target.value as Ownership | "")}
              >
                <option value="">Não atribuir automaticamente</option>
                {Object.entries(ownerships).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex gap-3">
            <ActionButton
              disabled={
                disabled ||
                pattern.trim().length < 3 ||
                !categoryId ||
                preview.existing ||
                preview.conflicts > 0
              }
              onClick={() =>
                onSave({
                  id: ruleId,
                  pattern,
                  categoryId,
                  ownership: ownership || null,
                  active: true,
                })
              }
            >
              Salvar regra
            </ActionButton>
            {ruleId ? (
              <ActionButton
                onClick={() => {
                  setRuleId(null);
                  setPattern("");
                  setCategoryId("");
                  setOwnership("");
                }}
              >
                Nova regra
              </ActionButton>
            ) : null}
          </div>
          <p className="text-xs text-ink-600">
            {preview.matched} itens atuais alcançados · {preview.conflicts} conflitos ·
            revisões manuais preservadas.
          </p>
          {preview.existing ? (
            <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
              Já existe uma regra para essa descrição; edite a regra existente.
            </p>
          ) : null}
        </section>
      ) : null}
      <div className="divide-y divide-ink-950/10">
        {data.rules.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
          >
            <span>
              {rule.pattern} →{" "}
              {data.categories.find((category) => category.id === rule.categoryId)?.name}{" "}
              · {rule.ownership ? ownerships[rule.ownership] : "titularidade pendente"} ·{" "}
              {rule.active ? "Ativa" : "Desativada"}
            </span>
            <div className="flex gap-2">
              <ActionButton
                disabled={disabled}
                onClick={() => {
                  setRuleId(rule.id);
                  setPattern(rule.pattern);
                  setCategoryId(rule.categoryId);
                  setOwnership(rule.ownership ?? "");
                  setEditing(true);
                }}
              >
                Editar
              </ActionButton>
              <ActionButton
                disabled={disabled}
                onClick={() => onSave({ ...rule, active: !rule.active })}
              >
                {rule.active ? "Desativar" : "Ativar"}
              </ActionButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
