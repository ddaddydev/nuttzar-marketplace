import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../utils/errors';

export function adminOnly(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    return next(new ForbiddenError('Admin access required'));
  }
  next();
}
