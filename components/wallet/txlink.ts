/*
 * Open a transaction / explorer link in its own window. Called after a swap,
 * bridge, or transfer confirms. Browsers block window.open outside a user
 * gesture, so this returns whether the pop-up actually opened — the caller
 * surfaces a click-to-open card as the fallback when it didn't.
 */
export function openTxWindow(url?: string | null): boolean {
  if (!url || typeof window === "undefined") return false
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer")
    return !!w
  } catch {
    return false
  }
}

/** Dig a tx/explorer URL out of any tool response shape we produce. */
export function txUrlOf(res: unknown): string | undefined {
  if (!res || typeof res !== "object") return undefined
  const r = res as Record<string, any>
  if (typeof r.openUrl === "string") return r.openUrl
  if (r.tx && typeof r.tx.explorer === "string") return r.tx.explorer
  if (typeof r.explorer === "string") return r.explorer
  if (typeof r.link === "string" && /etherscan|explorer/.test(r.link)) return r.link
  return undefined
}

/** Dig a KeeperHub workflow URL out of a tool response (invest / build_workflow). */
export function wfUrlOf(res: unknown): string | undefined {
  if (!res || typeof res !== "object") return undefined
  const r = res as Record<string, any>
  if (r.workflow && typeof r.workflow.link === "string") return r.workflow.link
  if (typeof r.link === "string" && /keeperhub|workflows/.test(r.link)) return r.link
  return undefined
}
