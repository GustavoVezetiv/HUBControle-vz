import { inferRoutineCategoryName, inferRoutineListContext, type RoutineListContext } from "@/features/weekly-review/categories";
import type { RoutineCategory, RoutineTask, RoutineTaskEvent, RoutineTaskList } from "@/lib/supabase/types";

type CountRow = { label: string; count: number };

export type WeeklyDerivedData = {
  completedThisWeek: RoutineTask[];
  createdAfterBaselineEvents: RoutineTaskEvent[];
  prioritizedEvents: RoutineTaskEvent[];
  reopenedEvents: RoutineTaskEvent[];
  dueDateChangedEvents: RoutineTaskEvent[];
  realEventsThisWeek: RoutineTaskEvent[];
  technicalEventsThisWeek: RoutineTaskEvent[];
  inheritedPriorityEventsThisWeek: RoutineTaskEvent[];
  openTasks: RoutineTask[];
  priorityQueueTasks: RoutineTask[];
  openRecentTasks: RoutineTask[];
  staleTasks: RoutineTask[];
  overdueTasks: RoutineTask[];
  tasksWithoutDate: RoutineTask[];
  tasksDueThisWeek: RoutineTask[];
  areaMostWorked: CountRow | null;
  areaLeastAttention: CountRow | null;
  countByList: CountRow[];
  countByCategory: CountRow[];
  hasInflatedInitialEvents: boolean;
};

export type ResolvedRoutineTaskContext = {
  categoryLabel: string;
  categorySource: "confirmed" | "detected" | "list" | "title_notes" | "fallback";
  listContext: RoutineListContext | null;
  listTitle: string;
};

export function buildWeeklyDerivedData(
  tasks: RoutineTask[],
  events: RoutineTaskEvent[],
  taskLists: RoutineTaskList[],
  categories: RoutineCategory[],
  weekStartDate: string,
  weekEndDate: string,
): WeeklyDerivedData {
  const todayValue = toDateInputValue(new Date());
  const listByGoogleId = new Map(taskLists.map((list) => [list.google_task_list_id, list]));
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));

  const completedThisWeek = tasks.filter((task) => task.completed_at && inDateRange(task.completed_at.slice(0, 10), weekStartDate, weekEndDate));
  const openTasks = tasks.filter((task) => task.status !== "completed");
  const technicalEventsThisWeek = events.filter((event) => inDateRange(event.event_at.slice(0, 10), weekStartDate, weekEndDate));
  const realEventsThisWeek = technicalEventsThisWeek.filter((event) => !isInflatedInitialEvent(event));
  const inheritedPriorityEventsThisWeek = technicalEventsThisWeek.filter(isInheritedPriorityEvent);
  const prioritizedEvents = buildPriorityEvents(realEventsThisWeek);

  const priorityQueueTasks = openTasks.filter((task) => listByGoogleId.get(task.google_task_list_id)?.is_priority_queue);
  const openRecentTasks = openTasks.filter((task) => task.updated_at_google && daysBetween(task.updated_at_google.slice(0, 10), todayValue) < 14);
  const staleTasks = openTasks.filter((task) => task.updated_at_google && daysBetween(task.updated_at_google.slice(0, 10), todayValue) >= 14);
  const overdueTasks = openTasks.filter((task) => task.due_date && task.due_date < todayValue);
  const tasksWithoutDate = openTasks.filter((task) => !task.due_date);
  const tasksDueThisWeek = openTasks.filter((task) => task.due_date && inDateRange(task.due_date, weekStartDate, weekEndDate));

  const completedByCategory = countRows(completedThisWeek, (task) => resolveRoutineTaskContext(task, listByGoogleId, categoryById).categoryLabel);
  const openByCategory = countRows(openTasks, (task) => resolveRoutineTaskContext(task, listByGoogleId, categoryById).categoryLabel);

  return {
    completedThisWeek,
    createdAfterBaselineEvents: realEventsThisWeek.filter((event) => event.event_type === "CREATED"),
    prioritizedEvents,
    reopenedEvents: realEventsThisWeek.filter((event) => event.event_type === "REOPENED"),
    dueDateChangedEvents: realEventsThisWeek.filter((event) => event.event_type === "DUE_DATE_CHANGED"),
    realEventsThisWeek,
    technicalEventsThisWeek,
    inheritedPriorityEventsThisWeek,
    openTasks,
    priorityQueueTasks,
    openRecentTasks,
    staleTasks,
    overdueTasks,
    tasksWithoutDate,
    tasksDueThisWeek,
    areaMostWorked: completedByCategory[0] ?? null,
    areaLeastAttention: findLeastAttentionArea(completedByCategory, openByCategory),
    countByList: countRows(openTasks, (task) => listByGoogleId.get(task.google_task_list_id)?.title ?? "Lista desconhecida"),
    countByCategory: countRows(openTasks, (task) => resolveRoutineTaskContext(task, listByGoogleId, categoryById).categoryLabel),
    hasInflatedInitialEvents: technicalEventsThisWeek.some(isInflatedInitialEvent),
  };
}

