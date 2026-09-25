import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const target = process.argv[2] ?? 'integration'
const allowed = new Map([
  ['integration', 'membership-tests.db'],
  ['e2e', 'membership-e2e.db'],
  ['e2e-server', 'membership-e2e.db'],
])
const filename = allowed.get(target)
if (!filename) throw new Error('Expected integration or e2e database target')
const root = process.cwd()
if (!root.endsWith(`${sep}sports-center-management-be`)) throw new Error('Database reset must run from the backend repository root')
const dataDirectory = resolve(root, 'prisma', 'data')
const dbPath = resolve(dataDirectory, filename)
if (!dbPath.startsWith(`${dataDirectory}${sep}`)) throw new Error('Refusing database path outside prisma/data')
const databaseUrl = `file:./data/${filename}`
process.env.DATABASE_URL = databaseUrl
mkdirSync(dataDirectory, { recursive: true })
rmSync(dbPath, { force: true })
for (const suffix of ['-journal', '-shm', '-wal']) rmSync(`${dbPath}${suffix}`, { force: true })

function run(args: string[]) {
  const cliPath = args[0] === 'prisma' ? 'node_modules/prisma/build/index.js' : 'node_modules/tsx/dist/cli.mjs'
  const result = spawnSync(process.execPath, [resolve(root, cliPath), ...args.slice(1)], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['prisma', 'migrate', 'deploy'])
run(['tsx', 'prisma/seed.ts'])
if (target === 'e2e-server') {
  const server = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    server.once('error', reject)
    server.once('exit', (code) => resolveExit(code ?? 1))
  })
  process.exit(exitCode)
}
