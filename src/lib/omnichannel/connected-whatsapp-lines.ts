export interface ConnectedWhatsAppLine {
  id: string
  displayName: string
}

export async function fetchConnectedWhatsAppLines(signal?: AbortSignal): Promise<ConnectedWhatsAppLine[]> {
  const response = await fetch('/api/omnichannel/zernio/connectors', { signal })
  if (!response.ok) throw new Error(`Connector request failed (${response.status})`)
  const body: { connectors?: Array<{ id: string; displayName: string | null; provider: string }> } = await response.json()
  if (!Array.isArray(body.connectors)) throw new Error('Invalid connector response')
  return body.connectors
    .filter((line) => line.provider === 'zernio_whatsapp')
    .map((line) => ({ id: line.id, displayName: line.displayName || line.id }))
}
