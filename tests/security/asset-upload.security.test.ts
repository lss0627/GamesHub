import { AssetSecurityError, validateImageUpload } from '@gamerhub/assets';
import { describe, expect, it } from 'vitest';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe('asset upload security', () => {
  it('rejects MIME spoofing and oversized/decode-bomb images', () => {
    expect(() =>
      validateImageUpload({
        bytes: png,
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
        licenseText: 'owned',
      }),
    ).toThrow(AssetSecurityError);
    expect(() =>
      validateImageUpload({
        bytes: new Uint8Array(6 * 1024 * 1024),
        mimeType: 'image/png',
        width: 1,
        height: 1,
        licenseText: 'owned',
      }),
    ).toThrow(/SIZE_LIMIT/);
    expect(() =>
      validateImageUpload({
        bytes: png,
        mimeType: 'image/png',
        width: 100000,
        height: 100000,
        licenseText: 'owned',
      }),
    ).toThrow(/DECODE_BOMB/);
  });

  it('requires a license for uploaded content', () => {
    expect(() =>
      validateImageUpload({
        bytes: png,
        mimeType: 'image/png',
        width: 1,
        height: 1,
      }),
    ).toThrow(/LICENSE_REQUIRED/);
  });
});
