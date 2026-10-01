import { createHash, randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StoredObject, UploadRequest } from './object-store';

export interface S3ObjectStoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  client?: S3Client;
}

function createS3Client(options: S3ObjectStoreOptions): S3Client {
  const config: S3ClientConfig = {
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  };
  return new S3Client(config);
}

export async function ensureS3Bucket(
  options: S3ObjectStoreOptions,
): Promise<'created' | 'existing'> {
  const client = options.client ?? createS3Client(options);
  const ownsClient = options.client === undefined;
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: options.bucket }));
      return 'existing';
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: options.bucket }));
      return 'created';
    }
  } finally {
    if (ownsClient) client.destroy();
  }
}

function assertKey(objectKey: string): void {
  if (
    !objectKey.startsWith('assets/') ||
    objectKey.includes('..') ||
    objectKey.includes('\r') ||
    objectKey.includes('\n') ||
    objectKey.includes('\0')
  )
    throw new Error('OBJECT_KEY_SCOPE_INVALID');
}

function assertProjectName(projectId: string, name: string): void {
  if (!projectId || /[\\/]/.test(projectId) || projectId.includes('..'))
    throw new Error('OBJECT_KEY_SCOPE_INVALID');
  if (!name.trim()) throw new Error('OBJECT_NAME_REQUIRED');
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (
    body &&
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    return new Uint8Array(await body.transformToByteArray());
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>)
      chunks.push(
        typeof chunk === 'string'
          ? new TextEncoder().encode(chunk)
          : new Uint8Array(chunk),
      );
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  throw new Error('OBJECT_BODY_INVALID');
}

export class S3ObjectStore {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3ObjectStoreOptions) {
    if (
      !options.endpoint.startsWith('http://') &&
      !options.endpoint.startsWith('https://')
    )
      throw new Error('OBJECT_STORAGE_ENDPOINT_INVALID');
    if (
      !options.region ||
      !options.bucket ||
      !options.accessKeyId ||
      !options.secretAccessKey
    )
      throw new Error('OBJECT_STORAGE_CONFIG_REQUIRED');
    this.bucket = options.bucket;
    this.client = options.client ?? createS3Client(options);
  }

  createUpload(projectId: string, name: string): UploadRequest {
    assertProjectName(projectId, name);
    return {
      uploadId: randomUUID(),
      objectKey: `assets/${projectId}/${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      contentHashAlgorithm: 'sha256',
    };
  }

  async put(
    objectKey: string,
    bytes: Uint8Array,
    metadata: Record<string, string> = {},
  ): Promise<StoredObject> {
    assertKey(objectKey);
    const copy = new Uint8Array(bytes);
    const contentHash = `sha256-${createHash('sha256').update(copy).digest('hex')}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: copy,
        ContentType: metadata.contentType,
        Metadata: { ...metadata, sha256: contentHash },
      }),
    );
    return {
      objectKey,
      contentHash,
      bytes: copy,
      createdAt: new Date().toISOString(),
    };
  }

  async get(objectKey: string): Promise<StoredObject> {
    assertKey(objectKey);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    const bytes = await bodyBytes(response.Body);
    const metadata = response.Metadata ?? {};
    const contentHash =
      metadata.sha256 ??
      `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
    return {
      objectKey,
      contentHash,
      bytes,
      createdAt:
        response.LastModified?.toISOString() ?? new Date().toISOString(),
    };
  }

  async head(
    objectKey: string,
  ): Promise<{ objectKey: string; contentHash: string; sizeBytes: number }> {
    assertKey(objectKey);
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      objectKey,
      contentHash: response.Metadata?.sha256 ?? '',
      sizeBytes: response.ContentLength ?? 0,
    };
  }

  async signedReadUrl(objectKey: string, expiresIn = 900): Promise<string> {
    assertKey(objectKey);
    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 3600)
      throw new Error('OBJECT_URL_EXPIRY_INVALID');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn },
    );
  }
}
