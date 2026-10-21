export type TranscriptionOrderRecord = {
  id: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNewestFirst(
  left: number | null,
  right: number | null
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

export function sortTranscriptionsNewestFirst<
  T extends TranscriptionOrderRecord,
>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const byStartedAt = compareNewestFirst(
      timestamp(left.started_at),
      timestamp(right.started_at)
    );
    if (byStartedAt !== 0) return byStartedAt;

    const byEndedAt = compareNewestFirst(
      timestamp(left.ended_at),
      timestamp(right.ended_at)
    );
    if (byEndedAt !== 0) return byEndedAt;

    const byCreatedAt = compareNewestFirst(
      timestamp(left.created_at),
      timestamp(right.created_at)
    );
    if (byCreatedAt !== 0) return byCreatedAt;

    return right.id.localeCompare(left.id);
  });
}
