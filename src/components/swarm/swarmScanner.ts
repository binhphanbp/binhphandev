"use client";

import type { SwarmTarget, SwarmTargetKind } from "./swarmTypes";

const IGNORE_SELECTOR = "[data-swarm-ignore], script, style, noscript, svg, path";

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= 36 && rect.height >= 16;
}

function inferLabel(el: HTMLElement): string {
  const explicit = el.getAttribute("data-swarm-label");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  if (tag === "header") return "Header.tsx";
  if (tag === "footer") return "Footer.tsx";
  if (tag === "h1") return "Heading · H1";
  if (tag === "h2") return "SectionHeading · H2";
  if (tag === "h3") return "Subheading · H3";
  if (tag === "p") return "TextBlock · Body";
  if (tag === "a" || tag === "button") return "Interactive · Action";
  if (tag === "ul" || tag === "ol") return "ListGroup";
  return "Container · Flex";
}

function inferGroupKey(el: HTMLElement): string | null {
  const explicitGroup = el.getAttribute("data-swarm-group");
  if (explicitGroup) return explicitGroup;

  const parent = el.parentElement;
  if (!parent) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === "li") return `list-${parent.tagName}`;
  return null;
}

export function scanSwarmTargets(scope: "hero" | "full"): SwarmTarget[] {
  if (typeof document === "undefined") return [];

  const rawCandidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  const pushUnique = (el: HTMLElement | null) => {
    if (!el || seen.has(el)) return;
    if (el.matches(IGNORE_SELECTOR) || el.closest("[data-swarm-ignore]")) return;
    if (!isElementVisible(el)) return;
    seen.add(el);
    rawCandidates.push(el);
  };

  // 1. Floating Header Navigation Pill
  const navPill = document.querySelector<HTMLElement>("[data-swarm-target='nav-pill']");
  pushUnique(navPill);

  if (scope === "hero") {
    // Fast Hero Intro: strictly above-the-fold primary elements (max 5 items)
    const heroNodes = document.querySelectorAll<HTMLElement>(
      "[data-swarm-hero='true'], main h1, h1",
    );
    for (const node of Array.from(heroNodes)) {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.88) {
        pushUnique(node);
      }
    }

    // Fallback for pages without explicit hero tags (e.g. direct visit to /work or /blog)
    if (rawCandidates.length <= 2) {
      const fallbackTop = document.querySelectorAll<HTMLElement>("[data-swarm-target], h1, h2");
      for (const el of Array.from(fallbackTop)) {
        if (rawCandidates.length >= 5) break;
        const rect = el.getBoundingClientRect();
        if (rect.top >= 0 && rect.top < window.innerHeight * 0.72) {
          pushUnique(el);
        }
      }
    }
  } else {
    // Full-Page Rebuild: collect explicit annotated targets + rich semantic blocks
    const explicitTargets = document.querySelectorAll<HTMLElement>("[data-swarm-target]");
    for (const el of Array.from(explicitTargets)) {
      pushUnique(el);
    }

    // Also discover semantic MDX / article elements not wrapped inside an existing target
    const contentNodes = document.querySelectorAll<HTMLElement>("h1, h2, h3, p, ul, footer");
    for (const el of Array.from(contentNodes)) {
      let overlaps = false;
      for (const existing of seen) {
        if (existing === navPill) continue;
        if (existing.contains(el) || el.contains(existing)) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 80 && rect.height >= 20) {
          pushUnique(el);
        }
      }
    }
  }

  // Filter out nested parent-child overlaps
  const atomicFiltered = rawCandidates.filter((candidate) => {
    const isAtomic = candidate.hasAttribute("data-swarm-target");
    if (isAtomic) {
      for (const other of rawCandidates) {
        if (
          other !== candidate &&
          other.hasAttribute("data-swarm-target") &&
          other.contains(candidate)
        ) {
          return false;
        }
      }
      return true;
    }
    for (const other of rawCandidates) {
      if (other !== candidate && candidate.contains(other)) {
        return false;
      }
    }
    return true;
  });

  // Sort strictly in visual reading order (top-to-bottom, left-to-right)
  atomicFiltered.sort((a, b) => {
    if (a === navPill) return -1;
    if (b === navPill) return 1;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const topDiff = ra.top + window.scrollY - (rb.top + window.scrollY);
    if (Math.abs(topDiff) > 28) return topDiff;
    return ra.left - rb.left;
  });

  // Cap full rebuild to 22 crisp, meaningful blocks so Tour stays punchy and fast
  const capped = scope === "hero" ? atomicFiltered.slice(0, 5) : atomicFiltered.slice(0, 22);

  const lastGroupSource = new Map<string, HTMLElement>();
  let typewriterAssigned = 0;

  return capped.map((el, index) => {
    const explicitKind = el.getAttribute("data-swarm-kind") as SwarmTargetKind | null;
    const groupKey = inferGroupKey(el);
    let kind: SwarmTargetKind = "box";
    let sourceEl: HTMLElement | undefined;

    if (el === navPill || explicitKind === "nav") {
      kind = "nav";
    } else if (
      (explicitKind === "typewriter" || el.tagName === "H1") &&
      typewriterAssigned < (scope === "hero" ? 1 : 2)
    ) {
      const cleanText = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (cleanText.length >= 4 && cleanText.length <= 140) {
        kind = "typewriter";
        typewriterAssigned++;
      }
    } else if (groupKey && lastGroupSource.has(groupKey) && scope === "full") {
      kind = "duplicate";
      sourceEl = lastGroupSource.get(groupKey);
    }

    if (groupKey) {
      lastGroupSource.set(groupKey, el);
    }

    const textSnapshot =
      kind === "typewriter" ? (el.textContent || "").replace(/\s+/g, " ").trim() : undefined;

    return {
      id: `swarm-node-${index}`,
      el,
      kind,
      label: inferLabel(el),
      textSnapshot,
      sourceEl,
    };
  });
}
