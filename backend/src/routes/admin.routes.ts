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

const sales = Router();
sales.use(requireAdminRole('SALES'));
sales.get('/', getSectionStatus('sales'));
// Slice 4: salon activity, churn risk, areas, partner flag + notes
sales.get('/activity', getActivity);
sales.patch('/salons/:salonId/info', patchSalesInfo);

const tech = Router();
tech.use(requireAdminRole('TECH'));
tech.get('/', getSectionStatus('tech'));

router.use('/founder', founder);
router.use('/sales', sales);
router.use('/tech', tech);

export default router;
