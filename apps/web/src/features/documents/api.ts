import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentKind, DocumentSendStatus, EntityType } from '@probild/shared';
import { api, apiDelete, apiGet, apiGetPaginated, apiPost } from '@/lib/api';

export interface DocumentSend {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  status: DocumentSendStatus;
  error: string | null;
  sentAt: string;
  sentBy: { id: string; firstName: string; lastName: string } | null;
}

export interface StoredDocument {
  id: string;
  name: string;
  kind: DocumentKind;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  isGenerated: boolean;
  entityType: EntityType;
  entityId: string;
  createdAt: string;
  client: { id: string; reference: string; companyName: string } | null;
  project: { id: string; name: string } | null;
  uploadedBy: { id: string; firstName: string; lastName: string } | null;
  sends: DocumentSend[];
}

export interface DocumentFilters {
  clientId?: string;
  projectId?: string;
  entityType?: EntityType;
  entityId?: string;
  kind?: DocumentKind | '';
  search?: string;
  page?: number;
  pageSize?: number;
  /** The panel views are scoped to one record; the Documents screen is not. */
  requireScope?: boolean;
}

export function useDocuments(params: DocumentFilters) {
  const { requireScope = true, ...filters } = params;

  return useQuery({
    queryKey: ['documents', filters],
    queryFn: () =>
      apiGetPaginated<StoredDocument>('/documents', {
        params: {
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 50,
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.entityType ? { entityType: filters.entityType } : {}),
          ...(filters.entityId ? { entityId: filters.entityId } : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.search ? { search: filters.search } : {}),
        },
      }),
    enabled: requireScope
      ? Boolean(filters.clientId || filters.projectId || filters.entityId)
      : true,
    placeholderData: (previous) => previous,
  });
}

/** Whether documents can actually be emailed, or only downloaded. */
export function useMailStatus() {
  return useQuery({
    queryKey: ['documents', 'mail-status'],
    queryFn: () => apiGet<{ configured: boolean }>('/documents/mail-status'),
    staleTime: 5 * 60_000,
  });
}

function useDocumentMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

export interface UploadInput {
  file: File;
  kind: DocumentKind;
  description?: string;
  clientId?: string;
  projectId?: string;
  entityType?: EntityType;
  entityId?: string;
}

export function useUploadDocument() {
  return useDocumentMutation(async (input: UploadInput) => {
    const form = new FormData();
    form.append('file', input.file);
    form.append('kind', input.kind);
    if (input.description) form.append('description', input.description);
    if (input.clientId) form.append('clientId', input.clientId);
    if (input.projectId) form.append('projectId', input.projectId);
    if (input.entityType) form.append('entityType', input.entityType);
    if (input.entityId) form.append('entityId', input.entityId);

    // Let the browser set the multipart boundary itself.
    const { data } = await api.post('/documents/upload', form, {
      headers: { 'Content-Type': undefined },
    });
    return data.data as StoredDocument;
  });
}

export function useGenerateDocument() {
  return useDocumentMutation((body: { source: 'QUOTATION' | 'PAYMENT'; sourceId: string }) =>
    apiPost<StoredDocument>('/documents/generate', body),
  );
}

export interface SendInput {
  id: string;
  to: string;
  toName?: string;
  cc?: string[];
  subject: string;
  message: string;
}

export function useSendDocument() {
  return useDocumentMutation(({ id, ...body }: SendInput) =>
    apiPost<{ sent: boolean; error?: string }>(`/documents/${id}/send`, body),
  );
}

export interface SendManyInput {
  documentIds: string[];
  to: string;
  toName?: string;
  cc?: string[];
  subject: string;
  message: string;
}

/** One email carrying every selected document. */
export function useSendDocuments() {
  return useDocumentMutation((body: SendManyInput) =>
    apiPost<{ sent: boolean; error?: string; documents: StoredDocument[] }>(
      '/documents/send',
      body,
    ),
  );
}

export function useDeleteDocument() {
  return useDocumentMutation((id: string) => apiDelete(`/documents/${id}`));
}

/**
 * Downloads through the API rather than a bare link, so the request carries the
 * access token and the file never needs an unauthenticated URL.
 */
export async function downloadDocument(document: StoredDocument): Promise<void> {
  const response = await api.get(`/documents/${document.id}/download`, {
    responseType: 'blob',
  });

  const url = URL.createObjectURL(response.data as Blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.name;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
