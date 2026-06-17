export type GoogleTaskListPayload = {
  id: string;
  title: string;
  updated?: string;
  selfLink?: string;
};

export type GoogleTaskPayload = {
  id: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  updated?: string;
  parent?: string;
  position?: string;
  hidden?: boolean;
  deleted?: boolean;
};

const baseUrl = "https://tasks.googleapis.com/tasks/v1";

export async function fetchGoogleTaskLists(accessToken: string) {
  const lists: GoogleTaskListPayload[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${baseUrl}/users/@me/lists?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Erro técnico ao buscar listas do Google Tasks:", payload);
      return { data: null, error: "Não foi possível ler as listas do Google Tasks." };
    }

    lists.push(...((payload?.items ?? []) as GoogleTaskListPayload[]));
    pageToken = payload?.nextPageToken;
  } while (pageToken);

  return { data: lists, error: null };
}

export async function fetchGoogleTasks(accessToken: string, taskListId: string, options: { updatedMin?: string } = {}) {
  const tasks: GoogleTaskPayload[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "true",
    });
    if (options.updatedMin) params.set("updatedMin", options.updatedMin);
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${baseUrl}/lists/${encodeURIComponent(taskListId)}/tasks?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Erro técnico ao buscar tarefas do Google Tasks:", payload);
      return { data: null, error: "Não foi possível ler tarefas do Google Tasks." };
    }

    tasks.push(...((payload?.items ?? []) as GoogleTaskPayload[]));
    pageToken = payload?.nextPageToken;
  } while (pageToken);

  return { data: tasks, error: null };
}
