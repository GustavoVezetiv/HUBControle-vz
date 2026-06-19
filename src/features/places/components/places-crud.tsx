"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { AuditRecordHistory } from "@/features/audit/components/audit-record-history";
import { PlaceMapPicker } from "@/features/places/components/place-map-picker-wrapper";
import { archivePlace, createPlace, listPlaces, listPlaceSupportData, updatePlace } from "@/features/places/queries";
import {
  emptyPlaceForm,
  getPlaceStatusTone,
  isOutOfScopePlaceCategory,
  isPlaceCategory,
  placeStatusOptions,
  placeToFormValues,
  placeTypeOptions,
  ratingOptions,
  type PlaceFormValues,
  type PlaceRow,
  type PlaceSupportData,
} from "@/features/places/types";
import {
  ActionButton,
  CategoryBadge,
  CategorySelect,
  CrudFeedback,
  FieldShell,
  inputClassName,
  Modal,
  TextBadge,
  TitleButton,
  ViewPreferenceActions,
} from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import { clearViewPreference, loadViewPreference, preferenceString, preferenceText, saveViewPreference } from "@/features/shared/view-preferences";
import { createClient } from "@/lib/supabase/client";

type ModalState =
  | { mode: "create"; item: null; defaults?: Partial<PlaceFormValues> }
  | { mode: "edit"; item: PlaceRow }
  | null;

type ViewMode = "list" | "kanban";
type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";
type KanbanColumn = {
  value: string;
  label: string;
  items: PlaceRow[];
};

type PlacesViewPreference = {
  search?: string;
  statusFilter?: string;
  typeFilter?: string;
  cityFilter?: string;
  ratingFilter?: RatingFilter;
  categoryFilter?: string;
  viewMode?: ViewMode;
};

const placesViewModeOptions = ["list", "kanban"] as const;
const placesRatingFilterOptions = ["all", "5", "4", "3", "2", "1"] as const;
const placesDefaultViewPreference: Required<PlacesViewPreference> = {
  search: "",
  statusFilter: "all",
  typeFilter: "all",
  cityFilter: "all",
  ratingFilter: "all",
  categoryFilter: "all",
  viewMode: "list",
};

