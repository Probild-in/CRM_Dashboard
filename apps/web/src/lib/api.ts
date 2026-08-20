import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiError, ApiResponse, FieldError } from '@probild/shared';
import { supabase } from './supabase';

let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

export const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

/*
 * The token comes from the Supabase session rather than a variable of our own.
 * `getSession()` returns the cached session and refreshes it if it is close to
 * expiry, so there is no refresh-on-401 dance left to do here.
 */
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    config.headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    // A 401 now means the account is gone, suspended, or the session truly
    // expired — supabase-js has already had its chance to refresh.
    if (error.response?.status === 401) {
      onSessionLost?.();
    }
    return Promise.reject(error);
  },
);

/** Unwraps the success envelope so callers work with plain data. */
export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await api.get<ApiResponse<T>>(url, config);
  if (!data.success) throw new ApiRequestError(data);
  return data.data;
}

export async function apiGetPaginated<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<{ items: T[]; meta: NonNullable<Extract<ApiResponse<T[]>, { success: true }>['meta']> }> {
  const { data } = await api.get<ApiResponse<T[]>>(url, config);
  if (!data.success) throw new ApiRequestError(data);
  return {
    items: data.data,
    meta: data.meta ?? {
      page: 1,
      pageSize: data.data.length,
      total: data.data.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.post<ApiResponse<T>>(url, body);
  if (!data.success) throw new ApiRequestError(data);
  return data.data;
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.patch<ApiResponse<T>>(url, body);
  if (!data.success) throw new ApiRequestError(data);
  return data.data;
}

export async function apiDelete(url: string): Promise<void> {
  await api.delete(url);
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details?: FieldError[];

  constructor(payload: ApiError) {
    super(payload.error.message);
    this.name = 'ApiRequestError';
    this.code = payload.error.code;
    this.details = payload.error.details;
  }
}

/** Turns any thrown value into a sentence worth showing a person. */
export function toMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiRequestError) return error.message;
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as ApiError | undefined;
    if (payload && !payload.success) return payload.error.message;
    if (error.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Field-level errors, so a form can point at the input that failed. */
export function toFieldErrors(error: unknown): FieldError[] {
  if (error instanceof ApiRequestError) return error.details ?? [];
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as ApiError | undefined;
    if (payload && !payload.success) return payload.error.details ?? [];
  }
  return [];
}
