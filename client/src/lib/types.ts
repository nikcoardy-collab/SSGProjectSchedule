export type Role = 'pm' | 'user';

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChange: boolean;
}

export type TaskStatus = 'Not Started' | 'In Progress' | 'Complete' | 'Blocked';
export type ProjectStatus = 'Active' | 'On Hold' | 'Complete' | 'Cancelled';

export interface Task {
  id: number;
  phaseId: number;
  name: string;
  status: TaskStatus;
  startDate: string | null;
  endDate: string | null;
  selectedDates: string[];
  assigneeId: number | null;
  assigneeName: string | null;
  notes: string;
  position: number;
  updatedAt: string;
}

export interface Phase {
  id: number;
  projectId: number;
  name: string;
  position: number;
  picUserId: number | null;
  picName: string | null;
  picUsername: string | null;
  tasks: Task[];
}

export interface Project {
  id: number;
  name: string;
  company: string;
  location: string;
  client: string;
  description: string;
  startDate: string;
  status: ProjectStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
  phases: Phase[];
}

export interface ProjectSummary {
  id: number;
  name: string;
  company: string;
  location: string;
  client: string;
  startDate: string;
  status: ProjectStatus;
  position: number;
  taskCount: number;
  doneCount: number;
  firstDay: string | null;
  lastDay: string | null;
  isPic: boolean;
}

export interface ActivityEntry {
  id: number;
  userName: string;
  action: string;
  detail: string;
  createdAt: string;
}

export const TASK_STATUSES: TaskStatus[] = ['Not Started', 'In Progress', 'Complete', 'Blocked'];
export const PROJECT_STATUSES: ProjectStatus[] = ['Active', 'On Hold', 'Complete', 'Cancelled'];
