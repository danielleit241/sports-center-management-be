import { defineConfig } from 'vitest/config'

if (process.env.DATABASE_URL?.includes('membership-tests.db') === false) throw new Error('Vitest may only use membership-tests.db')
process.env.DATABASE_URL = 'file:./data/membership-tests.db'

export default defineConfig({ test: { environment: 'node', testTimeout: 15_000, fileParallelism: false } })
