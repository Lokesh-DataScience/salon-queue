// backend/src/controllers/admin.controller.ts
import type { Request, Response } from 'express';
import { adminRoleOf } from '../middleware/admin.middleware';
import { sectionsFor, type AdminSection } from '../services/admin.service';

// Who am I as an admin, and which sections can I open.
export function getAdminMe(_req: Request, res: Response) {
  const role = adminRoleOf(res);
  res.json({ role, sections: sectionsFor(role) });
}

// Slice 0 placeholder for each section. Later slices add real routes next to it.
export function getSectionStatus(section: AdminSection) {
  return (_req: Request, res: Response) => {
    res.json({ section, ok: true });
  };
}
