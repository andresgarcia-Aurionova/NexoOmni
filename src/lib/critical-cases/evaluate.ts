import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { buildClassifierPrompt, parseClassification, transcriptForClassifier } from './classify'
import { caseLevelRank, loadCriticalSettings, type CaseLevel } from './settings'

type CurrentCase = { level: string | null; source: string | null }

/** AI may only raise an unclassified/AI level; it never lowers one nor overrides a human decision. */
export function shouldApplyAiLevel(current: CurrentCase, proposed: CaseLevel): boolean {
  if (current.source === 'human') return false
  return caseLevelRank(proposed) > caseLevelRank(current.level)
}

export type EvaluateArgs = { accountId: string; conversationId: string; triggerId?: string }

export async function evaluateCriticalCase(args: EvaluateArgs): Promise<CaseLevel | null> {
  const db = supabaseAdmin()
  const settings = await loadCriticalSettings(db, args.accountId)
  if (!settings.enabled) return null

  const { data: conversation, error } = await db.from('conversations')
    .select('case_level, case_level_source')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (error) throw error
  if (!conversation) return null
  const current = { level: conversation.case_level, source: conversation.case_level_source }
  if (current.source === 'human' || current.level === 'n3') return null

  const config = await loadAiConfig(db, args.accountId)
  if (!config) return null
  const context = await buildConversationContext(db, args.conversationId)
  if (!context.some((message) => message.role === 'user' && message.content.trim())) return null

  const sedeNames = settings.sedes.map((sede) => sede.name)
  const transcript = transcriptForClassifier(context)
  const result = await generateText({
    config,
    task: 'analysis',
    maxOutputTokens: 200,
    systemPrompt: buildClassifierPrompt(sedeNames),
    messages: [{ role: 'user', content: transcript }],
  })
  await logAiUsage(db, {
    accountId: args.accountId,
    conversationId: args.conversationId,
    // Not 'analysis': that mode is counted against the conversation-analysis quotas.
    mode: 'auto_reply',
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    usage: result.usage,
    billingIdempotencyKey: args.triggerId ? `critical-case:${args.triggerId}` : undefined,
  })
  const classification = parseClassification(result.text, sedeNames, transcript)
  if (!shouldApplyAiLevel(current, classification.level)) return null

  // Compare-and-swap on the state read above: a concurrent human correction
  // or higher AI level makes this update match zero rows.
  let update = db.from('conversations')
    .update({
      case_level: classification.level,
      case_level_source: 'ai',
      case_level_reason: classification.reason || null,
      case_sede: classification.sede,
      case_level_set_by: null,
      case_level_set_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
  update = current.level == null ? update.is('case_level', null) : update.eq('case_level', current.level)
  update = current.source == null ? update.is('case_level_source', null) : update.eq('case_level_source', current.source)
  const { data: updated, error: updateError } = await update.select('id').maybeSingle()
  if (updateError) throw updateError
  return updated ? classification.level : null
}

/** Never throws: a classification failure must not break message ingestion. */
export async function evaluateCriticalCaseSafely(args: EvaluateArgs): Promise<void> {
  try {
    await evaluateCriticalCase(args)
  } catch (cause) {
    console.error('[critical-cases] evaluation failed:', cause instanceof Error ? cause.message : cause)
  }
}
