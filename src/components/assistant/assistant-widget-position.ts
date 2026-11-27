export type AssistantBubblePosition = {
  x: number
  y: number
}

const BUBBLE_SIZE = 48
const VIEWPORT_MARGIN = 12

export function clampAssistantBubblePosition(
  position: AssistantBubblePosition,
  viewportWidth: number,
  viewportHeight: number,
): AssistantBubblePosition {
  return {
    x: Math.min(
      Math.max(VIEWPORT_MARGIN, position.x),
      Math.max(VIEWPORT_MARGIN, viewportWidth - BUBBLE_SIZE - VIEWPORT_MARGIN),
    ),
    y: Math.min(
      Math.max(VIEWPORT_MARGIN, position.y),
      Math.max(VIEWPORT_MARGIN, viewportHeight - BUBBLE_SIZE - VIEWPORT_MARGIN),
    ),
  }
}
