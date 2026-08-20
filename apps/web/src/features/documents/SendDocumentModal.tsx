import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { toMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useMailStatus, useSendDocument, type StoredDocument } from './api';

/**
 * Sending a document to a client.
 *
 * The subject and covering note are prefilled but fully editable — this is a
 * message from a person to their client, not a system notification, and it
 * should read like one.
 */
export function SendDocumentModal({
  document,
  defaultTo,
  defaultToName,
  companyName,
  onClose,
}: {
  document: StoredDocument;
  defaultTo?: string | null;
  defaultToName?: string | null;
  companyName?: string | null;
  onClose: () => void;
}) {
  const mail = useMailStatus();
  const sendDocument = useSendDocument();

  const [to, setTo] = useState(defaultTo ?? '');
  const [toName, setToName] = useState(defaultToName ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(defaultSubject(document, companyName));
  const [message, setMessage] = useState(defaultMessage(document, defaultToName));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const configured = mail.data?.configured ?? false;
  const lastSend = document.sends[0];

  const onSubmit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(to)) next.to = 'Enter a valid email address.';
    if (subject.trim() === '') next.subject = 'Give the email a subject.';
    if (message.trim() === '') next.message = 'Write a covering note.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const result = await sendDocument.mutateAsync({
        id: document.id,
        to,
        toName: toName || undefined,
        cc: cc
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        subject,
        message,
      });

      if (result.sent) {
        toast.success(`Sent to ${to}`);
        onClose();
      } else {
        toast.error(result.error ?? 'The message could not be sent.');
      }
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Send to the client"
      description={document.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sendDocument.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSubmit()}
            loading={sendDocument.isPending}
            disabled={!configured}
          >
            Send it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!configured ? (
          <p className="edge-marker rounded-r bg-warning-soft py-2.5 pr-3 pl-3.5 text-[0.8125rem] text-warning">
            Email is not set up yet, so nothing can be sent from here. An administrator needs to add
            the SMTP settings to the API. You can still download the document and send it yourself.
          </p>
        ) : null}

        {lastSend ? (
          <p className="text-xs text-ink-faint">
            Last sent to {lastSend.recipientEmail} on {formatDateTime(lastSend.sentAt)}
            {lastSend.status === 'FAILED' ? ' — that attempt failed.' : '.'}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="To" htmlFor="sendTo" error={errors.to} required>
            <Input
              id="sendTo"
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="accounts@client.com"
            />
          </Field>
          <Field label="Their name" htmlFor="sendToName">
            <Input
              id="sendToName"
              value={toName}
              onChange={(event) => setToName(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Copy to" htmlFor="sendCc" hint="Separate addresses with commas.">
          <Input id="sendCc" value={cc} onChange={(event) => setCc(event.target.value)} />
        </Field>

        <Field label="Subject" htmlFor="sendSubject" error={errors.subject} required>
          <Input
            id="sendSubject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>

        <Field
          label="Message"
          htmlFor="sendMessage"
          error={errors.message}
          hint="The document goes attached to this."
          required
        >
          <Textarea
            id="sendMessage"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-36"
          />
        </Field>
      </div>
    </Modal>
  );
}

function defaultSubject(document: StoredDocument, companyName?: string | null): string {
  const suffix = companyName ? ` — ${companyName}` : '';
  switch (document.kind) {
    case 'QUOTATION':
      return `Quotation from Probild${suffix}`;
    case 'INVOICE':
      return `Invoice from Probild${suffix}`;
    case 'AGREEMENT':
      return `Agreement from Probild${suffix}`;
    case 'PROPOSAL':
      return `Proposal from Probild${suffix}`;
    default:
      return `${document.name} from Probild`;
  }
}

function defaultMessage(document: StoredDocument, toName?: string | null): string {
  const greeting = toName ? `Hello ${toName.split(' ')[0]},` : 'Hello,';

  const body = {
    QUOTATION:
      'Please find our quotation attached. It sets out the scope, the price and the payment terms.\n\nHappy to walk through any of it — just reply here.',
    INVOICE:
      'Please find the invoice attached, along with the payment details.\n\nDo let me know if anything needs changing before you process it.',
    AGREEMENT:
      'Please find the agreement attached for your review.\n\nOnce you are happy, send a signed copy back and we will get started.',
    PROPOSAL:
      'Please find our proposal attached.\n\nHappy to talk it through whenever suits you.',
    REPORT: 'Please find the report attached.\n\nLet me know if you would like anything expanded.',
    OTHER: 'Please find the attached document.\n\nLet me know if you need anything else.',
  }[document.kind];

  return `${greeting}\n\n${body}\n\nBest regards,\nProbild`;
}
