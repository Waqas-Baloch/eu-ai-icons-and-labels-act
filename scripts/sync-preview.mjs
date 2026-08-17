/**
 * Copies the live theme-extension assets into the preview directory.
 *
 * The storefront preview loads the real eu-ai-disclosure.css and .js rather
 * than a mockup, so that page genuinely exercises the shipped overlay logic —
 * it is how the anchoring and theme-CSS-override bugs were found. This script
 * keeps the copies from going stale.
 */

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionAssets = join(root, "extensions", "ai-disclosure", "assets");
const preview = join(root, "preview");
const previewBadges = join(preview, "badges");

mkdirSync(previewBadges, { recursive: true });

for (const file of ["eu-ai-disclosure.css", "eu-ai-disclosure.js"]) {
  copyFileSync(join(extensionAssets, file), join(preview, file));
}

// The editor preview uses the app's real stylesheet, so a change to the
// editor's look shows up in the preview without being copied by hand.
copyFileSync(join(root, "app", "styles", "editor.css"), join(preview, "editor.css"));

let badges = 0;
for (const file of readdirSync(extensionAssets)) {
  if (!file.endsWith(".png")) continue;
  copyFileSync(join(extensionAssets, file), join(previewBadges, file));
  badges += 1;
}

// The admin's own badge preview is served from public/.
const publicBadges = join(root, "public", "badges");
mkdirSync(publicBadges, { recursive: true });
for (const file of readdirSync(extensionAssets)) {
  if (!file.endsWith(".png")) continue;
  copyFileSync(join(extensionAssets, file), join(publicBadges, file));
}

console.log(`Preview synced: 2 assets + ${badges} badges.`);
