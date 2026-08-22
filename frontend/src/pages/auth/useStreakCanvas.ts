// The streak animation behind both sign-in pages.
//
// Lifted out of LoginPage so the guest page can wear the same motion in its own
// colour. `baseHue` is the only difference between them: 248 is the staff
// violet, and the guest page passes a blue. Everything else — the geometry, the
// trail fade, the timing — is shared, so the two read as one product.

import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useStreakCanvas(canvasRef: RefObject<HTMLCanvasElement>, baseHue = 248) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let animId: number
    let W = 0
    let H = 0

    function resize() {
      W = canvas!.width = window.innerWidth
      H = canvas!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function draw(time: number) {
      ctx.fillStyle = 'rgba(5, 5, 16, 0.14)'
      ctx.fillRect(0, 0, W, H)

      const fx = W * 0.07
      const fy = H * 0.68
      const COUNT = 190
      const dist = Math.sqrt(W * W + H * H) * 1.1

      for (let i = 0; i < COUNT; i++) {
        const t = i / COUNT
        const angle = -0.55 + t * 1.85
        const s1 = 0.00028 + t * 0.00018
        const s2 = 0.00019 + t * 0.00012

        const wave1 = Math.sin(time * s1 + t * 7.3) * H * 0.13
        const wave2 = Math.sin(time * s2 + t * 4.8 + 1.2) * H * 0.07

        const ex = fx + Math.cos(angle) * dist
        const ey = fy + Math.sin(angle) * dist

        const cp1x = fx + (ex - fx) * 0.32 + wave1 * 0.2
        const cp1y = fy + (ey - fy) * 0.32 + wave1
        const cp2x = fx + (ex - fx) * 0.64 + wave2 * 0.15
        const cp2y = fy + (ey - fy) * 0.64 + wave2

        const hue = baseHue + t * 55
        const pulse = 0.06 + Math.abs(Math.sin(time * 0.00035 + t * 9.1)) * 0.22
        const isFeature = i % 11 === 0
        const alpha = isFeature ? Math.min(pulse * 3.2, 0.85) : pulse
        const lineW = isFeature ? 1.1 + Math.sin(time * 0.0006 + t) * 0.4 : 0.35

        const midX = fx + (ex - fx) * 0.5
        const midY = fy + (ey - fy) * 0.5
        const grad = ctx.createLinearGradient(fx, fy, midX + (ex - fx) * 0.15, midY + (ey - fy) * 0.15)
        grad.addColorStop(0, `hsla(${hue}, 85%, 72%, 0)`)
        grad.addColorStop(0.18, `hsla(${hue}, 85%, 72%, ${alpha * 0.6})`)
        grad.addColorStop(0.5, `hsla(${hue}, 90%, 75%, ${alpha})`)
        grad.addColorStop(0.78, `hsla(${hue + 18}, 80%, 68%, ${alpha * 0.55})`)
        grad.addColorStop(1, `hsla(${hue + 35}, 70%, 62%, 0)`)

        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey)
        ctx.strokeStyle = grad
        ctx.lineWidth = lineW
        ctx.stroke()
      }

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [canvasRef, baseHue])
}
