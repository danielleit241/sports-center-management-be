import express from 'express'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import swaggerUi from 'swagger-ui-express'
import { z } from 'zod'
import { config } from './config.js'
import { findUser, issueSession, REFRESH_COOKIE, requireMember, revokeRefreshToken, rotateRefreshToken, verifyPassword } from './auth.js'
import { prisma } from './prisma.js'
import { openapiDocument } from './openapi.js'
import {
  createPackageSchema,
  formatPackage,
  requireManager,
  serializeBenefits,
  updatePackageSchema,
} from './packages.js'
import { membershipRouter } from './memberships/routes.js'

const app = express()
app.use(express.json())
app.use(cookieParser())
app.get('/api-docs.json', (_request, response) => response.json(openapiDocument))
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, { explorer: true }))
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', config.frontendOrigin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  if (request.method === 'OPTIONS') return response.sendStatus(204)
  next()
})

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'RATE_LIMITED', message: 'Quá nhiều lần thử đăng nhập' } })
const loginSchema = z.object({ identifier: z.string().min(1), password: z.string().min(8) })

function publicUser(user: { id: number; email: string; phone: string | null; displayName: string; role: { name: string } }) {
  return { id: user.id, email: user.email, phone: user.phone, displayName: user.displayName, role: user.role.name }
}

app.get('/health', (_request, response) => response.json({ status: 'ok' }))

app.post('/api/auth/login', loginLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) return response.status(422).json({ code: 'VALIDATION_ERROR', message: 'Thông tin đăng nhập không hợp lệ', details: parsed.error.flatten() })
  const user = await findUser(parsed.data.identifier)
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return response.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng' })
  if (user.status !== 'ACTIVE') return response.status(403).json({ code: 'ACCOUNT_LOCKED', message: 'Tài khoản của bạn đã bị khóa, vui lòng liên hệ Ban quản lý' })
  const session = await issueSession(user)
  response.cookie(REFRESH_COOKIE, session.refreshToken, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/auth' })
  return response.json({ accessToken: session.accessToken, expiresIn: session.expiresIn, user: publicUser(user) })
})

app.post('/api/auth/refresh', async (request, response) => {
  const token = request.cookies[REFRESH_COOKIE]
  if (!token) return response.status(401).json({ code: 'MISSING_REFRESH_TOKEN', message: 'Refresh token không tồn tại' })
  try {
    const session = await rotateRefreshToken(token)
    response.cookie(REFRESH_COOKIE, session.refreshToken, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/auth' })
    return response.json({ accessToken: session.accessToken, expiresIn: session.expiresIn })
  } catch {
    return response.status(401).json({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token không hợp lệ hoặc đã hết hạn' })
  }
})

app.post('/api/auth/logout', async (request, response) => {
  const token = request.cookies[REFRESH_COOKIE]
  if (token) await revokeRefreshToken(token)
  response.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/api/auth' })
  return response.status(204).send()
})

app.use('/api/memberships', membershipRouter)

app.get('/api/classes', async (request, response) => {
  const memberId = requireMember(request, response, 'Chỉ thành viên mới được đăng ký lớp')
  if (!memberId) return
  const classes = await prisma.classSchedule.findMany({
    where: { status: 'OPEN', startTime: { gt: new Date() } },
    orderBy: { startTime: 'asc' },
    include: { _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } } },
  })
  return response.json(classes.map((classSchedule) => ({
    id: classSchedule.id,
    courseName: classSchedule.courseName,
    classDate: classSchedule.classDate,
    startTime: classSchedule.startTime,
    endTime: classSchedule.endTime,
    room: classSchedule.room,
    capacity: classSchedule.capacity,
    availableSlots: Math.max(classSchedule.capacity - classSchedule._count.registrations, 0),
  })))
})

const registrationSchema = z.object({ classId: z.coerce.number().int().positive() })

app.post('/api/class-registrations', async (request, response) => {
  const memberId = requireMember(request, response, 'Chỉ thành viên mới được đăng ký lớp')
  if (!memberId) return
  const parsed = registrationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(422).json({ code: 'VALIDATION_ERROR', message: 'classId không hợp lệ', details: parsed.error.flatten() })

  try {
    const registration = await prisma.$transaction(async (transaction) => {
      const classSchedule = await transaction.classSchedule.findUnique({ where: { id: parsed.data.classId } })
      if (!classSchedule || classSchedule.status !== 'OPEN') throw new Error('CLASS_NOT_FOUND')
      const now = new Date()
      const membership = await transaction.membership.findFirst({ where: { userId: memberId, status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } } })
      if (!membership) throw new Error('MEMBERSHIP_INACTIVE')
      const existing = await transaction.classRegistration.findUnique({ where: { userId_classScheduleId: { userId: memberId, classScheduleId: classSchedule.id } } })
      if (existing?.status === 'CONFIRMED') throw new Error('ALREADY_REGISTERED')
      const conflict = await transaction.classRegistration.findFirst({ where: { userId: memberId, status: 'CONFIRMED', classSchedule: { startTime: { lt: classSchedule.endTime }, endTime: { gt: classSchedule.startTime } } } })
      if (conflict) throw new Error('SCHEDULE_CONFLICT')
      const registrationCount = await transaction.classRegistration.count({ where: { classScheduleId: classSchedule.id, status: 'CONFIRMED' } })
      if (registrationCount >= classSchedule.capacity) throw new Error('CLASS_FULL')
      return existing
        ? transaction.classRegistration.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', registeredAt: now, cancelledAt: null } })
        : transaction.classRegistration.create({ data: { userId: memberId, classScheduleId: classSchedule.id } })
    })
    return response.status(201).json({ id: registration.id, classId: registration.classScheduleId, status: registration.status, registeredAt: registration.registeredAt })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'REGISTRATION_FAILED'
    const errors: Record<string, { status: number; message: string }> = {
      CLASS_NOT_FOUND: { status: 404, message: 'Lớp học không tồn tại hoặc đã đóng' },
      MEMBERSHIP_INACTIVE: { status: 403, message: 'Gói tập không còn hiệu lực' },
      ALREADY_REGISTERED: { status: 409, message: 'Bạn đã đăng ký lớp học này' },
      SCHEDULE_CONFLICT: { status: 409, message: 'Lịch học bị trùng với lớp đã đăng ký' },
      CLASS_FULL: { status: 409, message: 'Lớp học đã đủ số lượng' },
    }
    const failure = errors[code] ?? { status: 500, message: 'Không thể đăng ký lớp học' }
    return response.status(failure.status).json({ code, message: failure.message })
  }
})

