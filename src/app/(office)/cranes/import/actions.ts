'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { CsvError } from '@/lib/csv'
import { readCsvText } from '@/lib/import-file'
import type { FormState, ImportPreviewState } from '@/server/action-result'
import { requireAuth } from '@/server/auth/context'
import { applyCraneImport, previewCraneImport } from '@/server/cranes/import'

/**
 * The crane importer's two steps. Like the customer importer these cannot use `runAction`, because the
 * preview result carries row-by-row data the page renders rather than a single message.
 */

/** Carries the chosen customer alongside the shared preview shape, so the apply step can re-send it. */
export interface CraneImportPreviewState extends ImportPreviewState {
  customerId?: string
}

const MAX_FORM_BYTES = 3 * 1024 * 1024

async function readFile(formData: FormData): Promise<{ text: string } | { error: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV or Excel file first.' }
  if (file.size > MAX_FORM_BYTES) {
    return { error: 'That file is too large to upload. Split it into smaller files.' }
  }
  try {
    return { text: await readCsvText(Buffer.from(await file.arrayBuffer())) }
  } catch (error) {
    if (error instanceof CsvError) return { error: error.message }
    throw error
  }
}

function customerIdFrom(formData: FormData): string | null {
  const value = formData.get('customerId')
  return typeof value === 'string' && value.trim() ? value : null
}

export async function previewCraneImportAction(
  _previous: CraneImportPreviewState,
  formData: FormData,
): Promise<CraneImportPreviewState> {
  const context = await requireAuth()
  const customerId = customerIdFrom(formData)
  if (!customerId) return { ok: false, message: 'Choose which customer these cranes belong to.' }

  const read = await readFile(formData)
  if ('error' in read) return { ok: false, message: read.error, customerId }

  try {
    const preview = await previewCraneImport(context, customerId, Buffer.from(read.text, 'utf8'))

    if (preview.blocked) {
      return {
        ok: false,
        message: 'Nothing will be imported until the file is fixed.',
        fields: { _form: preview.errors },
        customerId,
      }
    }

    return {
      ok: true,
      message: `${preview.toCreate} to add, ${preview.toSkip} to skip. Nothing has been written yet.`,
      preview: {
        unknownColumns: preview.unknownColumns,
        recognisedColumns: preview.recognisedColumns,
        rows: preview.rows.map((row) => ({
          line: row.line,
          label: row.assetTag,
          outcome: row.outcome,
          ...(row.reason ? { reason: row.reason } : {}),
        })),
        toCreate: preview.toCreate,
        toSkip: preview.toSkip,
      },
      fileText: read.text,
      customerId,
    }
  } catch (error) {
    if (error instanceof CsvError) return { ok: false, message: error.message, customerId }
    throw error
  }
}

export async function applyCraneImportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requireAuth()
  const customerId = customerIdFrom(formData)
  const text = formData.get('fileText')

  if (!customerId) return { ok: false, message: 'Choose which customer these cranes belong to.' }
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'Preview a file first.' }
  }

  try {
    const outcome = await applyCraneImport(context, customerId, Buffer.from(text, 'utf8'))
    revalidatePath('/cranes')
    revalidatePath(`/customers/${customerId}`)
    redirect(`/cranes?imported=${outcome.created}&skipped=${outcome.skipped}`)
  } catch (error) {
    if (error instanceof CsvError) return { ok: false, message: error.message }
    if (error && typeof error === 'object' && 'digest' in error) throw error
    throw error
  }
}
