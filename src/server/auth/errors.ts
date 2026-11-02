import { errorMessage, logger } from '@/lib/logger'

/**
 * Errors the service layer throws. Each carries the HTTP status it should become, so route handlers
 * and server actions can translate them in one place instead of mapping error types by hand.
 */
export class AppError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = new.target.name
    this.status = status
    this.code = code
  }
}

/** Nobody is signed in. */
export class UnauthorizedError extends AppError {
  constructor(message = 'You must sign in to do that.') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

/** Signed in, but this role may not do this at all. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 403, 'FORBIDDEN')
  }
}

/** The record does not exist, or the caller may not see it. Deliberately indistinguishable. */
export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(message, 404, 'NOT_FOUND')
  }
}

/** Input failed validation. `fields` maps a form field to its message, for showing on the form. */
export class ValidationError extends AppError {
  readonly fields: Record<string, string[]>

  constructor(fields: Record<string, string[]>, message = 'Please correct the highlighted fields.') {
    super(message, 422, 'VALIDATION')
    this.fields = fields
  }
}

/** A rule that is not about permissions, e.g. moving a job to ON_HOLD without a reason. */
export class RuleError extends AppError {
  constructor(message: string) {
    super(message, 422, 'RULE_VIOLATION')
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * The answer to an unexpected error in a route handler: a generic body, and the real one in the log.
 *
 * Prisma messages name tables, columns and constraints; the storage adapters put the whole upstream
 * response in theirs. Neither belongs in a response, including to a signed-in caller — and `/api/health`
 * is answered to anybody at all.
 */
export function internalError(error: unknown): Response {
  logger.error('request.unhandled', { error: errorMessage(error) })
  return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
}
