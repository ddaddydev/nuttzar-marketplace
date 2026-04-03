import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { crateCooldown, crateBurstLimit } from '../../../middleware/crateRateLimit';
import * as cratesService from './crates.service';

const router = Router();

// GET /api/v1/games/crates
// Returns active crates with items (no weights, no values)
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await cratesService.listCrates();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/games/crates/:crateId/open
// Opens a crate — deducts cost, rolls winner server-side, returns result
// Middleware stack: auth → 750ms cooldown → 10/5s burst limit
router.post(
  '/:crateId/open',
  requireAuth,
  crateCooldown,
  crateBurstLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const crateId = parseInt(req.params.crateId, 10);
      if (isNaN(crateId)) {
        res.status(400).json({ success: false, error: 'Invalid crate ID' });
        return;
      }

      const result = await cratesService.openCrate(req.user!.userId, crateId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
