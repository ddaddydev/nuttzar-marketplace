import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/client';
import { env } from '../../config/env';
import { AppError, AuthError, ValidationError } from '../../utils/errors';
import type { JwtPayload } from '../../middleware/auth';

const BCRYPT_ROUNDS = 12;

function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export async function register(
  username: string,
  password: string,
): Promise<{ userId: number; token: string; refreshToken: string }> {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new ValidationError('Username already taken');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      wallet: { create: { credits: 0 } },
      leaderboardEntry: { create: {} },
    },
  });

  const payload: JwtPayload = { userId: user.id, role: user.role };
  return {
    userId: user.id,
    token: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function login(
  username: string,
  password: string,
): Promise<{ userId: number; token: string; refreshToken: string }> {
  const user = await prisma.user.findUnique({ where: { username } });
  // Use constant-time comparison regardless of whether user exists
  const hash = user?.passwordHash ?? '$2a$12$invalidhashinvalidhashinvalidhash';
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) throw new AuthError('Invalid username or password');

  const payload: JwtPayload = { userId: user.id, role: user.role };
  return {
    userId: user.id,
    token: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function refresh(
  refreshToken: string,
): Promise<{ token: string }> {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
  } catch {
    throw new AuthError('Invalid or expired refresh token');
  }

  // Confirm user still exists and role hasn't changed
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true },
  });
  if (!user) throw new AuthError('User no longer exists');

  return { token: signAccessToken({ userId: user.id, role: user.role }) };
}
