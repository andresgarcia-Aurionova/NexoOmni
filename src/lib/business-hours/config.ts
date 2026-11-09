import { z } from 'zod'
import { closurePeriodStart } from './schedule'

const businessHoursSchema = z.object({
  connectorId: z.string().uuid(),
  enabled: z.boolean(),
  timezone: z.string().min(1).max(100),
  windows: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    start: z.string(),
    end: z.string(),
  })).min(1).max(7),
  holidays: z.array(z.string()).max(1000),
  message: z.string().trim().min(1).max(4096),
}).superRefine((value, ctx) => {
  try {
    closurePeriodStart(value, new Date())
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid business-hours schedule' })
  }
})

export function parseBusinessHours(input: unknown) {
  return businessHoursSchema.safeParse(input)
}
