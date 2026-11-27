"use client";

import type { SwarmSectionGroup, SwarmSlot, SwarmSlotKind } from "./swarmTypes";

const IGNORE_SELECTOR = "[data-swarm-ignore], script, style, noscript, svg, path";

function isVisible(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width >= 20 && r.height >= 10;
}

export function scanGranularSections(): SwarmSectionGroup[] {
  if (typeof document === "undefined") return [];

  const vh = window.innerHeight || 800;
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

  // Sort strictly top-to-bottom, left-to-right in document coordinates
  const withCoords = rawPieces.map((item) => {
    const r = item.el.getBoundingClientRect();
    return {
      ...item,
      docTop: r.top + scrollY,
      docLeft: r.left,
    };
  });

  withCoords.sort((a, b) => {
    const isNavA = a.el.getAttribute("data-swarm-target") === "nav-pill";
    const isNavB = b.el.getAttribute("data-swarm-target") === "nav-pill";
    if (isNavA && !isNavB) return -1;
    if (!isNavA && isNavB) return 1;

    const dy = a.docTop - b.docTop;
    if (Math.abs(dy) > 26) return dy;
    return a.docLeft - b.docLeft;
  });

  // Cap to 56 granular pieces so even very long pages stay crisp and 60fps
  const capped = withCoords.slice(0, 56);

  // Cluster pieces into cohesive visual sections (clusters separated by > 165px vertical gap)
  const sections: SwarmSectionGroup[] = [];
  let dragCounter = 0;

  for (let i = 0; i < capped.length; i++) {
    const item = capped[i];
    const isNav = item.el.getAttribute("data-swarm-target") === "nav-pill";

    let targetSection = sections[sections.length - 1];
    if (
      !targetSection ||
      (!isNav &&
        sections.length > 0 &&
        item.docTop - targetSection.slots[targetSection.slots.length - 1].docTop > 165 &&
        !(sections.length === 1 && item.docTop < vh * 0.72))
    ) {
      const secIdx = sections.length;
      const anchorTop = isNav ? 0 : item.docTop;
      const triggerScrollY = secIdx === 0 ? 0 : Math.max(24, anchorTop - vh * 0.72);
      targetSection = {
        index: secIdx,
        triggerScrollY,
        anchorTop,
        slots: [],
      };
      sections.push(targetSection);
    }

    let textSnapshot: string | undefined;
    if (item.kind === "type") {
      const clean = (item.el.textContent || "").replace(/\s+/g, " ").trim();
      if (clean.length >= 2 && clean.length <= 240) {
        textSnapshot = clean;
      }
    }

    let dragFrom: { dx: number; dy: number; tiltDeg: number } | undefined;
    if (item.kind === "drag") {
      const fromLeft = dragCounter % 2 === 0;
      dragCounter += 1;
      dragFrom = {
        dx: fromLeft ? -115 : 115,
        dy: 38 + (dragCounter % 3) * 14,
        tiltDeg: fromLeft ? -5.5 : 5.5,
      };
    }

    targetSection.slots.push({
      id: `slot-${i}`,
      el: item.el,
      kind: item.kind === "type" && !textSnapshot ? "draw" : item.kind,
      sectionIndex: targetSection.index,
      docTop: item.docTop,
      textSnapshot,
      dragFrom,
    });
  }

  return sections;
}
