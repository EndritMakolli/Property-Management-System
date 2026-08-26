// What counts as an apartment photo, decided in one place on this side.
//
// The picker used to say accept="image/*". That is every image format in
// existence, so the file dialog offered .heic and .tiff files the server was
// always going to refuse — and refuse one request at a time, after the upload,
// with the reason discarded. Naming the extensions here means the dialog greys
// out what cannot work, and anything that slips through is explained before a
// single byte is sent.
//
// Keep this list in step with ALLOWED_EXTENSIONS in views/_expense_ai.py. PDF
// is deliberately absent: the server accepts one as an invoice, but a PDF is
// not a photo of a bedroom.

export const ACCEPTED_PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'] as const

export const PHOTO_ACCEPT_ATTR = ACCEPTED_PHOTO_EXTENSIONS.join(',')

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

const UNSUPPORTED = 'Upload an image (JPG, PNG, WebP, AVIF or GIF).'
const TOO_LARGE = 'It is larger than 10 MB.'

/** How many names to print before falling back to a count. */
const NAMES_SHOWN = 3

export type PhotoRejection = { name: string; reason: string }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/** The reason this file cannot be uploaded, or '' if it can. */
export function rejectionFor(file: File): string {
  if (!ACCEPTED_PHOTO_EXTENSIONS.includes(extensionOf(file.name) as never)) {
    return UNSUPPORTED
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return TOO_LARGE
  }
  return ''
}

function nameList(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).filter(Boolean)
  if (shown.length === 0) {
    return ''
  }
  const rest = names.length - shown.length
  return rest > 0 ? ` (${shown.join(', ')} and ${rest} more)` : ` (${shown.join(', ')})`
}

/** One sentence per reason, however many files shared it.
 *
 *  Twelve identical "could not be uploaded" lines tell you nothing twelve
 *  times. Grouping by reason is what makes the message worth reading.
 */
export function uploadFailureMessage(rejections: PhotoRejection[]): string {
  if (rejections.length === 0) {
    return ''
  }

  const byReason = new Map<string, string[]>()
  for (const { name, reason } of rejections) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), name])
  }

  return [...byReason.entries()]
    .map(([reason, names]) => {
      const count =
        names.length === 1
          ? `“${names[0]}” could not be uploaded.`
          : `${names.length} photos could not be uploaded.${nameList(names)}`
      return reason ? `${count} ${reason}` : count
    })
    .join(' ')
}