export function PlacesCrud() {
  const [items, setItems] = useState<PlaceRow[]>([]);
  const [support, setSupport] = useState<PlaceSupportData>({ categories: [] });
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const client = createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      setLoading(false);
      return;
    }

    setUserId(auth.user.id);
    const [placesResult, supportResult] = await Promise.all([listPlaces(client), listPlaceSupportData(client)]);

    if (placesResult.error) setFeedback({ type: "error", message: placesResult.error.message });
    else setItems(placesResult.data ?? []);

    if (supportResult.categories.error) setFeedback({ type: "error", message: supportResult.categories.error.message });
    else setSupport({ categories: supportResult.categories.data ?? [] });

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!userId) return;
    const preference = loadViewPreference<PlacesViewPreference>("places", userId);
    if (!preference) return;

    setSearch(preferenceText(preference.search));
    setStatusFilter(preferenceText(preference.statusFilter, "all"));
    setTypeFilter(preferenceText(preference.typeFilter, "all"));
    setCityFilter(preferenceText(preference.cityFilter, "all"));
    setRatingFilter(preferenceString(preference.ratingFilter, placesRatingFilterOptions, "all"));
    setCategoryFilter(preferenceText(preference.categoryFilter, "all"));
    setViewMode(preferenceString(preference.viewMode, placesViewModeOptions, "list"));
  }, [userId]);

  const placeCategories = useMemo(() => support.categories.filter(isPlaceCategory), [support.categories]);

  useEffect(() => {
    if (categoryFilter === "all") return;
    if (!placeCategories.some((category) => category.id === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, placeCategories]);

  const cityOptions = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.city?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      const category = support.categories.find((categoryItem) => categoryItem.id === item.category_id);
      const matchesSearch =
        !needle ||
        [item.name, item.description, item.city, item.district, item.address, item.companion, item.notes, category?.name]
          .some((value) => value?.toLowerCase().includes(needle));
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesType = typeFilter === "all" || item.place_type === typeFilter;
      const matchesCity = cityFilter === "all" || (item.city ?? "") === cityFilter;
      const matchesCategory = categoryFilter === "all" || item.category_id === categoryFilter;
      const matchesRating = ratingFilter === "all" || Number(item.rating ?? 0) >= Number(ratingFilter);

      return matchesSearch && matchesStatus && matchesType && matchesCity && matchesCategory && matchesRating;
    });
  }, [categoryFilter, cityFilter, items, ratingFilter, search, statusFilter, support.categories, typeFilter]);

  const summary = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const visitedThisMonth = filtered.filter((item) => item.visited_date?.startsWith(currentMonth));
    const bestRated = filtered
      .filter((item) => typeof item.rating === "number")
      .sort((left, right) => Number(right.rating ?? 0) - Number(left.rating ?? 0))[0] ?? null;

    return {
      wantToGo: filtered.filter((item) => item.status === "want_to_go").length,
      planned: filtered.filter((item) => item.status === "planned").length,
      visited: filtered.filter((item) => item.status === "visited").length,
      bestRated,
      actualCostMonth: visitedThisMonth.reduce((sum, item) => sum + Number(item.actual_cost || 0), 0),
    };
  }, [filtered]);

  const kanbanColumns = useMemo(() => {
    return placeStatusOptions.map((option) => ({
      value: option.value,
      label: option.label,
      items: filtered.filter((item) => item.status === option.value),
    }));
  }, [filtered]);

  function handleSaveViewPreference() {
    const saved = saveViewPreference("places", userId, {
      search,
      statusFilter,
      typeFilter,
      cityFilter,
      ratingFilter,
      categoryFilter,
      viewMode,
    });
    setFeedback({
      type: saved ? "success" : "error",
      message: saved ? "Visualização padrão de roles e lugares salva." : "Não foi possível salvar a visualização padrão.",
    });
  }

  function handleRestoreViewPreference() {
    clearViewPreference("places", userId);
    handleClearFilters();
    setFeedback({ type: "success", message: "Visualização padrão de roles e lugares restaurada." });
  }

  function handleClearFilters() {
    setSearch(placesDefaultViewPreference.search);
    setStatusFilter(placesDefaultViewPreference.statusFilter);
    setTypeFilter(placesDefaultViewPreference.typeFilter);
    setCityFilter(placesDefaultViewPreference.cityFilter);
    setRatingFilter(placesDefaultViewPreference.ratingFilter);
    setCategoryFilter(placesDefaultViewPreference.categoryFilter);
    setViewMode(placesDefaultViewPreference.viewMode);
  }

  async function handleSubmit(values: PlaceFormValues) {
    if (!values.name.trim()) {
      setFeedback({ type: "error", message: "Informe o nome do lugar ou rolê." });
      return;
    }
    if (Number(values.estimated_cost) < 0 || Number(values.actual_cost) < 0) {
      setFeedback({ type: "error", message: "Custos devem ser maiores ou iguais a zero." });
      return;
    }
    if (values.rating && (Number(values.rating) < 1 || Number(values.rating) > 5)) {
      setFeedback({ type: "error", message: "A nota deve ficar entre 1 e 5." });
      return;
    }
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const client = createClient();
      const preparedValues = prepareVisitedValues(values);
      const result =
        modal?.mode === "edit"
          ? await updatePlace(client, modal.item.id, preparedValues)
          : await createPlace(client, userId, preparedValues);

      if (result.error) {
        console.error("Erro técnico ao salvar lugar:", result.error);
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({ type: "success", message: modal?.mode === "edit" ? "Lugar atualizado." : "Lugar criado." });
      setModal(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao salvar lugar:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar o lugar." });
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(item: PlaceRow) {
    if (!userId) return;
    if (!window.confirm(`Arquivar "${item.name}"?`)) return;

    const { error } = await archivePlace(createClient(), item.id, userId);
    if (error) {
      console.error("Erro técnico ao arquivar lugar:", error);
      setFeedback({ type: "error", message: "Não foi possível arquivar o lugar." });
      return;
    }

    setFeedback({ type: "success", message: "Lugar arquivado." });
    await loadData();
  }

  async function handleKanbanDrop(itemId: string, nextStatus: string) {
    const item = items.find((currentItem) => currentItem.id === itemId);
    if (!item) return;
    const result = await updatePlace(createClient(), item.id, prepareVisitedValues({ ...placeToFormValues(item), status: nextStatus }));
    if (result.error) {
      console.error("Erro técnico ao mover lugar no kanban:", result.error);
      setFeedback({ type: "error", message: "Não foi possível atualizar o status no kanban." });
      return;
    }
    setFeedback({
      type: "success",
      message:
        nextStatus === "visited"
          ? "Status atualizado pelo kanban. Abra o item para registrar data da visita, nota e custo."
          : "Status atualizado pelo kanban.",
    });
    await loadData();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vida real"
        title="Roles e lugares"
        description="Guarde ideias de lugares, experiências planejadas, visitas concluídas e avaliações sem misturar isso com o financeiro principal."
        action={<ActionButton onClick={() => setModal({ mode: "create", item: null })}>Novo lugar</ActionButton>}
      />

      <CrudFeedback feedback={feedback} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Quero ir" value={String(summary.wantToGo)} helper="Itens filtrados." tone="warning" />
        <StatCard label="Planejados" value={String(summary.planned)} helper="Com intenção mais concreta." tone="info" />
        <StatCard label="Já fui" value={String(summary.visited)} helper="Experiências concluídas." tone="success" />
        <StatCard
          label="Melhor nota"
          value={summary.bestRated ? `${summary.bestRated.rating}/5` : "-"}
          helper={summary.bestRated ? summary.bestRated.name : "Nenhum lugar avaliado."}
          tone="neutral"
        />
        <StatCard label="Custo real do mês" value={formatCurrency(summary.actualCostMonth)} helper="Somente visitas do mês atual." tone="info" />
      </section>

      <SectionCard title="Visualização e filtros" description="Use o kanban para acompanhar o status. Categoria aceita apenas escopos de places, leisure ou general.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FieldShell label="Visualização">
            <select className={inputClassName} value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
              <option value="list">Lista</option>
              <option value="kanban">Kanban</option>
            </select>
          </FieldShell>
          <FieldShell label="Busca">
            <input className={inputClassName} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, cidade ou descrição" />
          </FieldShell>
          <FieldShell label="Status">
            <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos</option>
              {placeStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Tipo">
            <select className={inputClassName} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">Todos</option>
              {placeTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Cidade">
            <select className={inputClassName} value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="all">Todas</option>
              {cityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Nota">
            <select className={inputClassName} value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value as RatingFilter)}>
              {ratingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Categoria">
            <select className={inputClassName} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">Todas</option>
              {placeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </FieldShell>
        </div>
        <p className="mt-3 text-sm text-ink-600 dark:text-slate-300">
          Mostrando {filtered.length} de {items.length} lugar(es). Duplo clique no card abre edição rápida da experiência.
        </p>
        <div className="mt-4">
          <ViewPreferenceActions onSave={handleSaveViewPreference} onRestore={handleRestoreViewPreference} onClearFilters={handleClearFilters} />
        </div>
      </SectionCard>

      <SectionCard title="Lista de lugares" description="Registre o lugar, o momento planejado e o que aconteceu quando você foi.">
        {loading ? (
          <p className="text-sm text-ink-600 dark:text-slate-300">Carregando roles e lugares...</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nenhum lugar cadastrado"
            description="Cadastre restaurantes, bares, passeios, viagens e outros lugares que você quer acompanhar."
            actionLabel="Crie o primeiro lugar acima"
          />
        ) : viewMode === "kanban" ? (
          <PlacesKanban
            categories={support.categories}
            columns={kanbanColumns}
            onCreate={(columnValue) => setModal({ mode: "create", item: null, defaults: buildPlaceDefaultsForKanban(columnValue) })}
            onDrop={(itemId, columnValue) => void handleKanbanDrop(itemId, columnValue)}
            onEdit={(item) => setModal({ mode: "edit", item })}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm dark:divide-white/10">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600 dark:bg-slate-900/70 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Lugar</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Cidade</th>
                  <th className="px-4 py-3">Planejado / Visitado</th>
                  <th className="px-4 py-3">Custos</th>
                  <th className="px-4 py-3">Nota</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10 dark:divide-white/10">
                {filtered.map((item) => {
                  const category = support.categories.find((currentCategory) => currentCategory.id === item.category_id);
                  return (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-3">
                        <TitleButton onClick={() => setModal({ mode: "edit", item })}>{item.name}</TitleButton>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.category_id ? <CategoryBadge category={category} /> : null}
                          {isOutOfScopePlaceCategory(category) ? <TextBadge tone="warning">Categoria fora do escopo desta tela</TextBadge> : null}
                          {buildPlaceMapUrl(item) ? (
                            <a
                              href={buildPlaceMapUrl(item) ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-full border border-ink-950/10 px-2.5 py-1 text-xs font-semibold text-ink-700 transition hover:border-mint-500 hover:text-mint-600 dark:border-white/10 dark:text-slate-200 dark:hover:text-mint-200"
                            >
                              Abrir no mapa
                            </a>
                          ) : null}
                          {buildPlaceRouteUrl(item) ? (
                            <a
                              href={buildPlaceRouteUrl(item) ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center rounded-full border border-ink-950/10 px-2.5 py-1 text-xs font-semibold text-ink-700 transition hover:border-sky-500 hover:text-sky-600 dark:border-white/10 dark:text-slate-200 dark:hover:text-sky-200"
                            >
                              Ver rota
                            </a>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-ink-600 dark:text-slate-300">
                          {[item.city, item.district, item.address, item.description].filter(Boolean).join(" · ") || "Sem detalhes adicionais"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-ink-700 dark:text-slate-200">{labelFor(placeTypeOptions, item.place_type)}</td>
                      <td className="px-4 py-3">
                        <TextBadge tone={getPlaceStatusTone(item.status)}>{labelFor(placeStatusOptions, item.status)}</TextBadge>
                      </td>
                      <td className="px-4 py-3 text-ink-700 dark:text-slate-200">
                        {[item.city, item.district].filter(Boolean).join(" / ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-ink-700 dark:text-slate-200">
                        <div>{item.planned_date ? `Planejado: ${formatDate(item.planned_date)}` : "Sem data planejada"}</div>
                        <div className="mt-1 text-xs text-ink-600 dark:text-slate-300">{item.visited_date ? `Fui em ${formatDate(item.visited_date)}` : "Ainda não visitado"}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-700 dark:text-slate-200">
                        <div>Estimado: {formatCurrency(Number(item.estimated_cost || 0))}</div>
                        <div className="mt-1 text-xs text-ink-600 dark:text-slate-300">Real: {formatCurrency(Number(item.actual_cost || 0))}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-700 dark:text-slate-200">
                        {item.rating ? `${item.rating}/5` : "-"}
                        {item.status === "visited" && item.would_repeat !== null ? (
                          <div className="mt-1 text-xs text-ink-600 dark:text-slate-300">{item.would_repeat ? "Vale repetir" : "Não vale repetir"}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {buildPlaceMapUrl(item) ? (
                            <a
                              href={buildPlaceMapUrl(item) ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="hub-action hub-action-secondary inline-flex items-center justify-center rounded-md border border-ink-950/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:border-mint-500 hover:text-mint-600 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-100"
                            >
                              Abrir no mapa
                            </a>
                          ) : null}
                          <ActionButton variant="secondary" onClick={() => setModal({ mode: "edit", item })}>Editar</ActionButton>
                          <ActionButton variant="danger" onClick={() => void handleArchive(item)}>Arquivar</ActionButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {modal ? (
        <PlaceModal
          modal={modal}
          saving={saving}
          support={support}
          placeCategories={placeCategories}
          userId={userId}
          onClose={() => setModal(null)}
          onSubmit={(values) => void handleSubmit(values)}
        />
      ) : null}
    </div>
  );
}

function PlacesKanban({
  categories,
  columns,
  onCreate,
  onDrop,
  onEdit,
}: {
  categories: PlaceSupportData["categories"];
  columns: KanbanColumn[];
  onCreate: (columnValue: string) => void;
  onDrop: (itemId: string, columnValue: string) => void;
  onEdit: (item: PlaceRow) => void;
}) {
  return (
    <div className="overflow-x-auto pb-3">
      <div className="grid min-w-max grid-flow-col auto-cols-[minmax(300px,320px)] gap-4">
        {columns.map((column) => (
          <section
            key={column.value}
            className="flex min-h-96 flex-col rounded-lg border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/55"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const itemId = event.dataTransfer.getData("text/plain");
              if (itemId) onDrop(itemId, column.value);
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">{column.label}</h3>
                <p className="mt-1 text-xs text-ink-600 dark:text-slate-300">{column.items.length} item(ns)</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-3">
              {column.items.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-8 text-center text-sm text-ink-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                  Nenhum lugar
                </div>
              ) : (
                column.items.map((item) => (
                  <PlaceKanbanCard key={item.id} categories={categories} item={item} onDoubleClick={onEdit} onEdit={onEdit} />
                ))
              )}
              <ActionButton type="button" variant="secondary" className="w-full justify-center" onClick={() => onCreate(column.value)}>
                + Adicionar
              </ActionButton>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PlaceKanbanCard({
  categories,
  item,
  onDoubleClick,
  onEdit,
}: {
  categories: PlaceSupportData["categories"];
  item: PlaceRow;
  onDoubleClick: (item: PlaceRow) => void;
  onEdit: (item: PlaceRow) => void;
}) {
  const category = categories.find((currentCategory) => currentCategory.id === item.category_id);

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDoubleClick={() => onDoubleClick(item)}
      className="cursor-pointer rounded-lg border border-slate-300 bg-white p-4 text-ink-950 shadow-sm transition hover:border-mint-500 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="text-left text-sm font-semibold text-ink-950 hover:text-mint-700 dark:text-slate-100 dark:hover:text-mint-200" onClick={() => onEdit(item)}>
          {item.name}
        </button>
        <TextBadge tone={getPlaceStatusTone(item.status)}>{labelFor(placeStatusOptions, item.status)}</TextBadge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <TextBadge tone="neutral">{labelFor(placeTypeOptions, item.place_type)}</TextBadge>
        {item.category_id ? <CategoryBadge category={category} /> : null}
        {isOutOfScopePlaceCategory(category) ? <TextBadge tone="warning">Categoria fora do escopo desta tela</TextBadge> : null}
      </div>
      <div className="mt-4 grid gap-1 text-sm text-ink-700 dark:text-slate-300">
        <p>Cidade / bairro: <strong className="text-ink-950 dark:text-slate-100">{[item.city, item.district].filter(Boolean).join(" / ") || "-"}</strong></p>
        <p>Planejado: <strong className="text-ink-950 dark:text-slate-100">{item.planned_date ? formatDate(item.planned_date) : "-"}</strong></p>
        <p>Visita: <strong className="text-ink-950 dark:text-slate-100">{item.visited_date ? formatDate(item.visited_date) : "Ainda não fui"}</strong></p>
        <p>Custo real: <strong className="text-ink-950 dark:text-slate-100">{formatCurrency(Number(item.actual_cost || 0))}</strong></p>
        <p>Nota: <strong className="text-ink-950 dark:text-slate-100">{item.rating ? `${item.rating}/5` : "-"}</strong></p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {buildPlaceMapUrl(item) ? (
          <a
            href={buildPlaceMapUrl(item) ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-ink-950/10 px-2.5 py-1 text-xs font-semibold text-ink-700 transition hover:border-mint-500 hover:text-mint-600 dark:border-white/10 dark:text-slate-200 dark:hover:text-mint-200"
          >
            Abrir no mapa
          </a>
        ) : null}
        {buildPlaceRouteUrl(item) ? (
          <a
            href={buildPlaceRouteUrl(item) ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-ink-950/10 px-2.5 py-1 text-xs font-semibold text-ink-700 transition hover:border-sky-500 hover:text-sky-600 dark:border-white/10 dark:text-slate-200 dark:hover:text-sky-200"
          >
            Ver rota
          </a>
        ) : null}
      </div>
    </article>
  );
}

function PlaceModal({
  modal,
  saving,
  support,
  placeCategories,
  userId,
  onClose,
  onSubmit,
}: {
  modal: ModalState;
  saving: boolean;
  support: PlaceSupportData;
  placeCategories: PlaceSupportData["categories"];
  userId: string | null;
  onClose: () => void;
  onSubmit: (values: PlaceFormValues) => void;
}) {
  const [values, setValues] = useState<PlaceFormValues>(modal?.mode === "edit" ? placeToFormValues(modal.item) : { ...emptyPlaceForm, ...(modal?.defaults ?? {}) });
  const selectedCategory = support.categories.find((category) => category.id === values.category_id);
  const selectedCategoryOutOfScope = isOutOfScopePlaceCategory(selectedCategory);
  const originalCategoryId = modal?.mode === "edit" ? modal.item.category_id ?? "" : "";
  const isVisited = values.status === "visited";

  const submitValues = {
    ...values,
    category_id: values.category_id || originalCategoryId,
  };

  return (
    <Modal title={modal?.mode === "edit" ? "Editar lugar" : "Novo lugar"} description="Use para acompanhar ideias de rolês, lugares visitados e experiências que merecem avaliação." onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(submitValues); }}>
        <FieldShell label="Nome">
          <input required className={inputClassName} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        </FieldShell>
        <FieldShell label="Tipo">
          <select className={inputClassName} value={values.place_type} onChange={(event) => setValues({ ...values, place_type: event.target.value })}>
            {placeTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Descrição">
            <textarea rows={3} className={inputClassName} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
          </FieldShell>
        </div>
        <FieldShell label="Status">
          <select className={inputClassName} value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value })}>
            {placeStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldShell>
        <FieldShell label="Categoria">
          <CategorySelect categories={placeCategories} value={selectedCategoryOutOfScope ? "" : values.category_id} onChange={(category_id) => setValues({ ...values, category_id })} />
          {selectedCategoryOutOfScope ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/35 dark:text-amber-100">
              Categoria atual: <strong>{selectedCategory?.name}</strong>. Categoria fora do escopo desta tela.
            </div>
          ) : null}
        </FieldShell>
        <FieldShell label="Cidade">
          <input className={inputClassName} value={values.city} onChange={(event) => setValues({ ...values, city: event.target.value })} />
        </FieldShell>
        <FieldShell label="Bairro">
          <input className={inputClassName} value={values.district} onChange={(event) => setValues({ ...values, district: event.target.value })} />
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label="Localização no mapa">
            <PlaceMapPicker
              latitude={values.latitude}
              longitude={values.longitude}
              address={values.address}
              city={values.city}
              district={values.district}
              onChange={(next) => setValues((current) => ({ ...current, ...next }))}
            />
          </FieldShell>
        </div>
        <div className="md:col-span-2">
          <FieldShell label="Endereço">
            <input className={inputClassName} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} />
          </FieldShell>
        </div>
        <div className="md:col-span-2">
          <FieldShell label="Link do Google Maps">
            <input className={inputClassName} value={values.google_maps_url} onChange={(event) => setValues({ ...values, google_maps_url: event.target.value })} placeholder="https://maps.google.com/..." />
          </FieldShell>
        </div>
        <FieldShell label="Latitude">
          <input type="number" step="0.0000001" className={inputClassName} value={values.latitude} onChange={(event) => setValues({ ...values, latitude: event.target.value })} />
        </FieldShell>
        <FieldShell label="Longitude">
          <input type="number" step="0.0000001" className={inputClassName} value={values.longitude} onChange={(event) => setValues({ ...values, longitude: event.target.value })} />
        </FieldShell>
        <FieldShell label="Data planejada">
          <div className="space-y-2">
            <input type="date" className={inputClassName} value={values.planned_date} onChange={(event) => setValues({ ...values, planned_date: event.target.value })} />
            <div className="flex flex-wrap gap-2">
              <ActionButton
                type="button"
                variant="secondary"
                onClick={() => setValues({ ...values, planned_date: new Date().toISOString().slice(0, 10) })}
              >
                Planejar para hoje
              </ActionButton>
              {values.planned_date ? (
                <ActionButton type="button" variant="secondary" onClick={() => setValues({ ...values, planned_date: "" })}>
                  Limpar data
                </ActionButton>
              ) : null}
            </div>
            <p className="text-xs text-ink-600 dark:text-slate-300">Deixe vazio quando for apenas uma ideia futura sem data definida.</p>
          </div>
        </FieldShell>
        <FieldShell label="Custo estimado">
          <input min="0" step="0.01" type="number" className={inputClassName} value={values.estimated_cost} onChange={(event) => setValues({ ...values, estimated_cost: event.target.value })} />
        </FieldShell>

        {isVisited ? (
          <>
            <div className="md:col-span-2 rounded-md border border-mint-500/20 bg-mint-50 px-4 py-3 text-sm text-ink-700 dark:border-mint-400/20 dark:bg-mint-950/20 dark:text-slate-200">
              Quando o status é <strong>Fui</strong>, registre nota, custo real, data visitada e se vale repetir.
            </div>
            <FieldShell label="Data visitada">
              <div className="space-y-2">
                <input type="date" className={inputClassName} value={values.visited_date} onChange={(event) => setValues({ ...values, visited_date: event.target.value })} />
                <div className="flex flex-wrap gap-2">
                  {!values.visited_date ? (
                    <ActionButton
                      type="button"
                      variant="secondary"
                      onClick={() => setValues({ ...values, visited_date: new Date().toISOString().slice(0, 10) })}
                    >
                      Usar hoje na visita
                    </ActionButton>
                  ) : null}
                  {values.visited_date ? (
                    <ActionButton type="button" variant="secondary" onClick={() => setValues({ ...values, visited_date: "" })}>
                      Limpar data
                    </ActionButton>
                  ) : null}
                </div>
                <p className="text-xs text-ink-600 dark:text-slate-300">Se foi hoje, use o atalho. Caso contrário, informe a data correta.</p>
              </div>
            </FieldShell>
            <FieldShell label="Custo real">
              <input min="0" step="0.01" type="number" className={inputClassName} value={values.actual_cost} onChange={(event) => setValues({ ...values, actual_cost: event.target.value })} />
            </FieldShell>
            <FieldShell label="Nota de 1 a 5">
              <input min="1" max="5" step="1" type="number" className={inputClassName} value={values.rating} onChange={(event) => setValues({ ...values, rating: event.target.value })} />
            </FieldShell>
            <FieldShell label="Companhia">
              <input className={inputClassName} value={values.companion} onChange={(event) => setValues({ ...values, companion: event.target.value })} />
            </FieldShell>
            <label className="flex items-center gap-3 text-sm font-medium text-ink-800 dark:text-slate-200">
              <input type="checkbox" checked={values.would_repeat} onChange={(event) => setValues({ ...values, would_repeat: event.target.checked })} />
              Vale repetir
            </label>
          </>
        ) : null}

        <div className="md:col-span-2">
          <FieldShell label="Observações">
            <textarea rows={3} className={inputClassName} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
          </FieldShell>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>Cancelar</ActionButton>
          <ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</ActionButton>
        </div>
        {modal?.mode === "edit" ? (
          <div className="md:col-span-2">
            <AuditRecordHistory userId={userId} module="places" recordId={modal.item.id} title="Histórico do lugar" />
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function prepareVisitedValues(values: PlaceFormValues) {
  const nextValues = { ...values };

  if (nextValues.status !== "visited") {
    nextValues.actual_cost = nextValues.actual_cost || "0";
    nextValues.rating = "";
    nextValues.would_repeat = false;
  }

  return nextValues;
}

function buildPlaceDefaultsForKanban(columnValue: string): Partial<PlaceFormValues> {
  return { status: columnValue };
}

function labelFor(options: ReadonlyArray<{ value: string; label: string }>, value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function buildPlaceMapUrl(item: Pick<PlaceRow, "google_maps_url" | "latitude" | "longitude">) {
  if (item.google_maps_url?.trim()) return item.google_maps_url.trim();
  if (typeof item.latitude === "number" && typeof item.longitude === "number") {
    return `https://www.openstreetmap.org/?mlat=${item.latitude}&mlon=${item.longitude}#map=17/${item.latitude}/${item.longitude}`;
  }
  return null;
}

function buildPlaceRouteUrl(item: Pick<PlaceRow, "latitude" | "longitude" | "google_maps_url">) {
  if (typeof item.latitude === "number" && typeof item.longitude === "number") {
    return `https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`;
  }

  if (item.google_maps_url?.trim()) {
    return item.google_maps_url.trim();
  }

  return null;
}
