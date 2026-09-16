"use client"

// The Orb is already ported (WebGL, no Tailwind dependency) at app/orb.tsx and
// vendors its noise texture locally. Re-export it here so kit components that
// import "@/components/ui/orb" (e.g. voice-picker) resolve to the same instance.
export { Orb } from "@/app/orb"
export type { AgentState } from "@/app/orb"
