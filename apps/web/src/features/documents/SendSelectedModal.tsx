import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { toMessage } from '@/lib/api';
import { useClientOverview } from '@/features/clients/api';
import { LoadingState } from '@/components/ui/States';
import { formatFileSize, useMailStatus, useSendDocuments, type StoredDocument } from './api';

/** Most inboxes reject more than this; refuse before the send, not after. */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * Sending a selection of documents to one client, as a single email.
 *
 * The recipient is chosen from the client's own contacts, because that is who
 * these papers are for — with a free-text fallback for anyone not on file.
 */
interface SendProps {
  documents: StoredDocument[];
  clientId?: string;
  clientName?: string | null;
  clientEmail?: string | null;
  onClose: () => void;
  onSent: () => void;
}

/**
 * Waits for the client's contacts before opening the form.
 *
 * The form's fields default from those contacts, and `useState` initialisers
 * run once — mounting before the query resolves would leave the recipient
 * defaulted to the wrong person, which is a bad way to send a client's invoice.
 */
export function SendSelectedModal(props: SendProps) {
  const overview = useClientOverview(props.clientId);

  if (props.clientId && (overview.isPending || !overview.data)) {
    return (
      <Modal open onClose={props.onClose} title="Send to the client">
        <LoadingState label="Loading the client's contacts" />
      </Modal>
    );
  }

  const contacts =
    overview.data?.contacts.filter(
      (contact): contact is typeof contact & { email: string } => Boolean(contact.email),
    ) ?? [];

  return <SendForm {...props} contacts={contacts} />;
}

interface ContactOption {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  isPrimary: boolean;
}

function SendForm({
  documents,
  clientName,
  clientEmail,
  contacts,
  onClose,
  onSent,
}: SendProps & { contacts: ContactOption[] }) {
  const mail = useMailStatus();
  const sendDocuments = useSendDocuments();

  const primary = contacts.find((contact) => contact.isPrimary) ?? contacts[0];

  const [to, setTo] = useState(primary?.email ?? clientEmail ?? '');
  const [toName, setToName] = useState(
    primary ? `${primary.firstName} ${primary.lastName ?? ''}`.trim() : (clientName ?? ''),
  );
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(defaultSubject(documents, clientName));
  const [message, setMessage] = useState(defaultMessage(documents, toName));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const configured = mail.data?.configured ?? false;
  const totalBytes = documents.reduce((sum, document) => sum + document.sizeBytes, 0);
  const tooLarge = totalBytes > MAX_TOTAL_BYTES;

  const onSubmit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(to)) next.to = 'Enter a valid email address.';
    if (subject.trim() === '') next.subject = 'Give the email a subject.';
    if (message.trim() === '') next.message = 'Write a covering note.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const result = await sendDocuments.mutateAsync({
        documentIds: documents.map((document) => document.id),
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
        toast.success(
          documents.length === 1
            ? `Sent to ${to}`
            : `Sent ${documents.length} documents to ${to}`,
        );
        onSent();
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
      title={documents.length === 1 ? 'Send to the client' : `Send ${documents.length} documents`}
      description={clientName ? `To ${clientName}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sendDocuments.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSubmit()}
            loading={sendDocuments.isPending}
            disabled={!configured || tooLarge}
          >
            Send it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!configured ? (
          <p className="edge-marker rounded-r bg-warning-soft py-2.5 pr-3 pl-3.5 text-[0.8125rem] text-warning">
            Email is not set up yet, so nothing can be sent from here. An administrator needs to
            add the SMTP settings to the API. You can still download these and send them yourself.
          </p>
        ) : null}

        {tooLarge ? (
          <p className="edge-marker rounded-r bg-danger-soft py-2.5 pr-3 pl-3.5 text-[0.8125rem] text-danger">
            These come to {formatFileSize(totalBytes)} together, which most inboxes reject. Send
            them in smaller batches.
          </p>
        ) : null}

        {/* What is going, so nobody sends the wrong paperwork to a client. */}
        <section className="rounded-md border border-line bg-panel-muted px-4 py-3">
          <p className="eyebrow mb-2">
            Attaching {documents.length === 1 ? '1 document' : `${documents.length} documents`} ·{' '}
            {formatFileSize(totalBytes)}
          </p>
          <ul className="flex flex-col gap-1.5">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center gap-2">
                <Paperclip aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
                <span className="truncate text-[0.8125rem] text-ink">{document.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-ink-faint">
                  {formatFileSize(document.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {contacts.length > 0 ? (
          <Field label="Send to" htmlFor="sendContact" hint="From this client's contacts.">
            <Select
              id="sendContact"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                const contact = contacts.find((entry) => entry.email === event.target.value);
                if (contact) setToName(`${contact.firstName} ${contact.lastName ?? ''}`.trim());
              }}
            >
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.email}>
                  {contact.firstName} {contact.lastName ?? ''} — {contact.email}
                </option>
              ))}
              {clientEmail && !contacts.some((contact) => contact.email === clientEmail) ? (
                <option value={clientEmail}>{clientEmail} (the company address)</option>
              ) : null}
            </Select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email address" htmlFor="sendTo" error={errors.to} required>
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
          hint="The documents go attached to this."
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

function defaultSubject(documents: StoredDocument[], clientName?: string | null): string {
  const suffix = clientName ? ` — ${clientName}` : '';
  if (documents.length === 1) {
    const kind = documents[0]!.kind;
    const noun =
      kind === 'QUOTATION'
        ? 'Quotation'
        : kind === 'INVOICE'
          ? 'Invoice'
          : kind === 'AGREEMENT'
            ? 'Agreement'
            : kind === 'PROPOSAL'
              ? 'Proposal'
              : 'Document';
    return `${noun} from Probild${suffix}`;
  }
  return `Documents from Probild${suffix}`;
}

function defaultMessage(documents: StoredDocument[], toName?: string | null): string {
  const greeting = toName ? `Hello ${toName.split(' ')[0]},` : 'Hello,';

  if (documents.length === 1) {
    return `${greeting}\n\nPlease find the attached document.\n\nLet me know if you need anything else.\n\nBest regards,\nProbild`;
  }

  const list = documents.map((document) => `  · ${document.name}`).join('\n');
  return `${greeting}\n\nPlease find the following attached:\n\n${list}\n\nHappy to talk any of it through — just reply here.\n\nBest regards,\nProbild`;
}
