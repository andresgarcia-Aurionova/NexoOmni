import { GET as startConnect } from '@/app/api/omnichannel/zernio/connect/[channel]/route'

export async function GET(request: Request) {
  return startConnect(request, { params: Promise.resolve({ channel: 'telegram' }) })
}
