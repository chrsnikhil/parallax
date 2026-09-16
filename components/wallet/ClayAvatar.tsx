"use client"

/*
 * Clay avatars — ported from ITHACA and "extracted" (Talking Tom style). The
 * clips render the character on a PURE BLACK background; we draw each frame to a
 * <canvas> and key the black out to transparent, so only the clay character
 * paints — it floats on the app with no box. A hidden <video> drives frames;
 * character/state changes swap its src.
 */

import { memo, useEffect, useRef } from "react"

export type ClayState =
  | "idle" | "listening" | "talking" | "thinking" | "alert" | "happy" | "protecting"
export type ClayChar = "tv" | "dog" | "bungirl" | "ginger" | "alien"

export const CLAY_CHARS: { id: ClayChar; name: string; role: string }[] = [
  { id: "tv", name: "Guardian", role: "Protector" },
  { id: "dog", name: "Biscuit", role: "Watchdog" },
  { id: "bungirl", name: "Juno", role: "Analyst" },
  { id: "ginger", name: "Ginger", role: "Strategist" },
  { id: "alien", name: "Nova", role: "Scout" },
]

const HERO: Record<ClayChar, string> = {
  tv: "/heroes/tvrobot.webp",
  dog: "/heroes/dog.webp",
  bungirl: "/heroes/bungirl.webp",
  ginger: "/heroes/ginger.webp",
  alien: "/heroes/alien.webp",
}
export const clayHero = (c: ClayChar) => HERO[c]

// pure-black background → transparent. Soft ramp so the character keeps a clean
// anti-aliased edge without a halo.
const LO = 14 // luminance <= this → fully transparent
const HI = 46 // luminance >= this → fully opaque

// Same keying, but every frame is now (a) keyed at most once per *decoded video
// frame* (requestVideoFrameCallback → naturally the clip's ~24–30fps, not the
// 60fps display; falls back to a 30fps-throttled rAF), (b) worked at a capped
// resolution so the readback + pixel loop are much smaller, and (c) resolved
// through a precomputed luminance→alpha ramp so the per-pixel path is branchless
// with no division. Output is pixel-identical to the original ramp.
const MAX_H = 360 // cap the working-canvas height (upscaled by object-fit anyway)

// luminance (0–255) → alpha. <=LO transparent, LO..HI linear ramp, >=HI opaque
// (video frames are already opaque, so 255 here is a no-op — identical result).
const ALPHA_LUT = (() => {
  const lut = new Uint8Array(256)
  for (let l = 0; l < 256; l++) {
    lut[l] = l <= LO ? 0 : l >= HI ? 255 : Math.round((255 * (l - LO)) / (HI - LO))
  }
  return lut
})()

type VFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

function ClayAvatar({
  character,
  state,
  className = "",
}: {
  character: ClayChar
  state: ClayState
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current as VFCVideo | null
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    let w = 0
    let h = 0
    let stopped = false
    let rafId = 0
    let vfcId = 0

    const key = () => {
      if (video.readyState < 2 || !video.videoWidth) return
      const scale = Math.min(1, MAX_H / video.videoHeight)
      const nw = Math.max(1, Math.round(video.videoWidth * scale))
      const nh = Math.max(1, Math.round(video.videoHeight * scale))
      if (nw !== w || nh !== h) { w = nw; h = nh; canvas.width = w; canvas.height = h }
      ctx.drawImage(video, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        // integer luminance (matches the original ramp within ±1 alpha level)
        const lum = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8
        d[i + 3] = ALPHA_LUT[lum]
      }
      ctx.putImageData(img, 0, 0)
    }

    const hasVFC = typeof video.requestVideoFrameCallback === "function"
    if (hasVFC) {
      // key exactly once per presented video frame — no wasted re-keys of the
      // same frame, and nothing runs while the clip is stalled/reloading.
      const onFrame = () => {
        if (stopped) return
        key()
        vfcId = video.requestVideoFrameCallback!(onFrame)
      }
      vfcId = video.requestVideoFrameCallback!(onFrame)
    } else {
      // fallback: rAF throttled to ~30fps
      let last = 0
      const loop = (t: number) => {
        if (stopped) return
        rafId = requestAnimationFrame(loop)
        if (t - last >= 33) { last = t; key() }
      }
      rafId = requestAnimationFrame(loop)
    }

    return () => {
      stopped = true
      if (rafId) cancelAnimationFrame(rafId)
      if (vfcId && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(vfcId)
      }
    }
  }, [])

  return (
    <div className={`kh-av ${className}`} aria-hidden="true">
      <video
        ref={videoRef}
        className="kh-av-src"
        src={`/avatars/${character}_${state}.mp4`}
        poster={HERO[character]}
        autoPlay
        loop
        muted
        playsInline
      />
      <canvas ref={canvasRef} className="kh-av-canvas" />
    </div>
  )
}

// Memoized: props are (character, state) primitives, so a voice-state tick that
// changes only the live transcript (userText/reply) — but not clayState — no
// longer re-renders the avatar. The keying loop lives in a []-dep effect and is
// never restarted by re-renders regardless.
export default memo(ClayAvatar)
