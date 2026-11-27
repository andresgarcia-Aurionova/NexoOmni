import { describe, expect, it } from 'vitest'

import { clampAssistantBubblePosition } from './assistant-widget-position'

describe('assistant bubble position', () => {
  it('keeps the mobile bubble fully inside the viewport', () => {
    expect(clampAssistantBubblePosition({ x: -40, y: 900 }, 360, 720)).toEqual({
      x: 12,
      y: 660,
    })
  })

  it('preserves an already valid position', () => {
    expect(clampAssistantBubblePosition({ x: 120, y: 240 }, 360, 720)).toEqual({
      x: 120,
      y: 240,
    })
  })
})
