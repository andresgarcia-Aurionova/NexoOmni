import { redirect } from 'next/navigation';

import { AiCreditBalance } from '@/components/account/ai-credit-balance';
import { requireEntitlement } from '@/lib/account/entitlements';
import { ForbiddenError } from '@/lib/auth/account';

export default async function CreditsPage() {
  try {
    await requireEntitlement('ai_credits', 'supervisor');
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect('/dashboard?access_denied=1');
    }
    throw error;
  }

  return <AiCreditBalance />;
}
