"use client";

import { person } from "@/resources";
import { usePathname } from "next/navigation";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./SwarmStudio.module.scss";
import { swarmAudio } from "./swarmAudio";
import { scanGranularSections } from "./swarmScanner";
import {
  SWARM_AGENTS,
  type SwarmAgentSpec,
  type SwarmContextValue,
  type SwarmMode,
  type SwarmSectionGroup,
  type SwarmSkill,
  type SwarmSlot,
  type SwarmSlotKind,
} from "./swarmTypes";

const SwarmContext = createContext<SwarmContextValue | null>(null);

export function useSwarm(): SwarmContextValue {
  const ctx = useContext(SwarmContext);
  if (!ctx) {
    throw new Error("useSwarm must be used within a SwarmProvider");
  }
  return ctx;
}

const GATE_SESSION_KEY = "bp_swarm_gate_v2";
const MODE_SESSION_KEY = "bp_swarm_mode_v2";

// Figma stemmed arrow SVG path (18x22)
const FIGMA_ARROW_PATH = "M1.5 1.5v16.2l4.3-4.1 2.9 6.6 3-1.3-2.9-6.5h6z";

interface AgentRuntime {
  spec: SwarmAgentSpec;
  el: HTMLDivElement;
  innerEl: HTMLDivElement;
  crosshairEl: HTMLDivElement;
  labelEl: HTMLDivElement;
  x: number;
  y: number;
  vx: number;
  fromX: number;
  fromY: number;
  bendSign: number;
  labelAlpha: number;
  targetLabelAlpha: number;
  busySlotId: string | null;
  scoutSlotId: string | null;
  holdTimer: number;
  pressTimer: number;
  isHoldingDrag: boolean;
  isDrawingCrosshair: boolean;
  jobCount: number;
  seedFreqs: [number, number, number, number];
  seedPhases: [number, number, number, number];
}

interface SlotRuntime {
  slot: SwarmSlot;
  state: "pending" | "waiting" | "approaching" | "active" | "done";
  t: number;
  approachT: number;
  approachDur: number;
  delayRemaining: number;
  durationSec: number;
  agentId: number;
  reservedAgentId: number | null;
  grabOffsetX: number;
  grabOffsetY: number;
  selEl: HTMLDivElement | null;
  badgeEl: HTMLDivElement | null;
  ghostEl: HTMLDivElement | null;
  typedSpan: HTMLSpanElement | null;
  untypedSpan: HTMLSpanElement | null;
  caretBarEl: HTMLDivElement | null;
  guideVEl: HTMLDivElement | null;
  guideHEl: HTMLDivElement | null;
  guideBadgeEl: HTMLDivElement | null;
  lastCharCount: number;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function preferredSkillForKind(kind: SwarmSlotKind): SwarmSkill {
  if (kind === "type") return "type";
  if (kind === "drag" || kind === "pop") return "move";
  if (kind === "fill") return "color";
  return "draw";
}

function isFullscreenModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  if (document.body.style.overflow === "hidden") return true;
  return document.querySelector(".cursor-zoom-out, [aria-modal='true'], [role='dialog']") !== null;
}

function findTextStyleHost(el: HTMLElement): HTMLElement {
  return (
    el.querySelector<HTMLElement>("h1, h2, h3, p, [class*='display'], [class*='heading']") ??
    (el.firstElementChild as HTMLElement | null) ??
    el
  );
}

// Compute the exact live viewport coordinates where an agent clicks down to begin a slot
function getSlotStartPoint(sr: SlotRuntime): { x: number; y: number } {
  const el = sr.slot.el;
  const r = el.getBoundingClientRect();
  const kind = sr.slot.kind;

  if (kind === "draw") {
    return { x: r.left, y: r.top };
  }
  if (kind === "drag") {
    const df = sr.slot.dragFrom ?? { dx: -160, dy: 36, bend: 0.16, tiltDeg: -5 };
    return {
      x: r.left + df.dx + sr.grabOffsetX,
      y: r.top + df.dy + sr.grabOffsetY,
    };
  }
  if (kind === "type") {
    return {
      x: r.left + 8,
      y: r.top + Math.min(24, Math.max(12, r.height * 0.42)),
    };
  }
  if (kind === "line") {
    return {
      x: sr.slot.rightAligned ? r.right : r.left,
      y: r.top + r.height * 0.5,
    };
  }
  return {
    x: r.left + r.width * 0.48,
    y: r.top + r.height * 0.52,
  };
}

// Measure exact pixel caret position of the N-th character using Range.getClientRects()
function measureCaretPosition(
  sr: SlotRuntime,
  fallbackRect: DOMRect,
  sharedRange: Range | null,
): { x: number; top: number; height: number } {
  const defaultHeight = Math.min(44, Math.max(16, fallbackRect.height * 0.82));
  if (!sharedRange) {
    return { x: fallbackRect.left + 2, top: fallbackRect.top + 2, height: defaultHeight };
  }

  try {
    const typedNode = sr.typedSpan?.firstChild;
    if (typedNode && typedNode.nodeType === Node.TEXT_NODE) {
      const len = typedNode.textContent?.length ?? 0;
      // Walk back up to 3 chars in case a trailing space sits at a soft wrap boundary
      for (let idx = len - 1; idx >= Math.max(0, len - 3); idx--) {
        sharedRange.setStart(typedNode, idx);
        sharedRange.setEnd(typedNode, idx + 1);
        const rects = sharedRange.getClientRects();
        if (rects.length > 0) {
          const last = rects[rects.length - 1];
          if (last.height > 0) {
            return { x: last.right, top: last.top, height: last.height };
          }
        }
      }
    }

    const untypedNode = sr.untypedSpan?.firstChild;
    if (untypedNode && untypedNode.nodeType === Node.TEXT_NODE) {
      const uLen = untypedNode.textContent?.length ?? 0;
      if (uLen > 0) {
        sharedRange.setStart(untypedNode, 0);
        sharedRange.setEnd(untypedNode, 1);
        const rects = sharedRange.getClientRects();
        if (rects.length > 0 && rects[0].height > 0) {
          return { x: rects[0].left, top: rects[0].top, height: rects[0].height };
        }
      }
    }
  } catch {
    // Fallback cleanly if DOM text node changed mid-frame
  }

  return { x: fallbackRect.left + 2, top: fallbackRect.top + 2, height: defaultHeight };
}

function createSelectionBox(
  layer: HTMLElement,
  agent: SwarmAgentSpec,
  kind: SwarmSlotKind,
): { selEl: HTMLDivElement; badgeEl: HTMLDivElement | null } {
  const cls = [
    styles.selBox,
    kind === "draw" ? styles.selBoxDraw : "",
    kind === "type" ? styles.selBoxType : "",
  ]
    .filter(Boolean)
    .join(" ");

  const selEl = document.createElement("div");
  selEl.className = cls;
  selEl.style.setProperty("--c", agent.color);
  selEl.style.setProperty("--ink", agent.ink);

  let badgeEl: HTMLDivElement | null = null;

  if (kind === "draw" || kind === "drag" || kind === "fill" || kind === "pop") {
    for (const hCls of [
      styles.selHandleTL,
      styles.selHandleTR,
      styles.selHandleBL,
      styles.selHandleBR,
    ]) {
      const h = document.createElement("span");
      h.className = hCls;
      selEl.appendChild(h);
    }
  }

  if (kind === "draw" || kind === "line") {
    badgeEl = document.createElement("div");
    badgeEl.className = styles.selBadge;
    selEl.appendChild(badgeEl);
  }

  layer.appendChild(selEl);
  return { selEl, badgeEl };
}

