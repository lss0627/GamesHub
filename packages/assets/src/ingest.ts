import { createHash, randomUUID } from 'node:crypto';
import { type AssetObjectStore, InMemoryObjectStore } from './object-store';

export class AssetSecurityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'AssetSecurityError';
    this.code = code;
  }
}

const MAX_BYTES = 5 * 1024 * 1024;
const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface ImageUploadInput {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
  licenseText?: string;
  license?: { kind: string; text: string };
}

export type AssetImportStatus = 'pending' | 'imported' | 'failed';

function signatureMatches(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png')
    return (
      bytes.length >= 4 &&
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71
    );
  if (mimeType === 'image/jpeg')
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    );
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

export function validateImageUpload(input: ImageUploadInput): void {
  if (input.bytes.byteLength > MAX_BYTES)
    throw new AssetSecurityError('SIZE_LIMIT', 'Image exceeds the 5 MiB limit');
  if (
    !allowed.has(input.mimeType) ||
    !signatureMatches(input.bytes, input.mimeType)
  )
    throw new AssetSecurityError(
      'MIME_MISMATCH',
      'Declared image type does not match the file signature',
    );
  if (
    (input.width ?? 0) > 8192 ||
    (input.height ?? 0) > 8192 ||
    (input.width ?? 0) * (input.height ?? 0) > 64_000_000
  )
    throw new AssetSecurityError('DECODE_BOMB', 'Image dimensions are unsafe');
  if (!(input.licenseText ?? input.license?.text)?.trim())
    throw new AssetSecurityError(
      'LICENSE_REQUIRED',
      'An upload license declaration is required',
    );
}

export interface IngestedAsset {
  id: string;
  projectId: string;
  createdByRunId: string;
  name: string;
  mediaType: string;
  objectKey: string;
  contentHash: string;
  sizeBytes: number;
  securityStatus: 'approved';
  importStatus: AssetImportStatus;
  licenseText: string;
}

export function ingestImage(
  input: ImageUploadInput & {
    projectId: string;
    createdByRunId: string;
    name: string;
  },
  store = new InMemoryObjectStore(),
): IngestedAsset {
  validateImageUpload(input);
  const upload = store.createUpload(input.projectId, input.name);
  const stored = store.put(upload.objectKey, input.bytes);
  return {
    id: randomUUID(),
    projectId: input.projectId,
    createdByRunId: input.createdByRunId,
    name: input.name,
    mediaType: input.mimeType,
    objectKey: stored.objectKey,
    contentHash: stored.contentHash,
    sizeBytes: input.bytes.byteLength,
    securityStatus: 'approved',
    importStatus: 'pending',
    licenseText: input.licenseText ?? input.license?.text ?? '',
  };
}

export interface AssetScanner {
  scan(bytes: Uint8Array): Promise<{
    clean: boolean;
    reportReference: string;
  }>;
}

