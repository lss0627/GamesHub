import { PostgresDomainRepository, type SqlClient } from '@gamerhub/domain';
import { describe, expect, it, vi } from 'vitest';

describe('transaction cleanup', () => {
  it.each(['BEGIN', 'set_config'])(
    'releases connections when %s fails and preserves the original error',
    async (failure) => {
      const original = new Error('connection interrupted');
      const release = vi.fn();
      const query = vi.fn(async (sql: string) => {
        if (sql.includes(failure)) throw original;
        if (sql === 'ROLLBACK') throw new Error('rollback connection lost');
        return { rows: [] };
      });
      const client = { query, release } as SqlClient;
      const repository = new PostgresDomainRepository({
        query,
        connect: async () => client,
      });
      const operation = vi.fn();
      await expect(
        repository.withTenantTransaction('owner', operation),
      ).rejects.toBe(original);
      expect(release).toHaveBeenCalledTimes(1);
      expect(operation).not.toHaveBeenCalled();
    },
  );
});
