import { redact } from '@gamerhub/observability';
import { describe, expect, it } from 'vitest';

describe('observability redaction', () => {
  it('removes secrets, license material, paths and prompt credentials', () => {
    const output = JSON.stringify(
      redact({
        token: 'secret',
        licenseFile: '/tmp/license.ulf',
        hostPath: 'D:/host',
        prompt: 'Bearer abc',
      }),
    );
    expect(output).not.toMatch(/secret|license\.ulf|D:\/host|Bearer abc/);
    expect(output).toMatch(/REDACTED/);
  });
});
