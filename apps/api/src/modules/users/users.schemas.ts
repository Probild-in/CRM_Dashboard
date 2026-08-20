import { z } from 'zod';
import { UserRole, UserStatus } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';
import { passwordSchema } from '../auth/auth.schemas.js';

export const USER_SORT_FIELDS = ['createdAt', 'firstName', 'lastName', 'email', 'role'] as const;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

export const userIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid user id.'),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: passwordSchema,
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  role: z.nativeEnum(UserRole).default(UserRole.EMPLOYEE),
  status: z.nativeEnum(UserStatus).default(UserStatus.ACTIVE),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  designation: z.string().trim().max(120).optional().or(z.literal('')),
  timezone: z.string().trim().max(64).default('Asia/Kolkata'),
});

export const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  designation: z.string().trim().max(120).optional().or(z.literal('')),
  avatarUrl: z.string().trim().url().max(512).optional().or(z.literal('')),
  timezone: z.string().trim().max(64).optional(),
});

export const resetUserPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
