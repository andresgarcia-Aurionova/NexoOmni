import crypto from 'node:crypto'

export function technicalContactPhone(kind: string, source: string) {
  const encoded = crypto.createHash('sha256')
    .update(`${kind}:${source}`)
    .digest('hex')
    .replace(/[0-9]/g, (digit) => String.fromCharCode(71 + Number(digit)))
  return `connected-contact-${encoded}`
}
