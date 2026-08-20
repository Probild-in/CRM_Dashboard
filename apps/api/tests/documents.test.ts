import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { DocumentKind, UserRole } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { env, storageBucket } from '../src/config/env.js';
import { supabaseAdmin } from '../src/lib/supabase.js';
import * as storage from '../src/modules/documents/storage.js';
import * as mailer from '../src/modules/documents/mailer.js';
import { authHeader, buildTestApp, createTestUser, loginAs, resetDatabase } from './helpers.js';

let app: Express;

/**
 * Empties the test bucket between cases.
 *
 * Tests upload to `probild-documents-test`, not the working bucket — dev and
 * test share one Supabase project, so the suite must not be able to delete a
 * real document any more than it can truncate a real table.
 */
async function emptyTestBucket(): Promise<void> {
  const store = supabaseAdmin.storage.from(storageBucket);
  const { data: years } = await store.list('');

  for (const year of years ?? []) {
    const { data: months } = await store.list(year.name);
    for (const month of months ?? []) {
      const { data: files } = await store.list(`${year.name}/${month.name}`);
      const keys = (files ?? []).map((f) => `${year.name}/${month.name}/${f.name}`);
      if (keys.length) await store.remove(keys);
    }
  }
}

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  env.SMTP_HOST = undefined;
  env.MAIL_FROM_ADDRESS = undefined;
  vi.restoreAllMocks();
  await emptyTestBucket();
});

afterAll(async () => {
  await disconnectPrisma();
});

async function adminSession() {
  const user = await createTestUser(UserRole.SUPER_ADMIN);
  const session = await loginAs(app, user.email);
  return { user, token: session.accessToken };
}

async function makeClient(token: string, companyName = 'ABC Technologies') {
  const response = await request(app)
    .post('/api/clients')
    .set(authHeader(token))
    .send({ companyName, email: 'accounts@abctech.in' });
  return response.body.data;
}

const PDF_BYTES = Buffer.from('%PDF-1.4\n%probild test\n');

