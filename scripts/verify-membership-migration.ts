import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { PrismaClient } from '@prisma/client'

const root = process.cwd()
if (!root.endsWith(`${sep}sports-center-management-be`)) throw new Error('Migration verification must run from the backend repository root')
const directory = resolve(root, 'prisma', 'data')
const filename = 'membership-migration-test.db'
const databasePath = resolve(directory, filename)
if (!databasePath.startsWith(`${directory}${sep}`)) throw new Error('Refusing a database outside prisma/data')
const databaseUrl = `file:./data/${filename}`
const env = { ...process.env, DATABASE_URL: databaseUrl }
mkdirSync(directory, { recursive: true })
rmSync(databasePath, { force: true })
for (const suffix of ['-journal', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true })

function run(args: string[]) {
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/prisma/build/index.js'), ...args], { stdio: 'inherit', env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['db', 'execute', '--file', 'prisma/migrations/20260920142629_init/migration.sql', '--schema', 'prisma/schema.prisma'])
run(['migrate', 'resolve', '--applied', '20260920142629_init', '--schema', 'prisma/schema.prisma'])

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const role = await prisma.role.create({ data: { name: 'MEMBER' } })
const user = await prisma.user.create({ data: { email: 'migration-fixture@test.local', passwordHash: 'unused', displayName: 'Migration fixture', roleId: role.id } })
const pkg = await prisma.membershipPackage.create({ data: { code: 'MIGRATION-FIXTURE', name: 'Snapshot before migration', price: 875000, durationDays: 45, sportType: 'Pilates' } })
await prisma.$executeRawUnsafe('INSERT INTO "Membership" ("userId", "packageId", "startDate", "endDate", "status", "createdAt") VALUES (?, ?, ?, ?, ?, ?)', user.id, pkg.id, '2026-09-01T00:00:00.000Z', '2026-10-16T00:00:00.000Z', 'ACTIVE', '2026-09-01T00:00:00.000Z')
await prisma.$executeRawUnsafe('INSERT INTO "Membership" ("userId", "packageId", "startDate", "endDate", "status", "createdAt") VALUES (?, ?, ?, ?, ?, ?)', user.id, null, '2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'EXPIRED', '2026-08-01T00:00:00.000Z')
await prisma.$disconnect()

run(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'])
const migrated = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const rows = await migrated.membership.findMany({ orderBy: { id: 'asc' } })
await migrated.$disconnect()
const linked = rows[0]
const unlinked = rows[1]
if (linked.packageNameSnapshot !== 'Snapshot before migration' || linked.sportTypeSnapshot !== 'Pilates' || linked.durationDaysSnapshot !== 45 || linked.listedPriceSnapshot !== 875000) throw new Error('Migration did not backfill linked membership snapshots')
if (unlinked.packageNameSnapshot !== null || unlinked.sportTypeSnapshot !== null || unlinked.durationDaysSnapshot !== null || unlinked.listedPriceSnapshot !== null) throw new Error('Migration changed unlinked legacy membership snapshots')
console.log('Migration backfill verified for linked and unlinked memberships.')
