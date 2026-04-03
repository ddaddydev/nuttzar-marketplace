import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import { adminOnly } from '../../middleware/adminOnly';
import { prisma } from '../../db/client';
import { adminAdjustCredits } from '../wallet/wallet.service';

const router = Router();

// All admin routes require auth + ADMIN role
router.use(requireAuth, adminOnly);

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const users = await prisma.user.findMany({
      take: limit,
      skip: offset,
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        wallet: { select: { credits: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { users } });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/users/:userId/credits',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        delta: z.number().int(),
        reason: z.string().min(1),
      });
      const { delta } = schema.parse(req.body);
      const userId = parseInt(req.params.userId, 10);
      const result = await adminAdjustCredits(userId, delta, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ── Crates ────────────────────────────────────────────────────────────────────

router.get('/crates', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const crates = await prisma.crate.findMany({
      include: { items: true }, // Includes weights — admin only
    });
    res.json({ success: true, data: { crates } });
  } catch (err) {
    next(err);
  }
});

router.post('/crates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      price: z.number().int().positive(),
      items: z
        .array(
          z.object({
            name: z.string().min(1),
            value: z.number().int().positive(),
            weight: z.number().int().positive(),
          }),
        )
        .min(1),
    });
    const body = schema.parse(req.body);
    const crate = await prisma.crate.create({
      data: {
        name: body.name,
        description: body.description,
        price: body.price,
        items: { create: body.items },
      },
      include: { items: true },
    });
    res.status(201).json({ success: true, data: { crate } });
  } catch (err) {
    next(err);
  }
});

router.patch('/crates/:crateId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      price: z.number().int().positive().optional(),
      isActive: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    const crateId = parseInt(req.params.crateId, 10);
    const crate = await prisma.crate.update({
      where: { id: crateId },
      data: body,
      include: { items: true },
    });
    res.json({ success: true, data: { crate } });
  } catch (err) {
    next(err);
  }
});

// ── Game Config ───────────────────────────────────────────────────────────────

