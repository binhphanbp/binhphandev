"use client";

import type { SwarmSectionGroup, SwarmSlotKind } from "./swarmTypes";

const IGNORE_SELECTOR = "[data-swarm-ignore], script, style, noscript, svg, path";

function isVisible(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width >= 18 && r.height >= 8;
}

function classifyWave(el: HTMLElement, kind: SwarmSlotKind): 0 | 1 | 2 {
  if (el.getAttribute("data-swarm-target") === "nav-pill") return 0;
  if (el.closest("header")) return 0;
  if (kind === "draw" || kind === "line" || kind === "drag") return 0;

  if (kind === "type") {
    const hasPrimaryHeading =
      el.matches("h1, h2") || el.querySelector("h1, h2, [class*='display-strong']") !== null;
    return hasPrimaryHeading ? 0 : 1;
  }

  // Action buttons & CTA links land in wave 2 so copy & media establish first
  const isActionCta =
    kind === "fill" ||
    el.querySelector("a[href], button") !== null ||
    el.closest("a[href], button") !== null;
  if (isActionCta) {
    return 2;
  }

  return 1;
}

export function scanGranularSections(): SwarmSectionGroup[] {
  if (typeof document === "undefined") return [];

  const vh = window.innerHeight || 800;
  const vw = window.innerWidth || 1280;
  const scrollY = window.scrollY || 0;

  const rawPieces: { el: HTMLElement; kind: SwarmSlotKind }[] = [];
  const seen = new Set<HTMLElement>();

  const addPiece = (el: HTMLElement | null, kind: SwarmSlotKind) => {
    if (!el || seen.has(el)) return;
    if (el.matches(IGNORE_SELECTOR) || el.closest("[data-swarm-ignore]")) return;
    if (!isVisible(el)) return;
    seen.add(el);
    rawPieces.push({ el, kind });
  };

  // 1. Collect all explicitly annotated granular design pieces first
  const explicitPieces = document.querySelectorAll<HTMLElement>("[data-swarm-piece]");
  for (const el of Array.from(explicitPieces)) {
    const kindAttr = el.getAttribute("data-swarm-piece") as SwarmSlotKind | null;
    if (kindAttr) {
      addPiece(el, kindAttr);
    }
  }

  // 2. Fallback: also discover un-annotated semantic content (e.g. inside MDX articles / case studies)
  const semanticNodes = document.querySelectorAll<HTMLElement>(
    "main h1, main h2, main h3, article h2, article h3, article p, article li, section hr",
  );
  for (const el of Array.from(semanticNodes)) {
    let overlaps = false;
    for (const existing of seen) {
      if (existing.contains(el) || el.contains(existing)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const tag = el.tagName.toLowerCase();
    if (tag === "hr") {
      addPiece(el, "line");
    } else if (tag === "h1" || tag === "h2" || tag === "h3") {
      addPiece(el, "type");
    } else if (tag === "p" || tag === "li") {
      const txt = (el.textContent || "").trim();
      if (txt.length >= 8) {
        addPiece(el, txt.length <= 180 ? "type" : "draw");
      }
    }
  }

  // Sort top-to-bottom, left-to-right in document coordinates (keeping header items first)
  const withCoords = rawPieces.map((item) => {
    const r = item.el.getBoundingClientRect();
    const inHeader = item.el.closest("header") !== null;
    const sectionOwner = item.el.closest<HTMLElement>("[data-swarm-section]");
    return {
      ...item,
      inHeader,
      sectionOwner,
      rectW: r.width,
      rectH: r.height,
      docTop: inHeader ? Math.max(0, r.top) : r.top + scrollY,
      docLeft: r.left,
    };
  });

  withCoords.sort((a, b) => {
    if (a.inHeader && !b.inHeader) return -1;
    if (!a.inHeader && b.inHeader) return 1;

    const dy = a.docTop - b.docTop;
    if (Math.abs(dy) > 26) return dy;
    return a.docLeft - b.docLeft;
  });

  // Cap to 64 granular pieces so even very long pages stay crisp and 60fps
  const capped = withCoords.slice(0, 64);

  // Cluster pieces into cohesive visual sections (honoring [data-swarm-section] & >165px gaps)
  const sections: SwarmSectionGroup[] = [];
  let lastSectionOwner: HTMLElement | null = null;
  let dragCounter = 0;

  for (let i = 0; i < capped.length; i++) {
    const item = capped[i];

    let targetSection = sections[sections.length - 1];
    const ownerChanged =
      !item.inHeader &&
      item.sectionOwner !== null &&
      lastSectionOwner !== null &&
      item.sectionOwner !== lastSectionOwner;
    const enteredExplicitNonHeroSection =
      !item.inHeader &&
      sections.length === 1 &&
      item.sectionOwner !== null &&
      item.sectionOwner.getAttribute("data-swarm-section") !== "hero" &&
      lastSectionOwner?.getAttribute("data-swarm-section") === "hero";
    const gapExceeded =
      !item.inHeader &&
      targetSection !== undefined &&
      item.docTop - targetSection.slots[targetSection.slots.length - 1].docTop > 165 &&
      !(sections.length === 1 && item.docTop < vh * 0.62 && !enteredExplicitNonHeroSection);

    if (!targetSection || ownerChanged || enteredExplicitNonHeroSection || gapExceeded) {
      const secIdx = sections.length;
      const anchorTop = item.inHeader ? 0 : item.docTop;
      // Section 1+ requires scroll progression or clear viewport entry so below-hero cards wait their turn
      const triggerScrollY = secIdx === 0 ? 0 : Math.max(96, anchorTop - vh * 0.68);
      targetSection = {
        index: secIdx,
        triggerScrollY,
        anchorTop,
        slots: [],
      };
      sections.push(targetSection);
    }

    if (!item.inHeader && item.sectionOwner) {
      lastSectionOwner = item.sectionOwner;
    }

    let textSnapshot: string | undefined;
    const hasMultipleParagraphs = item.el.querySelectorAll("p, ul, li, br").length > 1;
    if (item.kind === "type" && !hasMultipleParagraphs) {
      const clean = (item.el.textContent || "").replace(/\s+/g, " ").trim();
      if (clean.length >= 2 && clean.length <= 260) {
        textSnapshot = clean;
      }
    }

    const effectiveKind: SwarmSlotKind = item.kind === "type" && !textSnapshot ? "draw" : item.kind;

    let dragFrom: { dx: number; dy: number; bend: number; tiltDeg: number } | undefined;
    if (effectiveKind === "drag") {
      const fromLeft = dragCounter % 2 === 0;
      const isLargeMedia = item.rectW > vw * 0.35 || item.rectH > 180;
      const travelX = isLargeMedia ? 235 : 135;
      dragCounter += 1;
      dragFrom = {
        dx: fromLeft ? -travelX : travelX,
        dy: (dragCounter % 2 === 0 ? -1 : 1) * (32 + (dragCounter % 3) * 14),
        bend: (fromLeft ? 1 : -1) * 0.18,
        tiltDeg: (fromLeft ? -1 : 1) * (4.4 + (dragCounter % 3) * 1.4),
      };
    }

    const cs = window.getComputedStyle(item.el);
    const rightAligned = cs.justifyContent === "flex-end" || item.docLeft > vw * 0.55;

    targetSection.slots.push({
      id: `slot-${i}`,
      el: item.el,
      kind: effectiveKind,
      sectionIndex: targetSection.index,
      docTop: item.docTop,
      wave: classifyWave(item.el, effectiveKind),
      rightAligned,
      textSnapshot,
      dragFrom,
    });
  }

  return sections;
}
