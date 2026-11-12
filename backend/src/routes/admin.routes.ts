// backend/src/routes/admin.routes.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireAdminRole } from '../middleware/admin.middleware';
import { getAdminMe, getSectionStatus } from '../controllers/admin.controller';
import { getOverview } from '../controllers/founder.controller';

const router = Router();

router.use(requireAuth); // a normal signed-in barber session is the starting point

router.get('/me', requireAdminRole(), getAdminMe);

// One sub-router per section. The guard sits on the sub-router, so every route a later
// slice adds inside it is protected automatically.
const founder = Router();
founder.use(requireAdminRole('FOUNDER'));
founder.get('/', getSectionStatus('founder'));
founder.get('/overview', getOverview); // Slice 1

const sales = Router();
sales.use(requireAdminRole('SALES'));
sales.get('/', getSectionStatus('sales'));

const tech = Router();
tech.use(requireAdminRole('TECH'));
tech.get('/', getSectionStatus('tech'));

router.use('/founder', founder);
router.use('/sales', sales);
router.use('/tech', tech);

export default router;
