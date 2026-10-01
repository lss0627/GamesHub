export interface ReapRun {
  id: string;
  leaseExpiresAt?: string;
  status: string;
}

export function reapExpiredLeases(
  runs: ReapRun[],
  now = Date.now(),
): { expiredRunIds: string[]; quarantinedLeaseIds: string[] } {
  const expiredRunIds = runs
    .filter(
      (run) =>
        run.leaseExpiresAt &&
        Date.parse(run.leaseExpiresAt) <= now &&
        ![
          'succeeded',
          'partially_succeeded',
          'failed',
          'cancelled',
          'timed_out',
        ].includes(run.status),
    )
    .map((run) => run.id);
  return {
    expiredRunIds,
    quarantinedLeaseIds: expiredRunIds.map((id) => `lease:${id}`),
  };
}