app.get('/api/auth/me', (request, response) => {
  const authorization = request.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return response.status(401).json({ code: 'UNAUTHENTICATED', message: 'Cần đăng nhập' })
  try {
    const payload = jwt.verify(authorization.slice(7), config.accessSecret) as jwt.JwtPayload & { sub?: string; role?: string }
    return response.json({ userId: Number(payload.sub), role: payload.role })
  } catch {
    return response.status(401).json({ code: 'INVALID_ACCESS_TOKEN', message: 'Access token không hợp lệ hoặc đã hết hạn' })
  }
})

// FR-003 Membership Package Catalog Endpoints

app.get('/api/packages', async (request, response) => {
  const authorization = request.header('authorization')
  let isManager = false
  if (authorization?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authorization.slice(7), config.accessSecret) as jwt.JwtPayload & { role?: string }
      if (payload.role === 'CENTER_MANAGER') isManager = true
    } catch {
      // ignore token error for public package listing
    }
  }

  const { status, sportType, search } = request.query
  const where: Record<string, unknown> = {}

  if (!isManager) {
    // Public and member catalogs always expose active packages only.
    where.status = 'ACTIVE'
  } else if (typeof status === 'string' && status !== 'ALL') {
    where.status = status
  } else if (status !== 'ALL') {
    // Manager default shows ACTIVE and INACTIVE (not ARCHIVED) unless specified
    where.status = { in: ['ACTIVE', 'INACTIVE'] }
  }

  if (typeof sportType === 'string' && sportType.trim()) {
    where.sportType = sportType.trim()
  }

  if (typeof search === 'string' && search.trim()) {
    const query = search.trim()
    where.OR = [
      { name: { contains: query } },
      { code: { contains: query } },
      { description: { contains: query } },
    ]
  }

  const packages = await prisma.membershipPackage.findMany({
    where,
    orderBy: [{ isBestSeller: 'desc' }, { createdAt: 'desc' }],
    include: { _count: { select: { memberships: true } } },
  })

  return response.json(packages.map(formatPackage))
})

app.get('/api/packages/:id', async (request, response) => {
  const id = Number(request.params.id)
  if (isNaN(id) || id <= 0) {
    return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'ID gói tập không hợp lệ' })
  }

  const pkg = await prisma.membershipPackage.findUnique({
    where: { id },
    include: { _count: { select: { memberships: true } } },
  })

  if (!pkg) {
    return response.status(404).json({ code: 'PACKAGE_NOT_FOUND', message: 'Không tìm thấy gói tập yêu cầu' })
  }

  return response.json(formatPackage(pkg))
})

