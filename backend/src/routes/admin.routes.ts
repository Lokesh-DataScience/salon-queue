// backend/src/routes/admin.routes.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireAdminRole } from '../middleware/admin.middleware';
import { getAdminMe, getSectionStatus } from '../controllers/admin.controller';
import { getOverview } from '../controllers/founder.controller';
import {
  getSalons,
  getSalonDetail,
  postSalon,
  postSuspension,
  postInternal,
  postStaffPassword,
  removeSalon,
} from '../controllers/founderSalons.controller';
import { getActivity, patchSalesInfo } from '../controllers/sales.controller';
import { getOnboardingFunnel } from '../controllers/onboarding.controller';
import { getLeads, postLead, patchLead, removeLead } from '../controllers/leads.controller';
import { getHealth } from '../controllers/tech.controller';
import { getEvents } from '../controllers/techEvents.controller';
import { getTeam, postTeam, deleteTeam, getAudit } from '../controllers/founderTeam.controller';

const router = Router();

router.use(requireAuth); // a normal signed-in barber session is the starting point

router.get('/me', requireAdminRole(), getAdminMe);

// One sub-router per section. The guard sits on the sub-router, so every route a later
// slice adds inside it is protected automatically.
const founder = Router();
founder.use(requireAdminRole('FOUNDER'));
founder.get('/', getSectionStatus('founder'));
founder.get('/overview', getOverview); // Slice 1
// Slice 2: salon management
founder.get('/salons', getSalons);
founder.post('/salons', postSalon);
founder.get('/salons/:salonId', getSalonDetail);
founder.post('/salons/:salonId/suspension', postSuspension);
founder.post('/salons/:salonId/internal', postInternal);
founder.delete('/salons/:salonId', removeSalon);
founder.post('/staff/:staffId/password', postStaffPassword);
// Slice 3: team (admin roles) and audit log
founder.get('/team', getTeam);
founder.post('/team', postTeam);
founder.delete('/team/:staffId', deleteTeam);
founder.get('/audit', getAudit);

const sales = Router();
sales.use(requireAdminRole('SALES'));
sales.get('/', getSectionStatus('sales'));
// Slice 4: salon activity, churn risk, areas, partner flag + notes
sales.get('/activity', getActivity);
sales.patch('/salons/:salonId/info', patchSalesInfo);
sales.get('/onboarding', getOnboardingFunnel); // Slice 5
// Slice 6: leads
sales.get('/leads', getLeads);
sales.post('/leads', postLead);
sales.patch('/leads/:leadId', patchLead);
sales.delete('/leads/:leadId', removeLead);

const tech = Router();
tech.use(requireAdminRole('TECH'));
tech.get('/', getSectionStatus('tech'));
tech.get('/health', getHealth); // Slice 7
tech.get('/events', getEvents); // Slice 8

router.use('/founder', founder);
router.use('/sales', sales);
router.use('/tech', tech);

export default router;