router.get('/games/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await prisma.gameConfig.findMany();
    res.json({ success: true, data: { configs } });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/games/config/:gameType',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({ config: z.record(z.unknown()) });
      const { config } = schema.parse(req.body);
      const gameType = req.params.gameType as never;
      const jsonConfig = config as Prisma.InputJsonValue;
      const updated = await prisma.gameConfig.upsert({
        where: { gameType },
        create: { gameType, config: jsonConfig, updatedBy: req.user!.userId },
        update: { config: jsonConfig, updatedBy: req.user!.userId },
      });
      res.json({ success: true, data: { config: updated } });
    } catch (err) {
      next(err);
    }
  },
);

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(0);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();

    const [totals, popularGames, activeUsers] = await Promise.all([
      prisma.gameHistory.aggregate({
        where: { createdAt: { gte: from, lte: to } },
        _sum: { betAmount: true, resultAmount: true },
        _count: true,
      }),
      prisma.gameHistory.groupBy({
        by: ['gameType'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
        _sum: { betAmount: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.gameHistory.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
      }),
    ]);

    const totalBets = totals._sum.betAmount ?? 0;
    const totalPayout = Math.max(0, (totals._sum.resultAmount ?? 0) + totalBets);
    const houseEdgeRealized =
      totalBets > 0
        ? (((totalBets - totalPayout) / totalBets) * 100).toFixed(2) + '%'
        : '0%';

    res.json({
      success: true,
      data: {
        totalBets,
        totalPayout,
        houseEdgeRealized,
        roundCount: totals._count,
        popularGames,
        uniqueActiveUsers: activeUsers.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Crate Logs / Fulfillment ──────────────────────────────────────────────────

// List pending (and optionally all) crate wins awaiting shipment
router.get('/crate-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string) || 'PENDING';
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const where: Record<string, unknown> = {};
    if (status !== 'ALL') where.status = status;

    const [logs, total] = await Promise.all([
      prisma.crateLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, username: true } },
          crate: { select: { name: true } },
          item: { select: { name: true, tornId: true, isRwWeapon: true } },
        },
      }),
      prisma.crateLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        logs: logs.map((l) => ({
          id: l.id,
          username: l.user.username,
          userId: l.userId,
          crateName: l.crate.name,
          itemName: l.item.name,
          tornId: l.item.tornId,
          isRwWeapon: l.item.isRwWeapon,
          itemValue: l.itemValue,
          isHighValue: l.itemValue > 1_000_000, // highlight flag for admin UI
          status: l.status,
          createdAt: l.createdAt,
          sentAt: l.sentAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Mark a crate log as sent
router.patch(
  '/crate-logs/:logId/send',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logId = parseInt(req.params.logId, 10);
      const log = await prisma.crateLog.update({
        where: { id: logId },
        data: { status: 'SENT', sentAt: new Date() },
        include: {
          user: { select: { username: true } },
          item: { select: { name: true } },
        },
      });

      console.log(
        `[Admin ${req.user!.userId}] marked crate log ${logId} as SENT`,
        `(${log.user.username} → ${log.item.name})`,
      );

      res.json({ success: true, data: { id: log.id, status: log.status, sentAt: log.sentAt } });
    } catch (err) {
      next(err);
    }
  },
);

// Admin: EV check for a specific crate
router.get(
  '/crates/:crateId/ev',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { getCrateEV } = await import('../games/crates/crates.service');
      const crateId = parseInt(req.params.crateId, 10);
      const result = await getCrateEV(crateId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ── Crate Item Management ─────────────────────────────────────────────────

router.patch(
  '/crates/:crateId/items/:itemId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        name:       z.string().min(1).optional(),
        value:      z.number().int().min(0).optional(),
        weight:     z.number().int().positive().optional(),
        tornId:     z.number().int().positive().nullable().optional(),
        isRwWeapon: z.boolean().optional(),
        isKey:      z.boolean().optional(),
        keyAmount:  z.number().int().positive().optional(),
        rarity:     z.enum(['common', 'uncommon', 'rare', 'legendary']).optional(),
      });
      const body   = schema.parse(req.body);
      const itemId = parseInt(req.params.itemId, 10);
      const item   = await prisma.crateItem.update({ where: { id: itemId }, data: body });
      res.json({ success: true, data: { item } });
    } catch (err) { next(err); }
  },
);

router.post(
  '/crates/:crateId/items',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = z.object({
        name:       z.string().min(1),
        value:      z.number().int().min(0),
        weight:     z.number().int().positive(),
        tornId:     z.number().int().positive().nullable().optional(),
        isRwWeapon: z.boolean().optional(),
        isKey:      z.boolean().optional(),
        keyAmount:  z.number().int().positive().optional(),
        rarity:     z.enum(['common', 'uncommon', 'rare', 'legendary']),
      });
      const body    = schema.parse(req.body);
      const crateId = parseInt(req.params.crateId, 10);
      const item    = await prisma.crateItem.create({ data: { ...body, crateId } });
      res.status(201).json({ success: true, data: { item } });
    } catch (err) { next(err); }
  },
);

router.delete(
  '/crates/:crateId/items/:itemId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const itemId = parseInt(req.params.itemId, 10);
      await prisma.crateItem.delete({ where: { id: itemId } });
      res.json({ success: true, data: { deleted: itemId } });
    } catch (err) { next(err); }
  },
);

// One-time: fix tornIds for existing crate items
router.post('/fix-torn-ids', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const updates = [
      { name: 'Bottle of Beer',     tornId: 180  },
      { name: 'Bag of Bon Bons',    tornId: 37   },
      { name: 'Gold Ring',          tornId: 53   },
      { name: 'Bottle of Sake',     tornId: 294  },
      { name: 'Drug Pack',          tornId: 370  },
      { name: 'Cardholder',         tornId: 1079 },
      { name: 'Billfold',           tornId: 1080 },
      { name: 'Shark Fin',          tornId: 1485 },
      { name: 'Can of Goose Juice', tornId: 985  },
      { name: 'FHC',                tornId: 367  },
    ];
    const results = await Promise.all(
      updates.map(({ name, tornId }) =>
        prisma.crateItem.updateMany({ where: { name, tornId: null }, data: { tornId } }),
      ),
    );
    const total = results.reduce((s, r) => s + r.count, 0);
    res.json({ success: true, data: { updated: total } });
  } catch (err) {
    next(err);
  }
});

export default router;
