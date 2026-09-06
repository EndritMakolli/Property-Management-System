// Copy a value to the clipboard, with the tick that tells you it worked.
//
// Lifted out of the codes page so the reservation form uses the same button
// rather than a second one that behaves almost the same.
//
// `navigator.clipboard` needs a secure context: it is undefined over plain
// http on a phone, which is exactly where this gets used. The fallback keeps
// the button working there instead of failing silently.

import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type CopyButtonProps = {
  value: string
  /** Shown beside the icon. Omit for an icon-only button. */
  label?: string
  title?: string
  className?: string
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the legacy path rather than giving up.
  }
  try {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(field)
    return ok
  } catch {
    return false
  }
}

export function CopyButton({ value, label, title, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clearing on unmount: the modal this sits in can close mid-timeout.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function handleCopy() {
    if (!value.trim()) return
    if (await copyToClipboard(value)) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <button
      aria-label={title ?? `Copy ${label ?? 'value'}`}
      className={`copy-info-btn${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      disabled={!value.trim()}
      title={value.trim() ? (title ?? 'Copy to clipboard') : 'Nothing to copy'}
      type="button"
      onClick={handleCopy}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {label && <span>{copied ? 'Copied!' : label}</span>}
    </button>
  )
}
