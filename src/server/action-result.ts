import { isAppError, ValidationError } from './auth/errors'

/**
 * What a server action hands back to its form.
 *
 * Three states, distinguished by two fields: nothing submitted yet (`ok`, no message), succeeded
 * (`ok`, with a message), failed (`not ok`, with a message and usually per-field errors).
 *
 * Expected failures — no permission, bad input, a broken business rule — come back as data the form
 * can render. Anything unexpected is rethrown, so it reaches the error boundary and the logs rather
 * than being swallowed into a form message.
 */
export interface FormState {
  ok: boolean
  message: string | null
  fields?: Record<string, string[]>
}

export const IDLE_FORM: FormState = { ok: true, message: null }

export async function runAction(fn: () => Promise<void>, successMessage: string): Promise<FormState> {
  try {
    await fn()
    return { ok: true, message: successMessage }
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        message: error.message,
        ...(error instanceof ValidationError ? { fields: error.fields } : {}),
      }
    }
    throw error
  }
}
