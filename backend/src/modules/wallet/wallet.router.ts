import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as walletService from './wallet.service';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await walletService.getBalance(req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
