import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface AssistantSource {
  kind: 'platform_manual' | 'account_data' | 'account_knowledge'
  title: string
  href?: string
}

interface ManualDocument {
  title: string
  description: string
  content: string
}

export interface ManualExcerpt {
  title: string
  href?: string
  excerpt: string
}

const EXCLUDED_FILES = new Set(['README.md', '_plantilla.md'])
let documentsPromise: Promise<ManualDocument[]> | null = null

function termsOf(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 2)
    )
  )
}

export function rankManuals<T extends { title: string; description: string; content: string }>(
  manuals: readonly T[],
  query: string,
  limit = 3
): T[] {
  const terms = termsOf(query)
  if (terms.length === 0 || limit <= 0) return []

  return manuals
    .map((manual, index) => {
      const searchable = `${manual.title} ${manual.description} ${manual.content}`.toLocaleLowerCase()
      const score = terms.reduce(
        (total, term) => total + (searchable.includes(term) ? 1 : 0),
        0
      )
      return { manual, index, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.manual)
}

async function walkManuals(directory: string): Promise<ManualDocument[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const documents: ManualDocument[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      if (entry.name === 'changelog' || entry.name.startsWith('_')) continue
      documents.push(...(await walkManuals(path.join(directory, entry.name))))
      continue
    }

    if (
      !entry.isFile() ||
      !entry.name.endsWith('.md') ||
      EXCLUDED_FILES.has(entry.name) ||
      entry.name.startsWith('administrar-')
    ) {
      continue
    }

    const filePath = path.join(directory, entry.name)
    const markdown = await readFile(filePath, 'utf8')
    const title = markdown.match(/^title:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim()
      ?? path.basename(entry.name, '.md')
    const description = markdown.match(/^description:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim()
      ?? ''
    const content = markdown.replace(/^---\s*[\s\S]*?---\s*/m, '').trim()
    documents.push({
      title,
      description,
      content,
    })
  }

  return documents
}

async function loadManuals(): Promise<ManualDocument[]> {
  if (!documentsPromise) {
    const root = path.join(process.cwd(), 'docs', 'manuals')
    documentsPromise = walkManuals(root)
  }
  return documentsPromise
}

export async function searchPlatformManuals(
  query: string,
  limit = 3
): Promise<{ excerpts: ManualExcerpt[]; sources: AssistantSource[] }> {
  const manuals = await loadManuals()
  const matches = rankManuals(manuals, query, limit)
  const excerpts = matches.map((manual) => ({
    title: manual.title,
    excerpt: manual.content.slice(0, 1800),
  }))

  return {
    excerpts,
    sources: excerpts.map(({ title }) => ({
      kind: 'platform_manual',
      title,
    })),
  }
}
