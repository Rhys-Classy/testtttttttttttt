import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Storage driver interface. Files are never served from a public URL; they are
 * streamed through /api/documents/[id], which checks access with RLS first.
 */
export interface StorageDriver {
  put(subAccountId: string, filename: string, data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalDiskStorage implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(subAccountId: string, filename: string, data: Buffer) {
    const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const key = `${subAccountId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return key;
  }
  get(key: string) { return readFile(this.resolve(key)); }
  async delete(key: string) { await unlink(this.resolve(key)).catch(() => undefined); }
}

/**
 * Netlify Blobs (hosted installs: functions have no persistent disk). Production
 * uses the site-wide store; deploy previews get a per-deploy store so test
 * uploads never mix with real customer files.
 */
class NetlifyBlobsStorage implements StorageDriver {
  private async store() {
    const { getStore, getDeployStore } = await import('@netlify/blobs');
    const context = (globalThis as { Netlify?: { context?: { deploy?: { context?: string } } } }).Netlify?.context?.deploy?.context ?? process.env.CONTEXT;
    return context === 'production' || !context
      ? getStore({ name: 'documents', consistency: 'strong' })
      : getDeployStore('documents');
  }
  async put(subAccountId: string, filename: string, data: Buffer) {
    const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const key = `${subAccountId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    await (await this.store()).set(key, copy.buffer);
    return key;
  }
  async get(key: string) {
    const buf = await (await this.store()).get(key, { type: 'arrayBuffer' });
    if (!buf) throw new Error('File not found in storage');
    return Buffer.from(buf as ArrayBuffer);
  }
  async delete(key: string) { await (await this.store()).delete(key); }
}

let driver: StorageDriver | undefined;
export function storage(): StorageDriver {
  if (!driver) {
    const kind = process.env.STORAGE_DRIVER ?? (process.env.NETLIFY_BLOBS_CONTEXT ? 'netlify-blobs' : 'local');
    driver = kind === 'netlify-blobs' ? new NetlifyBlobsStorage() : new LocalDiskStorage(path.resolve(env().STORAGE_DIR));
  }
  return driver;
}

export const ALLOWED_MIME = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
