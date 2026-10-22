import { describe, expect, it } from 'vitest'
import { rankManuals } from './manual-search'

describe('rankManuals', () => {
  const manuals = [
    { title: 'Conectar WhatsApp', description: 'Configura el canal', content: 'Vincula tu cuenta.' },
    { title: 'Agenda de citas', description: 'Programa citas', content: 'Consulta la agenda.' },
    { title: 'Bandeja compartida', description: 'Atiende mensajes', content: 'Conecta WhatsApp e Instagram.' },
  ]

  it('returns matching manuals ordered by relevance', () => {
    expect(rankManuals(manuals, 'WhatsApp canal')).toEqual([manuals[0], manuals[2]])
  })

  it('returns no results for empty or punctuation-only questions', () => {
    expect(rankManuals(manuals, '   ')).toEqual([])
    expect(rankManuals(manuals, '!?')).toEqual([])
  })

  it('respects the requested result limit', () => {
    expect(rankManuals(manuals, 'WhatsApp', 1)).toEqual([manuals[0]])
  })
})