app.post('/api/packages', async (request, response) => {
  const managerId = requireManager(request, response)
  if (!managerId) return

  const parsed = createPackageSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu cấu hình gói tập không hợp lệ',
      details: parsed.error.flatten(),
    })
  }

  const existing = await prisma.membershipPackage.findUnique({
    where: { code: parsed.data.code },
  })
  if (existing) {
    return response.status(409).json({
      code: 'PACKAGE_CODE_EXISTS',
      message: `Mã gói tập '${parsed.data.code}' đã tồn tại trong hệ thống`,
    })
  }

  const created = await prisma.membershipPackage.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description,
      price: parsed.data.price,
      durationDays: parsed.data.durationDays,
      sessionLimit: parsed.data.sessionLimit,
      sportType: parsed.data.sportType,
      benefits: serializeBenefits(parsed.data.benefits),
      isBestSeller: parsed.data.isBestSeller ?? false,
      status: 'ACTIVE',
    },
    include: { _count: { select: { memberships: true } } },
  })

  return response.status(201).json(formatPackage(created))
})

app.patch('/api/packages/:id', async (request, response) => {
  const managerId = requireManager(request, response)
  if (!managerId) return

  const id = Number(request.params.id)
  if (isNaN(id) || id <= 0) {
    return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'ID gói tập không hợp lệ' })
  }

  const parsed = updatePackageSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu cập nhật không hợp lệ',
      details: parsed.error.flatten(),
    })
  }

  const existing = await prisma.membershipPackage.findUnique({ where: { id } })
  if (!existing) {
    return response.status(404).json({ code: 'PACKAGE_NOT_FOUND', message: 'Không tìm thấy gói tập cần cập nhật' })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.description !== undefined) data.description = parsed.data.description
  if (parsed.data.price !== undefined) data.price = parsed.data.price
  if (parsed.data.durationDays !== undefined) data.durationDays = parsed.data.durationDays
  if (parsed.data.sessionLimit !== undefined) data.sessionLimit = parsed.data.sessionLimit
  if (parsed.data.sportType !== undefined) data.sportType = parsed.data.sportType
  if (parsed.data.benefits !== undefined) data.benefits = serializeBenefits(parsed.data.benefits)
  if (parsed.data.isBestSeller !== undefined) data.isBestSeller = parsed.data.isBestSeller
  if (parsed.data.status !== undefined) data.status = parsed.data.status

  const updated = await prisma.membershipPackage.update({
    where: { id },
    data,
    include: { _count: { select: { memberships: true } } },
  })

  return response.json(formatPackage(updated))
})

app.post('/api/packages/:id/activate', async (request, response) => {
  const managerId = requireManager(request, response)
  if (!managerId) return

  const id = Number(request.params.id)
  if (isNaN(id) || id <= 0) {
    return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'ID gói tập không hợp lệ' })
  }

  const existing = await prisma.membershipPackage.findUnique({ where: { id } })
  if (!existing) {
    return response.status(404).json({ code: 'PACKAGE_NOT_FOUND', message: 'Không tìm thấy gói tập' })
  }

  const updated = await prisma.membershipPackage.update({
    where: { id },
    data: { status: 'ACTIVE' },
    include: { _count: { select: { memberships: true } } },
  })

  return response.json(formatPackage(updated))
})

app.post('/api/packages/:id/deactivate', async (request, response) => {
  const managerId = requireManager(request, response)
  if (!managerId) return

  const id = Number(request.params.id)
  if (isNaN(id) || id <= 0) {
    return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'ID gói tập không hợp lệ' })
  }

  const existing = await prisma.membershipPackage.findUnique({ where: { id } })
  if (!existing) {
    return response.status(404).json({ code: 'PACKAGE_NOT_FOUND', message: 'Không tìm thấy gói tập' })
  }

  const updated = await prisma.membershipPackage.update({
    where: { id },
    data: { status: 'INACTIVE' },
    include: { _count: { select: { memberships: true } } },
  })

  return response.json(formatPackage(updated))
})

app.delete('/api/packages/:id', async (request, response) => {
  const managerId = requireManager(request, response)
  if (!managerId) return

  const id = Number(request.params.id)
  if (isNaN(id) || id <= 0) {
    return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'ID gói tập không hợp lệ' })
  }

  const existing = await prisma.membershipPackage.findUnique({
    where: { id },
    include: { _count: { select: { memberships: true } } },
  })
  if (!existing) {
    return response.status(404).json({ code: 'PACKAGE_NOT_FOUND', message: 'Không tìm thấy gói tập' })
  }

  if (existing._count.memberships > 0) {
    return response.status(409).json({
      code: 'PACKAGE_IN_USE',
      message: 'Không thể xóa gói tập đã phát sinh thẻ hội viên sử dụng',
      details: { activeSubscribers: existing._count.memberships },
    })
  }

  await prisma.membershipPackage.update({
    where: { id },
    data: { status: 'ARCHIVED' },
  })

  return response.json({ message: 'Đã lưu trữ gói tập thành công', id })
})

export { app }

if (process.env.NODE_ENV !== 'test') app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`))
