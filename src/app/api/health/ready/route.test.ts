import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  databaseCheck: vi.fn(),
  storageCheck: vi.fn(),
}));

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

import { NextRequest } from 'next/server';
import { GET } from './route';

const healthcheckSecret = 'test-healthcheck-secret';

function request(secret?: string) {
  return new NextRequest('https://nexoomni.example/api/health/ready', {
    headers: secret ? { 'x-healthcheck-secret': secret } : {},
  });
}

beforeEach(() => {
  process.env.HEALTHCHECK_SECRET = healthcheckSecret;
  mocks.databaseCheck.mockReset().mockResolvedValue({ error: null });
  mocks.storageCheck.mockReset().mockResolvedValue({ error: null });
  mocks.supabaseAdmin.mockReset().mockReturnValue({
    from: () => ({
      select: () => ({ limit: mocks.databaseCheck }),
    }),
    storage: { listBuckets: mocks.storageCheck },
  });
});

describe('readiness health route', () => {
  it('hides the endpoint when the configured secret is missing or incorrect', async () => {
    delete process.env.HEALTHCHECK_SECRET;
    const missingSecretResponse = await GET(request(healthcheckSecret));
    expect(missingSecretResponse.status).toBe(404);
    expect(missingSecretResponse.headers.get('cache-control')).toBe('no-store');

    process.env.HEALTHCHECK_SECRET = healthcheckSecret;
    const incorrectSecretResponse = await GET(request('incorrect-secret'));
    expect(incorrectSecretResponse.status).toBe(404);
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled();
  });

  it('reports readiness only when both database and storage checks succeed', async () => {
    const response = await GET(request(healthcheckSecret));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'ok', storage: 'ok' },
    });
    expect(mocks.databaseCheck).toHaveBeenCalledWith(1);
    expect(mocks.storageCheck).toHaveBeenCalledOnce();
  });

  it.each([
    ['database', 'databaseCheck', { database: 'failed', storage: 'ok' }],
    ['storage', 'storageCheck', { database: 'ok', storage: 'failed' }],
  ] as const)(
    'reports degraded readiness when the %s check fails',
    async (_name, failedCheck, checks) => {
      mocks[failedCheck].mockResolvedValueOnce({
        error: new Error('private dependency details'),
      });

      const response = await GET(request(healthcheckSecret));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: 'degraded',
        checks,
      });
    }
  );
});
