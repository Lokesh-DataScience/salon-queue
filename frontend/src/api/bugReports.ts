// frontend/src/api/bugReports.ts
// "Report a problem" for barbers. Each barber sees only their own reports.
import { apiFetch } from './client';

export type BugKind = 'bug' | 'idea' | 'question';
export type BugStatus = 'new' | 'investigating' | 'fixed' | 'wont_fix';

export interface MyBugReport {
  id: string;
  createdAt: string;
  kind: BugKind;
  message: string;
  status: BugStatus;
  techNote: string;
}

export function fetchMyBugReports() {
  return apiFetch<{ reports: MyBugReport[] }>('/api/barber/bug-reports').then((r) => r.reports);
}

export function sendBugReport(input: { kind: BugKind; message: string; page?: string; device?: string }) {
  return apiFetch<{ report: MyBugReport }>('/api/barber/bug-reports', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.report);
}
