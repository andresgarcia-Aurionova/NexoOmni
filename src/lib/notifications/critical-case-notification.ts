/** Critical-case notifications store the level (n2/n3) in `body`; the UI renders it as N2/N3. */
export function criticalLevelLabel(body: string | null | undefined): string {
  return body === 'n2' || body === 'n3' ? body.toUpperCase() : 'N2+'
}
