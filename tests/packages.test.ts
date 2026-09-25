import { createServer, type Server } from 'node:http'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/server.js'
import { config } from '../src/config.js'
import { prisma } from '../src/prisma.js'

type TestUser = { id: number; token: string }

let server: Server
let baseUrl: string

async function createManager(email: string): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CENTER_MANAGER' } })
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash('ChangeMe123!', 4),
      displayName: 'Test Manager',
      roleId: role.id,
    },
  })
  return {
    id: user.id,
    token: jwt.sign({ sub: user.id, role: 'CENTER_MANAGER', type: 'access' }, config.accessSecret, {
      expiresIn: '1h',
    }),
  }
}

async function createMember(email: string): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } })
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash('ChangeMe123!', 4),
      displayName: 'Test Member',
      roleId: role.id,
    },
  })
  return {
    id: user.id,
    token: jwt.sign({ sub: user.id, role: 'MEMBER', type: 'access' }, config.accessSecret, {
      expiresIn: '1h',
    }),
  }
}

async function request(path: string, token?: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string>),
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers })
}

beforeAll(async () => {
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
  await prisma.membership.deleteMany({ where: { user: { email: { startsWith: 'fr003-' } } } })
  await prisma.membershipPackage.deleteMany({ where: { code: { startsWith: 'TEST-' } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'fr003-' } } })
})

