import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';

/**
 * Global error handler — must be the last middleware registered.
 *
 * Never leaks internal error details (stack traces, Prisma messages)
 * to the client in production. All responses use the same shape:
 * { success: false, error: string }
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation error',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // Unexpected error — log internally, never expose to client
  console.error('[Unhandled error]', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
}
