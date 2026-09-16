import { readFileSync } from "node:fs";
import path from "node:path";

import PageScripts from "./PageScripts";
import WalletApp from "./WalletApp";

// The cloned markup lives in a .html file rather than inline in this component
// so it stays diffable and does not have to survive JSX escaping.
function markup() {
  return readFileSync(path.join(process.cwd(), "app", "body.html"), "utf8");
}

export default function Page() {
  return (
    <>
      {/*
        suppressHydrationWarning is load-bearing, not a silencer. This subtree is
        third-party markup that Webflow, GSAP and Rive mutate directly; React
        must not try to reconcile it. Without this, React re-creates the subtree
        on mismatch and every node reference the page scripts captured goes
        stale -- which is what stopped the intro animation rendering at all.
      */}
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: markup() }} />
      <PageScripts />
      {/* Original wallet cockpit — the dark landing where the hero scroll ends. */}
      <WalletApp />
    </>
  );
}
