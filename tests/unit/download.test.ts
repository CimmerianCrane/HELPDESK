import { describe, expect, it } from 'vitest'
import { attachmentFilename } from '@/lib/download'

/**
 * Downloads are served through one endpoint, so the filename in its `Content-Disposition` header is
 * the difference between "save as a PDF" and a file called `store`. Uploaded names can reach it, so
 * the header-breaking characters matter too.
 */

describe('attachmentFilename', () => {
  it('keeps an issued document number', () => {
    expect(attachmentFilename('SR2611001.pdf')).toBe('SR2611001.pdf')
  })

  it('removes quotes and line breaks an uploaded name could carry', () => {
    expect(attachmentFilename('a"b\r\nc.pdf')).toBe('abc.pdf')
  })

  it('falls back rather than sending an empty header', () => {
    expect(attachmentFilename('"')).toBe('download')
  })
})
