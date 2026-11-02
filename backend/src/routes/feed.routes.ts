// backend/src/routes/feed.routes.ts
import { Router } from 'express';
import { getReverseGeocode, getSalonFeed } from '../controllers/feed.controller';

export const feedRouter = Router(); // mounted at /api/salons
feedRouter.get('/:salonId/feed', getSalonFeed);

export const geoRouter = Router(); // mounted at /api/geo
geoRouter.get('/reverse', getReverseGeocode);