describe('storage safety', () => {
  it('refuses a file type Probild does not accept', () => {
    expect(() => storage.assertAllowedType('application/x-msdownload')).toThrow();
    expect(() => storage.assertAllowedType('application/pdf')).not.toThrow();
  });

  it('refuses a storage key that escapes the upload directory', () => {
    // The one thing between a stored key and the filesystem.
    expect(() => storage.resolveStorageKey('../../.env')).toThrow();
    expect(() => storage.resolveStorageKey('/etc/passwd')).toThrow();
    expect(() => storage.resolveStorageKey('2026/08/file.pdf')).not.toThrow();
  });

  it('names stored files itself rather than trusting the browser', async () => {
    const stored = await storage.store(PDF_BYTES, 'application/pdf');

    expect(stored.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(stored.sizeBytes).toBe(PDF_BYTES.byteLength);
  });

  it('strips anything dangerous out of a download filename', () => {
    expect(storage.safeFilename('../../etc/passwd')).not.toContain('/');
    expect(storage.safeFilename('Quote #1 (final).pdf')).toBe('Quote _1 _final_.pdf');
  });
});

describe('uploading', () => {
  it('stores a document against a client', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const response = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', client.id)
      .field('kind', DocumentKind.AGREEMENT)
      .field('description', 'Signed master services agreement')
      .attach('file', PDF_BYTES, { filename: 'agreement.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe('agreement.pdf');
    expect(response.body.data.kind).toBe(DocumentKind.AGREEMENT);
    expect(response.body.data.client.id).toBe(client.id);
    expect(response.body.data.isGenerated).toBe(false);
    // The internal path is never handed out.
    expect(response.body.data).not.toHaveProperty('storageKey');
  });

  it('refuses a file type that is not on the list', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const response = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', client.id)
      .attach('file', Buffer.from('MZ'), {
        filename: 'payload.exe',
        contentType: 'application/x-msdownload',
      });

    expect(response.status).toBe(422);
  });

  it('refuses an upload with nothing attached', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const response = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', client.id);

    expect(response.status).toBe(400);
  });

  it('refuses a document that hangs off nothing', async () => {
    const { token } = await adminSession();

    const response = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .attach('file', PDF_BYTES, { filename: 'orphan.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(422);
  });

  it('takes the client from the project it belongs to', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const project = await request(app)
      .post('/api/projects')
      .set(authHeader(token))
      .send({ clientId: client.id, name: 'Website rebuild' });

    const response = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('projectId', project.body.data.id)
      .attach('file', PDF_BYTES, { filename: 'spec.pdf', contentType: 'application/pdf' });

    expect(response.body.data.client.id).toBe(client.id);
    expect(response.body.data.project.id).toBe(project.body.data.id);
  });

  it('refuses uploads to a role without the permission', async () => {
    const admin = await adminSession();
    const client = await makeClient(admin.token);

    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(session.accessToken))
      .field('clientId', client.id)
      .attach('file', PDF_BYTES, { filename: 'nope.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(403);
  });

  it('hands the file back on download', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const uploaded = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', client.id)
      .attach('file', PDF_BYTES, { filename: 'agreement.pdf', contentType: 'application/pdf' });

    const response = await request(app)
      .get(`/api/documents/${uploaded.body.data.id}/download`)
      .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('agreement.pdf');
    // Client paperwork must never sit in a shared cache.
    expect(response.headers['cache-control']).toContain('no-store');
  });
});

describe('generating papers', () => {
  async function quotationFor(token: string, clientId: string) {
    return request(app)
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        title: 'Website design and build',
        clientId,
        issueDate: '2026-08-18',
        validUntil: '2026-09-02',
        taxPercent: 18,
        paymentTerms: '50% advance, 50% on delivery',
        items: [
          { description: 'UI/UX design', quantity: 1, unitPrice: 180000, discountPercent: 0 },
          { description: 'Build', quantity: 1, unitPrice: 420000, discountPercent: 5 },
        ],
      });
  }

  it('produces a quotation PDF', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const quotation = await quotationFor(token, client.id);

    const response = await request(app)
      .post('/api/documents/generate')
      .set(authHeader(token))
      .send({ source: 'QUOTATION', sourceId: quotation.body.data.id });

    expect(response.status).toBe(201);
    expect(response.body.data.kind).toBe(DocumentKind.QUOTATION);
    expect(response.body.data.isGenerated).toBe(true);
    expect(response.body.data.mimeType).toBe('application/pdf');
    expect(response.body.data.sizeBytes).toBeGreaterThan(500);
    expect(response.body.data.name).toContain('QT-000001');

    // It is a real PDF, not an empty file.
    const download = await request(app)
      .get(`/api/documents/${response.body.data.id}/download`)
      .set(authHeader(token));
    expect(download.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('replaces the paper rather than piling up copies', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const quotation = await quotationFor(token, client.id);

    const first = await request(app)
      .post('/api/documents/generate')
      .set(authHeader(token))
      .send({ source: 'QUOTATION', sourceId: quotation.body.data.id });

    await request(app)
      .patch(`/api/quotations/${quotation.body.data.id}`)
      .set(authHeader(token))
      .send({
        items: [{ description: 'Build only', quantity: 1, unitPrice: 400000, discountPercent: 0 }],
        changeReason: 'Client dropped the design scope',
      });

    const second = await request(app)
      .post('/api/documents/generate')
      .set(authHeader(token))
      .send({ source: 'QUOTATION', sourceId: quotation.body.data.id });

    // Same document, new contents — its send history survives a regeneration.
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.document.count({ where: { deletedAt: null } })).toBe(1);
  });

  it('produces an invoice PDF from a payment', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const payment = await request(app)
      .post('/api/payments')
      .set(authHeader(token))
      .send({
        clientId: client.id,
        title: '50% advance',
        amount: 342200,
        currency: 'INR',
        dueDate: '2026-09-15',
      });

    const response = await request(app)
      .post('/api/documents/generate')
      .set(authHeader(token))
      .send({ source: 'PAYMENT', sourceId: payment.body.data.id });

    expect(response.status).toBe(201);
    expect(response.body.data.kind).toBe(DocumentKind.INVOICE);
    expect(response.body.data.name).toContain('PAY-000001');
  });

  it('refuses to draw a quotation addressed to nobody', async () => {
    const { token } = await adminSession();

    const response = await request(app)
      .post('/api/documents/generate')
      .set(authHeader(token))
      .send({ source: 'QUOTATION', sourceId: '11111111-1111-4111-8111-111111111111' });

    expect(response.status).toBe(404);
  });
});

