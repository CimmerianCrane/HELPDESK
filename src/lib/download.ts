/**
 * A filename safe in `Content-Disposition`: ASCII only, no header-breaking characters.
 *
 * Names come from uploads as well as issued documents, so quotes and CR/LF are stripped rather
 * than trusted — either would break the header.
 */
export function attachmentFilename(filename: string): string {
  const safe = filename
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '')
    .trim()
  return safe || 'download'
}