interface HttpAssetServiceOptions {
  endpoint: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function assertHttpEndpoint(endpoint: string, code: string): void {
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://'))
    throw new AssetSecurityError(
      code,
      'Asset security service endpoint is invalid',
    );
}

function serviceHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function readServiceBody(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AssetSecurityError(
      'ASSET_SECURITY_SERVICE_INVALID',
      'Asset security service returned malformed JSON',
    );
  }
  if (!response.ok)
    throw new AssetSecurityError(
      'ASSET_SECURITY_SERVICE_FAILED',
      `Asset security service returned HTTP ${response.status}`,
    );
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** Calls an isolated malware-scanning service and fails closed on transport errors. */
export class HttpAssetScanner implements AssetScanner {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpAssetServiceOptions) {
    assertHttpEndpoint(options.endpoint, 'ASSET_SCANNER_ENDPOINT_INVALID');
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async scan(
    bytes: Uint8Array,
  ): Promise<{ clean: boolean; reportReference: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}/scan`, {
        method: 'POST',
        headers: serviceHeaders(this.apiKey),
        body: JSON.stringify({
          bytes_base64: Buffer.from(bytes).toString('base64'),
        }),
        signal: controller.signal,
      });
      const body = await readServiceBody(response);
      if (
        typeof body.clean !== 'boolean' ||
        typeof body.report_reference !== 'string'
      )
        throw new AssetSecurityError(
          'ASSET_SCANNER_RESPONSE_INVALID',
          'Scanner response lacks a clean verdict and report reference',
        );
      return { clean: body.clean, reportReference: body.report_reference };
    } catch (error) {
      if (error instanceof AssetSecurityError) throw error;
      throw new AssetSecurityError(
        'ASSET_SCANNER_UNAVAILABLE',
        'Isolated asset scanner is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface ImageDecoder {
  decodeAndReencode(input: { bytes: Uint8Array; mimeType: string }): Promise<{
    bytes: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
  }>;
}

/** Calls an isolated decoder that returns a freshly encoded image. */
export class HttpImageDecoder implements ImageDecoder {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpAssetServiceOptions) {
    assertHttpEndpoint(options.endpoint, 'ASSET_DECODER_ENDPOINT_INVALID');
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async decodeAndReencode(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}/decode`, {
        method: 'POST',
        headers: serviceHeaders(this.apiKey),
        body: JSON.stringify({
          mime_type: input.mimeType,
          bytes_base64: Buffer.from(input.bytes).toString('base64'),
        }),
        signal: controller.signal,
      });
      const body = await readServiceBody(response);
      const mimeType = body.mime_type;
      const bytesBase64 = body.bytes_base64;
      const width = body.width;
      const height = body.height;
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(String(mimeType)) ||
        typeof bytesBase64 !== 'string' ||
        typeof width !== 'number' ||
        typeof height !== 'number'
      )
        throw new AssetSecurityError(
          'ASSET_DECODER_RESPONSE_INVALID',
          'Decoder response is incomplete',
        );
      return {
        bytes: new Uint8Array(Buffer.from(bytesBase64, 'base64')),
        mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
        width,
        height,
      };
    } catch (error) {
      if (error instanceof AssetSecurityError) throw error;
      throw new AssetSecurityError(
        'ASSET_DECODER_UNAVAILABLE',
        'Isolated image decoder is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function ingestImageDurable(
  input: ImageUploadInput & {
    projectId: string;
    createdByRunId: string;
    name: string;
  },
  store: AssetObjectStore,
  scanner: AssetScanner,
  decoder: ImageDecoder,
): Promise<IngestedAsset & { scanReportReference: string }> {
  validateImageUpload(input);
  const scan = await scanner.scan(new Uint8Array(input.bytes));
  if (!scan.clean)
    throw new AssetSecurityError(
      'MALWARE_DETECTED',
      'Asset scanner rejected the upload',
    );
  const encoded = await decoder.decodeAndReencode({
    bytes: new Uint8Array(input.bytes),
    mimeType: input.mimeType,
  });
  validateImageUpload({
    ...input,
    bytes: encoded.bytes,
    mimeType: encoded.mimeType,
    width: encoded.width,
    height: encoded.height,
  });
  const upload = store.createUpload(input.projectId, input.name);
  const stored = await store.put(upload.objectKey, encoded.bytes, {
    contentType: encoded.mimeType,
    scanReportReference: scan.reportReference,
  });
  return {
    id: randomUUID(),
    projectId: input.projectId,
    createdByRunId: input.createdByRunId,
    name: input.name,
    mediaType: encoded.mimeType,
    objectKey: stored.objectKey,
    contentHash: stored.contentHash,
    sizeBytes: encoded.bytes.byteLength,
    securityStatus: 'approved',
    importStatus: 'pending',
    licenseText: input.licenseText ?? input.license?.text ?? '',
    scanReportReference: scan.reportReference,
  };
}

export function contentHash(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

export function scanAndReencodeImage(input: ImageUploadInput): Uint8Array {
  validateImageUpload(input);
  // The fixture has no native decoder; production replaces this with an
  // isolated decode/re-encode implementation before Unity import.
  return new Uint8Array(input.bytes);
}
