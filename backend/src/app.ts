// backend/src/app.ts
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { healthRouter } from './routes/health.routes';
import salonRouter from './routes/salon.routes';
import queueRouter from './routes/queue.routes';
import queueTicketRouter from './routes/ticket.routes';
import barberAuthRouter from './routes/auth.routes';
import barberRouter from './routes/barber.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createRateLimiters } from './middleware/rateLimit';

export function createApp(opts: { rateLimits?: boolean; clientDir?: string } = {}) {
  const useLimits = opts.rateLimits ?? env.NODE_ENV !== 'test';

  // Where the built frontend lives. Off in local development (Vite serves it there).
  const clientDir =
    opts.clientDir ?? (env.SERVE_FRONTEND ? path.resolve(__dirname, '../../frontend/dist') : undefined);
  if (clientDir && !fs.existsSync(path.join(clientDir, 'index.html'))) {
    throw new Error(`SERVE_FRONTEND is on but ${clientDir}/index.html was not found. Build the frontend first.`);
  }
  const app = express();

  // Behind a host's proxy every request looks like the proxy's IP unless this is set,
  // which would make every customer share ONE rate-limit bucket.
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // the app opens a websocket back to its own address
          'connect-src': ["'self'", 'wss:'],
        },
      },
    }),
  );

  // After CORS so a 429 still carries CORS headers (otherwise the browser shows an opaque network error).
  // Before body parsing so floods are rejected cheaply.
  if (useLimits) {
    const limits = createRateLimiters();
    app.use('/api', limits.global);
    app.get('/api/salons/nearby', limits.nearby);
    app.post('/api/queues/:salonId/join', limits.join);
    app.use('/api/queue-tickets', limits.ticket);
    app.post('/api/auth/barber/login', limits.login);
  }

  app.use(express.json({ limit: '10kb' })); // every body here is tiny
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.get('/api/push-config', (_req, res) => {
    const enabled = env.NOTIFICATION_PROVIDER === 'webpush' && !!env.VAPID_PUBLIC_KEY;
    res.json({ enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY : null });
  });
  app.use('/api/salons', salonRouter);
  app.use('/api/queues', queueRouter);
  app.use('/api/queue-tickets', queueTicketRouter);
  app.use('/api/auth/barber', barberAuthRouter);
  app.use('/api/barber', barberRouter);
  if (clientDir) {
    app.use(
      express.static(clientDir, {
        index: false, // the page itself is served by the fallback below, with its own caching rule
        setHeaders(res, filePath) {
          if (path.basename(filePath) === 'sw.js') {
            res.setHeader('Cache-Control', 'no-cache'); // a stale service worker would never update
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // hashed file names
          }
        },
      }),
    );
    // Any other page address (a refresh on /tickets/..., a tapped notification) gets the app.
    // API and websocket paths never do.
    app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      // Ticket links carry a secret token and the barber pages are private: keep both out of search engines.
      if (/^\/(tickets|barber)(\/|$)/.test(req.path)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}