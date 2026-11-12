"use client";

import {
  BriefcaseBusiness,
  CheckCheck,
  CircleCheck,
  Clock3,
  HandCoins,
  HeartHandshake,
  History,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { getCategoryScopeLabels, getCategoryScopes } from "@/features/categories/scopes";
import { CategoryIcon } from "@/features/shared/category-icons";
import {
  categoryTypeOptions,
  optionLabel,
  peopleTypeOptions,
  reimbursementStatusOptions,
} from "@/features/shared/options";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/features/shared/searchable-select";
import type { CategoryBadgeCategory } from "@/features/shared/crud-ui";
import type { ReimbursementPerson } from "../types";

export function personOptions(people: ReimbursementPerson[]): SearchableOption[] {
  return people.map((person) => {
    const Icon =
      person.relationship_type === "family"
        ? UsersRound
        : person.relationship_type === "client"
          ? BriefcaseBusiness
          : person.relationship_type === "friend"
            ? HeartHandshake
            : UserRound;
    return {
      value: person.id,
      label: person.name,
      description: [
        optionLabel(peopleTypeOptions, person.relationship_type ?? "other"),
        person.is_active === false ? "Inativo" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      icon: (
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-mint-100 text-mint-700 dark:bg-mint-950 dark:text-mint-200">
          <Icon className="h-4 w-4" />
        </span>
      ),
    };
  });
}

export const reimbursementStatusChoices: SearchableOption[] =
  reimbursementStatusOptions.map((option) => {
    const Icon =
      option.value === "received"
        ? CircleCheck
        : option.value === "expected"
          ? Clock3
          : option.value === "partial"
            ? HandCoins
            : option.value === "cancelled"
              ? XCircle
              : option.value === "forgiven"
                ? HeartHandshake
                : option.value === "late"
                  ? History
                  : CheckCheck;
    return {
      ...option,
      icon: (
        <Icon
          className={`h-5 w-5 ${option.value === "late" ? "text-amber-600" : option.value === "received" ? "text-mint-600" : "text-ink-500 dark:text-slate-400"}`}
        />
      ),
    };
  });

export function PersonSearchSelect({
  people,
  value,
  onChange,
  label = "Pessoa responsável",
  placeholder = "Selecione uma pessoa",
  required = false,
}: {
  people: ReimbursementPerson[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <SearchableSelect
      options={personOptions(people)}
      value={value}
      onChange={onChange}
      label={label}
      placeholder={placeholder}
      required={required}
    />
  );
}

export function ReimbursementCategorySelect({
  categories,
  value,
  onChange,
  label = "Categoria",
  placeholder = "Sem categoria",
  disabled,
  required,
}: {
  categories: (CategoryBadgeCategory & { scopes?: string[] | null })[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const options = categories.map((category) => ({
    value: category.id,
    label: category.name,
    description: [
      optionLabel(categoryTypeOptions, category.type),
      ...getCategoryScopeLabels(getCategoryScopes(category)),
    ].join(" · "),
    icon: (
      <span
        className="inline-flex size-8 items-center justify-center rounded-full border border-ink-950/10 bg-slate-50 dark:bg-slate-800"
        style={
          category.color && /^#[\da-f]{6}$/i.test(category.color)
            ? { color: category.color }
            : undefined
        }
      >
        <CategoryIcon value={category.icon ?? "outros"} className="h-5 w-5" />
      </span>
    ),
  }));
  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
    />
  );
}
