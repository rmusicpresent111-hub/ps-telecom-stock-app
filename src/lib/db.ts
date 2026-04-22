import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Check if cached client has all required models
// If not, discard the stale cache and create a fresh instance
const cachedClient = globalForPrisma.prisma
const hasAllModels = cachedClient && 'cashEntry' in cachedClient && 'expense' in cachedClient

export const db = hasAllModels
  ? cachedClient
  : new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
