import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { useCallback } from 'react'
import { getLoa } from '@/loa-client'

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
}

export function ExternalLink({ href, onClick, rel, target, ...props }: Props) {
  const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    void getLoa()
      .openExternalUrl(href)
      .then((result) => {
        if (!result.ok) {
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      })
      .catch(() => {
        window.open(href, '_blank', 'noopener,noreferrer')
      })
  }, [href, onClick])

  const ariaLabel = props['aria-label']
    ? `${props['aria-label']} (opens in browser)`
    : undefined

  return (
    <a
      {...props}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      href={href}
      rel={rel ?? 'noopener noreferrer'}
      target={target ?? '_blank'}
      onClick={handleClick}
    />
  )
}
