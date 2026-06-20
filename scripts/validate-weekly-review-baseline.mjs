#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const derivedPath = path.resolve("src/features/weekly-review/derived.ts");
let derivedSource = fs.readFileSync(derivedPath, "utf8");
derivedSource = derivedSource.replace(/import type [^;]+;\r?\n/g, "").replace(/export /g, "");
derivedSource += "\nmodule.exports = { buildWeeklyDerivedData, isInflatedInitialEvent, isInheritedPriorityEvent, isRealPriorityEvent };";

const derivedCompiled = ts.transpileModule(derivedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const derivedSandbox = {
  console,
  module: { exports: {} },
  exports: {},
};

vm.runInNewContext(derivedCompiled, derivedSandbox, { filename: derivedPath });

const {
  buildWeeklyDerivedData,
} = derivedSandbox.module.exports;

const aiPath = path.resolve("src/features/weekly-review/ai-analysis.ts");
let aiSource = fs.readFileSync(aiPath, "utf8");
aiSource = aiSource
  .replace(/import [^;]+;\r?\n/g, "")
  .replace(/export /g, "");
aiSource += "\nmodule.exports = { buildWeeklyAiInputSummary };";

const aiCompiled = ts.transpileModule(aiSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const aiSandbox = {
  console,
  process: { env: {} },
  module: { exports: {} },
  exports: {},
  buildWeeklyDerivedData,
};

vm.runInNewContext(aiCompiled, aiSandbox, { filename: aiPath });

const { buildWeeklyAiInputSummary } = aiSandbox.module.exports;

const weekStart = "2026-06-15";
const weekEnd = "2026-06-21";

const taskLists = [
  list({ id: "list-work", title: "Trabalho", is_priority_queue: false }),
  list({ id: "list-priority", title: "Geral/Hoje", is_priority_queue: true }),
];

const categories = [
  category({ id: "cat-work", name: "Trabalho" }),
  category({ id: "cat-personal", name: "Pessoal" }),
];

const tasks = [
  task({
    id: "task-inherited",
    google_task_id: "google-inherited",
    google_task_list_id: "list-priority",
    confirmed_category_id: "cat-work",
    status: "needsAction",
    due_date: null,
    updated_at_google: "2026-06-20T09:00:00.000Z",
  }),
  task({
    id: "task-moved",
    google_task_id: "google-moved",
    google_task_list_id: "list-priority",
    confirmed_category_id: "cat-personal",
    status: "needsAction",
    due_date: "2026-06-18",
    updated_at_google: "2026-06-20T09:00:00.000Z",
  }),
  task({
    id: "task-completed",
    google_task_id: "google-completed",
    google_task_list_id: "list-work",
    confirmed_category_id: "cat-work",
    status: "completed",
    due_date: "2026-06-17",
    completed_at: "2026-06-18T08:00:00.000Z",
    updated_at_google: "2026-06-18T08:00:00.000Z",
  }),
  task({
    id: "task-overdue",
    google_task_id: "google-overdue",
    google_task_list_id: "list-work",
    confirmed_category_id: "cat-personal",
    status: "needsAction",
    due_date: "2026-06-16",
    updated_at_google: "2026-06-17T08:00:00.000Z",
  }),
];

const events = [
  event({
    id: "event-created-inherited",
    google_task_id: "google-inherited",
    event_type: "CREATED",
    previous_value: null,
    new_value: { title: "Herdada" },
    event_at: "2026-06-16T09:00:00.000Z",
    sync_run_id: "sync-1",
  }),
  event({
    id: "event-prioritized-inherited",
    google_task_id: "google-inherited",
    event_type: "PRIORITIZED",
    previous_value: null,
    new_value: { list: "Geral/Hoje" },
    event_at: "2026-06-16T09:00:00.000Z",
    sync_run_id: "sync-1",
  }),
  event({
    id: "event-created-real",
    google_task_id: "google-moved",
    event_type: "CREATED",
    previous_value: { status: "missing" },
    new_value: { title: "Nova tarefa" },
    event_at: "2026-06-18T09:00:00.000Z",
    sync_run_id: "sync-2",
  }),
  event({
    id: "event-moved-list-priority",
    google_task_id: "google-moved",
    event_type: "MOVED_LIST",
    previous_value: { google_task_list_id: "list-work" },
    new_value: { google_task_list_id: "list-priority", title: "Geral/Hoje" },
    metadata: { prioritized: true },
    event_at: "2026-06-19T10:00:00.000Z",
    sync_run_id: "sync-3",
  }),
  event({
    id: "event-prioritized-real",
    google_task_id: "google-moved",
    event_type: "PRIORITIZED",
    previous_value: { list: "list-work" },
    new_value: { list: "Geral/Hoje" },
    event_at: "2026-06-19T10:00:00.000Z",
    sync_run_id: "sync-3",
  }),
  event({
    id: "event-due-date",
    google_task_id: "google-moved",
    event_type: "DUE_DATE_CHANGED",
    previous_value: "2026-06-20",
    new_value: "2026-06-18",
    event_at: "2026-06-19T11:00:00.000Z",
    sync_run_id: "sync-3",
  }),
];

const derived = buildWeeklyDerivedData(tasks, events, taskLists, categories, weekStart, weekEnd);

assert.equal(derived.hasInflatedInitialEvents, true, "inherited first-sync events should be detected");
assert.equal(derived.inheritedPriorityEventsThisWeek.length, 1, "inherited prioritized event should remain visible technically");
assert.equal(derived.createdAfterBaselineEvents.length, 1, "only created-after-baseline should count as real creation");
assert.equal(derived.prioritizedEvents.length, 1, "a real move to priority should count once even with MOVED_LIST + PRIORITIZED");
assert.equal(derived.realEventsThisWeek.some((item) => item.id === "event-prioritized-inherited"), false, "inherited priority should stay out of real events");
assert.equal(derived.realEventsThisWeek.some((item) => item.id === "event-created-inherited"), false, "inherited created should stay out of real events");
assert.equal(derived.priorityQueueTasks.length, 2, "current priority queue state should remain available as context");

const aiInput = buildWeeklyAiInputSummary({ tasks, events, taskLists, categories }, weekStart, weekEnd);

assert.equal(aiInput.movimento_semana.priorizadas_reais, 1, "AI payload should use real priority count only");
assert.equal(aiInput.movimento_semana.criadas_apos_baseline, 1, "AI payload should keep only created-after-baseline");
assert.equal(aiInput.estado_atual.total_em_geral_hoje, 2, "AI payload should keep current priority queue as context");
assert.equal(
  aiInput.eventos_relevantes.some((item) => item.tarefa === "Tarefa herdada"),
  false,
  "AI payload should not send inherited priority noise",
);

console.log("Weekly review baseline validation passed.");

function task(overrides) {
  return {
    id: overrides.id,
    user_id: "user-1",
    google_task_id: overrides.google_task_id,
    google_task_list_id: overrides.google_task_list_id,
    routine_task_list_id: null,
    title: overrides.title ?? taskTitle(overrides.id),
    notes: null,
    status: overrides.status ?? "needsAction",
    due_date: overrides.due_date ?? null,
    completed_at: overrides.completed_at ?? null,
    updated_at_google: overrides.updated_at_google ?? null,
    last_seen_at: "2026-06-20T09:00:00.000Z",
    detected_category_id: null,
    confirmed_category_id: overrides.confirmed_category_id ?? null,
    parent_google_task_id: null,
    position: null,
    is_hidden: false,
    raw_json: {},
    created_at: "2026-06-20T09:00:00.000Z",
    updated_at: "2026-06-20T09:00:00.000Z",
  };
}

function event(overrides) {
  return {
    id: overrides.id,
    user_id: "user-1",
    routine_task_id: null,
    google_task_id: overrides.google_task_id,
    event_type: overrides.event_type,
    previous_value: overrides.previous_value ?? null,
    new_value: overrides.new_value ?? null,
    event_at: overrides.event_at,
    metadata: overrides.metadata ?? {},
    sync_run_id: overrides.sync_run_id ?? null,
    event_signature: null,
    created_at: overrides.event_at,
  };
}

function list(overrides) {
  return {
    id: overrides.id,
    user_id: "user-1",
    google_task_list_id: overrides.id,
    title: overrides.title,
    is_priority_queue: overrides.is_priority_queue,
    updated_at_google: "2026-06-20T09:00:00.000Z",
    last_seen_at: "2026-06-20T09:00:00.000Z",
    raw_json: {},
    created_at: "2026-06-20T09:00:00.000Z",
    updated_at: "2026-06-20T09:00:00.000Z",
  };
}

function category(overrides) {
  return {
    id: overrides.id,
    user_id: "user-1",
    name: overrides.name,
    color: null,
    is_default: false,
    created_at: "2026-06-20T09:00:00.000Z",
    updated_at: "2026-06-20T09:00:00.000Z",
  };
}

function taskTitle(id) {
  switch (id) {
    case "task-inherited":
      return "Tarefa herdada";
    case "task-moved":
      return "Tarefa movida";
    case "task-completed":
      return "Tarefa concluída";
    case "task-overdue":
      return "Tarefa vencida";
    default:
      return id;
  }
}
