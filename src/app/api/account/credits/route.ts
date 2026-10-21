import { NextResponse } from 'next/server';

import { requireEntitlement } from '@/lib/account/entitlements';
import { toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const { accountId, supabase } = await requireEntitlement(
      'ai_conversation_intelligence',
      'supervisor'
    );
    const [{ data: wallet, error: walletError }, { data: ledger, error: ledgerError }] =
      await Promise.all([
        supabase
          .from('ai_credit_wallets')
          .select('available_credits,updated_at')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('ai_credit_ledger')
          .select('id,entry_type,delta_credits,balance_after,created_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

    if (walletError) throw walletError;
    if (ledgerError) throw ledgerError;
    if (!wallet) throw new Error('AI credit wallet is missing for the account.');

    return NextResponse.json(
      {
        balance: String(wallet.available_credits),
        updated_at: wallet.updated_at,
        movements: (ledger ?? []).map((entry) => ({
          id: entry.id,
          entry_type: entry.entry_type,
          delta_credits: String(entry.delta_credits),
          balance_after: String(entry.balance_after),
          created_at: entry.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
