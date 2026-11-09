import { describe, expect, it, vi } from 'vitest'
import { dispatchWithBusinessHours } from './dispatch'

describe('dispatchWithBusinessHours', () => {
  it('sends only the notice when closed with no active flow', async () => {
    const flow = vi.fn().mockResolvedValue(false)
    const notice = vi.fn().mockResolvedValue(undefined)
    const others = vi.fn()
    await dispatchWithBusinessHours({ closed: true, runFlow: flow, sendNotice: notice, runOtherResponders: others })
    expect(flow).toHaveBeenCalledWith(false)
    expect(notice).toHaveBeenCalledOnce()
    expect(others).not.toHaveBeenCalled()
  })

  it('allows an active flow to continue when closed', async () => {
    const flow = vi.fn().mockResolvedValue(true)
    const notice = vi.fn()
    const others = vi.fn().mockResolvedValue(undefined)
    await dispatchWithBusinessHours({ closed: true, runFlow: flow, sendNotice: notice, runOtherResponders: others })
    expect(flow).toHaveBeenCalledWith(false)
    expect(notice).not.toHaveBeenCalled()
    expect(others).not.toHaveBeenCalled()
  })

  it('allows normal responders when open', async () => {
    const flow = vi.fn().mockResolvedValue(false)
    const notice = vi.fn()
    const others = vi.fn().mockResolvedValue(undefined)
    await dispatchWithBusinessHours({ closed: false, runFlow: flow, sendNotice: notice, runOtherResponders: others })
    expect(flow).toHaveBeenCalledWith(true)
    expect(notice).not.toHaveBeenCalled()
    expect(others).toHaveBeenCalledWith(false)
  })

  it('does not fall back to another responder on flow or notice errors', async () => {
    const others = vi.fn()
    await expect(dispatchWithBusinessHours({
      closed: true,
      runFlow: vi.fn().mockRejectedValue(new Error('flow')),
      sendNotice: vi.fn(),
      runOtherResponders: others,
    })).rejects.toThrow('flow')
    await expect(dispatchWithBusinessHours({
      closed: true,
      runFlow: vi.fn().mockResolvedValue(false),
      sendNotice: vi.fn().mockRejectedValue(new Error('send')),
      runOtherResponders: others,
    })).rejects.toThrow('send')
    expect(others).not.toHaveBeenCalled()
  })
})
