"use client";

import { useEffect } from "react";
import SCRIPTS from "./page-scripts.json";

type Entry = { src: string; type?: string };

// Module scope, NOT a ref: React StrictMode runs effects twice in dev, and a
// second pass would append every script again -- duplicate Rive instances,
// duplicate listeners, duplicate scroll handlers.
let started = false;

/**
 * Replays the body's scripts in document order.
 *
 * Order is load-bearing: jquery, four webflow chunks, the inline blocks, THEN
 * rive.min.js, THEN the block that calls into it. next/script's
 * afterInteractive makes no ordering promise across tags, so each is appended
 * one at a time and awaited.
 *
 * `type` is carried through. One block is type=module, which has different
 * semantics (deferred, strict, own scope) and resolves bare specifiers through
 * the import map in the head -- appending it as a classic script breaks it.
 *
 * A failed script resolves rather than rejects: one 404 should not strand every
 * script after it.
 */
export default function PageScripts() {
  useEffect(() => {
    if (started) return;
    started = true;
    (async () => {
      for (const entry of SCRIPTS as Entry[]) {
        await new Promise<void>((resolve) => {
          const el = document.createElement("script");
          el.src = entry.src;
          if (entry.type) el.type = entry.type;
          // async=false preserves execution order for appended scripts.
          el.async = false;
          el.onload = () => resolve();
          el.onerror = () => {
            console.warn("[clone] script failed:", entry.src);
            resolve();
          };
          document.body.appendChild(el);
        });
      }
    })();
  }, []);

  return null;
}