describe('sending to a client', () => {
  async function documentFor(token: string, clientId: string): Promise<string> {
    const uploaded = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', clientId)
      .field('kind', DocumentKind.AGREEMENT)
      .attach('file', PDF_BYTES, { filename: 'agreement.pdf', contentType: 'application/pdf' });
    return uploaded.body.data.id;
  }

  function configureMail(): void {
    env.SMTP_HOST = 'smtp.example.test';
    env.MAIL_FROM_ADDRESS = 'hello@probild.test';
  }

  it('says plainly that sending is not set up', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentId = await documentFor(token, client.id);

    const status = await request(app).get('/api/documents/mail-status').set(authHeader(token));
    expect(status.body.data.configured).toBe(false);

    const response = await request(app)
      .post(`/api/documents/${documentId}/send`)
      .set(authHeader(token))
      .send({
        to: 'accounts@abctech.in',
        subject: 'Your agreement',
        message: 'Please find the signed agreement attached.',
      });

    expect(response.status).toBe(503);
    expect(response.body.error.message).toContain('not set up');
  });

  it('sends the document as an attachment and records it', async () => {
    configureMail();
    const { user, token } = await adminSession();
    const client = await makeClient(token);
    const documentId = await documentFor(token, client.id);

    const sendSpy = vi
      .spyOn(mailer, 'send')
      .mockResolvedValue({ sent: true, messageId: 'test-1' });

    const response = await request(app)
      .post(`/api/documents/${documentId}/send`)
      .set(authHeader(token))
      .send({
        to: 'accounts@abctech.in',
        toName: 'Rohan Mehta',
        cc: ['finance@abctech.in'],
        subject: 'Your agreement',
        message: 'Please find the signed agreement attached.',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.sent).toBe(true);

    const mail = sendSpy.mock.calls[0]![0];
    expect(mail.to).toBe('accounts@abctech.in');
    expect(mail.cc).toEqual(['finance@abctech.in']);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments?.[0]?.filename).toBe('agreement.pdf');
    expect(mail.attachments?.[0]?.content.equals(PDF_BYTES)).toBe(true);

    const sends = await prisma.documentSend.findMany({ where: { documentId } });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      status: 'SENT',
      recipientEmail: 'accounts@abctech.in',
      sentById: user.id,
    });
  });

  it('records a failure rather than losing it', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentId = await documentFor(token, client.id);

    vi.spyOn(mailer, 'send').mockResolvedValue({
      sent: false,
      error: 'Mailbox does not exist',
    });

    const response = await request(app)
      .post(`/api/documents/${documentId}/send`)
      .set(authHeader(token))
      .send({
        to: 'wrong@abctech.in',
        subject: 'Your agreement',
        message: 'Please find it attached.',
      });

    // A bounce is reported, and left on the client's record to be seen.
    expect(response.status).toBe(502);
    expect(response.body.data.sent).toBe(false);

    const sends = await prisma.documentSend.findMany({ where: { documentId } });
    expect(sends[0]).toMatchObject({ status: 'FAILED', error: 'Mailbox does not exist' });
  });

  it('shows the send history on the document', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentId = await documentFor(token, client.id);

    vi.spyOn(mailer, 'send').mockResolvedValue({ sent: true, messageId: 'test-1' });

    await request(app)
      .post(`/api/documents/${documentId}/send`)
      .set(authHeader(token))
      .send({ to: 'accounts@abctech.in', subject: 'First', message: 'Attached.' });

    const response = await request(app)
      .get(`/api/documents/${documentId}`)
      .set(authHeader(token));

    expect(response.body.data.sends).toHaveLength(1);
    expect(response.body.data.sends[0].subject).toBe('First');
  });

  it('refuses a malformed recipient address', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentId = await documentFor(token, client.id);

    const response = await request(app)
      .post(`/api/documents/${documentId}/send`)
      .set(authHeader(token))
      .send({ to: 'not-an-address', subject: 'Hello', message: 'Attached.' });

    expect(response.status).toBe(400);
  });

  it('requires a covering note', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentId = await documentFor(token, client.id);

    const response = await request(app)
      .post(`/api/documents/${documentId}/send`)
      .set(authHeader(token))
      .send({ to: 'accounts@abctech.in', subject: 'Hello', message: '' });

    expect(response.status).toBe(400);
  });
});

