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
  labelEl: HTMLDivElement;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  goalX: number;
  goalY: number;
  travelT: number;
  travelDur: number;
  bendSign: number;
  labelAlpha: number;
  targetLabelAlpha: number;
  busySlotId: string | null;
  jobCount: number;
  parkX: number;
  parkY: number;
  seedFreqs: [number, number, number, number];
  seedPhases: [number, number, number, number];
}

interface SlotRuntime {
  slot: SwarmSlot;
  state: "pending" | "waiting" | "active" | "done";
  t: number;
  delayRemaining: number;
  durationSec: number;
  agentId: number;
  selEl: HTMLDivElement | null;
  badgeEl: HTMLDivElement | null;
  ghostEl: HTMLDivElement | null;
  typedSpan: HTMLSpanElement | null;
  untypedSpan: HTMLSpanElement | null;
  caretSpan: HTMLSpanElement | null;
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

function createSelectionBox(
  layer: HTMLElement,
  agent: SwarmAgentSpec,
  kind: SwarmSlotKind,
): { selEl: HTMLDivElement; badgeEl: HTMLDivElement | null } {
  const selEl = document.createElement("div");
  selEl.className = `${styles.selBox} ${kind === "type" ? styles.selBoxType : ""}`;
  selEl.style.setProperty("--c", agent.color);
  selEl.style.setProperty("--ink", agent.ink);

  let badgeEl: HTMLDivElement | null = null;

  if (kind === "draw" || kind === "drag") {
    for (const cls of [
      styles.selHandleTL,
      styles.selHandleTR,
      styles.selHandleBL,
      styles.selHandleBR,
    ]) {
      const h = document.createElement("span");
      h.className = cls;
      selEl.appendChild(h);
    }
  }

  if (kind === "draw") {
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

function celebrateSlot(fxLayer: HTMLElement | null, el: HTMLElement, color: string) {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return;

  // 1. Subtle WAAPI elastic bounce on small/medium items
  if (r.height < 420 && typeof el.animate === "function") {
    try {
      el.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.035)" },
          { transform: "scale(0.99)" },
          { transform: "scale(1)" },
        ],
        { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    } catch {
      // Ignore if element doesn't support WAAPI
    }
  }

  if (!fxLayer) return;

  // 2. Expanding frame outline pulse
  const pulse = document.createElement("div");
  pulse.className = styles.pulseOutline;
  pulse.style.left = `${Math.round(r.left)}px`;
  pulse.style.top = `${Math.round(r.top)}px`;
  pulse.style.width = `${Math.round(r.width)}px`;
  pulse.style.height = `${Math.round(r.height)}px`;
  pulse.style.setProperty("--c", color);
  fxLayer.appendChild(pulse);
  window.setTimeout(() => pulse.remove(), 700);

  // 3. Radiating 4-point stars & circles burst
  const originX = Math.round(r.left + Math.min(r.width * 0.78, r.width - 12));
  const originY = Math.round(r.top + Math.min(r.height * 0.35, 36));
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

function moveAgentTo(agent: AgentRuntime, gx: number, gy: number, durSec = 0.42) {
  const dist = Math.hypot(gx - agent.x, gy - agent.y);
  if (dist < 18) {
    agent.goalX = gx;
    agent.goalY = gy;
    agent.travelT = 1;
    return;
  }
  agent.fromX = agent.x;
  agent.fromY = agent.y;
  agent.goalX = gx;
  agent.goalY = gy;
  agent.travelT = 0;
  agent.travelDur = Math.max(0.18, Math.min(0.68, durSec));
}

function assignAgentForSlot(agents: AgentRuntime[], slot: SwarmSlot): number {
  const wanted = preferredSkillForKind(slot.kind);
  let bestId = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const ag of agents) {
    let score = ag.jobCount * 4;
    if (ag.busySlotId !== null) score += 120;
    if (ag.spec.skill !== wanted) score += 28;
    if (score < bestScore) {
      bestScore = score;
      bestId = ag.spec.id;
    }
  }

  const chosen = agents[bestId];
  if (chosen) {
    chosen.jobCount += 1;
  }
  return bestId;
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
      sr.selEl = null;
      sr.ghostEl = null;
    }
    slotsRef.current = [];
    sectionsRef.current = [];
    activatedSectionsRef.current.clear();

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
          <svg class="${styles.agentArrow}" viewBox="0 0 18 22" fill="none">
            <path d="${FIGMA_ARROW_PATH}" fill="${spec.color}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
          <div class="${styles.agentLabel}">${spec.name}</div>
        `;
        const labelEl = el.querySelector(`.${styles.agentLabel}`) as HTMLDivElement;
        layer.appendChild(el);

        const onLeft = i % 2 === 0;
        const slotRow = Math.floor(i / 2);
        const px = onLeft ? 48 + slotRow * 24 : Math.max(80, vw - 135 - slotRow * 22);
        const py = 96 + slotRow * Math.max(115, Math.floor((vh - 220) / 3.5));

        el.style.transform = `translate3d(${px}px, ${py}px, 0)`;

        return {
          spec,
          el,
          labelEl,
          x: px,
          y: py,
          fromX: px,
          fromY: py,
          goalX: px,
          goalY: py,
          travelT: 1,
          travelDur: 0.42,
          bendSign: i % 2 === 0 ? 1 : -1,
          labelAlpha: blurred ? 0.85 : 0,
          targetLabelAlpha: blurred ? 0.85 : 0,
          busySlotId: null,
          jobCount: 0,
          parkX: px,
          parkY: py,
          seedFreqs: [
            0.38 + ((i * 17) % 10) * 0.05,
            0.52 + ((i * 23) % 10) * 0.04,
            0.44 + ((i * 31) % 10) * 0.05,
            0.61 + ((i * 13) % 10) * 0.04,
          ],
          seedPhases: [i * 1.1, i * 2.3, i * 0.7, i * 3.1],
        };
      });
    } else {
      for (const ag of agentsRef.current) {
        ag.el.classList.toggle(styles.agentBlurred, blurred);
        ag.busySlotId = null;
        ag.jobCount = 0;
        if (blurred) {
          ag.targetLabelAlpha = 0.85;
        }
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
      holdUntilRef.current = 0;

      ensureAgentsMounted(false);

      const sections = scanGranularSections();
      sectionsRef.current = sections;

      const allSlotRuntimes: SlotRuntime[] = [];
      for (const sec of sections) {
        for (let sIdx = 0; sIdx < sec.slots.length; sIdx++) {
          const slot = sec.slots[sIdx];
          slot.el.setAttribute("data-swarm-unbuilt", "true");

          let durationSec = 0.85;
          if (slot.kind === "type") {
            const len = (slot.textSnapshot || "").length;
            durationSec = Math.min(2.35, Math.max(0.75, len * 0.032));
          } else if (slot.kind === "drag") {
            durationSec = 0.96;
          } else if (slot.kind === "draw") {
            durationSec = 0.88;
          } else if (slot.kind === "fill" || slot.kind === "pop") {
            durationSec = 0.62;
          } else if (slot.kind === "line") {
            durationSec = 0.58;
          }

          allSlotRuntimes.push({
            slot,
            state: "pending",
            t: 0,
            delayRemaining: Math.min(1.6, sIdx * 0.24),
            durationSec,
            agentId: 0,
            selEl: null,
            badgeEl: null,
            ghostEl: null,
            typedSpan: null,
            untypedSpan: null,
            caretSpan: null,
            lastCharCount: 0,
          });
        }
      }

      slotsRef.current = allSlotRuntimes;
      setBuildProgress(0);
      setIsComplete(allSlotRuntimes.length === 0);
      setMode("build");
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(MODE_SESSION_KEY, "build");
      }
      setAutoScrolling(startAutoScroll);
    },
    [cleanupBuildArtifacts, ensureAgentsMounted],
  );

  // Activate a section's slots when reached
  const activateSection = useCallback((secIndex: number) => {
    if (activatedSectionsRef.current.has(secIndex)) return;
    activatedSectionsRef.current.add(secIndex);

    const vw = window.innerWidth;
    let localOrder = 0;

    for (const sr of slotsRef.current) {
      if (sr.slot.sectionIndex !== secIndex || sr.state !== "pending") continue;
      sr.agentId = assignAgentForSlot(agentsRef.current, sr.slot);
      sr.delayRemaining = Math.min(1.5, localOrder * 0.22);
      sr.state = "waiting";
      localOrder += 1;

      // Update idle parking spots around this newly active section
      const ag = agentsRef.current[sr.agentId];
      if (ag) {
        const onLeft = ag.spec.id % 2 === 0;
        const lane = Math.floor(ag.spec.id / 2);
        ag.parkX = onLeft ? Math.max(24, vw * 0.065) : Math.min(vw - 95, vw * 0.915);
        ag.parkY = Math.max(92, Math.min(window.innerHeight - 100, 125 + lane * 145));
      }
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
      // First visit: show Entrance Gate with softly blurred background cursors
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

  // Master 60fps Choreography, Slot Primitives, Auto-Scroll & Finale Orbit Loop
  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let lastNow = performance.now();
    let lastProgressReport = -1;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      const nowSec = now / 1000;
      fxBudgetRef.current = 4;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const modalOpen = isFullscreenModalOpen();

      if (agentLayerRef.current) {
        agentLayerRef.current.style.opacity = modalOpen ? "0" : "1";
      }

      const curMode = modeRef.current;

      // --- MODE 1: ENTRANCE GATE (Blurred ambient cursor drift) ---
      if (curMode === "gate") {
        for (const ag of agentsRef.current) {
          const wx =
            Math.sin(nowSec * ag.seedFreqs[0] + ag.seedPhases[0]) * 38 +
            Math.cos(nowSec * ag.seedFreqs[1] + ag.seedPhases[1]) * 18;
          const wy =
            Math.cos(nowSec * ag.seedFreqs[2] + ag.seedPhases[2]) * 32 +
            Math.sin(nowSec * ag.seedFreqs[3] + ag.seedPhases[3]) * 16;
          const x = Math.max(24, Math.min(vw - 95, ag.parkX + wx));
          const y = Math.max(24, Math.min(vh - 60, ag.parkY + wy));
          ag.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          ag.labelEl.style.opacity = "0.85";
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // --- MODE 2: BUILD MODE (Scroll + Time Granular Choreography) ---
      if (curMode === "build") {
        const scrollY = window.scrollY;
        const sections = sectionsRef.current;
        const allSlots = slotsRef.current;

        // 1. Trigger any section whose scroll threshold has been reached (including near page bottom)
        const maxScrollNow = Math.max(0, document.documentElement.scrollHeight - vh);
        const nearPageBottom = scrollY >= maxScrollNow - 32;
        if (sections.length > 0) {
          activateSection(0);
          for (let i = 1; i < sections.length; i++) {
            const sec = sections[i];
            if (activatedSectionsRef.current.has(sec.index)) continue;
            const firstSlotEl = sec.slots[0]?.el;
            const liveTop = firstSlotEl ? firstSlotEl.getBoundingClientRect().top : vh;
            if (nearPageBottom || scrollY >= sec.triggerScrollY || liveTop <= vh * 0.96) {
              activateSection(sec.index);
            }
          }
        }

        // Check if user scrolled far past an active section -> gently speed up above-viewport slots
        let doneCount = 0;
        let activeInViewportCount = 0;

        for (const sr of allSlots) {
          if (sr.state === "done") {
            doneCount += 1;
            continue;
          }
          if (sr.state === "pending") continue;

          const rect = sr.slot.el.getBoundingClientRect();
          const scrolledPast = rect.bottom < 40;
          const speedBoost = scrolledPast ? 2.8 : 1.0;

          if (rect.top < vh * 0.56 && rect.bottom > 60) {
            activeInViewportCount += 1;
          }

          if (sr.state === "waiting") {
            sr.delayRemaining -= dt * speedBoost;
            if (sr.delayRemaining > 0) continue;

            // Transition waiting -> active
            sr.state = "active";
            const ag = agentsRef.current[sr.agentId];
            if (ag) {
              ag.busySlotId = sr.slot.id;
              ag.targetLabelAlpha = 1;
              moveAgentTo(ag, rect.left + 8, rect.top + 8, 0.36);
              spawnRing(fxLayerRef.current, rect.left + 12, rect.top + 12, ag.spec.color);
            }

            // Mount selection UI & split-span ghost if needed
            if (selLayerRef.current && ag) {
              const { selEl, badgeEl } = createSelectionBox(
                selLayerRef.current,
                ag.spec,
                sr.slot.kind,
              );
              sr.selEl = selEl;
              sr.badgeEl = badgeEl;

              if (sr.slot.kind === "type" && sr.slot.textSnapshot) {
                const textHost =
                  sr.slot.el.querySelector<HTMLElement>(
                    "h1, h2, h3, p, span, [class*='display'], [class*='heading']",
                  ) ?? sr.slot.el;
                const cs = window.getComputedStyle(textHost);
                const ghost = document.createElement("div");
                ghost.className = styles.typeGhost;
                ghost.style.fontFamily = cs.fontFamily;
                ghost.style.fontSize = cs.fontSize;
                ghost.style.fontWeight = cs.fontWeight;
                ghost.style.lineHeight = cs.lineHeight;
                ghost.style.letterSpacing = cs.letterSpacing;
                ghost.style.textAlign = cs.textAlign;
                ghost.style.color = cs.color;
                if ("textWrap" in cs) {
                  ghost.style.setProperty("text-wrap", cs.getPropertyValue("text-wrap"));
                }

                const typedSpan = document.createElement("span");
                const caretSpan = document.createElement("span");
                caretSpan.className = styles.typeCaret;
                caretSpan.style.setProperty("--c", ag.spec.color);
                const untypedSpan = document.createElement("span");
                untypedSpan.style.color = "transparent";
                untypedSpan.textContent = sr.slot.textSnapshot;

                ghost.appendChild(typedSpan);
                ghost.appendChild(caretSpan);
                ghost.appendChild(untypedSpan);
                selLayerRef.current.appendChild(ghost);

                sr.ghostEl = ghost;
                sr.typedSpan = typedSpan;
                sr.caretSpan = caretSpan;
                sr.untypedSpan = untypedSpan;
              }
            }
          }

          // Advance active slot progress (0 -> 1)
          sr.t = Math.min(1, sr.t + (dt * speedBoost) / sr.durationSec);
          const ag = agentsRef.current[sr.agentId];
          const el = sr.slot.el;
          const r = el.getBoundingClientRect();

          if (sr.slot.kind === "draw") {
            const ease = easeInOutCubic(sr.t);
            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = "1";
            const insetR = ((1 - ease) * 100).toFixed(2);
            const insetB = ((1 - ease) * 100).toFixed(2);
            el.style.clipPath = `inset(0 ${insetR}% ${insetB}% 0)`;

            const curW = Math.max(2, Math.round(r.width * ease));
            const curH = Math.max(2, Math.round(r.height * ease));
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(r.left)}px`;
              sr.selEl.style.top = `${Math.round(r.top)}px`;
              sr.selEl.style.width = `${curW}px`;
              sr.selEl.style.height = `${curH}px`;
            }
            if (sr.badgeEl) {
              sr.badgeEl.textContent = `${curW} × ${curH}`;
            }
            if (ag) {
              ag.goalX = r.left + curW;
              ag.goalY = r.top + curH;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "drag") {
            const ease = easeOutCubic(sr.t);
            const inv = 1 - ease;
            const df = sr.slot.dragFrom ?? { dx: -110, dy: 40, tiltDeg: -5 };
            const dx = df.dx * inv;
            const dy = df.dy * inv;
            const tilt = df.tiltDeg * Math.sin(Math.PI * sr.t);
            const lift = 1 + 0.045 * Math.sin(Math.PI * sr.t);

            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = String(Math.min(1, sr.t * 3.2));
            el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${lift.toFixed(3)})`;

            const liveR = el.getBoundingClientRect();
            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(liveR.left)}px`;
              sr.selEl.style.top = `${Math.round(liveR.top)}px`;
              sr.selEl.style.width = `${Math.round(liveR.width)}px`;
              sr.selEl.style.height = `${Math.round(liveR.height)}px`;
              sr.selEl.style.transform = `rotate(${tilt.toFixed(2)}deg)`;
            }
            if (ag) {
              ag.goalX = liveR.left + liveR.width * 0.44;
              ag.goalY = liveR.top + Math.min(72, liveR.height * 0.38);
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "type" && sr.slot.textSnapshot && sr.ghostEl) {
            const text = sr.slot.textSnapshot;
            const charCount = Math.min(text.length, Math.max(1, Math.floor(sr.t * text.length)));
            if (charCount !== sr.lastCharCount) {
              sr.lastCharCount = charCount;
              if (sr.typedSpan) sr.typedSpan.textContent = text.slice(0, charCount);
              if (sr.untypedSpan) sr.untypedSpan.textContent = text.slice(charCount);
              swarmAudio.playKeyTick();
            }

            const textHost =
              el.querySelector<HTMLElement>(
                "h1, h2, h3, p, span, [class*='display'], [class*='heading']",
              ) ?? el;
            const tr = textHost.getBoundingClientRect();

            sr.ghostEl.style.left = `${Math.round(tr.left)}px`;
            sr.ghostEl.style.top = `${Math.round(tr.top)}px`;
            sr.ghostEl.style.width = `${Math.round(tr.width)}px`;

            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(tr.left - 4)}px`;
              sr.selEl.style.top = `${Math.round(tr.top - 3)}px`;
              sr.selEl.style.width = `${Math.round(tr.width + 8)}px`;
              sr.selEl.style.height = `${Math.round(tr.height + 6)}px`;
            }

            if (ag && sr.caretSpan) {
              const cr = sr.caretSpan.getBoundingClientRect();
              ag.goalX = cr.left + 2;
              ag.goalY = cr.bottom - 2;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "fill" || sr.slot.kind === "pop") {
            const scale = easeOutBack(sr.t);
            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = String(Math.min(1, sr.t * 3.5));
            el.style.transform = `scale(${scale.toFixed(3)})`;

            if (sr.selEl) {
              sr.selEl.style.left = `${Math.round(r.left)}px`;
              sr.selEl.style.top = `${Math.round(r.top)}px`;
              sr.selEl.style.width = `${Math.round(r.width)}px`;
              sr.selEl.style.height = `${Math.round(r.height)}px`;
            }
            if (ag) {
              ag.goalX = r.left + r.width * 0.55;
              ag.goalY = r.top + r.height * 0.55;
              ag.targetLabelAlpha = 1;
            }
          } else if (sr.slot.kind === "line") {
            const ease = easeInOutCubic(sr.t);
            el.removeAttribute("data-swarm-unbuilt");
            el.style.opacity = "1";
            el.style.transformOrigin = "left center";
            el.style.transform = `scaleX(${ease.toFixed(3)})`;
            if (sr.selEl) {
              sr.selEl.style.display = "none";
            }
            if (ag) {
              ag.goalX = r.left + r.width * ease;
              ag.goalY = r.top + r.height * 0.5;
              ag.targetLabelAlpha = 1;
            }
          }

          // Slot Completed!
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
            sr.selEl = null;
            sr.ghostEl = null;

            if (ag) {
              if (ag.busySlotId === sr.slot.id) {
                ag.busySlotId = null;
              }
              if (fxBudgetRef.current > 0) {
                fxBudgetRef.current -= 1;
                celebrateSlot(fxLayerRef.current, el, ag.spec.color);
                swarmAudio.playSparklePop();
              }
            }

            // Grant a brief breath after completing a section before gliding further
            const remainingInSec = allSlots.some(
              (other) => other.slot.sectionIndex === sr.slot.sectionIndex && other.state !== "done",
            );
            if (!remainingInSec) {
              holdUntilRef.current = Math.max(holdUntilRef.current, now + 480);
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

        // 2. Smooth 60fps Auto-Scroll Controller (bypasses Once UI CSS scroll-behavior: smooth)
        if (autoScrollRef.current && !modalOpen) {
          if (scrollY >= maxScroll - 4 && doneCount >= allSlots.length) {
            // Reached the very bottom Finale -> stop auto-scroll cleanly
            autoScrollRef.current = false;
            setAutoScrolling(false);
          } else if (now >= holdUntilRef.current) {
            // Steady browse glide; slow down gently while focal pieces in upper viewport are mid-build
            const scrollSpeed =
              activeInViewportCount >= 3
                ? vh * 0.055
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

        // 3. Position All 8 Agents (Active Work / Margin Parking / Finale Orbit Ring)
        const finaleEl = document.getElementById("swarm-finale-anchor");
        const finaleRect = finaleEl?.getBoundingClientRect();
        const inFinaleRing =
          doneCount >= allSlots.length &&
          finaleRect !== undefined &&
          finaleRect.top < vh * 0.78 &&
          finaleRect.bottom > 120;

        for (let i = 0; i < agentsRef.current.length; i++) {
          const ag = agentsRef.current[i];

          // Check if agent still has a live active slot
          const hasActiveSlot =
            ag.busySlotId !== null &&
            allSlots.some((s) => s.slot.id === ag.busySlotId && s.state === "active");
          if (!hasActiveSlot) {
            ag.busySlotId = null;
          }

          let targetX = ag.goalX;
          let targetY = ag.goalY;
          let wanderAmp = 0;

          if (inFinaleRing && finaleRect) {
            // Clockwise elliptical Finale Ring framing "Thanks for scrolling." & buttons cleanly
            const cx = finaleRect.left + finaleRect.width * 0.5;
            const cy = finaleRect.top + finaleRect.height * 0.44;
            const rx = Math.min(355, Math.max(250, vw * 0.36));
            const ry = Math.min(156, Math.max(128, finaleRect.height * 0.42));
            const angle = nowSec * 0.52 + (i * Math.PI * 2) / agentsRef.current.length;

            targetX = cx + Math.cos(angle) * rx;
            targetY = cy + Math.sin(angle) * ry;
            wanderAmp = 2.5;
            ag.targetLabelAlpha = 1;
          } else if (!hasActiveSlot) {
            // Idle margin parking with faded name pill
            targetX = ag.parkX;
            targetY = ag.parkY;
            wanderAmp = 4.5;
            ag.targetLabelAlpha = 0;
          }

          // Organic 4-sine idle wander
          if (wanderAmp > 0) {
            targetX +=
              Math.sin(nowSec * ag.seedFreqs[0] + ag.seedPhases[0]) * wanderAmp +
              Math.cos(nowSec * ag.seedFreqs[1] + ag.seedPhases[1]) * (wanderAmp * 0.5);
            targetY +=
              Math.cos(nowSec * ag.seedFreqs[2] + ag.seedPhases[2]) * wanderAmp +
              Math.sin(nowSec * ag.seedFreqs[3] + ag.seedPhases[3]) * (wanderAmp * 0.5);
          }

          // Clamp inside viewport bounds
          targetX = Math.max(12, Math.min(vw - 78, targetX));
          targetY = Math.max(12, Math.min(vh - 42, targetY));

          // Curved travel interpolation + smooth damping
          if (ag.travelT < 1) {
            ag.travelT = Math.min(1, ag.travelT + dt / ag.travelDur);
            const et = easeInOutCubic(ag.travelT);
            const dx = targetX - ag.fromX;
            const dy = targetY - ag.fromY;
            const bend = Math.sin(Math.PI * et) * 0.16 * ag.bendSign;
            ag.x = ag.fromX + dx * et - dy * bend;
            ag.y = ag.fromY + dy * et + dx * bend;
          } else {
            const follow = 1 - Math.exp(-(inFinaleRing ? 6.5 : 14) * dt);
            ag.x += (targetX - ag.x) * follow;
            ag.y += (targetY - ag.y) * follow;
          }

          ag.labelAlpha += (ag.targetLabelAlpha - ag.labelAlpha) * 0.16;
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
        userCursorRootRef.current?.classList.remove(styles.userCursorVisible);
        document.documentElement.removeAttribute("data-custom-cursor");
        return;
      }

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

      {/* Swarm Overlay Portal: Selection Frames, Celebrations & 8 Figma Agents */}
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
