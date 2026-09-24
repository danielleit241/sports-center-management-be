import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { User } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from './prisma.js'
import { config } from './config.js'
import type { Request, Response } from 'express'

export const REFRESH_COOKIE = 'sports_center_refresh'
const accessTtlSeconds = 60 * 60
const refreshTtlMs = 7 * 24 * 60 * 60 * 1000

type UserWithRole = User & { role: { name: string } }

export function requireMember(request: Request, response: Response, forbiddenMessage = 'Chỉ thành viên mới được sử dụng chức năng này') {
  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' })
    return null
  }
  try {
    const payload = jwt.verify(authorization.slice(7), config.accessSecret) as jwt.JwtPayload & { sub?: string; role?: string }
    const memberId = Number(payload.sub)
    if (!payload.sub || !Number.isSafeInteger(memberId) || memberId <= 0 || payload.role !== 'MEMBER') {
      response.status(403).json({ code: 'MEMBER_ACCESS_REQUIRED', message: forbiddenMessage })
      return null
    }
    return memberId
  } catch {
    response.status(401).json({ code: 'INVALID_ACCESS_TOKEN', message: 'Access token không hợp lệ hoặc đã hết hạn' })
    return null
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueSession(user: UserWithRole) {
  const accessToken = jwt.sign({ sub: user.id, role: user.role.name, type: 'access' }, config.accessSecret, { expiresIn: accessTtlSeconds })
  const refreshToken = jwt.sign({ sub: user.id, jti: randomUUID(), type: 'refresh' }, config.refreshSecret, { expiresIn: '7d' })
  await prisma.refreshToken.create({ data: { tokenHash: hashToken(refreshToken), userId: user.id, expiresAt: new Date(Date.now() + refreshTtlMs) } })
  return { accessToken, refreshToken, expiresIn: accessTtlSeconds }
}

export async function findUser(identifier: string) {
  return prisma.user.findFirst({ where: { OR: [{ email: identifier }, { phone: identifier }] }, include: { role: true } })
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } })
}

export async function rotateRefreshToken(token: string) {
  const payload = jwt.verify(token, config.refreshSecret) as jwt.JwtPayload & { sub?: string; type?: string }
  if (payload.type !== 'refresh' || !payload.sub) throw new Error('INVALID_REFRESH_TOKEN')
  const stored = await prisma.refreshToken.findFirst({ where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { include: { role: true } } } })
  if (!stored || stored.user.status !== 'ACTIVE') throw new Error('INVALID_REFRESH_TOKEN')
  await revokeRefreshToken(token)
  return issueSession(stored.user)
}
