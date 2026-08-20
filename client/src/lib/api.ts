import type {
  ActivityEntry, DayDetails, Project, ProjectSummary, Task, TaskStatus, User,
} from './types';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const post = <T,>(url: string, body?: unknown) =>
  request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T,>(url: string) => request<T>(url, { method: 'DELETE' });

export interface TaskInput {
  phaseId?: number;
  name?: string;
  status?: TaskStatus;
  selectedDates?: string[];
  notes?: string;
  assigneeId?: number | null;
  dependsOn?: number[];
}

export const api = {
  login: (username: string, password: string) =>
    post<{ user: User }>('/api/auth/login', { username, password }).then((r) => r.user),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  me: () => request<{ user: User }>('/api/auth/me').then((r) => r.user),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/auth/change-password', { currentPassword, newPassword }),

  users: () => request<{ users: User[] }>('/api/users').then((r) => r.users),
  allUsers: () => request<{ users: User[] }>('/api/users/all').then((r) => r.users),
  createUser: (body: {
    username: string; name: string; email: string; password: string; role: 'pm' | 'user';
  }) => post<{ user: User }>('/api/users', body).then((r) => r.user),
  updateUser: (id: number, body: Partial<User> & { password?: string }) =>
    patch<{ user: User }>(`/api/users/${id}`, body).then((r) => r.user),
  deactivateUser: (id: number) => del<{ ok: true }>(`/api/users/${id}`),

  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects').then((r) => r.projects),
  project: (id: number) => request<{ project: Project }>(`/api/projects/${id}`).then((r) => r.project),
  activity: (id: number) =>
    request<{ activity: ActivityEntry[] }>(`/api/projects/${id}/activity`).then((r) => r.activity),
  createProject: (body: {
    name: string; company: string; location: string; client: string;
    description: string; startDate: string; phasePics: (number | null)[];
  }) => post<{ project: Project }>('/api/projects', body).then((r) => r.project),
  updateProject: (id: number, body: Record<string, unknown>) =>
    patch<{ project: Project }>(`/api/projects/${id}`, body).then((r) => r.project),
  deleteProject: (id: number) => del<{ ok: true }>(`/api/projects/${id}`),

  addPhase: (projectId: number, name: string, picUserId: number | null) =>
    post<{ phaseId: number }>('/api/phases', { projectId, name, picUserId }),
  updatePhase: (id: number, body: { name?: string; picUserId?: number | null }) =>
    patch<{ ok: true }>(`/api/phases/${id}`, body),
  deletePhase: (id: number) => del<{ ok: true }>(`/api/phases/${id}`),

  createTask: (body: TaskInput & { phaseId: number; name: string }) =>
    post<{ taskId: number }>('/api/tasks', body),
  updateTask: (id: number, body: TaskInput) => patch<{ ok: true }>(`/api/tasks/${id}`, body),
  deleteTask: (id: number) => del<{ ok: true }>(`/api/tasks/${id}`),
  reorderTasks: (phaseId: number, order: number[]) =>
    post<{ ok: true }>('/api/tasks/reorder', { phaseId, order }),

  dayDetails: (taskId: number, day: string) =>
    request<DayDetails>(`/api/tasks/${taskId}/days/${day}`),
  addDayComment: (taskId: number, day: string, body: string) =>
    post<{ commentId: number }>(`/api/tasks/${taskId}/days/${day}/comments`, { body }),
  deleteDayComment: (id: number) => del<{ ok: true }>(`/api/day-comments/${id}`),
  deleteDayFile: (id: number) => del<{ ok: true }>(`/api/day-files/${id}`),
  async uploadDayFile(taskId: number, day: string, file: File): Promise<void> {
    const res = await fetch(`/api/tasks/${taskId}/days/${day}/files`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        'x-file-mime': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
  },
};

/** Files are stored in the database; deployments cap request bodies near 4.5MB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type { Task };