function spawnRing(layer: HTMLElement | null, x: number, y: number, color: string) {
  if (!layer) return;
  const ring = document.createElement("div");
  ring.className = styles.agentRing;
  ring.style.left = `${Math.round(x)}px`;
  ring.style.top = `${Math.round(y)}px`;
  ring.style.setProperty("--c", color);
  layer.appendChild(ring);
  window.setTimeout(() => ring.remove(), 480);
}

function celebrateSlot(
  fxLayer: HTMLElement | null,
  el: HTMLElement,
  burstX: number,
  burstY: number,
  color: string,
) {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return;

  // 1. Subtle WAAPI elastic settle on small/medium items
  if (r.height < 420 && typeof el.animate === "function") {
    try {
      el.animate(
        [{ transform: "scale(1.03)" }, { transform: "scale(0.99)" }, { transform: "scale(1)" }],
        { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    } catch {
      // Ignore if element doesn't support WAAPI
    }
  }

  if (!fxLayer) return;

  // 2. Expanding frame outline pulse
  if (r.width >= 16 && r.height >= 12) {
    const pulse = document.createElement("div");
    pulse.className = styles.pulseOutline;
    pulse.style.left = `${Math.round(r.left)}px`;
    pulse.style.top = `${Math.round(r.top)}px`;
    pulse.style.width = `${Math.round(r.width)}px`;
    pulse.style.height = `${Math.round(r.height)}px`;
    pulse.style.setProperty("--c", color);
    fxLayer.appendChild(pulse);
    window.setTimeout(() => pulse.remove(), 700);
  }

  // 3. Radiating 4-point stars & circles burst right from the cursor's release point
  const originX = Math.round(clamp(burstX, 16, window.innerWidth - 16));
  const originY = Math.round(clamp(burstY, 16, window.innerHeight - 16));
  const count = 7;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
    const dist = 18 + Math.random() * 24;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;

    const spark = document.createElement("div");
    spark.className = `${styles.spark} ${i % 2 === 0 ? styles.sparkStar : ""}`;
    spark.style.left = `${originX}px`;
    spark.style.top = `${originY}px`;
    spark.style.setProperty("--c", color);
    spark.style.setProperty("--dx", `${dx.toFixed(1)}px`);
    spark.style.setProperty("--dy", `${dy.toFixed(1)}px`);
    fxLayer.appendChild(spark);
    window.setTimeout(() => spark.remove(), 640);
  }
}

// Pick a strictly FREE agent (busySlotId === null) so no two active slots ever share a cursor
function claimFreeAgentForSlot(agents: AgentRuntime[], sr: SlotRuntime): AgentRuntime | null {
  if (sr.reservedAgentId !== null) {
    const reserved = agents[sr.reservedAgentId];
    if (reserved && reserved.busySlotId === null) {
      return reserved;
    }
  }

  const wanted = preferredSkillForKind(sr.slot.kind);
  const startPt = getSlotStartPoint(sr);
  let best: AgentRuntime | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const ag of agents) {
    if (ag.busySlotId !== null) continue;
    // Prefer agents not currently scouting a different slot unless needed
    const scoutingOtherPenalty = ag.scoutSlotId !== null && ag.scoutSlotId !== sr.slot.id ? 10 : 0;
    const dist = Math.hypot(startPt.x - ag.x, startPt.y - ag.y);
    const skillBonus = ag.spec.skill === wanted ? -15 : 0;
    const score = ag.jobCount * 3.8 + dist * 0.008 + scoutingOtherPenalty + skillBonus;
    if (score < bestScore) {
      bestScore = score;
      best = ag;
    }
  }

  return best;
}

