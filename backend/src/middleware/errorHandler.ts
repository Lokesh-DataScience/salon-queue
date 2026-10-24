// backend/src/middleware/errorHandler.ts
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ message: 'Not found.' });
}

// Name + code only. Never err.message / err.details / the object itself:
// database errors can echo the offending row (names, phone numbers).
function describeError(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : 'Error';
  const code = typeof e?.code === 'string' || typeof e?.code === 'number' ? ` code=${e.code}` : '';
  return `${name}${code}`;
}

// Deliberately typed with 4 args so Express recognizes it as an error handler.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      message: 'Invalid request.',
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ message: err.message });
    return;
  }

  // body-parser errors (malformed JSON, oversized body) are client mistakes, not 500s.
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ message: 'Invalid request.' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ message: 'Request too large.' });
    return;
  }

  // req.path excludes the query string, so ?accessToken=... never reaches the log.
  console.error(`[error] ${req.method} ${req.path} ${describeError(err)}`);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
}