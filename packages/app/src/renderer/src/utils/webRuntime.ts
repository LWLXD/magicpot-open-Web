export function isMagicPotWebRuntime(): boolean {
  if (typeof window === 'undefined') return false

  return Boolean(
    window.__MAGICPOT_WEB_RUNTIME__ ||
    window.__MAGICPOT_WEB__ ||
    (!window.electronFile &&
      (window.location.protocol === 'http:' || window.location.protocol === 'https:'))
  )
}

export type MagicPotWebUser = NonNullable<Window['__MAGICPOT_WEB__']>['user']

export function getMagicPotWebUser(): MagicPotWebUser | null {
  if (typeof window === 'undefined') return null
  return window.__MAGICPOT_WEB__?.user || null
}

export function isMagicPotWebAdmin(): boolean {
  return getMagicPotWebUser()?.role === 'admin'
}

export function canAccessWebAdminSurface(): boolean {
  const user = getMagicPotWebUser()
  if (!isMagicPotWebRuntime()) return true
  return user?.role === 'admin'
}

export function triggerBrowserDownload(
  bytes: BlobPart,
  fileName: string,
  mimeType = 'application/octet-stream'
): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type MagicPotWebImageClipboard = {
  bytes: Uint8Array
  mimeType: string
  fileName: string
  createdAt: number
}

const WEB_IMAGE_CLIPBOARD_MAX_AGE_MS = 30 * 60 * 1000

function getWebImageClipboardStore(): { value?: MagicPotWebImageClipboard } {
  const host = window as Window & {
    __MAGICPOT_WEB_IMAGE_CLIPBOARD__?: { value?: MagicPotWebImageClipboard }
  }
  host.__MAGICPOT_WEB_IMAGE_CLIPBOARD__ ||= {}
  return host.__MAGICPOT_WEB_IMAGE_CLIPBOARD__
}

export function setMagicPotWebImageClipboard(
  bytes: Uint8Array,
  mimeType = 'image/png',
  fileName = 'magicpot-clipboard.png'
): void {
  if (typeof window === 'undefined') return

  getWebImageClipboardStore().value = {
    bytes: new Uint8Array(bytes),
    mimeType,
    fileName,
    createdAt: Date.now()
  }
}

export function getMagicPotWebImageClipboardFile(): File | null {
  if (typeof window === 'undefined') return null

  const value = getWebImageClipboardStore().value
  if (!value) return null

  if (Date.now() - value.createdAt > WEB_IMAGE_CLIPBOARD_MAX_AGE_MS) {
    getWebImageClipboardStore().value = undefined
    return null
  }

  return new File([value.bytes as BlobPart], value.fileName, { type: value.mimeType })
}

export async function writeBlobToBrowserClipboard(blob: Blob, mimeType: string): Promise<void> {
  const clipboard = navigator.clipboard
  const ClipboardItemCtor = globalThis.ClipboardItem

  if (!clipboard?.write || !ClipboardItemCtor) {
    throw new Error('Current browser does not allow writing files to the clipboard.')
  }

  await clipboard.write([new ClipboardItemCtor({ [mimeType]: blob })])
}

export async function writeImageBytesToBrowserClipboard(
  bytes: Uint8Array,
  mimeType = 'image/png'
): Promise<void> {
  setMagicPotWebImageClipboard(bytes, mimeType)

  const blob = new Blob([bytes as BlobPart], { type: mimeType })

  try {
    await writeBlobToBrowserClipboard(blob, mimeType)
    return
  } catch (clipboardError) {
    console.warn(
      '[MagicPotWeb] Async image clipboard write failed; using MagicPot internal clipboard:',
      clipboardError
    )
  }
}

export async function writeTextToBrowserClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Current browser does not allow writing text to the clipboard.')
  }

  await navigator.clipboard.writeText(text)
}
