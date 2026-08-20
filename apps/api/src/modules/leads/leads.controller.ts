import type { Request, Response } from 'express';
import { sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { auditContext } from '../audit/audit.service.js';
import * as leadsService from './leads.service.js';
import type {
  ChangeLeadStatusInput,
  CreateActivityInput,
  CreateLeadInput,
  ListLeadsQuery,
  PipelineQuery,
  UpdateLeadInput,
} from './leads.schemas.js';

/** Every lead read is scoped by who is asking. */
function actor(req: Request): leadsService.Actor {
  return { id: req.user!.id, role: req.user!.role };
}

export async function list(req: Request, res: Response): Promise<void> {
  const result = await leadsService.listLeads(req.query as unknown as ListLeadsQuery, actor(req));
  sendPaginated(res, result.items, result.meta);
}

export async function summary(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await leadsService.getLeadSummary(actor(req)));
}

export async function pipeline(req: Request, res: Response): Promise<void> {
  const result = await leadsService.getPipeline(req.query as unknown as PipelineQuery, actor(req));
  sendSuccess(res, result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await leadsService.getLead(req.params.id as string, actor(req)));
}

export async function activities(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await leadsService.listActivities(req.params.id as string, actor(req)));
}

export async function create(req: Request, res: Response): Promise<void> {
  const lead = await leadsService.createLead(
    req.body as CreateLeadInput,
    actor(req),
    auditContext(req),
  );
  sendSuccess(res, lead, 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  const lead = await leadsService.updateLead(
    req.params.id as string,
    req.body as UpdateLeadInput,
    actor(req),
    auditContext(req),
  );
  sendSuccess(res, lead);
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const lead = await leadsService.changeStatus(
    req.params.id as string,
    req.body as ChangeLeadStatusInput,
    actor(req),
    auditContext(req),
  );
  sendSuccess(res, lead);
}

export async function assign(req: Request, res: Response): Promise<void> {
  const { assignedToId } = req.body as { assignedToId: string | null };
  const lead = await leadsService.assignLead(
    req.params.id as string,
    assignedToId,
    actor(req),
    auditContext(req),
  );
  sendSuccess(res, lead);
}

export async function addActivity(req: Request, res: Response): Promise<void> {
  const lead = await leadsService.addActivity(
    req.params.id as string,
    req.body as CreateActivityInput,
    actor(req),
    auditContext(req),
  );
  sendSuccess(res, lead, 201);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await leadsService.deleteLead(req.params.id as string, actor(req), auditContext(req));
  sendNoContent(res);
}
