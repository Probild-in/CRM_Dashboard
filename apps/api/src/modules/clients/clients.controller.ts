import type { Request, Response } from 'express';
import { sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { auditContext } from '../audit/audit.service.js';
import * as clientsService from './clients.service.js';
import type {
  ConvertLeadInput,
  CreateClientInput,
  CreateContactInput,
  ListClientsQuery,
  UpdateClientInput,
  UpdateContactInput,
} from './clients.schemas.js';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await clientsService.listClients(req.query as unknown as ListClientsQuery);
  sendPaginated(res, result.items, result.meta);
}

export async function getById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await clientsService.getClient(req.params.id as string));
}

export async function overview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await clientsService.getClientOverview(req.params.id as string));
}

export async function create(req: Request, res: Response): Promise<void> {
  const client = await clientsService.createClient(
    req.body as CreateClientInput,
    auditContext(req),
  );
  sendSuccess(res, client, 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  const client = await clientsService.updateClient(
    req.params.id as string,
    req.body as UpdateClientInput,
    auditContext(req),
  );
  sendSuccess(res, client);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await clientsService.deleteClient(req.params.id as string, auditContext(req));
  sendNoContent(res);
}

export async function listContacts(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await clientsService.listContacts(req.params.id as string));
}

export async function createContact(req: Request, res: Response): Promise<void> {
  const contact = await clientsService.createContact(
    req.params.id as string,
    req.body as CreateContactInput,
    auditContext(req),
  );
  sendSuccess(res, contact, 201);
}

export async function updateContact(req: Request, res: Response): Promise<void> {
  const contact = await clientsService.updateContact(
    req.params.id as string,
    req.params.contactId as string,
    req.body as UpdateContactInput,
    auditContext(req),
  );
  sendSuccess(res, contact);
}

export async function removeContact(req: Request, res: Response): Promise<void> {
  await clientsService.deleteContact(
    req.params.id as string,
    req.params.contactId as string,
    auditContext(req),
  );
  sendNoContent(res);
}

/** Mounted on the leads router: POST /api/leads/:id/convert */
export async function convertLead(req: Request, res: Response): Promise<void> {
  const result = await clientsService.convertLead(
    req.params.id as string,
    req.body as ConvertLeadInput,
    req.user!.id,
    auditContext(req),
  );
  sendSuccess(res, result, 201);
}
