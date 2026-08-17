/**
 * EU AI Act disclosure overlay.
 *
 * Anchors the official EU label to product images the app assessed as needing
 * disclosure. Runs entirely on data already embedded in the page by the app
 * embed block — no network calls, no tracking, nothing personal read or sent.
 *
 * Deliberately conservative about the theme's DOM: it only ever adds an
 * absolutely positioned element and, where necessary, sets `position: relative`
 * on the image's immediate wrapper. It never moves, replaces or restyles the
 * theme's own nodes.
 */
(function () {
  "use strict";

  var DATA_ID = "eu-ai-act-disclosure-data";
  var MARK = "euAiBadged";

  var config = null;
  try {
    var node = document.getElementById(DATA_ID);
    if (!node) return;
    config = JSON.parse(node.textContent || "{}");
  } catch (error) {
    return;
  }

  var byFile = (config.images && config.images.byFile) || {};
  if (!Object.keys(byFile).length) return;

  var LABEL_TEXT = {
    ai_generated: "AI generated",
    ai_modified: "AI modified",
    ai: "Contains AI generated content",
  };

  /**
   * Normalises a Shopify CDN image URL to a filename key.
   *
   * MUST stay in step with imageFileKey() in app/lib/metafields.server.ts —
   * the two are the only thing joining a rendered <img> to a stored decision,
   * and a divergence makes badges silently stop appearing.
   */
  function fileKey(url) {
    if (!url) return "";
    var withoutQuery = String(url).split("?")[0];
    var filename = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
    return filename
      .replace(/_(\d+x\d*|\d*x\d+)(?=\.[a-z0-9]+$)/i, "")
      .replace(
        /_(pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.[a-z0-9]+$)/i,
        "",
      )
      .toLowerCase();
  }

  function decisionFor(img) {
    // currentSrc reflects what the browser actually picked from a srcset.
    var candidates = [img.currentSrc, img.getAttribute("src"), img.dataset.src];
    for (var i = 0; i < candidates.length; i++) {
      var key = fileKey(candidates[i]);
      if (key && byFile[key]) return byFile[key];
    }
    return null;
  }

  function shouldLabel(decision) {
    if (!decision) return false;
    if (decision.state === "required" || decision.state === "reduced") return true;
    // Unresolved images only carry a label when the merchant opted into
    // provisional labelling, which the app signals by writing a variant.
    return decision.state === "unknown" && decision.label && decision.label !== "none";
  }

  /**
   * Resolves the artwork for a label, honouring a per-image style override
   * before falling back to the block setting.
   */
  function assetFor(variant, style) {
    var set = config.assets && config.assets[variant];
    if (!set) return null;
    return set[style] || set[config.style] || set.black || set.black_transparent || null;
  }

  /** Guards a stored fraction, so a bad value cannot push the badge off-image. */
  function clamp01(value) {
    if (typeof value !== "number" || !isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  function sizeClassFor(img) {
    var width = img.clientWidth || img.naturalWidth || 0;
    // A medium badge on a 90px gallery thumb looks broken; step it down rather
    // than skipping the image, since a customer may see the thumbnail first.
    if (width && width < 200) return "small";
    return config.size || "medium";
  }

  function badgeFor(decision, img) {
    var variant = decision.label;
    if (!variant || variant === "none") return null;

    // Per-image overrides win over the block settings; absent keys inherit, so
    // changing the shop default still moves every image that never opted out.
    var src = assetFor(variant, decision.style);
    if (!src) return null;

    var wrapper = document.createElement("span");

    // A stored free position wins; otherwise fall back to the corner preset,
    // which is what images the merchant never opened still use.
    var hasFree = typeof decision.x === "number" && typeof decision.y === "number";

    if (hasFree) {
      wrapper.className =
        "eu-ai-badge eu-ai-badge--overlay eu-ai-badge--free";
      wrapper.style.setProperty("--eu-ai-x", String(clamp01(decision.x)));
      wrapper.style.setProperty("--eu-ai-y", String(clamp01(decision.y)));
      // Height as a percentage of the image, so the badge scales with it.
      // Set on the wrapper only — the artwork fills the wrapper, and setting
      // the percentage on both would apply it twice.
      var pct = Math.min(20, Math.max(2, typeof decision.h === "number" ? decision.h : 6));
      wrapper.style.height = pct + "%";
    } else {
      var corner = decision.corner || config.placement || "bottom_left";
      wrapper.className =
        "eu-ai-badge eu-ai-badge--" +
        sizeClassFor(img) +
        " eu-ai-badge--overlay eu-ai-badge--" +
        String(corner).replace(/_/g, "-");
    }
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", LABEL_TEXT[variant] || "AI generated");

    var image = document.createElement("img");
    image.className = "eu-ai-badge__img";
    image.src = src;
    image.alt = LABEL_TEXT[variant] || "AI generated";
    image.loading = "lazy";
    image.decoding = "async";

    wrapper.appendChild(image);
    return wrapper;
  }

  var HUG_TOLERANCE = 40;

  /** True when `el` tightly bounds the image on both axes. */
  function hugs(el, img) {
    var box = el.getBoundingClientRect();
    var imgBox = img.getBoundingClientRect();
    return (
      imgBox.width > 0 &&
      box.width > 0 &&
      box.width - imgBox.width < HUG_TOLERANCE &&
      box.height - imgBox.height < HUG_TOLERANCE
    );
  }

  /**
   * Wraps an image in a positioned span so a badge can be anchored to it.
   *
   * Necessary because real themes rarely give an image a parent that bounds it
   * on both axes: a main image usually shares its wrapper with the thumbnail
   * strip, and thumbnails sit in a wide flex row. Positioning against either
   * would put the badge on the wrong part of the page — or, as the first
   * version of this function did, give up and render nothing at all.
   *
   * The wrapper inherits the image's own display so it occupies the same space
   * in the theme's layout, and the image itself is never restyled.
   */
  function wrapImage(img) {
    // <picture> may only contain <source> and <img>, so wrap the picture.
    var target =
      img.parentElement && img.parentElement.tagName === "PICTURE"
        ? img.parentElement
        : img;

    var existing = target.parentElement;
    if (existing && existing.classList.contains("eu-ai-anchored")) return existing;

    var display = window.getComputedStyle(target).display;
    var wrapper = document.createElement("span");
    wrapper.className = "eu-ai-anchored";
    wrapper.style.position = "relative";
    wrapper.style.display = display === "inline" ? "inline-block" : display;
    wrapper.style.maxWidth = "100%";

    target.parentNode.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    return wrapper;
  }

  /**
   * Finds or creates the element to anchor the badge to.
   *
   * Prefers leaving the DOM alone: an already-positioned ancestor that bounds
   * the image is used as-is, and a static parent that bounds it is merely
   * promoted. Wrapping is the last resort, but it always succeeds — the badge
   * has to render, because a silently missing label is an undisclosed image.
   */
  function anchorFor(img) {
    var parent = img.parentElement;
    var depth = 0;

    while (parent && depth < 3) {
      if (parent.classList.contains("eu-ai-anchored")) return parent;

      var position = window.getComputedStyle(parent).position;
      var positioned =
        position === "relative" || position === "absolute" || position === "sticky";

      if (positioned && hugs(parent, img)) return parent;

      if (depth === 0 && hugs(parent, img)) {
        parent.classList.add("eu-ai-anchored");
        return parent;
      }

      parent = parent.parentElement;
      depth++;
    }

    return wrapImage(img);
  }

  function decorate(img) {
    if (!img || img.dataset[MARK]) return;

    var decision = decisionFor(img);
    if (!shouldLabel(decision)) return;

    var anchor = anchorFor(img);
    if (!anchor) return;

    // Mark only once an anchor exists. Marking earlier — as an earlier version
    // did — meant a single failed anchoring pass permanently suppressed the
    // label for that image.
    img.dataset[MARK] = "1";

    if (anchor.querySelector(":scope > .eu-ai-badge--overlay")) return;

    var badge = badgeFor(decision, img);
    if (badge) anchor.appendChild(badge);
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var images = scope.querySelectorAll("img:not([data-eu-ai-badged])");
    for (var i = 0; i < images.length; i++) {
      // Images still loading have no dimensions yet, which breaks the anchor
      // heuristic — wait for them.
      if (images[i].complete) {
        decorate(images[i]);
      } else {
        images[i].addEventListener("load", function () {
          decorate(this);
        });
      }
    }
  }

  function start() {
    scan(document);

    // Themes swap gallery images on variant change and lazy-load below the
    // fold, so a one-time pass would miss most of a product page.
    if (typeof MutationObserver === "function") {
      var pending = false;
      var observer = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(function () {
          pending = false;
          scan(document);
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
