import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadSettings: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'Internal server error' }, { status: 500 })),
}))

vi.mock('@/lib/critical-cases/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/critical-cases/settings')>()
  return { ...original, loadCriticalSettings: mocks.loadSettings }
})

import { PUT } from './route'

const saved = {
  enabled: true,
  templateName: 'alerta_caso_critico',
  templateLanguage: 'es_MX',
  defaultPhones: [],
  sedes: [],
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/critical-cases/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/critical-cases/settings', () => {
  beforeEach(() => {
    mocks.requireRole.mockReset()
    mocks.loadSettings.mockReset()
    mocks.upsert.mockReset()
    const supabase = {
      from: vi.fn(() => ({ upsert: mocks.upsert })),
    }
    mocks.requireRole.mockResolvedValue({
      accountId: 'account-1',
      userId: 'user-1',
      supabase,
    })
    mocks.loadSettings.mockResolvedValue(saved)
    mocks.upsert.mockResolvedValue({ error: null })
  })

  it('saves through the account-scoped RLS client with an explicit conflict target', async () => {
    const response = await PUT(request(saved))

    expect(response.status).toBe(200)
    expect(mocks.loadSettings).toHaveBeenCalledWith(
      expect.any(Object),
      'account-1',
    )
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        enabled: true,
        updated_by: 'user-1',
      }),
      { onConflict: 'account_id' },
    )
  })

  it('returns a safe actionable error when the settings row cannot be saved', async () => {
    mocks.upsert.mockResolvedValue({
      error: {
        code: '42501',
        message: 'database detail',
        details: 'private detail',
      },
    })

    const response = await PUT(request(saved))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'No fue posible guardar las alertas de casos críticos. Inténtalo de nuevo.',
    })
  })
})