describe('sending several at once', () => {
  function configureMail(): void {
    env.SMTP_HOST = 'smtp.example.test';
    env.MAIL_FROM_ADDRESS = 'hello@probild.test';
  }

  async function twoDocuments(token: string, clientId: string): Promise<string[]> {
    const ids: string[] = [];
    for (const [name, kind] of [
      ['agreement.pdf', DocumentKind.AGREEMENT],
      ['invoice.pdf', DocumentKind.INVOICE],
    ] as const) {
      const uploaded = await request(app)
        .post('/api/documents/upload')
        .set(authHeader(token))
        .field('clientId', clientId)
        .field('kind', kind)
        .attach('file', PDF_BYTES, { filename: name, contentType: 'application/pdf' });
      ids.push(uploaded.body.data.id);
    }
    return ids;
  }

  it('puts every document in one email', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentIds = await twoDocuments(token, client.id);

    const sendSpy = vi.spyOn(mailer, 'send').mockResolvedValue({ sent: true, messageId: 'batch-1' });

    const response = await request(app)
      .post('/api/documents/send')
      .set(authHeader(token))
      .send({
        documentIds,
        to: 'accounts@abctech.in',
        subject: 'Your paperwork',
        message: 'Both documents are attached.',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.sent).toBe(true);

    // One message, two attachments — not two emails.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const mail = sendSpy.mock.calls[0]![0];
    expect(mail.attachments).toHaveLength(2);
    expect(mail.attachments?.map((attachment) => attachment.filename)).toEqual([
      'agreement.pdf',
      'invoice.pdf',
    ]);
  });

  it('records the send against every document', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentIds = await twoDocuments(token, client.id);

    vi.spyOn(mailer, 'send').mockResolvedValue({ sent: true, messageId: 'batch-1' });

    await request(app)
      .post('/api/documents/send')
      .set(authHeader(token))
      .send({
        documentIds,
        to: 'accounts@abctech.in',
        subject: 'Your paperwork',
        message: 'Both attached.',
      });

    for (const id of documentIds) {
      const sends = await prisma.documentSend.findMany({ where: { documentId: id } });
      expect(sends).toHaveLength(1);
      expect(sends[0]!.status).toBe('SENT');
    }
  });

  it('records a failed batch against every document too', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentIds = await twoDocuments(token, client.id);

    vi.spyOn(mailer, 'send').mockResolvedValue({ sent: false, error: 'Mailbox full' });

    const response = await request(app)
      .post('/api/documents/send')
      .set(authHeader(token))
      .send({
        documentIds,
        to: 'accounts@abctech.in',
        subject: 'Your paperwork',
        message: 'Both attached.',
      });

    expect(response.status).toBe(502);
    expect(await prisma.documentSend.count({ where: { status: 'FAILED' } })).toBe(2);
  });

  it('refuses an empty selection', async () => {
    configureMail();
    const { token } = await adminSession();

    const response = await request(app)
      .post('/api/documents/send')
      .set(authHeader(token))
      .send({
        documentIds: [],
        to: 'accounts@abctech.in',
        subject: 'Nothing',
        message: 'Nothing attached.',
      });

    expect(response.status).toBe(400);
  });

  it('refuses a batch that would be too large for an inbox', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);

    // Two 11MB files: each is fine on its own, together they are not.
    const big = Buffer.alloc(11 * 1024 * 1024, 0x41);
    const ids: string[] = [];
    for (const name of ['one.pdf', 'two.pdf']) {
      const uploaded = await request(app)
        .post('/api/documents/upload')
        .set(authHeader(token))
        .field('clientId', client.id)
        .attach('file', big, { filename: name, contentType: 'application/pdf' });
      ids.push(uploaded.body.data.id);
    }

    const response = await request(app)
      .post('/api/documents/send')
      .set(authHeader(token))
      .send({
        documentIds: ids,
        to: 'accounts@abctech.in',
        subject: 'Large',
        message: 'Attached.',
      });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('20MB');
    // Nothing was sent, so nothing is recorded.
    expect(await prisma.documentSend.count()).toBe(0);
  });

  it('refuses a batch containing a document that no longer exists', async () => {
    configureMail();
    const { token } = await adminSession();
    const client = await makeClient(token);
    const documentIds = await twoDocuments(token, client.id);

    const response = await request(app)
      .post('/api/documents/send')
      .set(authHeader(token))
      .send({
        documentIds: [...documentIds, '11111111-1111-4111-8111-111111111111'],
        to: 'accounts@abctech.in',
        subject: 'Your paperwork',
        message: 'Attached.',
      });

    expect(response.status).toBe(404);
    expect(await prisma.documentSend.count()).toBe(0);
  });
});

describe('the client profile', () => {
  it('lists a client’s documents', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', client.id)
      .field('kind', DocumentKind.AGREEMENT)
      .attach('file', PDF_BYTES, { filename: 'agreement.pdf', contentType: 'application/pdf' });

    const overview = await request(app)
      .get(`/api/clients/${client.id}/overview`)
      .set(authHeader(token));

    expect(overview.body.data.documents).toHaveLength(1);
    expect(overview.body.data.documents[0].name).toBe('agreement.pdf');
  });

  it('takes a deleted document out of the list', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const uploaded = await request(app)
      .post('/api/documents/upload')
      .set(authHeader(token))
      .field('clientId', client.id)
      .attach('file', PDF_BYTES, { filename: 'agreement.pdf', contentType: 'application/pdf' });

    await request(app)
      .delete(`/api/documents/${uploaded.body.data.id}`)
      .set(authHeader(token));

    const response = await request(app)
      .get('/api/documents')
      .query({ clientId: client.id })
      .set(authHeader(token));

    expect(response.body.data).toHaveLength(0);
  });
});
