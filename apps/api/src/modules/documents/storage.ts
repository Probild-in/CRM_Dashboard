import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { env, storageBucket } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * File storage, backed by a private Supabase Storage bucket.
 *
 * Objects are named by a generated id rather than by whatever the browser sent
 * — a client-supplied filename is untrusted input. The original name is kept in
 * the database for display and download.
 *
 * The bucket is private and reads go through this API, so the permission checks
 * in `documents.service` remain the only way to reach a file. Nothing here hands
 * out a public or signed URL.
 */

const bucket = () => supabaseAdmin.storage.from(storageBucket);

/** What Probild accepts. Anything else is refused by name, not silently dropped. */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

export const ALLOWED_MIME_LIST = Object.keys(ALLOWED_MIME_TYPES);

export function maxUploadBytes(): number {
  return env.MAX_UPLOAD_MB * 1024 * 1024;
}

export function assertAllowedType(mimeType: string): void {
  if (!ALLOWED_MIME_TYPES[mimeType]) {
    throw new UnprocessableError(
      `Probild does not accept ${mimeType} files. Send a PDF, an image, an Office document, a CSV or a zip.`,
    );
  }
}

/**
 * Validates a stored key.
 *
 * There is no filesystem to escape any more, but a key containing `..`, a
 * leading slash or a backslash is malformed and is refused rather than passed
 * to the storage API.
 */
export function resolveStorageKey(storageKey: string): string {
  if (
    !/^[\w.\-/]+$/.test(storageKey) ||
    storageKey.includes('..') ||
    storageKey.startsWith('/')
  ) {
    throw new UnprocessableError('That file path is not valid.');
  }
  return storageKey;
}

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
}

/** Uploads a buffer under a generated key, foldered by year and month. */
export async function store(buffer: Buffer, mimeType: string): Promise<StoredFile> {
  assertAllowedType(mimeType);

  if (buffer.byteLength > maxUploadBytes()) {
    throw new UnprocessableError(`Files must be ${env.MAX_UPLOAD_MB}MB or smaller.`);
  }

  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storageKey = `${folder}/${randomUUID()}.${ALLOWED_MIME_TYPES[mimeType]}`;

  const { error } = await bucket().upload(storageKey, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    logger.error({ err: error, storageKey }, 'Could not upload the file');
    throw new UnprocessableError('That file could not be stored. Please try again.');
  }

  return { storageKey, sizeBytes: buffer.byteLength };
}

export async function readBuffer(storageKey: string): Promise<Buffer> {
  const { data, error } = await bucket().download(resolveStorageKey(storageKey));
  if (error || !data) {
    throw new NotFoundError('Document file');
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Async, unlike the filesystem version it replaced: Supabase returns the object
 * as a Blob rather than a handle to stream from.
 */
export async function readStream(storageKey: string): Promise<NodeJS.ReadableStream> {
  return Readable.from(await readBuffer(storageKey));
}

export async function exists(storageKey: string): Promise<boolean> {
  const key = resolveStorageKey(storageKey);
  const slash = key.lastIndexOf('/');
  const folder = slash === -1 ? '' : key.slice(0, slash);
  const name = slash === -1 ? key : key.slice(slash + 1);

  const { data, error } = await bucket().list(folder, { search: name, limit: 100 });
  if (error) return false;
  return (data ?? []).some((object) => object.name === name);
}

/** Removing the row matters more than removing the bytes, so failures only log. */
export async function remove(storageKey: string): Promise<void> {
  const { error } = await bucket().remove([resolveStorageKey(storageKey)]);
  if (error) {
    logger.warn({ err: error, storageKey }, 'Could not delete the stored file');
  }
}

/** A filename safe to put in a Content-Disposition header. */
export function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 180) || 'document';
}
