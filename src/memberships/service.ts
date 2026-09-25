import { Prisma, type MembershipPackage } from '@prisma/client'
import { prisma } from '../prisma.js'
import { calculateEndDate, hasSportConflict, snapshotPackage } from './policy.js'

export class MembershipFailure extends Error {
  constructor(readonly code: string) { super(code) }
}

export function serializeMembership(membership: {
  id: number
  packageId: number | null
  packageNameSnapshot: string | null
  sportTypeSnapshot: string | null
  durationDaysSnapshot: number | null
  listedPriceSnapshot: number | null
  startDate: Date
  endDate: Date
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
  package?: Pick<MembershipPackage, 'name' | 'sportType' | 'durationDays' | 'price'> | null
}, now = new Date()) {
  return {
    id: membership.id,
    packageId: membership.packageId,
    packageName: membership.packageNameSnapshot ?? membership.package?.name ?? null,
    sportType: membership.sportTypeSnapshot ?? membership.package?.sportType ?? null,
    durationDays: membership.durationDaysSnapshot ?? membership.package?.durationDays ?? null,
    listedPrice: membership.listedPriceSnapshot ?? membership.package?.price ?? null,
    startDate: membership.startDate.toISOString(),
    endDate: membership.endDate.toISOString(),
    status: membership.status === 'ACTIVE' && membership.endDate <= now ? 'EXPIRED' : membership.status,
  }
}

export async function listMemberships(memberId: number) {
  const rows = await prisma.membership.findMany({ where: { userId: memberId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { package: true } })
  const now = new Date()
  return rows.map((row) => serializeMembership(row, now))
}

export async function registerMembership(memberId: number, packageId: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const pkg = await transaction.membershipPackage.findUnique({ where: { id: packageId } })
        if (!pkg) throw new MembershipFailure('PACKAGE_NOT_FOUND')
        if (pkg.status !== 'ACTIVE') throw new MembershipFailure('PACKAGE_NOT_AVAILABLE')
        const now = new Date()
        const active = await transaction.membership.findMany({
          where: { userId: memberId, status: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } },
          select: { sportTypeSnapshot: true, package: { select: { sportType: true } }, startDate: true, endDate: true, status: true },
        })
        if (hasSportConflict(pkg.sportType, active.map((row) => ({ ...row, sportType: row.sportTypeSnapshot ?? row.package?.sportType ?? null })), now)) {
          throw new MembershipFailure('SPORT_MEMBERSHIP_CONFLICT')
        }
        const membership = await transaction.membership.create({
          data: {
            userId: memberId,
            packageId: pkg.id,
            ...snapshotPackage(pkg),
            startDate: now,
            endDate: calculateEndDate(now, pkg.durationDays),
            status: 'ACTIVE',
          },
          include: { package: true },
        })
        return serializeMembership(membership, now)
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      if (error instanceof MembershipFailure) throw error
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue
      throw error
    }
  }
  throw new MembershipFailure('SPORT_MEMBERSHIP_CONFLICT')
}
