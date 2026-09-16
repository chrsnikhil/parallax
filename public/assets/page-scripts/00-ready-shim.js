/*
 * DOMContentLoaded / load rescue for replayed scripts.
 *
 * The cloned page's scripts are appended AFTER React hydration, so by the time
 * they run the document is already "complete" and both DOMContentLoaded and
 * window load have long since fired. A script that registers a listener for
 * either -- as head-07 (Rive lazy-init) and 11-inline (video modal) do, with no
 * readyState guard -- would simply never execute its body.
 *
 * So: if the event being listened for has already happened, invoke the handler
 * on a macrotask instead of registering it. Every other event type passes
 * through untouched.
 */
(function () {
  function rescue(target, orig, firedTypes) {
    return function (type, fn, opts) {
      if (firedTypes.indexOf(type) !== -1 && typeof fn === "function") {
        setTimeout(function () {
          try {
            fn.call(target, new Event(type));
          } catch (e) {
            console.warn("[clone] late " + type + " handler threw:", e);
          }
        }, 0);
        return;
      }
      return orig(type, fn, opts);
    };
  }

  if (document.readyState !== "loading") {
    document.addEventListener = rescue(
      document, document.addEventListener.bind(document), ["DOMContentLoaded"]);
  }
  if (document.readyState === "complete") {
    window.addEventListener = rescue(
      window, window.addEventListener.bind(window), ["DOMContentLoaded", "load"]);
  }
})();
