import type { SupabaseClient } from '@supabase/supabase-js'

export async function pauseFlowOnAgentReply(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<void> {
  try {
    const { error } = await db.from('flow_runs').update({
      status: 'paused_by_agent',
      ended_at: new Date().toISOString(),
      end_reason: 'agent_replied',
    }).eq('account_id', accountId).eq('conversation_id', conversationId).eq('status', 'active')
    if (error) console.error('[flows] pause-on-agent-send failed:', error.message)
  } catch (error) {
    console.error('[flows] pause-on-agent-send threw:', error)
  }
}
