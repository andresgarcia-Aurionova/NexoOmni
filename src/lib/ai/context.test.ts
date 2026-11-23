import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('uses completed PDF validation instead of the filename', async () => {
    const out = await buildConversationContext(
      fakeDb([{
        sender_type: 'customer',
        content_type: 'document',
        content_text: 'constancia.pdf',
        media_analysis_status: 'completed',
        media_description: 'tipo=constancia de situación fiscal; legible=sí; completo=sí; faltantes=ninguno',
      }]),
      'conv-1',
    )
    expect(out).toEqual([{
      role: 'user',
      content: '[PDF validado: tipo=constancia de situación fiscal; legible=sí; completo=sí; faltantes=ninguno]',
    }])
  })

  it('does not treat an unreadable PDF as validated', async () => {
    const out = await buildConversationContext(
      fakeDb([{
        sender_type: 'customer',
        content_type: 'document',
        content_text: 'ticket.pdf',
        media_analysis_status: 'failed',
        media_analysis_error: 'provider error',
      }]),
      'conv-1',
    )
    expect(out[0]?.content).toContain('no se pudo validar automáticamente')
  })

  it('prioritizes invoice image validation over its caption', async () => {
    const out = await buildConversationContext(
      fakeDb([{
        sender_type: 'customer',
        content_type: 'image',
        content_text: 'Mi constancia',
        media_analysis_status: 'completed',
        media_description: 'tipo=constancia de situación fiscal; legible=sí; completo=no; faltantes=régimen fiscal',
      }]),
      'conv-1',
    )
    expect(out).toEqual([{
      role: 'user',
      content: '[Imagen validada: tipo=constancia de situación fiscal; legible=sí; completo=no; faltantes=régimen fiscal]',
    }])
  })
})
