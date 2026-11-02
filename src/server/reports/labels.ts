import type { ReportStatus } from '@prisma/client'

/**
 * The words a report uses on screen. Kept apart from the services so a page can import them without
 * pulling a PDF renderer into the client bundle.
 */
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  AMENDED: 'Superseded',
  RETURNED: 'Sent back',
}

export const SAFE_TO_OPERATE_LABELS = {
  YES: 'Yes',
  NO: 'No',
  WITH_RESTRICTIONS: 'Yes, with restrictions',
} as const
