// backend/src/routes/auth.routes.ts
import { Router } from 'express';
import { postBarberLogin, postBarberRefresh, postBarberLogout } from '../controllers/auth.controller';

const router = Router();

router.post('/login', postBarberLogin);
router.post('/refresh', postBarberRefresh);
router.post('/logout', postBarberLogout);

export default router;