export function resolveRoutineTaskContext(
  task: RoutineTask,
  listByGoogleId: Map<string, RoutineTaskList>,
  categoryById: Map<string, string>,
): ResolvedRoutineTaskContext {
  const listTitle = listByGoogleId.get(task.google_task_list_id)?.title ?? "Lista desconhecida";
  const listContext = inferRoutineListContext(listTitle);
  const confirmedCategory = categoryById.get(task.confirmed_category_id ?? "");
  if (confirmedCategory) {
    return { categoryLabel: confirmedCategory, categorySource: "confirmed", listContext, listTitle };
  }

  const detectedCategory = categoryById.get(task.detected_category_id ?? "");
  if (detectedCategory && detectedCategory !== "Sem previsão") {
    return { categoryLabel: detectedCategory, categorySource: "detected", listContext, listTitle };
  }

  if (listContext) {
    return { categoryLabel: listContext.categoryName, categorySource: "list", listContext, listTitle };
  }

  const inferredName = inferRoutineCategoryName({
    title: task.title,
    notes: task.notes,
    listTitle,
  });

  if (inferredName && inferredName !== "Sem previsão") {
    return { categoryLabel: inferredName, categorySource: "title_notes", listContext: null, listTitle };
  }

  return { categoryLabel: "Sem previsão", categorySource: "fallback", listContext: null, listTitle };
}

export function isInflatedInitialEvent(event: RoutineTaskEvent) {
  return event.previous_value === null && (event.event_type === "CREATED" || event.event_type === "PRIORITIZED");
}

export function isInheritedPriorityEvent(event: RoutineTaskEvent) {
  return event.event_type === "PRIORITIZED" && event.previous_value === null;
}

export function isRealPriorityEvent(event: RoutineTaskEvent) {
  if (isInheritedPriorityEvent(event)) return false;
  return event.event_type === "PRIORITIZED" || (event.event_type === "MOVED_LIST" && JSON.stringify(event.metadata).includes("prioritized"));
}

function buildPriorityEvents(events: RoutineTaskEvent[]) {
  const candidates = events.filter(isRealPriorityEvent);
  const deduped = new Map<string, RoutineTaskEvent>();

  for (const event of candidates) {
    const key = buildPriorityEventKey(event);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, event);
      continue;
    }

    if (existing.event_type !== "PRIORITIZED" && event.event_type === "PRIORITIZED") {
      deduped.set(key, event);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.event_at.localeCompare(right.event_at));
}

function buildPriorityEventKey(event: RoutineTaskEvent) {
  if (event.sync_run_id) return `${event.google_task_id}:${event.sync_run_id}`;
  return `${event.google_task_id}:${event.event_at}:${extractListTarget(event) ?? "priority"}`;
}

function extractListTarget(event: RoutineTaskEvent) {
  if (!event.new_value || typeof event.new_value !== "object" || Array.isArray(event.new_value)) return null;
  const record = event.new_value as Record<string, unknown>;
  return typeof record.google_task_list_id === "string" ? record.google_task_list_id : typeof record.list === "string" ? record.list : null;
}

function countRows<T>(rows: T[], getLabel: (row: T) => string) {
  const counts = rows.reduce<Map<string, number>>((acc, row) => {
    const label = getLabel(row);
    acc.set(label, (acc.get(label) ?? 0) + 1);
    return acc;
  }, new Map());

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function findLeastAttentionArea(completedByCategory: CountRow[], openByCategory: CountRow[]) {
  const completedLabels = new Set(completedByCategory.map((item) => item.label));
  const openWithoutCompletion = openByCategory.find((item) => !completedLabels.has(item.label));
  if (openWithoutCompletion) return openWithoutCompletion;
  return [...completedByCategory].sort((left, right) => left.count - right.count)[0] ?? null;
}

function inDateRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  return Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}
