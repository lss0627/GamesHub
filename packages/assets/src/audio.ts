import { randomUUID } from 'node:crypto';
import {
  type AssetScanner,
  AssetSecurityError,
  type IngestedAsset,
} from './ingest';
import type { AssetObjectStore } from './object-store';

/** Bounded PCM-only decoder. Rebuild the container, discarding all metadata chunks. */
export function canonicalWav(input: Uint8Array): {
  bytes: Buffer;
  duration: number;
} {
  const fail = (): never => {
    throw new AssetSecurityError(
      'AUDIO_INVALID',
      'Requires valid 16-bit mono/stereo PCM WAV, 8–48 kHz, at most 60 seconds / 5 MiB',
    );
  };
  const b = Buffer.from(input);
  if (
    b.length < 44 ||
    b.length > 5 * 1024 * 1024 ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WAVE' ||
    b.readUInt32LE(4) + 8 !== b.length
  )
    fail();
  let format: Buffer | undefined, samples: Buffer | undefined;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const kind = b.toString('ascii', pos, pos + 4),
      size = b.readUInt32LE(pos + 4),
      end = pos + 8 + size;
    if (end > b.length) fail();
    if (kind === 'fmt ') {
      if (format || size < 16) fail();
      format = b.subarray(pos + 8, end);
    }
    if (kind === 'data') {
      if (samples) fail();
      samples = b.subarray(pos + 8, end);
    }
    pos = end + (size % 2);
  }
  if (pos !== b.length || !format || !samples?.length) return fail();
  const channels = format.readUInt16LE(2),
    rate = format.readUInt32LE(4),
    align = channels * 2;
  if (
    format.readUInt16LE(0) !== 1 ||
    ![1, 2].includes(channels) ||
    rate < 8000 ||
    rate > 48000 ||
    format.readUInt16LE(14) !== 16 ||
    format.readUInt16LE(12) !== align ||
    format.readUInt32LE(8) !== rate * align ||
    samples.length % align !== 0 ||
    samples.length / align / rate > 60
  )
    fail();
  const out = Buffer.alloc(44 + samples.length);
  out.write('RIFF');
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  format.copy(out, 20, 0, 16);
  out.write('data', 36);
  out.writeUInt32LE(samples.length, 40);
  samples.copy(out, 44);
  return { bytes: out, duration: samples.length / align / rate };
}
export async function ingestAudio(
  input: {
    projectId: string;
    createdByRunId: string;
    name: string;
    bytes: Uint8Array;
    licenseText?: string;
  },
  store: AssetObjectStore,
  scanner?: AssetScanner,
): Promise<IngestedAsset> {
  if (!input.licenseText?.trim())
    throw new AssetSecurityError('LICENSE_REQUIRED', 'License required');
  const { bytes } = canonicalWav(input.bytes);
  const scan = scanner ? await scanner.scan(bytes) : undefined;
  if (scan && !scan.clean)
    throw new AssetSecurityError('MALWARE_DETECTED', 'Rejected audio');
  const upload = store.createUpload(input.projectId, input.name);
  const stored = await store.put(upload.objectKey, bytes, {
    contentType: 'audio/wav',
    ...(scan ? { scanReportReference: scan.reportReference } : {}),
  });
  return {
    id: randomUUID(),
    projectId: input.projectId,
    createdByRunId: input.createdByRunId,
    name: input.name,
    mediaType: 'audio/wav',
    objectKey: stored.objectKey,
    contentHash: stored.contentHash,
    sizeBytes: bytes.length,
    securityStatus: 'approved',
    importStatus: 'pending',
    licenseText: input.licenseText,
  };
}
