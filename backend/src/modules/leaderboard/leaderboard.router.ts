import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as leaderboardService from './leaderboard.service';

const router = Router();

router.get('/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sortBy = (req.query.by as string) || 'gambled';
    const limit = Math.max(1, parseInt((req.query.limit as string) || '50', 10));
    const result = await leaderboardService.getLeaderboard(sortBy, limit);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/recent-wins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.max(1, parseInt((req.query.limit as string) || '20', 10));
    const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
    const result = await leaderboardService.getRecentWins(limit, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/history', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.max(1, parseInt((req.query.limit as string) || '50', 10));
    const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));
    const gameType = req.query.gameType as string | undefined;
    const result = await leaderboardService.getMyHistory(
      req.user!.userId,
      limit,
      offset,
      gameType,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
