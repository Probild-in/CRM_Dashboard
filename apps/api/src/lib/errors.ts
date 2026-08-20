import { ApiErrorCode, type FieldError } from '@probild/shared';

/**
 * Errors thrown anywhere in a request are normalised into `AppError` by the
 * central error handler, so controllers never format responses themselves.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: FieldError[];
  /** Expected failures are logged at `warn`; unexpected ones at `error`. */
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: ApiErrorCode,
    details?: FieldError[],
    isOperational = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: FieldError[]) {
    super(message, 400, ApiErrorCode.VALIDATION_ERROR, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super(message, 401, ApiErrorCode.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, 403, ApiErrorCode.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} was not found.`, 404, ApiErrorCode.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'This action conflicts with the current state.') {
    super(message, 409, ApiErrorCode.CONFLICT);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, details?: FieldError[]) {
    super(message, 422, ApiErrorCode.UNPROCESSABLE, details);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Something went wrong.') {
    super(message, 500, ApiErrorCode.INTERNAL_ERROR, undefined, false);
  }
}
