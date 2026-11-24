export function getReactionEndpoint(channelType: string | null | undefined): string {
  if (!channelType) return '/api/whatsapp/react'
  const nativeOmnichannel = channelType === 'facebook' || channelType === 'instagram' || channelType.startsWith('zernio_')
  return nativeOmnichannel ? '/api/omnichannel/react' : '/api/whatsapp/react'
}
