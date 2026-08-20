import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { ApiErrorCode } from '@probild/shared';
import { logger } from '../../lib/logger.js';

/**
 * Outbound email.
 *
 * Optional, like the calendar: with no SMTP host configured, documents are
 * still stored, generated and downloadable — the app says plainly that sending
 * is not set up rather than failing at the moment someone tries.
 */

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.MAIL_FROM_ADDRESS);
}

export class MailNotConfiguredError extends AppError {
  constructor() {
    super(
      'Sending email is not set up yet. Add the SMTP settings to the API environment, or download the document and send it yourself.',
      503,
      ApiErrorCode.UNPROCESSABLE,
    );
  }
}

function getTransporter(): Transporter {
  if (!isMailConfigured()) {
    throw new MailNotConfiguredError();
  }

  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } }
      : {}),
  });

  return transporter;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMail {
  to: string;
  toName?: string | null;
  cc?: string[];
  subject: string;
  /** The covering note, as the sender typed it. */
  body: string;
  /** One email can carry several papers — an agreement and its invoice together. */
  attachments?: MailAttachment[];
}

export interface SendResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends one message.
 *
 * Failures are returned rather than thrown: the caller records the attempt
 * either way, so a bounced address leaves a trail on the client profile instead
 * of disappearing.
 */
export async function send(mail: OutgoingMail): Promise<SendResult> {
  try {
    const info = await getTransporter().sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_ADDRESS! },
      to: mail.toName ? { name: mail.toName, address: mail.to } : mail.to,
      ...(mail.cc && mail.cc.length > 0 ? { cc: mail.cc } : {}),
      ...(env.MAIL_REPLY_TO ? { replyTo: env.MAIL_REPLY_TO } : {}),
      subject: mail.subject,
      text: mail.body,
      html: toHtml(mail.body),
      ...(mail.attachments && mail.attachments.length > 0
        ? { attachments: mail.attachments }
        : {}),
    });

    return { sent: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The message could not be sent.';
    logger.error({ err: error, to: mail.to }, 'Could not send the document');
    return { sent: false, error: message.slice(0, 500) };
  }
}

/**
 * A plain-text note, made into a plain email.
 *
 * Deliberately simple markup: a client's inbox is not the place to be clever,
 * and every character the sender typed is escaped before it goes near HTML.
 */
function toHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${block.replace(/\n/g, '<br />')}</p>`)
    .join('');

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#10151C">${paragraphs}</div>`;
}

/** For the connection check on the settings screen. */
export async function verify(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown' };
  }
}
