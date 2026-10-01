import { createHash, randomUUID } from 'node:crypto';

export interface UploadRequest {
  uploadId: string;
  objectKey: string;
  contentHashAlgorithm: 'sha256';
}

export interface StoredObject {
  objectKey: string;
  contentHash: string;
  bytes: Uint8Array;
  createdAt: string;
}

export interface AssetObjectStore {
  createUpload(projectId: string, name: string): UploadRequest;
  put(
    objectKey: string,
    bytes: Uint8Array,
    metadata?: Record<string, string>,
  ): StoredObject | Promise<StoredObject>;
  get(objectKey: string): StoredObject | Promise<StoredObject>;
}

export class InMemoryObjectStore implements AssetObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  createUpload(projectId: string, name: string): UploadRequest {
    if (!projectId || /[\\/]/.test(projectId) || projectId.includes('..'))
      throw new Error('OBJECT_KEY_SCOPE_INVALID');
    if (!name.trim()) throw new Error('OBJECT_NAME_REQUIRED');
    return {
      uploadId: randomUUID(),
      objectKey: `assets/${projectId}/${randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      contentHashAlgorithm: 'sha256',
    };
  }

  put(
    objectKey: string,
    bytes: Uint8Array,
    _metadata?: Record<string, string>,
  ): StoredObject {
    if (!objectKey.startsWith('assets/') || objectKey.includes('..'))
      throw new Error('OBJECT_KEY_SCOPE_INVALID');
    const stored = {
      objectKey,
      bytes: new Uint8Array(bytes),
      contentHash: `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
      createdAt: new Date().toISOString(),
    };
    this.objects.set(objectKey, stored);
    return structuredClone(stored);
  }

  get(objectKey: string): StoredObject {
    const stored = this.objects.get(objectKey);
    if (!stored) throw new Error('OBJECT_NOT_FOUND');
    return structuredClone(stored);
  }
}
