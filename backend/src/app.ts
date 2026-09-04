// backend/src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { healthRouter } from './routes/health.routes';
import salonRouter from './routes/salon.routes';
import queueRouter from './routes/queue.routes';
import queueTicketRouter from './routes/ticket.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use('/api/health', healthRouter);

  // Future routers (Milestone 2+):
  app.use('/api/salons', salonRouter);
  app.use('/api/queues', queueRouter);
  app.use('/api/queue-tickets', queueTicketRouter);
  // app.use('/api/auth/barber', barberAuthRouter);
  // app.use('/api/barber', barberRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}