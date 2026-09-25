import { createServer, type Server } from 'node:http'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/server.js'
import { config } from '../src/config.js'
import { prisma } from '../src/prisma.js'

let server: Server
let baseUrl: string
let memberId: number
let memberToken: string
let otherToken: string
let managerToken: string
let gymId: number
let yogaId: number
let allId: number
let inactiveId: number
let archivedId: number
let otherYogaId: number

async function createUser(email: string, roleName: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } })
  const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash('ChangeMe123!', 4), displayName: 'Membership test', roleId: role.id } })
  return { id: user.id, token: jwt.sign({ sub: user.id, role: roleName, type: 'access' }, config.accessSecret, { expiresIn: '1h' }) }
}

async function request(path: string, token?: string, method = 'GET', body?: unknown) {
  return fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

beforeAll(async () => {
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

beforeEach(async () => {
  await prisma.membership.deleteMany({ where: { user: { email: { startsWith: 'membership-api-' } } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'membership-api-' } } })
  await prisma.membershipPackage.deleteMany({ where: { code: { startsWith: 'SUB-TEST-' } } })
  const member = await createUser(`membership-api-member-${Date.now()}@test.local`, 'MEMBER')
  const other = await createUser(`membership-api-other-${Date.now()}@test.local`, 'MEMBER')
  const manager = await createUser(`membership-api-manager-${Date.now()}@test.local`, 'CENTER_MANAGER')
  memberId = member.id; memberToken = member.token; otherToken = other.token; managerToken = manager.token
  const pkg = (code: string, sportType: string, status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' = 'ACTIVE') => prisma.membershipPackage.create({ data: { code, name: `${code} name`, price: 420000, durationDays: 30, sportType, status } })
  gymId = (await pkg('SUB-TEST-GYM', 'Gym')).id
  yogaId = (await pkg('SUB-TEST-YOGA', 'Yoga')).id
  otherYogaId = (await pkg('SUB-TEST-YOGA-ALT', ' yOgA ')).id
  allId = (await pkg('SUB-TEST-ALL', 'Toàn diện')).id
  inactiveId = (await pkg('SUB-TEST-INACTIVE', 'Boxing', 'INACTIVE')).id
  archivedId = (await pkg('SUB-TEST-ARCHIVED', 'Zumba', 'ARCHIVED')).id
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

describe('member memberships API', () => {
  it('requires a member token to read and register', async () => {
    expect((await request('/api/memberships')).status).toBe(401)
    expect((await request('/api/memberships', managerToken, 'GET')).status).toBe(403)
    expect((await request('/api/memberships', undefined, 'POST', { packageId: gymId })).status).toBe(401)
    expect((await request('/api/memberships', managerToken, 'POST', { packageId: gymId })).status).toBe(403)
  })

  it('registers immediately and retains package snapshots after catalog edits', async () => {
    const response = await request('/api/memberships', memberToken, 'POST', { packageId: gymId })
    expect(response.status).toBe(201)
    const created = await response.json() as Record<string, unknown>
    expect(created).toMatchObject({ packageId: gymId, packageName: 'SUB-TEST-GYM name', sportType: 'Gym', durationDays: 30, listedPrice: 420000, status: 'ACTIVE' })
    expect(Date.parse(String(created.startDate))).toBeLessThanOrEqual(Date.now())
    expect(Date.parse(String(created.endDate)) - Date.parse(String(created.startDate))).toBe(30 * 24 * 60 * 60 * 1000)
    await prisma.membershipPackage.update({ where: { id: gymId }, data: { name: 'Changed', sportType: 'Changed', durationDays: 2, price: 10 } })
    const history = await request('/api/memberships', memberToken)
    expect(await history.json()).toMatchObject([{ packageName: 'SUB-TEST-GYM name', sportType: 'Gym', durationDays: 30, listedPrice: 420000 }])
    expect((await request('/api/memberships', otherToken).then((res) => res.json()) as unknown[])).toHaveLength(0)
  })

  it('allows another sport, while blocking same sport and Toàn diện in either direction', async () => {
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: yogaId })).status).toBe(201)
    const gym = await prisma.membershipPackage.findUniqueOrThrow({ where: { id: gymId } })
    await prisma.membership.create({ data: { userId: memberId, packageId: gym.id, packageNameSnapshot: gym.name, sportTypeSnapshot: gym.sportType, durationDaysSnapshot: gym.durationDays, listedPriceSnapshot: gym.price, startDate: new Date(Date.now() - 1000), endDate: new Date(Date.now() + 60_000) } })
    const duplicate = await request('/api/memberships', memberToken, 'POST', { packageId: gymId })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ code: 'SPORT_MEMBERSHIP_CONFLICT' })
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: allId })).status).toBe(409)
  })

  it('rejects malformed, missing, and inactive package registrations', async () => {
    expect((await request('/api/memberships', memberToken, 'POST', {})).status).toBe(422)
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: '1' })).status).toBe(422)
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: 999999 })).status).toBe(404)
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: inactiveId })).status).toBe(409)
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: archivedId })).status).toBe(409)
    expect((await request('/api/memberships', 'not-a-token')).status).toBe(401)
  })

  it('blocks a specific sport when the member already has Toàn diện', async () => {
    const allSports = await prisma.membershipPackage.findUniqueOrThrow({ where: { id: allId } })
    await prisma.membership.create({ data: { userId: memberId, packageId: allId, sportTypeSnapshot: ' Toàn Diện ', packageNameSnapshot: allSports.name, startDate: new Date(Date.now() - 1000), endDate: new Date(Date.now() + 60_000) } })
    const response = await request('/api/memberships', memberToken, 'POST', { packageId: gymId })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SPORT_MEMBERSHIP_CONFLICT' })
  })

  it('uses linked-package values as legacy fallback and keeps package-less values null', async () => {
    const pkg = await prisma.membershipPackage.findUniqueOrThrow({ where: { id: yogaId } })
    await prisma.membership.create({ data: { userId: memberId, packageId: yogaId, startDate: new Date(Date.now() - 90 * 86400000), endDate: new Date(Date.now() - 1), status: 'ACTIVE' } })
    await prisma.membership.create({ data: { userId: memberId, packageId: null, startDate: new Date(Date.now() - 90 * 86400000), endDate: new Date(Date.now() - 1), status: 'ACTIVE' } })
    const history = await request('/api/memberships', memberToken).then((response) => response.json()) as Array<Record<string, unknown>>
    expect(history).toHaveLength(2)
    expect(history.find((membership) => membership.packageId === yogaId)).toMatchObject({ packageName: pkg.name, sportType: pkg.sportType, durationDays: pkg.durationDays, listedPrice: pkg.price, status: 'EXPIRED' })
    expect(history.find((membership) => membership.packageId === null)).toMatchObject({ packageName: null, sportType: null, durationDays: null, listedPrice: null, status: 'EXPIRED' })
  })

  it('allows expired and cancelled memberships without blocking registration', async () => {
    for (const status of ['EXPIRED', 'CANCELLED'] as const) {
      await prisma.membership.create({ data: { userId: memberId, packageId: yogaId, sportTypeSnapshot: 'Yoga', startDate: new Date(Date.now() - 90 * 86400000), endDate: new Date(Date.now() - 1), status } })
    }
    expect((await request('/api/memberships', memberToken, 'POST', { packageId: yogaId })).status).toBe(201)
  })

  it('rechecks conflicts after simultaneous registrations', async () => {
    const results = await Promise.all([
      request('/api/memberships', memberToken, 'POST', { packageId: yogaId }),
      request('/api/memberships', memberToken, 'POST', { packageId: otherYogaId }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect(await prisma.membership.count({ where: { userId: memberId, status: 'ACTIVE', startDate: { lte: new Date() }, endDate: { gt: new Date() }, sportTypeSnapshot: { in: ['Yoga', ' yOgA '] } } })).toBe(1)
  })
})
