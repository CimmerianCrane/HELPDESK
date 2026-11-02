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

/**
 * What a CSV import's preview step hands back. Shared by every importer and by the form that renders
 * it, because the two columns the person actually reads — which row, and what will happen to it — are
 * the same whatever is being imported.
 */
export interface ImportPreviewState extends FormState {
  preview?: {
    unknownColumns: string[]
    recognisedColumns: string[]
    rows: Array<{ line: number; label: string; outcome: 'create' | 'skip'; reason?: string }>
    toCreate: number
    toSkip: number
  }
  /** The file, carried into the apply step so it does not have to be chosen twice. */
  fileText?: string
}

export async function runAction(fn: () => Promise<void>, successMessage: string): Promise<FormState> {
  try {
    await fn()
    return { ok: true, message: successMessage }
  } catch (error) {
    return toFormState(error)
  }
}

/**
 * Turns a thrown expected error into a form state, and rethrows anything else so it reaches the error
 * boundary and the logs.
 *
 * Exposed separately for the actions whose success message depends on what the service returned —
 * an assignment that proceeded over a warning succeeds, but the message has to say so.
 */
export function toFormState(error: unknown): FormState {
  if (isAppError(error)) {
    return {
      ok: false,
      message: error.message,
      ...(error instanceof ValidationError ? { fields: error.fields } : {}),
    }
  }
  throw error
}
