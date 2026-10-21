import { describe, expect, it } from 'vitest';

import { sortTranscriptionsNewestFirst } from './transcription-order';

const call = (
  id: string,
  started_at: string | null,
  ended_at: string | null,
  created_at = '2026-10-21T10:00:00.000Z'
) => ({ id, started_at, ended_at, created_at });

describe('sortTranscriptionsNewestFirst', () => {
  it('orders by call start, not by varying call end times', () => {
    const calls = [
      call(
        'longer',
        '2026-10-21T10:10:00.000Z',
        '2026-10-21T10:30:00.000Z'
      ),
      call(
        'newer',
        '2026-10-21T10:20:00.000Z',
        '2026-10-21T10:21:00.000Z'
      ),
    ];

    expect(sortTranscriptionsNewestFirst(calls).map(({ id }) => id)).toEqual([
      'newer',
      'longer',
    ]);
  });

  it('puts calls without a start time last and uses end time as a fallback', () => {
    const calls = [
      call('missing-old', null, '2026-10-20T10:00:00.000Z'),
      call('started', '2026-10-21T10:00:00.000Z', null),
      call('missing-new', null, '2026-10-21T09:00:00.000Z'),
    ];

    expect(sortTranscriptionsNewestFirst(calls).map(({ id }) => id)).toEqual([
      'started',
      'missing-new',
      'missing-old',
    ]);
  });

  it('keeps ties stable across pages using creation time and row id', () => {
    const calls = [
      call('a', '2026-10-21T10:00:00.000Z', null, '2026-10-21T10:00:00Z'),
      call('b', '2026-10-21T10:00:00.000Z', null, '2026-10-21T10:00:00Z'),
      call('c', '2026-10-21T10:00:00.000Z', null, '2026-10-21T10:01:00Z'),
    ];

    expect(sortTranscriptionsNewestFirst(calls).map(({ id }) => id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
});
