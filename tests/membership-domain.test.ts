import { describe, expect, it } from 'vitest'
import { calculateEndDate, hasSportConflict, normalizeSport, snapshotPackage } from '../src/memberships/policy.js'

const now = new Date('2026-09-24T00:00:00.000Z')
const membership = (sportType: string, overrides: Partial<{ startDate: Date; endDate: Date; status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' }> = {}) => ({
  sportType, startDate: overrides.startDate ?? new Date(now.getTime() - 1000), endDate: overrides.endDate ?? new Date(now.getTime() + 1000), status: overrides.status ?? 'ACTIVE',
})

describe('membership sport conflict policy', () => {
  it('trims and case-normalizes Vietnamese sport names', () => expect(normalizeSport('  YOGA ')).toBe(normalizeSport('yoga')))
  it.each([
    ['same sport ignoring case and spaces', ' Yoga ', [membership('yOgA')], true],
    ['different sport', 'Gym', [membership('Yoga')], false],
    ['all-sports candidate conflicts with specific sport', ' Toàn diện ', [membership('Boxing')], true],
    ['specific sport conflicts with all-sports membership', 'Yoga', [membership('toàn diện')], true],
    ['expired membership does not conflict', 'Yoga', [membership('Yoga', { endDate: now })], false],
    ['future membership does not conflict', 'Yoga', [membership('Yoga', { startDate: new Date(now.getTime() + 1) })], false],
    ['cancelled membership does not conflict', 'Yoga', [membership('Yoga', { status: 'CANCELLED' })], false],
  ])('%s', (_label, candidate, memberships, expected) => {
    expect(hasSportConflict(candidate as string, memberships as ReturnType<typeof membership>[], now)).toBe(expected)
  })

  it('calculates an exact 24-hour-day duration', () => {
    expect(calculateEndDate(now, 30).getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('copies the displayed package values into immutable membership snapshot fields', () => {
    expect(snapshotPackage({ name: 'Annual Access', sportType: 'Toàn diện', durationDays: 365, price: 6000000 })).toEqual({
      packageNameSnapshot: 'Annual Access', sportTypeSnapshot: 'Toàn diện', durationDaysSnapshot: 365, listedPriceSnapshot: 6000000,
    })
  })
})
