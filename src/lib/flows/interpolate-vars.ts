export function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return ''
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    const value = vars[key]
    return value === undefined || value === null ? '' : String(value)
  })
}