export const SwarmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  const [mode, setMode] = useState<SwarmMode>("present");
  const [gateClosing, setGateClosing] = useState(false);
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  // Engine Mutable Refs
  const modeRef = useRef<SwarmMode>("present");
  const autoScrollRef = useRef<boolean>(false);
  const scrollAccumRef = useRef<number>(0);
  const holdUntilRef = useRef<number>(0);
  const sectionsRef = useRef<SwarmSectionGroup[]>([]);
  const slotsRef = useRef<SlotRuntime[]>([]);
  const activatedSectionsRef = useRef<Set<number>>(new Set());
  const agentsRef = useRef<AgentRuntime[]>([]);
  const fxBudgetRef = useRef<number>(0);
  const sharedRangeRef = useRef<Range | null>(null);
  const userPointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -999,
    y: -999,
    active: false,
  });

  // Overlay DOM Refs
  const agentLayerRef = useRef<HTMLDivElement | null>(null);
  const selLayerRef = useRef<HTMLDivElement | null>(null);
  const fxLayerRef = useRef<HTMLDivElement | null>(null);

  // User Custom Multiplayer Cursor Refs
  const userCursorLayerRef = useRef<HTMLDivElement | null>(null);
  const userCursorRootRef = useRef<HTMLDivElement | null>(null);
  const userCursorLabelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    modeRef.current = mode;
    if (typeof document !== "undefined") {
      if (mode === "gate") {
        document.documentElement.setAttribute("data-swarm-gate", "true");
      } else {
        document.documentElement.removeAttribute("data-swarm-gate");
      }
    }
  }, [mode]);

  useEffect(() => {
    autoScrollRef.current = autoScrolling;
    if (typeof document !== "undefined") {
      if (autoScrolling) {
        document.documentElement.setAttribute("data-swarm-autoscroll", "true");
        scrollAccumRef.current = window.scrollY;
      } else {
        document.documentElement.removeAttribute("data-swarm-autoscroll");
      }
    }
  }, [autoScrolling]);

  // Clean up all inline styles & temporary selection DOM nodes
  const cleanupBuildArtifacts = useCallback(() => {
    for (const sr of slotsRef.current) {
      const el = sr.slot.el;
      el.removeAttribute("data-swarm-unbuilt");
      el.style.clipPath = "";
      el.style.transform = "";
      el.style.transformOrigin = "";
      el.style.opacity = "";
      sr.selEl?.remove();
      sr.ghostEl?.remove();
      sr.caretBarEl?.remove();
      sr.guideVEl?.remove();
      sr.guideHEl?.remove();
      sr.guideBadgeEl?.remove();
      sr.selEl = null;
      sr.ghostEl = null;
      sr.caretBarEl = null;
      sr.guideVEl = null;
      sr.guideHEl = null;
      sr.guideBadgeEl = null;
    }
    slotsRef.current = [];
    sectionsRef.current = [];
    activatedSectionsRef.current.clear();

    for (const ag of agentsRef.current) {
      ag.busySlotId = null;
      ag.scoutSlotId = null;
      ag.isHoldingDrag = false;
      ag.isDrawingCrosshair = false;
      ag.crosshairEl.classList.remove(styles.agentCrosshairActive);
    }

    if (typeof document !== "undefined") {
      const leftover = document.querySelectorAll<HTMLElement>("[data-swarm-unbuilt]");
      for (const el of Array.from(leftover)) {
        el.removeAttribute("data-swarm-unbuilt");
        el.style.clipPath = "";
        el.style.transform = "";
        el.style.opacity = "";
      }
    }

    if (selLayerRef.current) selLayerRef.current.innerHTML = "";
    if (fxLayerRef.current) fxLayerRef.current.innerHTML = "";
  }, []);

  // Spawn or reset the 8 Figma Swarm Cursor DOM nodes
  const ensureAgentsMounted = useCallback((blurred = false) => {
    const layer = agentLayerRef.current;
    if (!layer || typeof window === "undefined") return;

    if (!sharedRangeRef.current && typeof document !== "undefined") {
      sharedRangeRef.current = document.createRange();
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (agentsRef.current.length === 0) {
      layer.innerHTML = "";
      agentsRef.current = SWARM_AGENTS.map((spec, i) => {
        const el = document.createElement("div");
        el.className = `${styles.agentNode} ${blurred ? styles.agentBlurred : ""}`;
        el.style.setProperty("--c", spec.color);
        el.style.setProperty("--ink", spec.ink);
        el.innerHTML = `
          <div class="${styles.agentInner}">
            <div class="${styles.agentCrosshair}"></div>
            <svg class="${styles.agentArrow}" viewBox="0 0 18 22" fill="none">
              <path d="${FIGMA_ARROW_PATH}" fill="${spec.color}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="${styles.agentLabel}">${spec.name}</div>
        `;
        const innerEl = el.querySelector(`.${styles.agentInner}`) as HTMLDivElement;
        const crosshairEl = el.querySelector(`.${styles.agentCrosshair}`) as HTMLDivElement;
        const labelEl = el.querySelector(`.${styles.agentLabel}`) as HTMLDivElement;
        layer.appendChild(el);

        const hx = Math.round(spec.homeSpot[0] * vw);
        const hy = Math.round(spec.homeSpot[1] * vh);
        el.style.transform = `translate3d(${hx}px, ${hy}px, 0)`;

        return {
          spec,
          el,
          innerEl,
          crosshairEl,
          labelEl,
          x: hx,
          y: hy,
          vx: 0,
          fromX: hx,
          fromY: hy,
          bendSign: i % 2 === 0 ? 1 : -1,
          labelAlpha: 0.85,
          targetLabelAlpha: 0.85,
          busySlotId: null,
          scoutSlotId: null,
          holdTimer: 0,
          pressTimer: 0,
          isHoldingDrag: false,
          isDrawingCrosshair: false,
          jobCount: 0,
          seedFreqs: [
            0.36 + ((i * 17) % 10) * 0.045,
            0.51 + ((i * 23) % 10) * 0.04,
            0.42 + ((i * 31) % 10) * 0.045,
            0.59 + ((i * 13) % 10) * 0.038,
          ],
          seedPhases: [i * 1.15, i * 2.35, i * 0.75, i * 3.05],
        };
      });
    } else {
      for (const ag of agentsRef.current) {
        ag.el.classList.toggle(styles.agentBlurred, blurred);
        ag.busySlotId = null;
        ag.scoutSlotId = null;
        ag.holdTimer = 0;
        ag.pressTimer = 0;
        ag.isHoldingDrag = false;
        ag.isDrawingCrosshair = false;
        ag.crosshairEl.classList.remove(styles.agentCrosshairActive);
        ag.jobCount = 0;
        ag.targetLabelAlpha = 0.85;
      }
    }
  }, []);

  const hideAllAgents = useCallback(() => {
    if (agentLayerRef.current) {
      agentLayerRef.current.innerHTML = "";
    }
    agentsRef.current = [];
  }, []);

  // Initialize Granular Build Choreography on Current Page
  const initializeBuildForCurrentPage = useCallback(
    (startAutoScroll: boolean) => {
      if (typeof window === "undefined") return;

      cleanupBuildArtifacts();
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      scrollAccumRef.current = 0;
      // Hold initial viewport at top while Hero builds so H1 never scrolls under the sticky navbar
      holdUntilRef.current = performance.now() + 2150;

      ensureAgentsMounted(false);

      const sections = scanGranularSections();
      sectionsRef.current = sections;

      const allSlotRuntimes: SlotRuntime[] = [];
      for (const sec of sections) {
        const waveCounts: [number, number, number] = [0, 0, 0];

        // Pre-compute slot durations per wave so Wave 2 CTAs land right as Wave 1 copy finishes
        const slotDurs = sec.slots.map((slot) => {
          if (slot.kind === "type") {
            const len = (slot.textSnapshot || "").length;
            return clamp(len * 0.028, 0.72, 2.15);
          }
          if (slot.kind === "drag") return 0.94;
          if (slot.kind === "draw") return 0.82;
          if (slot.kind === "fill" || slot.kind === "pop") return 0.56;
          return 0.54;
        });

        let maxWave0Dur = 0;
        let maxWave1Dur = 0;
        for (let k = 0; k < sec.slots.length; k++) {
          if (sec.slots[k].wave === 0) maxWave0Dur = Math.max(maxWave0Dur, slotDurs[k]);
          if (sec.slots[k].wave === 1) maxWave1Dur = Math.max(maxWave1Dur, slotDurs[k]);
        }

        const wave1Start = maxWave0Dur > 0 ? clamp(maxWave0Dur * 0.28, 0.2, 0.42) : 0.06;
        const wave2Start =
          maxWave1Dur > 0
            ? Math.max(0.76, wave1Start + maxWave1Dur * 0.78)
            : Math.max(0.62, maxWave0Dur * 0.72);

        for (let sIdx = 0; sIdx < sec.slots.length; sIdx++) {
          const slot = sec.slots[sIdx];
          const r = slot.el.getBoundingClientRect();
          slot.el.setAttribute("data-swarm-unbuilt", "true");

          const durationSec = slotDurs[sIdx];
          const w = slot.wave;
          const wOrder = waveCounts[w];
          waveCounts[w] += 1;
          const waveBase = w === 0 ? 0.02 : w === 1 ? wave1Start : wave2Start;
          const delaySec = waveBase + Math.min(0.65, wOrder * 0.11);

          const grabOffsetX = clamp(
            r.width * (0.36 + (sIdx % 3) * 0.08),
            12,
            Math.max(16, r.width - 14),
          );
          const grabOffsetY = clamp(r.height * 0.38, 10, Math.min(84, Math.max(14, r.height - 10)));

          allSlotRuntimes.push({
            slot,
            state: "pending",
            t: 0,
            approachT: 0,
            approachDur: 0.3,
            delayRemaining: delaySec,
            durationSec,
            agentId: -1,
            reservedAgentId: null,
            grabOffsetX,
            grabOffsetY,
            selEl: null,
            badgeEl: null,
            ghostEl: null,
            typedSpan: null,
            untypedSpan: null,
            caretBarEl: null,
            guideVEl: null,
            guideHEl: null,
            guideBadgeEl: null,
            lastCharCount: 0,
          });
        }
      }

      slotsRef.current = allSlotRuntimes;
      setBuildProgress(0);
      setIsComplete(allSlotRuntimes.length === 0);
      setMode("build");
      window.sessionStorage.setItem(MODE_SESSION_KEY, "build");
      setAutoScrolling(startAutoScroll);
    },
    [cleanupBuildArtifacts, ensureAgentsMounted],
  );

  // Activate a section's slots into parallel waves when reached
  const activateSection = useCallback((secIndex: number) => {
    if (activatedSectionsRef.current.has(secIndex)) return;
    activatedSectionsRef.current.add(secIndex);

    for (const sr of slotsRef.current) {
      if (sr.slot.sectionIndex !== secIndex || sr.state !== "pending") continue;
      sr.state = "waiting";
    }
  }, []);

  // Initial mount & route-change lifecycle
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentPath = pathname ?? "/";
    if (!currentPath) return;

    const initialMusic = swarmAudio.init();
    setMusicEnabled(initialMusic);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      cleanupBuildArtifacts();
      hideAllAgents();
      setMode("present");
      setAutoScrolling(false);
      return;
    }

    const seenGate = window.sessionStorage.getItem(GATE_SESSION_KEY);
    const savedMode = window.sessionStorage.getItem(MODE_SESSION_KEY) as SwarmMode | null;

    if (!seenGate) {
      cleanupBuildArtifacts();
      ensureAgentsMounted(true);
      setMode("gate");
      setAutoScrolling(false);
      return;
    }

    if (savedMode === "build") {
      const timer = window.setTimeout(() => {
        initializeBuildForCurrentPage(true);
      }, 60);
      return () => window.clearTimeout(timer);
    }

    cleanupBuildArtifacts();
    hideAllAgents();
    setMode("present");
    setAutoScrolling(false);
  }, [
    pathname,
    cleanupBuildArtifacts,
    ensureAgentsMounted,
    hideAllAgents,
    initializeBuildForCurrentPage,
  ]);

  // Master 60fps Multi-Cursor Physics, Approach-Click-Lock, Smart Guides & Auto-Scroll Loop
  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let lastNow = performance.now();
    let lastProgressReport = -1;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      const nowSec = now / 1000;
      fxBudgetRef.current = 5;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const modalOpen = isFullscreenModalOpen();

      if (agentLayerRef.current) {
        agentLayerRef.current.style.opacity = modalOpen ? "0" : "1";
      }

      const curMode = modeRef.current;

      // --- MODE 1: ENTRANCE GATE (Blurred ambient cursor drift around studio canvas) ---
      if (curMode === "gate") {
        for (const ag of agentsRef.current) {
          const baseX = ag.spec.homeSpot[0] * vw;
          const baseY = ag.spec.homeSpot[1] * vh;
          const wx =
            Math.sin(nowSec * ag.seedFreqs[0] + ag.seedPhases[0]) * 42 +
            Math.cos(nowSec * ag.seedFreqs[1] + ag.seedPhases[1]) * 20;
          const wy =
            Math.cos(nowSec * ag.seedFreqs[2] + ag.seedPhases[2]) * 34 +
            Math.sin(nowSec * ag.seedFreqs[3] + ag.seedPhases[3]) * 18;
          const x = clamp(baseX + wx, 24, vw - 95);
          const y = clamp(baseY + wy, 24, vh - 60);
          ag.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          ag.labelEl.style.opacity = "0.85";
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // --- MODE 2: BUILD MODE (Authentic 8-Agent Collaborative Figma Session) ---
      if (curMode === "build") {
        const scrollY = window.scrollY;
        const sections = sectionsRef.current;
        const allSlots = slotsRef.current;
        const agents = agentsRef.current;

        // Tick down brief post-click / post-finish timers on agents
        for (const ag of agents) {
          if (ag.holdTimer > 0) ag.holdTimer = Math.max(0, ag.holdTimer - dt);
          if (ag.pressTimer > 0) ag.pressTimer = Math.max(0, ag.pressTimer - dt);
        }

        // 1. Trigger any section whose scroll threshold has been reached
        const maxScrollNow = Math.max(0, document.documentElement.scrollHeight - vh);
        const nearPageBottom = scrollY >= maxScrollNow - 32;
        if (sections.length > 0) {
          activateSection(0);
          const sec0Done = !allSlots.some((s) => s.slot.sectionIndex === 0 && s.state !== "done");
          for (let i = 1; i < sections.length; i++) {
            const sec = sections[i];
            if (activatedSectionsRef.current.has(sec.index)) continue;
            const firstSlotEl = sec.slots[0]?.el;
            const liveTop = firstSlotEl ? firstSlotEl.getBoundingClientRect().top : vh;

            // Keep below-hero sections unbuilt while Hero builds at scrollY = 0
            if (i === 1 && sec.anchorTop < vh * 0.88) {
              if (sec0Done || scrollY >= 72 || nearPageBottom) {
                activateSection(sec.index);
              }
            } else if (nearPageBottom || scrollY >= sec.triggerScrollY || liveTop <= vh * 0.76) {
              activateSection(sec.index);
            }
          }
        }

        // 2. Lookahead Scouting: Free agents claim & pre-hover near in-viewport waiting slots only
        for (const ag of agents) {
          if (ag.busySlotId !== null) {
            ag.scoutSlotId = null;
            continue;
          }
          if (ag.scoutSlotId !== null) {
            const curScout = allSlots.find((s) => s.slot.id === ag.scoutSlotId);
            const curRect = curScout?.slot.el.getBoundingClientRect();
            if (
              !curScout ||
              curScout.state !== "waiting" ||
              !curRect ||
              curRect.top < 54 ||
              curRect.top > vh - 105
            ) {
              if (curScout && curScout.reservedAgentId === ag.spec.id) {
                curScout.reservedAgentId = null;
              }
              ag.scoutSlotId = null;
            }
          }
          if (ag.scoutSlotId === null && ag.holdTimer <= 0) {
            const wanted = ag.spec.skill;
            let bestScout: SlotRuntime | null = null;
            let bestScoutScore = Number.POSITIVE_INFINITY;

            for (const sr of allSlots) {
              if (sr.state !== "waiting") continue;
              if (sr.reservedAgentId !== null && sr.reservedAgentId !== ag.spec.id) continue;
              const r = sr.slot.el.getBoundingClientRect();
              if (r.top < 54 || r.top > vh - 105) continue;

              const skillMatch = preferredSkillForKind(sr.slot.kind) === wanted ? -18 : 0;
              const score = sr.delayRemaining * 20 + r.top * 0.04 + skillMatch;
              if (score < bestScoutScore) {
                bestScoutScore = score;
                bestScout = sr;
              }
            }

            if (bestScout) {
              ag.scoutSlotId = bestScout.slot.id;
              bestScout.reservedAgentId = ag.spec.id;
            }
          }
        }

        // 3. Advance Slot State Machine: waiting -> approaching -> active -> done
        let doneCount = 0;
        let activeInViewportCount = 0;

        for (const sr of allSlots) {
          if (sr.state === "done") {
            doneCount += 1;
            continue;
          }
          if (sr.state === "pending") continue;

          const rect = sr.slot.el.getBoundingClientRect();
          const scrolledPast = rect.bottom < 36;
          const speedBoost = scrolledPast ? 2.8 : 1.0;

          if (rect.top < vh * 0.62 && rect.bottom > 56) {
            activeInViewportCount += 1;
          }

          // --- PHASE A: WAITING FOR WAVE STAGGER & FREE AGENT ---
          if (sr.state === "waiting") {
            sr.delayRemaining -= dt * speedBoost;
            if (sr.delayRemaining > 0) continue;

            const chosen = claimFreeAgentForSlot(agents, sr);
            if (!chosen) {
              // All 8 agents are simultaneously busy right now! Wait for the very next free agent
              sr.delayRemaining = 0.03;
              continue;
            }

            sr.agentId = chosen.spec.id;
            sr.reservedAgentId = chosen.spec.id;
            chosen.busySlotId = sr.slot.id;
            chosen.scoutSlotId = null;
            chosen.jobCount += 1;
            chosen.fromX = chosen.x;
            chosen.fromY = chosen.y;
            chosen.targetLabelAlpha = 1;

            const startPt = getSlotStartPoint(sr);
            const dist = Math.hypot(startPt.x - chosen.x, startPt.y - chosen.y);
            sr.approachT = 0;
            sr.approachDur =
              dist < 34 ? 0.11 : clamp(0.18 + dist / 1650, 0.2, scrolledPast ? 0.22 : 0.4);
            sr.state = "approaching";
          }

          // --- PHASE B: CURSOR FLIES TO EXACT START POINT BEFORE ELEMENT BEGINS ---
          if (sr.state === "approaching") {
            const ag = agents[sr.agentId];
            const startPt = getSlotStartPoint(sr);

            sr.approachT = Math.min(1, sr.approachT + (dt * speedBoost) / sr.approachDur);
            if (ag) {
              const et = easeInOutCubic(sr.approachT);
              const gx = clamp(startPt.x, 14, vw - 76);
              const gy = clamp(startPt.y, 14, vh - 40);
              const dx = gx - ag.fromX;
              const dy = gy - ag.fromY;
              const bend = Math.sin(Math.PI * et) * 0.15 * ag.bendSign;
              const nextX = ag.fromX + dx * et - dy * bend;
              const nextY = ag.fromY + dy * et + dx * bend;
              ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
              ag.x = nextX;
              ag.y = nextY;
              ag.targetLabelAlpha = 1;
              ag.isDrawingCrosshair = sr.slot.kind === "draw" && sr.approachT > 0.55;
            }

            if (sr.approachT < 1) continue;

            // Cursor has arrived! Click down physically & mount Figma selection UI
            sr.state = "active";
            sr.t = 0;

            if (ag) {
              ag.pressTimer = 0.16;
              ag.isHoldingDrag =
                sr.slot.kind === "draw" || sr.slot.kind === "drag" || sr.slot.kind === "line";
              ag.isDrawingCrosshair = sr.slot.kind === "draw";
              spawnRing(fxLayerRef.current, ag.x + 2, ag.y + 2, ag.spec.color);
            }

            if (selLayerRef.current && ag) {
              const { selEl, badgeEl } = createSelectionBox(
                selLayerRef.current,
                ag.spec,
                sr.slot.kind,
              );
              sr.selEl = selEl;
              sr.badgeEl = badgeEl;

              // Mount Figma Smart Alignment Guides for drag operations
              if (sr.slot.kind === "drag") {
                const gV = document.createElement("div");
                gV.className = styles.smartGuideV;
                const gH = document.createElement("div");
                gH.className = styles.smartGuideH;
                const gB = document.createElement("div");
                gB.className = styles.smartGuideBadge;
                selLayerRef.current.appendChild(gV);
                selLayerRef.current.appendChild(gH);
                selLayerRef.current.appendChild(gB);
                sr.guideVEl = gV;
                sr.guideHEl = gH;
                sr.guideBadgeEl = gB;
              }

              // Mount pure-inline split-span text ghost + Range-tracked caret bar
              if (sr.slot.kind === "type" && sr.slot.textSnapshot) {
                const textHost = findTextStyleHost(sr.slot.el);
                const cs = window.getComputedStyle(textHost);
                const ghost = document.createElement("div");
                ghost.className = styles.typeGhost;
                ghost.style.fontFamily = cs.fontFamily;
                ghost.style.fontSize = cs.fontSize;
                ghost.style.fontWeight = cs.fontWeight;
                ghost.style.fontStyle = cs.fontStyle;
                ghost.style.lineHeight = cs.lineHeight;
                ghost.style.letterSpacing = cs.letterSpacing;
                ghost.style.wordSpacing = cs.wordSpacing;
                ghost.style.textTransform = cs.textTransform;
                ghost.style.textAlign = cs.textAlign;
                ghost.style.color = cs.color;
                if ("textWrap" in cs) {
                  ghost.style.setProperty("text-wrap", cs.getPropertyValue("text-wrap"));
                }

                // Pure inline spans ONLY (no inline-block in between!) so word wrapping never shifts
                const typedSpan = document.createElement("span");
                const untypedSpan = document.createElement("span");
                untypedSpan.style.color = "transparent";
                untypedSpan.textContent = sr.slot.textSnapshot;

                ghost.appendChild(typedSpan);
                ghost.appendChild(untypedSpan);
                selLayerRef.current.appendChild(ghost);

                const caretBar = document.createElement("div");
                caretBar.className = styles.typeCaretBar;
                caretBar.style.setProperty("--c", ag.spec.color);
                selLayerRef.current.appendChild(caretBar);

                sr.ghostEl = ghost;
                sr.typedSpan = typedSpan;
                sr.untypedSpan = untypedSpan;
                sr.caretBarEl = caretBar;
              }
            }
          }

          // --- PHASE C: ACTIVE MANIPULATION (1:1 ZERO-LAG CURSOR LOCK) ---
          sr.t = Math.min(1, sr.t + (dt * speedBoost) / sr.durationSec);
          const ag = agents[sr.agentId];
          const el = sr.slot.el;
          const r = el.getBoundingClientRect();

          if (sr.slot.kind === "draw") {
            const ease = easeInOutCubic(sr.t);
            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = "1";
            const insetR = ((1 - ease) * 100).toFixed(2);
            const insetB = ((1 - ease) * 100).toFixed(2);
            el.style.clipPath = `inset(0 ${insetR}% ${insetB}% 0)`;

            const curW = Math.max(8, Math.round(r.width * ease));
            const curH = Math.max(8, Math.round(r.height * ease));
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(r.left)}px`;
              sr.selEl.style.top = `${Math.round(r.top)}px`;
              sr.selEl.style.width = `${curW}px`;
              sr.selEl.style.height = `${curH}px`;
            }
            if (sr.badgeEl) {
              sr.badgeEl.textContent = `${curW} × ${curH}`;
            }
            // Pin cursor arrow 1:1 onto the bottom-right resize handle it is actively pulling
            if (ag) {
              const nextX = clamp(r.left + curW, 12, vw - 76);
              const nextY = clamp(r.top + curH, 12, vh - 40);
              ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
              ag.x = nextX;
              ag.y = nextY;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "drag") {
            const ease = easeOutCubic(sr.t);
            const inv = 1 - ease;
            const df = sr.slot.dragFrom ?? { dx: -165, dy: 38, bend: 0.16, tiltDeg: -5 };
            const arc = Math.sin(Math.PI * ease) * df.bend;
            const dx = df.dx * inv - df.dy * arc;
            const dy = df.dy * inv + df.dx * arc;
            const tilt = df.tiltDeg * Math.sin(Math.PI * ease);
            const lift = 1 + 0.045 * Math.sin(Math.PI * Math.min(1, sr.t * 1.08));

            // Compute resting target rect before transform for Figma Smart Alignment Guides
            const finalLeft = r.left - dx;
            const finalTop = r.top - dy;

            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = String(Math.min(1, 0.25 + sr.t * 2.6));
            el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${lift.toFixed(3)})`;

            const liveR = el.getBoundingClientRect();
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(liveR.left)}px`;
              sr.selEl.style.top = `${Math.round(liveR.top)}px`;
              sr.selEl.style.width = `${Math.round(liveR.width)}px`;
              sr.selEl.style.height = `${Math.round(liveR.height)}px`;
              sr.selEl.style.transform = `rotate(${tilt.toFixed(2)}deg)`;
            }

            // Show Figma Smart Alignment Guides (#FF3366) as the dragged element snaps into place
            if (sr.guideVEl && sr.guideHEl && sr.guideBadgeEl) {
              if (sr.t >= 0.46 && sr.t < 0.995) {
                const guideAlpha = sr.t > 0.92 ? (1 - sr.t) / 0.08 : (sr.t - 0.46) / 0.2;
                const op = clamp(guideAlpha, 0, 0.9).toFixed(2);
                const snapDist = Math.round(Math.hypot(dx, dy));

                sr.guideVEl.style.left = `${Math.round(finalLeft)}px`;
                sr.guideVEl.style.top = `${Math.round(finalTop - 26)}px`;
                sr.guideVEl.style.height = `${Math.round(liveR.height + 52)}px`;
                sr.guideVEl.style.opacity = op;

                sr.guideHEl.style.left = `${Math.round(finalLeft - 26)}px`;
                sr.guideHEl.style.top = `${Math.round(finalTop)}px`;
                sr.guideHEl.style.width = `${Math.round(liveR.width + 52)}px`;
                sr.guideHEl.style.opacity = op;

                sr.guideBadgeEl.style.left = `${Math.round(finalLeft + Math.min(48, liveR.width * 0.25))}px`;
                sr.guideBadgeEl.style.top = `${Math.max(58, Math.round(finalTop - 12))}px`;
                sr.guideBadgeEl.textContent = snapDist <= 2 ? "0" : `${snapDist}`;
                sr.guideBadgeEl.style.opacity = op;
              } else {
                sr.guideVEl.style.opacity = "0";
                sr.guideHEl.style.opacity = "0";
                sr.guideBadgeEl.style.opacity = "0";
              }
            }

            // Pin cursor arrow 1:1 onto the card grab point carrying it into place
            if (ag) {
              const nextX = clamp(liveR.left + sr.grabOffsetX, 12, vw - 76);
              const nextY = clamp(liveR.top + sr.grabOffsetY, 12, vh - 40);
              ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
              ag.x = nextX;
              ag.y = nextY;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "type" && sr.slot.textSnapshot && sr.ghostEl) {
            const text = sr.slot.textSnapshot;
            const charCount = Math.min(text.length, Math.max(1, Math.round(sr.t * text.length)));
            if (charCount !== sr.lastCharCount) {
              sr.lastCharCount = charCount;
              if (sr.typedSpan) sr.typedSpan.textContent = text.slice(0, charCount);
              if (sr.untypedSpan) sr.untypedSpan.textContent = text.slice(charCount);
              swarmAudio.playKeyTick();
            }

            // Use the full block wrapper rect so balanced inline spans never shrink/overflow
            const boxR = el.getBoundingClientRect();

            sr.ghostEl.style.left = `${Math.round(boxR.left)}px`;
            sr.ghostEl.style.top = `${Math.round(boxR.top)}px`;
            sr.ghostEl.style.width = `${Math.round(boxR.width)}px`;

            const liveGhostH = Math.max(boxR.height, sr.ghostEl.offsetHeight);
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(boxR.left - 5)}px`;
              sr.selEl.style.top = `${Math.round(boxR.top - 4)}px`;
              sr.selEl.style.width = `${Math.round(boxR.width + 10)}px`;
              sr.selEl.style.height = `${Math.round(liveGhostH + 8)}px`;
            }

            const caretPos = measureCaretPosition(sr, boxR, sharedRangeRef.current);
            if (sr.caretBarEl) {
              sr.caretBarEl.style.left = `${Math.round(caretPos.x)}px`;
              sr.caretBarEl.style.top = `${Math.round(caretPos.top)}px`;
              sr.caretBarEl.style.height = `${Math.round(caretPos.height)}px`;
            }

            // Track cursor smoothly right alongside the live character caret
            if (ag) {
              const targetX = clamp(caretPos.x + 5, 12, vw - 76);
              const targetY = clamp(caretPos.top + caretPos.height + 2, 12, vh - 40);
              const follow = 1 - Math.exp(-26 * dt);
              const nextX = ag.x + (targetX - ag.x) * follow;
              const nextY = ag.y + (targetY - ag.y) * follow;
              ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
              ag.x = nextX;
              ag.y = nextY;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "fill" || sr.slot.kind === "pop") {
            const scale = 0.72 + 0.28 * easeOutBack(sr.t);
            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = String(Math.min(1, 0.2 + sr.t * 3.0));
            el.style.transform = `scale(${scale.toFixed(3)})`;

            const liveR = el.getBoundingClientRect();
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(liveR.left)}px`;
              sr.selEl.style.top = `${Math.round(liveR.top)}px`;
              sr.selEl.style.width = `${Math.round(liveR.width)}px`;
              sr.selEl.style.height = `${Math.round(liveR.height)}px`;
            }
            if (ag) {
              const nextX = clamp(liveR.left + liveR.width * 0.56, 12, vw - 76);
              const nextY = clamp(liveR.top + liveR.height * 0.58, 12, vh - 40);
              ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
              ag.x = nextX;
              ag.y = nextY;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "line") {
            const ease = easeInOutCubic(sr.t);
            const rightAligned = Boolean(sr.slot.rightAligned);
            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = "1";
            el.style.transformOrigin = rightAligned ? "right center" : "left center";
            el.style.transform = `scaleX(${ease.toFixed(3)})`;

            const curLen = Math.max(4, Math.round(r.width * ease));
            const leftX = rightAligned ? r.right - curLen : r.left;
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(leftX)}px`;
              sr.selEl.style.top = `${Math.round(r.top - 2)}px`;
              sr.selEl.style.width = `${curLen}px`;
              sr.selEl.style.height = `${Math.max(4, Math.round(r.height + 4))}px`;
            }
            if (sr.badgeEl) {
              sr.badgeEl.textContent = `${curLen} px`;
            }
            if (ag) {
              const tipX = rightAligned ? r.right - curLen : r.left + curLen;
              const nextX = clamp(tipX, 12, vw - 76);
              const nextY = clamp(r.top + r.height * 0.5, 12, vh - 40);
              ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
              ag.x = nextX;
              ag.y = nextY;
              ag.targetLabelAlpha = 1;
            }
          }

          // --- SLOT COMPLETED! ---
          if (sr.t >= 1) {
            sr.state = "done";
            doneCount += 1;

            el.removeAttribute("data-swarm-unbuilt");
            el.style.clipPath = "";
            el.style.transform = "";
            el.style.transformOrigin = "";
            el.style.opacity = "";

            sr.selEl?.remove();
            sr.ghostEl?.remove();
            sr.caretBarEl?.remove();
            sr.guideVEl?.remove();
            sr.guideHEl?.remove();
            sr.guideBadgeEl?.remove();
            sr.selEl = null;
            sr.ghostEl = null;
            sr.caretBarEl = null;
            sr.guideVEl = null;
            sr.guideHEl = null;
            sr.guideBadgeEl = null;

            if (ag) {
              if (ag.busySlotId === sr.slot.id) {
                ag.busySlotId = null;
              }
              ag.isHoldingDrag = false;
              ag.isDrawingCrosshair = false;
              ag.holdTimer = 0.14;
              if (fxBudgetRef.current > 0) {
                fxBudgetRef.current -= 1;
                celebrateSlot(fxLayerRef.current, el, ag.x, ag.y, ag.spec.color);
                swarmAudio.playSparklePop();
              }
            }

            const remainingInSec = allSlots.some(
              (other) => other.slot.sectionIndex === sr.slot.sectionIndex && other.state !== "done",
            );
            if (!remainingInSec) {
              holdUntilRef.current = Math.max(holdUntilRef.current, now + 440);
            }
          }
        }

        // Update overall progress percentage (throttled to integer steps)
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
        const slotRatio = allSlots.length > 0 ? doneCount / allSlots.length : 1;
        const scrollRatio = Math.min(1, scrollY / maxScroll);
        const combined = Math.min(1, Math.max(slotRatio * 0.85 + scrollRatio * 0.15, slotRatio));
        const roundedPct = Math.round(combined * 100);
        if (roundedPct !== lastProgressReport) {
          lastProgressReport = roundedPct;
          setBuildProgress(combined);
          if (doneCount === allSlots.length && allSlots.length > 0) {
            setIsComplete(true);
          }
        }

        // 4. Smooth 60fps Auto-Scroll Controller
        if (autoScrollRef.current && !modalOpen) {
          if (scrollY >= maxScroll - 4 && doneCount >= allSlots.length) {
            autoScrollRef.current = false;
            setAutoScrolling(false);
          } else if (now >= holdUntilRef.current) {
            const scrollSpeed =
              activeInViewportCount >= 4
                ? vh * 0.052
                : activeInViewportCount > 0
                  ? vh * 0.105
                  : vh * 0.185;
            scrollAccumRef.current = Math.min(maxScroll, scrollAccumRef.current + scrollSpeed * dt);
            window.scrollTo({
              top: scrollAccumRef.current,
              behavior: "instant" as ScrollBehavior,
            });
          } else {
            scrollAccumRef.current = window.scrollY;
          }
        }

        // 5. Render All 8 Agents (Active Lock / Lookahead Scout / Asymmetric Studio Hover / Finale Ring)
        const finaleEl = document.getElementById("swarm-finale-anchor");
        const finaleRect = finaleEl?.getBoundingClientRect();
        const inFinaleRing =
          doneCount >= allSlots.length &&
          finaleRect !== undefined &&
          finaleRect.top < vh * 0.78 &&
          finaleRect.bottom > 120;

        for (let i = 0; i < agents.length; i++) {
          const ag = agents[i];

          const liveBusySlot =
            ag.busySlotId !== null
              ? allSlots.find(
                  (s) =>
                    s.slot.id === ag.busySlotId &&
                    (s.state === "approaching" || s.state === "active"),
                )
              : undefined;

          if (!liveBusySlot) {
            ag.busySlotId = null;
            ag.isHoldingDrag = false;
            ag.isDrawingCrosshair = false;
          }

          // Free agents (not actively approaching or manipulating a slot) move organically
          if (!liveBusySlot) {
            let targetX = ag.spec.homeSpot[0] * vw;
            let targetY = ag.spec.homeSpot[1] * vh;
            let wanderAmp = 24;
            let smoothing = 4.6;

            if (inFinaleRing && finaleRect) {
              // Clockwise elliptical Finale Ring framing "Thanks for scrolling." & buttons cleanly
              const cx = finaleRect.left + finaleRect.width * 0.5;
              const cy = finaleRect.top + finaleRect.height * 0.44;
              const rx = Math.min(355, Math.max(250, vw * 0.36));
              const ry = Math.min(156, Math.max(128, finaleRect.height * 0.42));
              const angle = nowSec * 0.52 + (i * Math.PI * 2) / agents.length;

              targetX = cx + Math.cos(angle) * rx;
              targetY = cy + Math.sin(angle) * ry;
              wanderAmp = 2.5;
              smoothing = 6.5;
              ag.targetLabelAlpha = 1;
            } else if (ag.holdTimer > 0) {
              // Natural 140ms human pause right where the mouse button was just released
              targetX = ag.x;
              targetY = ag.y;
              wanderAmp = 1.5;
              smoothing = 12;
              ag.targetLabelAlpha = 0.95;
            } else if (ag.scoutSlotId !== null) {
              // Lookahead Scout: hover thoughtfully near the upcoming element before clicking in
              const scoutSr = allSlots.find((s) => s.slot.id === ag.scoutSlotId);
              if (scoutSr) {
                const pt = getSlotStartPoint(scoutSr);
                targetX = pt.x + (i % 2 === 0 ? -18 : 18);
                targetY = pt.y - 14;
                wanderAmp = 9;
                smoothing = 6.8;
                ag.targetLabelAlpha = 0.9;
              }
            } else {
              // Asymmetric studio canvas hover with visible collaborator name pill
              ag.targetLabelAlpha = 0.68;
            }

            if (wanderAmp > 0) {
              targetX +=
                Math.sin(nowSec * ag.seedFreqs[0] + ag.seedPhases[0]) * wanderAmp +
                Math.cos(nowSec * ag.seedFreqs[1] + ag.seedPhases[1]) * (wanderAmp * 0.48);
              targetY +=
                Math.cos(nowSec * ag.seedFreqs[2] + ag.seedPhases[2]) * (wanderAmp * 0.85) +
                Math.sin(nowSec * ag.seedFreqs[3] + ag.seedPhases[3]) * (wanderAmp * 0.45);
            }

            // Polite awareness: gently yield aside if the user's "You" cursor hovers right over an idle agent
            if (!inFinaleRing && userPointerRef.current.active) {
              const ux = userPointerRef.current.x;
              const uy = userPointerRef.current.y;
              const dxU = targetX - ux;
              const dyU = targetY - uy;
              const distU = Math.hypot(dxU, dyU);
              if (distU > 1 && distU < 88) {
                const push = ((88 - distU) / 88) * 34;
                targetX += (dxU / distU) * push;
                targetY += (dyU / distU) * push;
              }
            }

            targetX = clamp(targetX, 16, vw - 82);
            targetY = clamp(targetY, 16, vh - 46);

            const follow = 1 - Math.exp(-smoothing * dt);
            const nextX = ag.x + (targetX - ag.x) * follow;
            const nextY = ag.y + (targetY - ag.y) * follow;
            ag.vx = dt > 0 ? (nextX - ag.x) / dt : 0;
            ag.x = nextX;
            ag.y = nextY;
          }

          // Physical arrow scale (click press / drag hold) + subtle horizontal velocity bank
          const pressScale = ag.pressTimer > 0 ? 0.83 : ag.isHoldingDrag ? 0.92 : 1;
          const bankDeg = clamp(ag.vx * 0.008, -7, 7);
          ag.innerEl.style.transform = `scale(${pressScale.toFixed(2)}) rotate(${bankDeg.toFixed(1)}deg)`;
          ag.crosshairEl.classList.toggle(styles.agentCrosshairActive, ag.isDrawingCrosshair);
          ag.labelEl.classList.toggle(styles.agentLabelFlipped, ag.x > vw - 98);

          ag.labelAlpha += (ag.targetLabelAlpha - ag.labelAlpha) * 0.18;
          ag.el.style.transform = `translate3d(${ag.x.toFixed(1)}px, ${ag.y.toFixed(1)}px, 0)`;
          ag.labelEl.style.opacity = ag.labelAlpha.toFixed(2);
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [activateSection]);

  // Custom User Multiplayer Cursor ("You") + Manual Scroll Auto-Pause Listeners
  useEffect(() => {
    if (typeof window === "undefined") return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !finePointer || !userCursorRootRef.current) {
        userPointerRef.current.active = false;
        userCursorRootRef.current?.classList.remove(styles.userCursorVisible);
        document.documentElement.removeAttribute("data-custom-cursor");
        return;
      }

      userPointerRef.current = { x: e.clientX, y: e.clientY, active: true };

      const targetNode = e.target as HTMLElement | null;
      const inTextInput = targetNode?.closest(
        "input[type='text'], input[type='email'], input[type='password'], input[type='search'], textarea, [contenteditable='true']",
      );

      userCursorRootRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;

      if (inTextInput) {
        userCursorRootRef.current.classList.remove(styles.userCursorVisible);
        document.documentElement.removeAttribute("data-custom-cursor");
      } else {
        userCursorRootRef.current.classList.add(styles.userCursorVisible);
        if (!document.documentElement.hasAttribute("data-custom-cursor")) {
          document.documentElement.setAttribute("data-custom-cursor", "true");
        }
        userCursorLabelRef.current?.classList.toggle(
          styles.userCursorLabelFlipped,
          e.clientX > window.innerWidth - 95,
        );
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && finePointer && userCursorRootRef.current) {
        userCursorRootRef.current.classList.add(styles.userCursorDown);
        spawnRing(userCursorLayerRef.current, e.clientX, e.clientY, "#6366f1");
      }
    };

    const onPointerUp = () => {
      userCursorRootRef.current?.classList.remove(styles.userCursorDown);
    };

    const onMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        userPointerRef.current.active = false;
        userCursorRootRef.current?.classList.remove(
          styles.userCursorVisible,
          styles.userCursorDown,
        );
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (autoScrollRef.current && Math.abs(e.deltaY) >= 8) {
        autoScrollRef.current = false;
        setAutoScrolling(false);
      }
    };

    const pauseAutoOnManualScroll = () => {
      if (autoScrollRef.current) {
        autoScrollRef.current = false;
        setAutoScrolling(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (
        autoScrollRef.current &&
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Escape"].includes(e.key)
      ) {
        pauseAutoOnManualScroll();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    document.addEventListener("mouseout", onMouseOut, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", pauseAutoOnManualScroll, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", pauseAutoOnManualScroll);
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.removeAttribute("data-custom-cursor");
      document.documentElement.removeAttribute("data-swarm-autoscroll");
    };
  }, []);

  // Public Controls
  const enterPortfolio = useCallback(
    (withSound: boolean) => {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(GATE_SESSION_KEY, "1");
      }
      if (withSound) {
        swarmAudio.startMusic();
        setMusicEnabled(true);
      } else {
        swarmAudio.stopMusic();
        setMusicEnabled(false);
      }
      setGateClosing(true);
      window.setTimeout(() => {
        setGateClosing(false);
        initializeBuildForCurrentPage(true);
      }, 360);
    },
    [initializeBuildForCurrentPage],
  );

  const skipGateToFinal = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(GATE_SESSION_KEY, "1");
      window.sessionStorage.setItem(MODE_SESSION_KEY, "present");
    }
    setGateClosing(true);
    window.setTimeout(() => {
      setGateClosing(false);
      cleanupBuildArtifacts();
      hideAllAgents();
      setAutoScrolling(false);
      setMode("present");
    }, 320);
  }, [cleanupBuildArtifacts, hideAllAgents]);

  const replayBuild = useCallback(() => {
    initializeBuildForCurrentPage(true);
  }, [initializeBuildForCurrentPage]);

  const viewFinalDesign = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(MODE_SESSION_KEY, "present");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    cleanupBuildArtifacts();
    hideAllAgents();
    setAutoScrolling(false);
    setBuildProgress(1);
    setIsComplete(true);
    setMode("present");
  }, [cleanupBuildArtifacts, hideAllAgents]);

  const toggleAutoScroll = useCallback(() => {
    if (modeRef.current !== "build") {
      initializeBuildForCurrentPage(true);
      return;
    }
    setAutoScrolling((prev) => {
      const next = !prev;
      if (next && typeof window !== "undefined") {
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        if (window.scrollY >= maxScroll - 12 && isComplete) {
          initializeBuildForCurrentPage(true);
          return true;
        }
        scrollAccumRef.current = window.scrollY;
      }
      return next;
    });
  }, [initializeBuildForCurrentPage, isComplete]);

  const toggleMusic = useCallback(() => {
    const next = swarmAudio.toggle();
    setMusicEnabled(next);
  }, []);

  const contextValue = useMemo<SwarmContextValue>(
    () => ({
      mode,
      autoScrolling,
      musicEnabled,
      buildProgress,
      isComplete,
      enterPortfolio,
      skipGateToFinal,
      replayBuild,
      viewFinalDesign,
      toggleAutoScroll,
      toggleMusic,
    }),
    [
      autoScrolling,
      buildProgress,
      enterPortfolio,
      isComplete,
      mode,
      musicEnabled,
      replayBuild,
      skipGateToFinal,
      toggleAutoScroll,
      toggleMusic,
      viewFinalDesign,
    ],
  );

  const pct = Math.min(100, Math.max(0, Math.round(buildProgress * 100)));

  return (
    <SwarmContext.Provider value={contextValue}>
      {children}

      {/* Swarm Overlay Portal: Selection Frames, Smart Guides, Celebrations & 8 Figma Agents */}
      <div className={styles.overlayRoot} data-swarm-ignore="true" aria-hidden="true">
        <div ref={selLayerRef} className={styles.selLayer} />
        <div ref={fxLayerRef} className={styles.fxLayer} />
        <div ref={agentLayerRef} className={styles.agentLayer} />
      </div>

      {/* Entrance Gate (First Visit Invitation) */}
      {mode === "gate" && (
        <section
          className={`${styles.gateOverlay} ${gateClosing ? styles.gateClosing : ""}`}
          data-swarm-ignore="true"
          aria-label="Welcome to Binh Phan's Portfolio"
        >
          <div className={styles.gateContent}>
            <span className={styles.gateEyebrow}>PORTFOLIO</span>
            <h1 className={styles.gateTitle}>{person.name}</h1>
            <p className={styles.gateSubtitle}>
              Turn your sound on, sit back and watch this page design itself.
            </p>
            <button
              type="button"
              onClick={() => enterPortfolio(true)}
              className={styles.gateEnterBtn}
            >
              <span aria-hidden="true">▶</span>
              <span>Enter</span>
            </button>
            <div className={styles.gateSecondaryRow}>
              <button
                type="button"
                onClick={() => enterPortfolio(false)}
                className={styles.gateTextBtn}
              >
                Enter without sound
              </button>
              <span className={styles.gateDot} aria-hidden="true">
                ·
              </span>
              <button type="button" onClick={skipGateToFinal} className={styles.gateTextBtn}>
                View final design →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Minimalist 2-Corner Floating HUD */}
      {mode !== "gate" && (
        <>
          <button
            type="button"
            data-swarm-ignore="true"
            onClick={toggleMusic}
            className={`${styles.musicBtn} ${musicEnabled ? styles.musicPlaying : styles.musicMuted}`}
            aria-label={musicEnabled ? "Mute background music" : "Play background music"}
            title={musicEnabled ? "Mute sound" : "Turn sound on"}
          >
            <span className={styles.eqBars} aria-hidden="true">
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
            </span>
          </button>

          {mode === "build" && (
            <button
              type="button"
              data-swarm-ignore="true"
              onClick={toggleAutoScroll}
              className={`${styles.autoScrollPill} ${autoScrolling ? styles.autoScrollPlaying : ""}`}
              aria-label={autoScrolling ? "Pause auto scroll" : "Start auto scroll"}
            >
              <span aria-hidden="true">{autoScrolling ? "❚❚" : "▶"}</span>
              <span>{autoScrolling ? "Pause" : "Auto scroll"}</span>
              <span className={styles.autoScrollProgress} aria-hidden="true">
                <span className={styles.autoScrollProgressFill} style={{ width: `${pct}%` }} />
              </span>
            </button>
          )}
        </>
      )}

      {/* Custom Multiplayer User Cursor ("You") */}
      <div
        ref={userCursorLayerRef}
        className={styles.userCursorLayer}
        data-swarm-ignore="true"
        aria-hidden="true"
      >
        <div ref={userCursorRootRef} className={styles.userCursorRoot}>
          <div className={styles.userCursorInner}>
            <svg className={styles.agentArrow} viewBox="0 0 18 22" fill="none" aria-hidden="true">
              <title>You</title>
              <path
                d={FIGMA_ARROW_PATH}
                fill="#6366F1"
                stroke="#FFFFFF"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <div ref={userCursorLabelRef} className={styles.userCursorLabel}>
              You
            </div>
          </div>
        </div>
      </div>
    </SwarmContext.Provider>
  );
};
