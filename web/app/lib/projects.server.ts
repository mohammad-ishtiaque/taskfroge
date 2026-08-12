import { callApi } from './api.server';

export type VisibilityPreset = 'OPEN' | 'SUMMARY' | 'CUSTOM';
export type Role = 'PROJECT_MANAGER' | 'DEVELOPER' | 'CLIENT';

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  _count: { members: number };
}

export interface ProjectMemberView {
  id: string;
  addedAt: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
}

export interface ProjectDetail extends Omit<ProjectSummary, '_count'> {
  visibility: {
    preset: VisibilityPreset;
    showBoard: boolean;
    showAssignees: boolean;
    showDueDates: boolean;
    showTimeTracking: boolean;
    showBlockedReasons: boolean;
    showAttachments: boolean;
  } | null;
  members: ProjectMemberView[];
  invitations: { id: string; email: string; role: Role; expiresAt: string }[];
}

export const listProjects = (request: Request) =>
  callApi<ProjectSummary[]>('/projects', { request });

export const getProject = (request: Request, key: string) =>
  callApi<ProjectDetail>(`/projects/${encodeURIComponent(key)}`, { request });

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  memberships: { role: Role }[];
}

/**
 * People in the workspace who are not yet on this project.
 *
 * The counterpart to invitations: invite is for someone with no account,
 * this is for someone who already has one. Without it the only way to staff a
 * project is to email people who are already sitting next to you.
 */
export const listAssignable = (request: Request, key: string) =>
  callApi<AssignableUser[]>(`/projects/${encodeURIComponent(key)}/assignable`, { request });
