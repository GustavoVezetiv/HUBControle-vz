import type {
  RoutineCategory,
  RoutineAiSummary,
  RoutineGoogleConnection,
  RoutineTask,
  RoutineTaskEvent,
  RoutineTaskList,
  RoutineSyncRun,
  RoutineWeeklyReport,
} from "@/lib/supabase/types";

export type WeeklyReviewData = {
  connection: RoutineGoogleConnection | null;
  categories: RoutineCategory[];
  taskLists: RoutineTaskList[];
  tasks: RoutineTask[];
  events: RoutineTaskEvent[];
  weeklyReports: RoutineWeeklyReport[];
  aiSummaries: RoutineAiSummary[];
  syncRuns: RoutineSyncRun[];
};

export type WeeklyReviewSummary = {
  completedThisWeek: RoutineTask[];
  prioritizedEvents: RoutineTaskEvent[];
  openTasks: RoutineTask[];
  staleTasks: RoutineTask[];
  eventsThisWeek: RoutineTaskEvent[];
  countByList: Array<{ label: string; count: number }>;
  countByCategory: Array<{ label: string; count: number }>;
};
