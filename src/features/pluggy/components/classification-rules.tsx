"use client";
import { useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { ActionButton, inputClassName } from "@/features/shared/crud-ui";
import { SearchableSelect } from "@/features/shared/searchable-select";
import type { PluggyDashboard as Dashboard } from "../service";
import type { Ownership } from "../types";
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
  onSave: (rule: unknown) => void;
}) {
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ownership, setOwnership] = useState<Ownership | "">("");
  const [ruleId, setRuleId] = useState<string | null>(null);
  return (
    <SectionCard
      title="Regras simples de classificação"
      description="Somente regras confirmadas podem preencher categoria. Titularidade permanece pendente, exceto quando você a definir explicitamente na regra. Tags não criam reembolsos."
    >
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
          disabled={disabled || pattern.trim().length < 3 || !categoryId}
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
          Confirmar e salvar regra
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
      <div className="mt-5 space-y-2">
        {data.rules.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
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
      <details className="mt-5">
        <summary className="cursor-pointer text-sm font-medium">
          Sugestões do histórico Organizze ({data.proposals.length})
        </summary>
        <div className="mt-3 max-h-96 space-y-2 overflow-auto">
          {data.proposals.map((proposal) => (
            <div key={proposal.pattern} className="rounded border p-3 text-sm">
              <p>
                {proposal.pattern} → {proposal.category} · {proposal.count} ocorrências
              </p>
              <p>
                Tags de referência: {proposal.tags.join(", ") || "nenhuma"}
                {proposal.conflicts
                  ? " · Categorias históricas conflitantes; revisar."
                  : ""}
              </p>
              <ActionButton
                disabled={disabled}
                onClick={() => {
                  setRuleId(null);
                  setPattern(proposal.pattern.slice(0, 120));
                  setCategoryId(proposal.conflicts ? "" : (proposal.categoryId ?? ""));
                  setOwnership("");
                }}
              >
                Revisar esta sugestão
              </ActionButton>
            </div>
          ))}
        </div>
      </details>
    </SectionCard>
  );
}
