import { prisma } from '../../db/client';
import { ValidationError } from '../../utils/errors';

const VALID_SORT = ['gambled', 'profit'] as const;
type SortBy = (typeof VALID_SORT)[number];

export async function getLeaderboard(
  sortBy: string,
  limit: number,
): Promise<{ entries: object[] }> {
  if (!VALID_SORT.includes(sortBy as SortBy)) {
    throw new ValidationError('Invalid sort field — use "gambled" or "profit"');
  }

  const orderField = sortBy === 'profit' ? 'totalProfit' : 'totalGambled';

  const entries = await prisma.leaderboardEntry.findMany({
    take: Math.min(limit, 100),
    orderBy: { [orderField]: 'desc' },
    include: { user: { select: { username: true } } },
  });

  return {
    entries: entries.map((e, i) => ({
      rank: i + 1,
      username: e.user.username,
      totalGambled: e.totalGambled,
      totalProfit: e.totalProfit,
    })),
  };
}

export async function getRecentWins(
  limit: number,
  userId?: number,
): Promise<{ wins: object[] }> {
  const wins = await prisma.gameHistory.findMany({
    where: {
      resultAmount: { gt: 0 },
      ...(userId ? { userId } : {}),
    },
    take: Math.min(limit, 50),
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { username: true } } },
  });

  return {
    wins: wins.map((w) => ({
      username: w.user.username,
      gameType: w.gameType,
      betAmount: w.betAmount,
      resultAmount: w.resultAmount,
      timestamp: w.createdAt,
    })),
  };
}

export async function getMyHistory(
  userId: number,
  limit: number,
  offset: number,
  gameType?: string,
): Promise<{ history: object[] }> {
  const where: Record<string, unknown> = { userId };
  if (gameType) {
    const validTypes = [
      'CRASH', 'PLINKO', 'HEIST', 'BLACKJACK', 'CRATE',
      'PVP_STASHHOUSE', 'PVP_RPS', 'PVP_PAINTBALL',
    ];
    if (!validTypes.includes(gameType)) {
      throw new ValidationError('Invalid gameType');
    }
    where.gameType = gameType;
  }

  const history = await prisma.gameHistory.findMany({
    where,
    take: Math.min(limit, 100),
    skip: offset,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      gameType: true,
      betAmount: true,
      resultAmount: true,
      metadata: true,
      createdAt: true,
    },
  });

  return { history };
}
