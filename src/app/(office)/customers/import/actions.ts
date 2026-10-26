'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CsvError } from '@/lib/csv'
import type { FormState, ImportPreviewState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { applyCustomerImport, previewCustomerImport } from '@/server/customers/import'

/**
 * Import actions. Unlike the other actions in this app these cannot use `runAction`, because both
 * results carry structured data the page renders (a row-by-row preview, a created count) rather than
 * one message. Expected failures are still turned into `FormState`; only unexpected ones propagate.
 */

/**
 * Vercel caps a server action's request body at 4.5 MB, and a file arrives base64/inline inside it.
 * Refusing anything over 3 MB here leaves room for the form's other fields and for the platform's
 * own overhead, so the user gets our message rather than a 413 from Vercel.
 */
const MAX_FORM_BYTES = 3 * 1024 * 1024

async function readFile(formData: FormData): Promise<{ text: string } | { error: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file first.' }
  }
  if (file.size > MAX_FORM_BYTES) {
    return { error: 'That file is too large to upload. Split it into smaller files.' }
  }
  return { text: await file.text() }
}

export async function previewImportAction(
  _previous: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  const context = await requireAuth()
  const read = await readFile(formData)

  if ('error' in read) {
    return { ok: false, message: read.error }
  }
  const text = read.text

  try {
    const preview = await previewCustomerImport(context, Buffer.from(text, 'utf8'))

    if (preview.blocked) {
      return {
        ok: false,
        message: 'Nothing will be imported until the file is fixed.',
        fields: { _form: preview.errors },
      }
    }

    return {
      ok: true,
      message: `${preview.toCreate} to create, ${preview.toSkip} to skip. Nothing has been written yet.`,
      preview: {
        unknownColumns: preview.unknownColumns,
        recognisedColumns: preview.recognisedColumns,
        rows: preview.rows.map((row) => ({
          line: row.line,
          label: row.legalName,
          outcome: row.outcome,
          ...(row.reason ? { reason: row.reason } : {}),
        })),
        toCreate: preview.toCreate,
        toSkip: preview.toSkip,
      },
      fileText: text,
    }
  } catch (error) {
    if (error instanceof CsvError) {
      return { ok: false, message: error.message }
    }
    throw error
  }
}

export async function applyImportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requireAuth()
  const text = formData.get('fileText')

  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'Preview a file first.' }
  }

  try {
    const outcome = await applyCustomerImport(context, Buffer.from(text, 'utf8'))
    revalidatePath('/customers')
    revalidatePath('/customers/import')
    redirect(`/customers?imported=${outcome.created}&skipped=${outcome.skipped}`)
  } catch (error) {
    // `redirect` throws internally; let Next's own control-flow error through untouched.
    if (error instanceof CsvError) {
      return { ok: false, message: error.message }
    }
    if (error && typeof error === 'object' && 'digest' in error) throw error
    throw error
  }
}
