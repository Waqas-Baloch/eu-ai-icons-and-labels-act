import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

/**
 * Recover from a route chunk that no longer exists.
 *
 * Asset filenames are content-hashed, so every deploy replaces them. A merchant
 * who had the app open across a deploy is running the old build's manifest: the
 * moment they navigate, Remix asks for a chunk that is gone, the dynamic import
 * rejects, and the route renders *nothing at all*. Nothing throws, so no error
 * boundary catches it — the frame simply goes blank, which is indistinguishable
 * from a hang and is exactly how it presented while this app was being deployed
 * repeatedly.
 *
 * Vite fires `vite:preloadError` for precisely this. Reloading re-fetches the
 * document, and with it the current manifest, so the navigation completes on
 * the new build.
 *
 * Guarded against a reload loop: if reloading did not help — the chunk is
 * genuinely missing rather than stale — a second failure is left alone so the
 * page can fail visibly instead of refreshing forever.
 */
const RELOAD_MARKER = "eu-ai-act:chunk-reload";

window.addEventListener("vite:preloadError", (event) => {
  if (sessionStorage.getItem(RELOAD_MARKER)) return;
  event.preventDefault();
  sessionStorage.setItem(RELOAD_MARKER, String(Date.now()));
  window.location.reload();
});

// A completed navigation means the manifest is current; clear the guard so a
// later deploy can recover the same way.
window.addEventListener("load", () => {
  window.setTimeout(() => sessionStorage.removeItem(RELOAD_MARKER), 5_000);
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});
