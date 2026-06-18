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
  openRecentTasks: RoutineTask[];
  staleTasks: RoutineTask[];
  tasksWithoutDate: RoutineTask[];
  tasksDueThisWeek: RoutineTask[];
  eventsThisWeek: RoutineTaskEvent[];
  areaMostWorked: { label: string; count: number } | null;
  areaLeastAttention: { label: string; count: number } | null;
  hasInflatedInitialEvents: boolean;
  countByList: Array<{ label: string; count: number }>;
  countByCategory: Array<{ label: string; count: number }>;
};
