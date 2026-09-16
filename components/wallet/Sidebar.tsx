"use client"

/*
 * Left rail of the bento: brand, section nav, and options. Minimal icon+label
 * rows; the active section is marked with a mint accent. Selecting a section
 * swaps the center of the bento (WalletApp owns the view state).
 */

import { memo, type ComponentType } from "react"
import { Command, Wallet, Workflow, ShieldCheck, Activity, Settings2, LifeBuoy } from "lucide-react"

import { BRAND } from "@/components/wallet/data"

export type ViewKey = "command" | "portfolio" | "automations" | "delegation" | "activity"

type Item = { key: ViewKey; label: string; Icon: ComponentType<{ className?: string }> }

const NAV: Item[] = [
  { key: "command", label: "Command", Icon: Command },
  { key: "portfolio", label: "Portfolio", Icon: Wallet },
  { key: "automations", label: "Automations", Icon: Workflow },
  { key: "delegation", label: "Delegation", Icon: ShieldCheck },
  { key: "activity", label: "Activity", Icon: Activity },
]

// Memoized: props are `view` (primitive) + `onSelect` (a stable setState
// setter), so the lucide icon subtree no longer re-renders on every voice tick —
// only when the selected view actually changes.
function Sidebar({
  view,
  onSelect,
}: {
  view: ViewKey
  onSelect: (v: ViewKey) => void
}) {
  return (
    <aside className="kh-side">
      <div className="kh-side-brand">
        <span className="kh-live on" aria-hidden="true" />
        {BRAND}
      </div>

      <nav className="kh-side-nav" aria-label="Sections">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`kh-side-item ${view === key ? "is-active" : ""}`}
            aria-current={view === key ? "page" : undefined}
            onClick={() => onSelect(key)}
          >
            <Icon className="kh-side-ic" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="kh-side-foot">
        <button type="button" className="kh-side-item">
          <Settings2 className="kh-side-ic" />
          <span>Settings</span>
        </button>
        <button type="button" className="kh-side-item">
          <LifeBuoy className="kh-side-ic" />
          <span>Support</span>
        </button>
      </div>
    </aside>
  )
}

export default memo(Sidebar)
