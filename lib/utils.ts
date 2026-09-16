import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * The shadcn/ElevenLabs `cn` helper. Guardian re-exports this from the `cn`
 * package; here we use the canonical clsx + tailwind-merge implementation so
 * conflicting Tailwind classes resolve predictably. Same call signature, so
 * every ported kit component works unchanged.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