afterAll(async () => {
  await prisma.$disconnect()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('FR-003 Membership Package Management', () => {
  it('allows public to list ACTIVE packages only', async () => {
    await prisma.membershipPackage.create({
      data: {
        code: 'TEST-ACT-1',
        name: 'Gói Active Test',
        price: 1000000,
        durationDays: 30,
        sportType: 'Gym',
        status: 'ACTIVE',
      },
    })
    await prisma.membershipPackage.create({
      data: {
        code: 'TEST-INACT-1',
        name: 'Gói Inactive Test',
        price: 1000000,
        durationDays: 30,
        sportType: 'Gym',
        status: 'INACTIVE',
      },
    })

    const response = await request('/api/packages')
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{ code: string; status: string }>
    const testActive = body.find((p) => p.code === 'TEST-ACT-1')
    const testInactive = body.find((p) => p.code === 'TEST-INACT-1')
    expect(testActive).toBeDefined()
    expect(testInactive).toBeUndefined()

    const member = await createMember('fr003-catalog-member@sports-center.local')
    const memberOverride = await request('/api/packages?status=INACTIVE', member.token)
    expect((await memberOverride.json() as Array<{ code: string }>).some((pkg) => pkg.code === 'TEST-INACT-1')).toBe(false)
    const manager = await createManager('fr003-catalog-manager@sports-center.local')
    const managerFilter = await request('/api/packages?status=INACTIVE', manager.token)
    expect((await managerFilter.json() as Array<{ code: string }>).some((pkg) => pkg.code === 'TEST-INACT-1')).toBe(true)
  })

  it('rejects package creation from unauthenticated or non-manager users', async () => {
    const member = await createMember('fr003-member@sports-center.local')

    // Unauthenticated
    const resUnauth = await request('/api/packages', undefined, {
      method: 'POST',
      body: JSON.stringify({
        code: 'TEST-UNAUTH',
        name: 'Test Package',
        price: 500000,
        durationDays: 30,
        sportType: 'Gym',
      }),
    })
    expect(resUnauth.status).toBe(401)

    // Member (not manager)
    const resForbidden = await request('/api/packages', member.token, {
      method: 'POST',
      body: JSON.stringify({
        code: 'TEST-MEMBER',
        name: 'Test Package',
        price: 500000,
        durationDays: 30,
        sportType: 'Gym',
      }),
    })
    expect(resForbidden.status).toBe(403)
    expect(await resForbidden.json()).toMatchObject({ code: 'MANAGER_ACCESS_REQUIRED' })
  })

  it('validates price > 0 and durationDays > 0', async () => {
    const manager = await createManager('fr003-mgr-val@sports-center.local')

    // Price <= 0
    const resInvalidPrice = await request('/api/packages', manager.token, {
      method: 'POST',
      body: JSON.stringify({
        code: 'TEST-NEG-PRICE',
        name: 'Gói giá âm',
        price: -100,
        durationDays: 30,
        sportType: 'Gym',
      }),
    })
    expect(resInvalidPrice.status).toBe(400)
    expect(await resInvalidPrice.json()).toMatchObject({ code: 'VALIDATION_ERROR' })

    // Duration <= 0
    const resInvalidDuration = await request('/api/packages', manager.token, {
      method: 'POST',
      body: JSON.stringify({
        code: 'TEST-NEG-DUR',
        name: 'Gói hạn 0 ngày',
        price: 500000,
        durationDays: 0,
        sportType: 'Gym',
      }),
    })
    expect(resInvalidDuration.status).toBe(400)
    expect(await resInvalidDuration.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('allows Manager to create new package and enforces unique package code', async () => {
    const manager = await createManager('fr003-mgr-create@sports-center.local')

    const createPayload = {
      code: 'TEST-PKG-NEW',
      name: 'Gym Standard 3 Tháng',
      description: 'Gói 3 tháng tiêu chuẩn cho hội viên',
      price: 2500000,
      durationDays: 90,
      sessionLimit: null,
      sportType: 'Gym',
      benefits: ['Tập không giới hạn', 'Tủ đồ thông minh'],
      isBestSeller: true,
    }

    const response = await request('/api/packages', manager.token, {
      method: 'POST',
      body: JSON.stringify(createPayload),
    })

    expect(response.status).toBe(201)
    const created = await response.json()
    expect(created).toMatchObject({
      code: 'TEST-PKG-NEW',
      name: 'Gym Standard 3 Tháng',
      price: 2500000,
      durationDays: 90,
      status: 'ACTIVE',
      isBestSeller: true,
    })
    expect(created.benefits).toEqual(['Tập không giới hạn', 'Tủ đồ thông minh'])

    // Duplicate code
    const duplicateRes = await request('/api/packages', manager.token, {
      method: 'POST',
      body: JSON.stringify(createPayload),
    })
    expect(duplicateRes.status).toBe(409)
    expect(await duplicateRes.json()).toMatchObject({ code: 'PACKAGE_CODE_EXISTS' })
  })

  it('allows Manager to edit, activate, deactivate package', async () => {
    const manager = await createManager('fr003-mgr-toggle@sports-center.local')

    const pkg = await prisma.membershipPackage.create({
      data: {
        code: 'TEST-TOGGLE',
        name: 'Gói Toggle Thử Nghiệm',
        price: 1500000,
        durationDays: 60,
        sportType: 'Yoga',
        status: 'ACTIVE',
      },
    })

    // Edit package
    const patchRes = await request(`/api/packages/${pkg.id}`, manager.token, {
      method: 'PATCH',
      body: JSON.stringify({ price: 1600000, description: 'Đã cập nhật giá' }),
    })
    expect(patchRes.status).toBe(200)
    expect((await patchRes.json()).price).toBe(1600000)

    // Deactivate
    const deactRes = await request(`/api/packages/${pkg.id}/deactivate`, manager.token, { method: 'POST' })
    expect(deactRes.status).toBe(200)
    expect((await deactRes.json()).status).toBe('INACTIVE')

    // Activate
    const actRes = await request(`/api/packages/${pkg.id}/activate`, manager.token, { method: 'POST' })
    expect(actRes.status).toBe(200)
    expect((await actRes.json()).status).toBe('ACTIVE')
  })

  it('blocks deletion/archive if package is linked to active memberships', async () => {
    const manager = await createManager('fr003-mgr-del@sports-center.local')
    const member = await createMember('fr003-subscriber@sports-center.local')

    const pkg = await prisma.membershipPackage.create({
      data: {
        code: 'TEST-LINKED',
        name: 'Gói Đã Có Hội Viên',
        price: 2000000,
        durationDays: 30,
        sportType: 'Boxing',
        status: 'ACTIVE',
      },
    })

    await prisma.membership.create({
      data: {
        userId: member.id,
        packageId: pkg.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 86400000),
        status: 'ACTIVE',
      },
    })

    // Attempt delete
    const deleteRes = await request(`/api/packages/${pkg.id}`, manager.token, { method: 'DELETE' })
    expect(deleteRes.status).toBe(409)
    expect(await deleteRes.json()).toMatchObject({ code: 'PACKAGE_IN_USE' })

    // Unlink membership and delete again
    await prisma.membership.deleteMany({ where: { packageId: pkg.id } })
    const successDelete = await request(`/api/packages/${pkg.id}`, manager.token, { method: 'DELETE' })
    expect(successDelete.status).toBe(200)
  })
})
