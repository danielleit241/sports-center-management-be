import type { MembershipStatus } from '@prisma/client'

export type ActiveMembership = {
  sportType: string | null
  startDate: Date
  endDate: Date
  status: MembershipStatus
}

export function normalizeSport(sportType: string) {
  return sportType.trim().toLocaleLowerCase('vi-VN')
}

function isAllSports(sportType: string | null) {
  return sportType !== null && normalizeSport(sportType) === normalizeSport('Toàn diện')
}

export function hasSportConflict(candidateSport: string, memberships: ActiveMembership[], now: Date) {
  const normalizedCandidate = normalizeSport(candidateSport)
  return memberships.some((membership) => {
    if (membership.status !== 'ACTIVE' || membership.startDate > now || membership.endDate <= now) return false
    const existingSport = membership.sportType
    if (!existingSport) return false
    return isAllSports(candidateSport) || isAllSports(existingSport) || normalizeSport(existingSport) === normalizedCandidate
  })
}

export function calculateEndDate(startDate: Date, durationDays: number) {
  return new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000)
}

export function snapshotPackage(pkg: { name: string; sportType: string; durationDays: number; price: number }) {
  return {
    packageNameSnapshot: pkg.name,
    sportTypeSnapshot: pkg.sportType,
    durationDaysSnapshot: pkg.durationDays,
    listedPriceSnapshot: pkg.price,
  }
}
