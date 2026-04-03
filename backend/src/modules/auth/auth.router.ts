import { Router, Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema, refreshSchema } from './auth.schema';
import * as authService from './auth.service';

const router = Router();

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body.username, body.password);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.username, body.password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = refreshSchema.parse(req.body);
    const result = await authService.refresh(body.refreshToken);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
