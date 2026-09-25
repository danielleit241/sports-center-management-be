import { Router } from 'express'
import { z } from 'zod'
import { requireMember } from '../auth.js'
import { MembershipFailure, listMemberships, registerMembership } from './service.js'

export const membershipRouter = Router()
const registrationSchema = z.object({ packageId: z.number().int().positive() }).strict()

membershipRouter.get('/', async (request, response) => {
  const memberId = requireMember(request, response)
  if (!memberId) return
  return response.json(await listMemberships(memberId))
})

membershipRouter.post('/', async (request, response) => {
  const memberId = requireMember(request, response)
  if (!memberId) return
  const parsed = registrationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(422).json({ code: 'VALIDATION_ERROR', message: 'packageId không hợp lệ', details: parsed.error.flatten() })
  try {
    const membership = await registerMembership(memberId, parsed.data.packageId)
    return response.status(201).json(membership)
  } catch (error) {
    if (error instanceof MembershipFailure) {
      const failures: Record<string, { status: number; message: string }> = {
        PACKAGE_NOT_FOUND: { status: 404, message: 'Không tìm thấy gói tập yêu cầu' },
        PACKAGE_NOT_AVAILABLE: { status: 409, message: 'Gói tập hiện không khả dụng' },
        SPORT_MEMBERSHIP_CONFLICT: { status: 409, message: 'Bạn đang có gói tập còn hiệu lực cho bộ môn này' },
      }
      const failure = failures[error.code]
      return response.status(failure.status).json({ code: error.code, message: failure.message })
    }
    throw error
  }
})
