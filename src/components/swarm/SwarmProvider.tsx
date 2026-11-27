"use client";

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
import { scanSwarmTargets } from "./swarmScanner";
import {
  SWARM_AGENTS,
  type SwarmAgent,
  type SwarmContextValue,
  type SwarmPhase,
  type SwarmProgress,
  type SwarmSpeed,
  type SwarmTarget,
} from "./swarmTypes";

const SwarmContext = createContext<SwarmContextValue | null>(null);

export function useSwarm(): SwarmContextValue {
  const ctx = useContext(SwarmContext);
  if (!ctx) {
    throw new Error("useSwarm must be used within a SwarmProvider");
  }
  return ctx;
}

interface LiveCursorEntity {
  agent: SwarmAgent;
  el: HTMLDivElement;
  taskEl: HTMLSpanElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  arcOffset: number;
  orbitPhase: number;
  ambient: boolean;
  pressing: boolean;
}

interface TrackedWireframe {
  update: () => void;
  remove: () => void;
}

const SWARM_INTRO_SESSION_KEY = "bp_swarm_intro_v1";

function isFullscreenModalOpen(): boolean {
  if (typeof document === "undefined") return false;
  if (document.body.style.overflow === "hidden") return true;
  return document.querySelector(".cursor-zoom-out, [aria-modal='true'], [role='dialog']") !== null;
}

function syncBadgePlacement(badge: HTMLElement | null, y: number, h: number, vh: number) {
  if (!badge) return;
  const nearTop = y < 28;
  const nearBottom = y + h > vh - 28;
  badge.classList.toggle(styles.inspectBadgeBelow, nearTop && !nearBottom);
  badge.classList.toggle(styles.inspectBadgeInside, nearTop && nearBottom);
}

function setCursorTask(cursor: LiveCursorEntity, task: string) {
  if (!cursor.taskEl) return;
  if (!task) {
    cursor.taskEl.style.display = "none";
    cursor.taskEl.textContent = "";
  } else {
    cursor.taskEl.style.display = "inline";
    cursor.taskEl.textContent = task;
  }
}

function setCursorPressing(cursor: LiveCursorEntity, pressing: boolean) {
  cursor.pressing = pressing;
  cursor.el.classList.toggle(styles.cursorPressing, pressing);
}

function createWireCornersFragment(): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const cls of [
    styles.wireCornerTL,
    styles.wireCornerTR,
    styles.wireCornerBL,
    styles.wireCornerBR,
  ]) {
    const handle = document.createElement("span");
    handle.className = cls;
    frag.appendChild(handle);
  }
  return frag;
}

function spawnClickRipple(layer: HTMLElement | null, x: number, y: number, color: string) {
  if (!layer) return;
  const ripple = document.createElement("div");
  ripple.className = styles.clickRipple;
  ripple.style.left = `${Math.round(x)}px`;
  ripple.style.top = `${Math.round(y)}px`;
  ripple.style.setProperty("--ripple-color", color);
  layer.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 440);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function resolveUserCursorAction(
  target: HTMLElement | null,
  phase: SwarmPhase,
  blueprintMode: boolean,
): { action: string; interactive: boolean; hideCustom: boolean } {
  if (!target) {
    return {
      action: phase !== "idle" ? "Director" : blueprintMode ? "Inspector" : "Exploring",
      interactive: false,
      hideCustom: false,
    };
  }

  // Native text caret for text inputs
  if (
    target.closest(
      "input[type='text'], input[type='email'], input[type='password'], input[type='search'], textarea, [contenteditable='true']",
    )
  ) {
    return { action: "Typing", interactive: false, hideCustom: true };
  }

  if (target.closest(".cursor-zoom-out")) {
    return { action: "Close ×", interactive: true, hideCustom: false };
  }
  if (target.closest(".cursor-zoom-in")) {
    return { action: "Zoom +", interactive: true, hideCustom: false };
  }

  const ariaBtn = target.closest<HTMLElement>("[aria-label]");
  const ariaText = ariaBtn?.getAttribute("aria-label") || "";
  if (ariaText.includes("Swarm Rebuild")) {
    return {
      action: phase !== "idle" ? "Go Live" : "Run Swarm ✦",
      interactive: true,
      hideCustom: false,
    };
  }
  if (ariaText.includes("Blueprint")) {
    return { action: "Blueprint ⊞", interactive: true, hideCustom: false };
  }
  if (ariaText.includes("Switch to")) {
    return { action: "Theme", interactive: true, hideCustom: false };
  }

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (anchor) {
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("http") || anchor.target === "_blank") {
      return { action: "Open ↗", interactive: true, hideCustom: false };
    }
    if (href.startsWith("mailto:")) {
      return { action: "Email ✉", interactive: true, hideCustom: false };
    }
    if (href.startsWith("/work/")) {
      return { action: "Case Study →", interactive: true, hideCustom: false };
    }
    if (href.startsWith("/blog/")) {
      return { action: "Read Story →", interactive: true, hideCustom: false };
    }
    return { action: "Navigate", interactive: true, hideCustom: false };
  }

  if (target.closest("button, [role='button']")) {
    return { action: "Click", interactive: true, hideCustom: false };
  }

  if (phase !== "idle") {
    return { action: "Director", interactive: false, hideCustom: false };
  }

  if (blueprintMode) {
    const bpTarget = target.closest<HTMLElement>("[data-swarm-label]");
    if (bpTarget) {
      const short = (bpTarget.getAttribute("data-swarm-label") || "Inspect").split("·")[0].trim();
      return { action: short, interactive: false, hideCustom: false };
    }
    return { action: "Inspector", interactive: false, hideCustom: false };
  }

  if (target.closest("[data-swarm-target='project-card']")) {
    return { action: "Project", interactive: false, hideCustom: false };
  }

  return { action: "Exploring", interactive: false, hideCustom: false };
}

export const SwarmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  const [phase, setPhase] = useState<SwarmPhase>("idle");
  const [blueprintMode, setBlueprintMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [tourMode, setTourMode] = useState(true);
  const [speed, setSpeedState] = useState<SwarmSpeed>(1);
  const [hudVisible, setHudVisible] = useState(false);
  const [progress, setProgress] = useState<SwarmProgress>({
    current: 0,
    total: 0,
    currentLabel: "Ready",
  });

  // Mutable refs for 60fps animation loop without React re-render overhead
  const phaseRef = useRef<SwarmPhase>("idle");
  const speedRef = useRef<SwarmSpeed>(1);
  const tourRef = useRef<boolean>(true);
  const blueprintRef = useRef<boolean>(false);
  const epochRef = useRef<number>(0);
  const userScrolledDuringTourRef = useRef<boolean>(false);
  const hudHideTimerRef = useRef<number | null>(null);

  const wireLayerRef = useRef<HTMLDivElement | null>(null);
  const cursorLayerRef = useRef<HTMLDivElement | null>(null);
  const inspectLayerRef = useRef<HTMLDivElement | null>(null);
  const inspectBoxRef = useRef<HTMLDivElement | null>(null);
  const inspectBadgeRef = useRef<HTMLDivElement | null>(null);
  const guideHRef = useRef<HTMLDivElement | null>(null);
  const guideVRef = useRef<HTMLDivElement | null>(null);

  // Custom Multiplayer User Cursor DOM refs (0ms input latency)
  const userCursorLayerRef = useRef<HTMLDivElement | null>(null);
  const userCursorRootRef = useRef<HTMLDivElement | null>(null);
  const userCursorSvgRef = useRef<SVGSVGElement | null>(null);
  const userCursorPillRef = useRef<HTMLDivElement | null>(null);
  const userCursorActionRef = useRef<HTMLSpanElement | null>(null);
  const userVelRef = useRef<{ prevX: number; vx: number; tilt: number }>({
    prevX: -9999,
    vx: 0,
    tilt: 0,
  });

  const cursorsRef = useRef<LiveCursorEntity[]>([]);
  const wireframesRef = useRef<Set<TrackedWireframe>>(new Set());
  const concealedElsRef = useRef<Set<HTMLElement>>(new Set());
  const hoveredElRef = useRef<HTMLElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: -9999, y: -9999 });

  // Sync refs with state
  useEffect(() => {
    phaseRef.current = phase;
    if (typeof document !== "undefined") {
      if (phase !== "idle") {
        document.documentElement.setAttribute("data-swarm-active", "true");
      } else {
        document.documentElement.removeAttribute("data-swarm-active");
      }
    }
  }, [phase]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    tourRef.current = tourMode;
  }, [tourMode]);

  useEffect(() => {
    blueprintRef.current = blueprintMode;
    if (typeof document !== "undefined") {
      if (blueprintMode) {
        document.documentElement.setAttribute("data-blueprint", "true");
      } else {
        document.documentElement.removeAttribute("data-blueprint");
      }
    }
  }, [blueprintMode]);

  // Keep user cursor action pill immediately synced when phase or blueprintMode changes while pointer is stationary
  useEffect(() => {
    if (typeof document === "undefined" || !userCursorActionRef.current) return;
    const { x, y } = pointerRef.current;
    const elUnderPointer =
      x >= 0 && y >= 0 ? (document.elementFromPoint(x, y) as HTMLElement | null) : null;
    const { action, interactive } = resolveUserCursorAction(elUnderPointer, phase, blueprintMode);
    userCursorActionRef.current.textContent = action;
    userCursorRootRef.current?.classList.toggle(styles.userCursorInteractive, interactive);
  }, [phase, blueprintMode]);

  // Initialize audio preference & cleanup custom cursor attribute on unmount
  useEffect(() => {
    swarmAudio.init();
    setSoundEnabled(swarmAudio.isEnabled());
    return () => {
      if (typeof document !== "undefined") {
        document.documentElement.removeAttribute("data-custom-cursor");
      }
    };
  }, []);

  const clearHudTimer = useCallback(() => {
    if (hudHideTimerRef.current !== null) {
      window.clearTimeout(hudHideTimerRef.current);
      hudHideTimerRef.current = null;
    }
  }, []);

  const restoreAllElements = useCallback(() => {
    for (const el of concealedElsRef.current) {
      el.removeAttribute("data-swarm-conceal");
    }
    concealedElsRef.current.clear();

    if (typeof document !== "undefined") {
      const remaining = document.querySelectorAll<HTMLElement>("[data-swarm-conceal]");
      for (const el of Array.from(remaining)) {
        el.removeAttribute("data-swarm-conceal");
      }
    }

    for (const w of wireframesRef.current) {
      w.remove();
    }
    wireframesRef.current.clear();
    if (wireLayerRef.current) {
      wireLayerRef.current.innerHTML = "";
    }
  }, []);

  const spawnCursorEntity = useCallback(
    (
      agent: SwarmAgent,
      startX: number,
      startY: number,
      ambient = false,
      initialTask = "",
    ): LiveCursorEntity | null => {
      const layer = cursorLayerRef.current;
      if (!layer) return null;

      const el = document.createElement("div");
      el.className = `${styles.cursorNode} ${ambient ? styles.cursorAmbient : ""}`;
      el.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;

      el.innerHTML = `
        <svg class="${styles.cursorSvg}" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1.6 1.4L6.9 14.3L9.1 9.2L14.4 7.3L1.6 1.4Z" fill="${agent.color}" stroke="#ffffff" stroke-width="1.25" stroke-linejoin="round"/>
        </svg>
        <div class="${styles.cursorTag}" style="background:${agent.color}">
          <span>${agent.name}</span>
          <span class="${styles.cursorTask}" style="${initialTask ? "" : "display:none"}">${initialTask}</span>
        </div>
      `;

      const taskEl = el.querySelector(`.${styles.cursorTask}`) as HTMLSpanElement;
      layer.appendChild(el);

      const entity: LiveCursorEntity = {
        agent,
        el,
        taskEl,
        x: startX,
        y: startY,
        tx: startX,
        ty: startY,
        vx: 0,
        vy: 0,
        arcOffset: (Math.random() - 0.5) * 26,
        orbitPhase: Math.random() * Math.PI * 2,
        ambient,
        pressing: false,
      };
      cursorsRef.current.push(entity);
      return entity;
    },
    [],
  );

  const clearAllCursors = useCallback(() => {
    for (const c of cursorsRef.current) {
      c.el.remove();
    }
    cursorsRef.current = [];
    if (cursorLayerRef.current) {
      cursorLayerRef.current.innerHTML = "";
    }
  }, []);

  const spawnAmbientCoopCursor = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 1024) {
      clearAllCursors();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    clearAllCursors();
    const startX = Math.max(24, window.innerWidth - 210);
    const startY = 140;
    spawnCursorEntity(SWARM_AGENTS[0], startX, startY, true, "60fps");
  }, [clearAllCursors, spawnCursorEntity]);

  // Master 60fps Physics, User Cursor Tilt Decay & Viewport Tracking Loop
  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;

      // Smoothly decay User Multiplayer Cursor velocity tilt back to 0deg when pointer rests
      if (userCursorSvgRef.current) {
        userVelRef.current.vx *= Math.exp(-14 * dt);
        const targetTilt = Math.max(-8, Math.min(8, userVelRef.current.vx * 0.011));
        userVelRef.current.tilt +=
          (targetTilt - userVelRef.current.tilt) * (1 - Math.exp(-18 * dt));
        userCursorSvgRef.current.style.transform = `rotate(${userVelRef.current.tilt.toFixed(2)}deg)`;
      }

      const modalOpen = isFullscreenModalOpen();
      if (cursorLayerRef.current) {
        cursorLayerRef.current.style.opacity = modalOpen && phaseRef.current === "idle" ? "0" : "1";
      }

      // 1. Update active viewport-locked wireframes & hovered inspect box
      for (const wf of wireframesRef.current) {
        wf.update();
      }
      if (modalOpen && phaseRef.current === "idle") {
        if (hoveredElRef.current) {
          hoveredElRef.current = null;
        }
        inspectLayerRef.current?.classList.remove(styles.inspectVisible);
      } else if (hoveredElRef.current && phaseRef.current === "idle") {
        const hEl = hoveredElRef.current;
        const topAtPointer = px >= 0 && py >= 0 ? document.elementFromPoint(px, py) : hEl;
        const isOccluded =
          topAtPointer !== null && !hEl.contains(topAtPointer) && !topAtPointer.contains(hEl);

        if (!document.body.contains(hEl) || isOccluded) {
          hoveredElRef.current = null;
          inspectLayerRef.current?.classList.remove(styles.inspectVisible);
        } else {
          const r = hEl.getBoundingClientRect();
          if (r.bottom < 0 || r.top > vh || r.width < 24 || r.height < 16) {
            inspectLayerRef.current?.classList.remove(styles.inspectVisible);
          } else if (inspectBoxRef.current) {
            const ix = Math.round(r.left);
            const iy = Math.round(r.top);
            const iw = Math.round(r.width);
            const ih = Math.round(r.height);
            inspectBoxRef.current.style.left = `${ix}px`;
            inspectBoxRef.current.style.top = `${iy}px`;
            inspectBoxRef.current.style.width = `${iw}px`;
            inspectBoxRef.current.style.height = `${ih}px`;
            if (blueprintRef.current && guideHRef.current && guideVRef.current) {
              guideHRef.current.style.top = `${iy}px`;
              guideVRef.current.style.left = `${ix}px`;
            }
            syncBadgePlacement(inspectBadgeRef.current, iy, ih, vh);
            inspectLayerRef.current?.classList.add(styles.inspectVisible);
          }
        }
      }

      // 2. Update Swarm cursors with relaxed human-paced spring physics + mouse avoidance
      const maxCursorX = Math.max(40, vw - 195);
      const maxCursorY = Math.max(40, vh - 46);

      for (let idx = 0; idx < cursorsRef.current.length; idx++) {
        const c = cursorsRef.current[idx];
        c.orbitPhase += dt * (c.ambient ? 0.72 : 1.65);

        let goalX = c.tx;
        let goalY = c.ty;

        if (c.ambient) {
          const marginCenter = Math.min(vw - 215, Math.max(vw * 0.78, vw - 240));
          goalX = marginCenter + Math.sin(c.orbitPhase) * 24;
          goalY = Math.min(vh - 130, Math.max(110, vh * 0.34)) + Math.cos(c.orbitPhase * 0.78) * 64;

          const modeLabel = blueprintRef.current ? "blueprint" : "60fps";
          if (c.taskEl.textContent !== modeLabel) {
            setCursorTask(c, modeLabel);
          }
        } else if (!c.pressing) {
          // Gentle organic drift while observing teammates
          goalX += Math.cos(c.orbitPhase + idx * 1.1) * 8;
          goalY += Math.sin(c.orbitPhase * 0.9 + idx) * 7;
        }

        // Subtle curved flight arc when gliding long distances
        const distToGoal = Math.hypot(goalX - c.x, goalY - c.y);
        if (!c.ambient && distToGoal > 36) {
          goalY += Math.min(1, distToGoal / 260) * c.arcOffset;
        }

        // Joel Califa mouse repulsion when user's multiplayer cursor ("You") approaches
        const dxMouse = c.x - px;
        const dyMouse = c.y - py;
        const distMouse = Math.hypot(dxMouse, dyMouse);
        const repelRadius = c.ambient ? 170 : 95;
        if (distMouse > 1 && distMouse < repelRadius && !c.pressing) {
          const strength = ((repelRadius - distMouse) / repelRadius) * (c.ambient ? 118 : 50);
          goalX += (dxMouse / distMouse) * strength;
          goalY += (dyMouse / distMouse) * strength;
        }

        // Clamp goal inside viewport so cursor pill never clips off-screen
        goalX = Math.max(14, Math.min(maxCursorX, goalX));
        goalY = Math.max(14, Math.min(maxCursorY, goalY));

        // Relaxed, human hand glide stiffness (5.4 at 1x instead of snappy 11.5)
        const stiffness = c.ambient ? 3.4 : Math.min(18, 5.4 * speedRef.current);
        const step = 1 - Math.exp(-stiffness * dt);

        const prevX = c.x;
        c.x += (goalX - c.x) * step;
        c.y += (goalY - c.y) * step;
        c.vx = (c.x - prevX) / Math.max(0.008, dt);

        const tilt = Math.max(-8, Math.min(8, c.vx * 0.01));
        c.el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) rotate(${tilt.toFixed(1)}deg)`;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  // Living Canvas Hover Inspect + 0ms-Latency Custom Multiplayer User Cursor
  const updateInspectBox = useCallback((el: HTMLElement | null) => {
    const layer = inspectLayerRef.current;
    const box = inspectBoxRef.current;
    const badge = inspectBadgeRef.current;
    const gh = guideHRef.current;
    const gv = guideVRef.current;
    if (!layer || !box || !badge || !gh || !gv) return;

    if (!el || phaseRef.current !== "idle" || isFullscreenModalOpen()) {
      layer.classList.remove(styles.inspectVisible);
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 16 || rect.bottom < 0 || rect.top > window.innerHeight) {
      layer.classList.remove(styles.inspectVisible);
      return;
    }

    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;

    const isBp = blueprintRef.current;
    gh.style.display = isBp ? "block" : "none";
    gv.style.display = isBp ? "block" : "none";
    if (isBp) {
      gh.style.top = `${y}px`;
      gv.style.left = `${x}px`;
    }

    const name = el.getAttribute("data-swarm-label") || el.tagName.toLowerCase();
    badge.textContent = isBp ? `${name} · ${w}×${h} · (${x}, ${y})` : `${name} · ${w}×${h}`;
    syncBadgePlacement(badge, y, h, window.innerHeight);

    layer.classList.add(styles.inspectVisible);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    const onPointerMove = (e: PointerEvent) => {
      const prevX = userVelRef.current.prevX;
      if (prevX > -9000) {
        userVelRef.current.vx = (e.clientX - prevX) * 28;
      }
      userVelRef.current.prevX = e.clientX;
      pointerRef.current = { x: e.clientX, y: e.clientY };

      const targetNode = e.target as HTMLElement | null;

      // Update Custom Multiplayer User Cursor with 0ms tip latency
      if (e.pointerType === "mouse" && finePointer && userCursorRootRef.current) {
        userCursorRootRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;

        const { action, interactive, hideCustom } = resolveUserCursorAction(
          targetNode,
          phaseRef.current,
          blueprintRef.current,
        );

        if (hideCustom) {
          userCursorRootRef.current.classList.remove(styles.userCursorVisible);
          document.documentElement.removeAttribute("data-custom-cursor");
        } else {
          userCursorRootRef.current.classList.add(styles.userCursorVisible);
          userCursorRootRef.current.classList.toggle(styles.userCursorInteractive, interactive);
          if (!document.documentElement.hasAttribute("data-custom-cursor")) {
            document.documentElement.setAttribute("data-custom-cursor", "true");
          }
          if (userCursorActionRef.current && userCursorActionRef.current.textContent !== action) {
            userCursorActionRef.current.textContent = action;
          }
          // Flip user cursor pill to the left of the arrow when near right edge of screen
          if (userCursorPillRef.current) {
            userCursorPillRef.current.classList.toggle(
              styles.userCursorPillFlipped,
              e.clientX > window.innerWidth - 175,
            );
          }
        }
      } else if (e.pointerType !== "mouse" && userCursorRootRef.current) {
        userCursorRootRef.current.classList.remove(styles.userCursorVisible);
        document.documentElement.removeAttribute("data-custom-cursor");
      }

      // Living Canvas Hover Inspect
      if (e.pointerType !== "mouse" || phaseRef.current !== "idle" || isFullscreenModalOpen()) {
        if (hoveredElRef.current) {
          hoveredElRef.current = null;
          updateInspectBox(null);
        }
        return;
      }

      if (!targetNode || targetNode.closest("[data-swarm-ignore]")) {
        if (hoveredElRef.current) {
          hoveredElRef.current = null;
          updateInspectBox(null);
        }
        return;
      }

      const labeledMatch = targetNode.closest<HTMLElement>(
        blueprintRef.current
          ? "[data-swarm-label], [data-swarm-target]"
          : "[data-swarm-inspect='true']",
      );
      const matched =
        labeledMatch ??
        (blueprintRef.current ? targetNode.closest<HTMLElement>("h1, h2, h3, p, footer") : null);

      if (matched !== hoveredElRef.current) {
        hoveredElRef.current = matched;
        if (matched && blueprintRef.current) {
          swarmAudio.playHoverTick();
        }
        updateInspectBox(matched);
      } else if (matched) {
        updateInspectBox(matched);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && finePointer && userCursorRootRef.current) {
        userCursorRootRef.current.classList.add(styles.userCursorDown);
        spawnClickRipple(userCursorLayerRef.current, e.clientX, e.clientY, "#818cf8");
      }
    };

    const onPointerUp = () => {
      userCursorRootRef.current?.classList.remove(styles.userCursorDown);
    };

    const onDocumentMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        userCursorRootRef.current?.classList.remove(
          styles.userCursorVisible,
          styles.userCursorDown,
        );
        pointerRef.current = { x: -9999, y: -9999 };
      }
    };

    const onUserWheelOrTouch = () => {
      if (phaseRef.current === "full-rebuild") {
        userScrolledDuringTourRef.current = true;
      }
    };

    const onScroll = () => {
      if (hoveredElRef.current && phaseRef.current === "idle") {
        updateInspectBox(hoveredElRef.current);
      }
    };

    const onResize = () => {
      if (phaseRef.current === "idle") {
        if (hoveredElRef.current) {
          updateInspectBox(hoveredElRef.current);
        }
        const hasAmbient = cursorsRef.current.some((c) => c.ambient);
        if (window.innerWidth < 1024 && hasAmbient) {
          clearAllCursors();
        } else if (window.innerWidth >= 1024 && !hasAmbient) {
          spawnAmbientCoopCursor();
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    window.addEventListener("blur", onPointerUp, { passive: true });
    window.addEventListener("wheel", onUserWheelOrTouch, { passive: true });
    window.addEventListener("touchmove", onUserWheelOrTouch, { passive: true });
    document.addEventListener("mouseout", onDocumentMouseOut, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onPointerUp);
      window.removeEventListener("wheel", onUserWheelOrTouch);
      window.removeEventListener("touchmove", onUserWheelOrTouch);
      document.removeEventListener("mouseout", onDocumentMouseOut);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [clearAllCursors, spawnAmbientCoopCursor, updateInspectBox]);

  // Helper: Cancellable scaled wait
  const waitScaled = useCallback((ms: number, epoch: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const check = (now: number) => {
        if (epochRef.current !== epoch) {
          reject(new Error("cancelled"));
          return;
        }
        const elapsed = (now - start) * speedRef.current;
        if (elapsed >= ms) {
          resolve();
        } else {
          window.requestAnimationFrame(check);
        }
      };
      window.requestAnimationFrame(check);
    });
  }, []);

  // Helper: Relaxed, human-browsing viewport scroll for Tour Mode
  const ensureInViewport = useCallback(
    async (
      el: HTMLElement,
      epoch: number,
      observerCursors: LiveCursorEntity[] = [],
    ): Promise<void> => {
      if (!tourRef.current || typeof window === "undefined") return;
      const rect = el.getBoundingClientRect();
      const topMargin = 92;
      const bottomMargin = window.innerHeight - 130;

      const comfortablyVisible =
        (rect.top >= topMargin && rect.bottom <= bottomMargin) ||
        (rect.top >= topMargin && rect.top <= window.innerHeight * 0.42);

      if (!comfortablyVisible) {
        const targetScrollY = Math.max(
          0,
          window.scrollY + rect.top - Math.min(148, window.innerHeight * 0.2),
        );
        const startY = window.scrollY;
        const diff = targetScrollY - startY;

        if (Math.abs(diff) >= 32) {
          // Leisurely reading-scroll speed (~850ms - 1500ms at 1x)
          const duration = Math.min(1520, Math.max(820, Math.abs(diff) * 1.08));
          const startTime = performance.now();

          await new Promise<void>((resolve, reject) => {
            const step = (now: number) => {
              if (epochRef.current !== epoch) {
                reject(new Error("cancelled"));
                return;
              }
              const t = Math.min(1, ((now - startTime) * speedRef.current) / duration);
              const eased = easeInOutCubic(t);
              window.scrollTo(0, startY + diff * eased);
              if (t < 1) {
                window.requestAnimationFrame(step);
              } else {
                resolve();
              }
            };
            window.requestAnimationFrame(step);
          });

          // Brief reading breath after camera settles on section
          await waitScaled(240, epoch);
        }
      }

      // Bring idle teammate cursors into flanking observer positions around the current focal block
      if (observerCursors.length > 0) {
        const liveRect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        for (let i = 0; i < observerCursors.length; i++) {
          const obs = observerCursors[i];
          const onLeft = i % 2 === 0;
          obs.tx = onLeft
            ? Math.max(24, liveRect.left - 85 - (i % 3) * 18)
            : Math.min(vw - 205, liveRect.right + 28 + (i % 3) * 14);
          obs.ty = Math.max(
            76,
            Math.min(vh - 96, liveRect.top + 28 + ((i * 54) % Math.max(60, liveRect.height))),
          );
          setCursorTask(obs, "reviewing");
        }
      }
    },
    [waitScaled],
  );

  // Build Action 1: Deliberate, Browse-Paced Wireframe Box Construction
  const runBoxAction = useCallback(
    async (cursor: LiveCursorEntity, target: SwarmTarget, epoch: number, isHeroIntro = false) => {
      const layer = wireLayerRef.current;
      if (!layer) return;

      const shortName = target.label.split("·")[0].trim();
      const r0 = target.el.getBoundingClientRect();
      cursor.tx = r0.left;
      cursor.ty = r0.top;
      setCursorTask(cursor, shortName);
      await waitScaled(isHeroIntro ? 340 : 440, epoch);

      const rClick = target.el.getBoundingClientRect();
      setCursorPressing(cursor, true);
      spawnClickRipple(layer, rClick.left, rClick.top, cursor.agent.color);
      swarmAudio.playDragStart();

      const box = document.createElement("div");
      box.className = styles.wireBox;
      box.style.setProperty("--wire-color", cursor.agent.color);
      box.appendChild(createWireCornersFragment());

      const badge = document.createElement("div");
      badge.className = styles.wireSizeBadge;
      box.appendChild(badge);

      let progressRatio = 0.04;
      const tracker: TrackedWireframe = {
        update: () => {
          const r = target.el.getBoundingClientRect();
          const curW = Math.max(10, Math.round(r.width * progressRatio));
          const curH = Math.max(10, Math.round(r.height * progressRatio));
          box.style.left = `${Math.round(r.left)}px`;
          box.style.top = `${Math.round(r.top)}px`;
          box.style.width = `${curW}px`;
          box.style.height = `${curH}px`;
          badge.textContent = `${shortName} · ${curW} × ${curH}`;
          cursor.tx = r.left + curW;
          cursor.ty = r.top + curH;
        },
        remove: () => box.remove(),
      };
      tracker.update();
      layer.appendChild(box);
      wireframesRef.current.add(tracker);

      // Scale drag duration comfortably by element size (~680ms for buttons, ~1050ms for cards)
      const dragDuration = isHeroIntro
        ? 580
        : Math.min(1120, Math.max(680, (r0.width + r0.height) * 0.56));
      const dragStart = performance.now();

      await new Promise<void>((resolve, reject) => {
        const step = (now: number) => {
          if (epochRef.current !== epoch) {
            tracker.remove();
            wireframesRef.current.delete(tracker);
            reject(new Error("cancelled"));
            return;
          }
          const t = Math.min(1, ((now - dragStart) * speedRef.current) / dragDuration);
          progressRatio = easeInOutCubic(t);
          setCursorTask(
            cursor,
            `${Math.round(r0.width * progressRatio)}×${Math.round(r0.height * progressRatio)}`,
          );
          if (t < 1) {
            window.requestAnimationFrame(step);
          } else {
            resolve();
          }
        };
        window.requestAnimationFrame(step);
      });

      const rEnd = target.el.getBoundingClientRect();
      setCursorPressing(cursor, false);
      spawnClickRipple(layer, rEnd.right, rEnd.bottom, cursor.agent.color);
      target.el.setAttribute("data-swarm-conceal", "revealed");
      concealedElsRef.current.delete(target.el);
      swarmAudio.playSnap();

      wireframesRef.current.delete(tracker);
      box.remove();

      // Let the viewer admire the newly constructed block before moving on
      if (!isHeroIntro) {
        setCursorTask(cursor, "aligned ✓");
        await waitScaled(400, epoch);
      }
    },
    [waitScaled],
  );

  // Build Action 2: Natural Character-by-Character Typewriter
  const runTypewriterAction = useCallback(
    async (cursor: LiveCursorEntity, target: SwarmTarget, epoch: number, fast = false) => {
      const layer = wireLayerRef.current;
      const text = target.textSnapshot || "";
      if (!layer || !text) {
        await runBoxAction(cursor, target, epoch, fast);
        return;
      }

      const textHost =
        target.el.querySelector<HTMLElement>(
          "h1, h2, h3, [class*='display'], [class*='heading']",
        ) ?? target.el;
      const cs = window.getComputedStyle(textHost);
      const r0 = textHost.getBoundingClientRect();

      const guide = document.createElement("div");
      guide.className = styles.alignGuideV;
      guide.style.setProperty("--wire-color", cursor.agent.color);

      const ghost = document.createElement("div");
      ghost.className = styles.typewriterGhost;
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

      const tracker: TrackedWireframe = {
        update: () => {
          const r = textHost.getBoundingClientRect();
          ghost.style.left = `${Math.round(r.left)}px`;
          ghost.style.top = `${Math.round(r.top)}px`;
          ghost.style.width = `${Math.round(r.width)}px`;
          const alignX =
            cs.textAlign === "center" ? Math.round(r.left + r.width / 2) : Math.round(r.left);
          guide.style.left = `${alignX}px`;
        },
        remove: () => {
          ghost.remove();
          guide.remove();
        },
      };
      tracker.update();
      layer.appendChild(guide);
      layer.appendChild(ghost);
      wireframesRef.current.add(tracker);

      cursor.tx = r0.left + 16;
      cursor.ty = r0.top + Math.min(24, r0.height * 0.45);
      setCursorTask(cursor, "typing...");
      await waitScaled(fast ? 260 : 380, epoch);
      setCursorPressing(cursor, true);
      spawnClickRipple(layer, cursor.tx, cursor.ty, cursor.agent.color);

      const charsPerStep = 1;
      const baseDelay = fast ? 34 : 46;

      try {
        for (let i = 1; i <= text.length; i += charsPerStep) {
          if (epochRef.current !== epoch) throw new Error("cancelled");
          const slice = text.slice(0, i);
          const lastChar = slice[slice.length - 1];
          ghost.textContent = slice;
          const caret = document.createElement("span");
          caret.className = styles.typingCaret;
          caret.style.background = cursor.agent.color;
          ghost.appendChild(caret);

          const liveR = textHost.getBoundingClientRect();
          const ratio = i / text.length;
          cursor.tx = liveR.left + 16 + ratio * Math.max(24, liveR.width - 32);
          cursor.ty = liveR.top + Math.min(32, liveR.height * 0.55);

          if (i % 2 === 0 && lastChar !== " ") {
            swarmAudio.playKey();
          }

          const punctuationPause =
            lastChar === "," || lastChar === "-" || lastChar === "–" || lastChar === "."
              ? 75
              : lastChar === " "
                ? 18
                : 0;
          await waitScaled(baseDelay + punctuationPause, epoch);
        }
      } finally {
        setCursorPressing(cursor, false);
        wireframesRef.current.delete(tracker);
        tracker.remove();
      }

      target.el.setAttribute("data-swarm-conceal", "revealed");
      concealedElsRef.current.delete(target.el);
      swarmAudio.playSnap();

      if (!fast) {
        setCursorTask(cursor, "typed ✓");
        await waitScaled(360, epoch);
      }
    },
    [runBoxAction, waitScaled],
  );

  // Build Action 3: Unhurried Alt+Drag Duplication with Lingering Figma Smart-Spacing Ruler
  const runDuplicateAction = useCallback(
    async (cursor: LiveCursorEntity, target: SwarmTarget, epoch: number) => {
      const layer = wireLayerRef.current;
      const srcEl = target.sourceEl;
      if (!layer || !srcEl) {
        await runBoxAction(cursor, target, epoch, false);
        return;
      }

      const rs0 = srcEl.getBoundingClientRect();
      cursor.tx = rs0.left + rs0.width * 0.5;
      cursor.ty = rs0.top + Math.min(54, rs0.height * 0.32);
      setCursorTask(cursor, "Alt + Drag");
      await waitScaled(380, epoch);

      setCursorPressing(cursor, true);
      spawnClickRipple(layer, cursor.tx, cursor.ty, cursor.agent.color);
      swarmAudio.playDuplicate();

      const ghost = document.createElement("div");
      ghost.className = `${styles.wireBox} ${styles.wireDashed}`;
      ghost.style.setProperty("--wire-color", cursor.agent.color);
      ghost.appendChild(createWireCornersFragment());

      const badge = document.createElement("div");
      badge.className = styles.wireSizeBadge;
      badge.textContent = `Alt + Drag · ${target.label.split("·")[0].trim()}`;
      ghost.appendChild(badge);

      const gapLine = document.createElement("div");
      const gapPill = document.createElement("div");
      gapPill.className = styles.gapPill;

      let slideT = 0;
      const tracker: TrackedWireframe = {
        update: () => {
          const rs = srcEl.getBoundingClientRect();
          const rt = target.el.getBoundingClientRect();
          const x = rs.left + (rt.left - rs.left) * slideT;
          const y = rs.top + (rt.top - rs.top) * slideT;
          const w = rs.width + (rt.width - rs.width) * slideT;
          const h = rs.height + (rt.height - rs.height) * slideT;

          ghost.style.left = `${Math.round(x)}px`;
          ghost.style.top = `${Math.round(y)}px`;
          ghost.style.width = `${Math.round(w)}px`;
          ghost.style.height = `${Math.round(h)}px`;

          cursor.tx = x + w * 0.5;
          cursor.ty = y + Math.min(54, h * 0.32);

          const verticalOverlap = Math.min(rs.bottom, rt.bottom) - Math.max(rs.top, rt.top);
          const isHorizontalRow =
            verticalOverlap > 24 && (rt.left >= rs.right - 12 || rs.left >= rt.right - 12);

          if (!isHorizontalRow) {
            const topEdge = Math.min(rs.bottom, rt.bottom);
            const bottomEdge = Math.max(rs.top, rt.top);
            const gap = Math.max(0, Math.round(bottomEdge - topEdge));
            const gx = Math.round(rt.left + rt.width / 2);
            const lineTop = Math.max(8, Math.round(topEdge));
            const lineH = Math.max(
              0,
              Math.min(window.innerHeight - 8, Math.round(bottomEdge)) - lineTop,
            );

            gapLine.className = styles.gapLineV;
            gapLine.style.left = `${gx}px`;
            gapLine.style.top = `${lineTop}px`;
            gapLine.style.height = `${lineH}px`;
            gapLine.style.width = "1.5px";
            gapLine.style.display = lineH >= 6 ? "block" : "none";

            const gy = Math.max(
              36,
              Math.min(window.innerHeight - 36, Math.round((topEdge + bottomEdge) / 2)),
            );
            gapPill.style.left = `${gx}px`;
            gapPill.style.top = `${gy}px`;
            gapPill.textContent = `↕ ${gap}px`;
          } else {
            const leftEdge = Math.min(rs.right, rt.right);
            const rightEdge = Math.max(rs.left, rt.left);
            const gap = Math.max(0, Math.round(rightEdge - leftEdge));
            const gy = Math.max(
              36,
              Math.min(window.innerHeight - 36, Math.round(rt.top + rt.height / 2)),
            );
            const lineLeft = Math.max(8, Math.round(leftEdge));
            const lineW = Math.max(
              0,
              Math.min(window.innerWidth - 8, Math.round(rightEdge)) - lineLeft,
            );

            gapLine.className = styles.gapLineH;
            gapLine.style.left = `${lineLeft}px`;
            gapLine.style.top = `${gy}px`;
            gapLine.style.width = `${lineW}px`;
            gapLine.style.height = "1.5px";
            gapLine.style.display = lineW >= 6 ? "block" : "none";

            const gx = Math.round((leftEdge + rightEdge) / 2);
            gapPill.style.left = `${gx}px`;
            gapPill.style.top = `${gy}px`;
            gapPill.textContent = `↔ ${gap}px`;
          }
        },
        remove: () => {
          ghost.remove();
          gapLine.style.opacity = "0";
          gapPill.style.opacity = "0";
          window.setTimeout(() => {
            gapLine.remove();
            gapPill.remove();
          }, 360);
        },
      };
      tracker.update();
      layer.appendChild(ghost);
      layer.appendChild(gapLine);
      layer.appendChild(gapPill);
      wireframesRef.current.add(tracker);

      // Pause briefly after grabbing clone, then glide smoothly into destination
      await waitScaled(140, epoch);
      const slideDur = 820;
      const slideStart = performance.now();
      await new Promise<void>((resolve, reject) => {
        const step = (now: number) => {
          if (epochRef.current !== epoch) {
            tracker.remove();
            wireframesRef.current.delete(tracker);
            reject(new Error("cancelled"));
            return;
          }
          const raw = Math.min(1, ((now - slideStart) * speedRef.current) / slideDur);
          slideT = easeInOutCubic(raw);
          if (raw < 1) {
            window.requestAnimationFrame(step);
          } else {
            resolve();
          }
        };
        window.requestAnimationFrame(step);
      });

      setCursorPressing(cursor, false);
      spawnClickRipple(layer, cursor.tx, cursor.ty, cursor.agent.color);
      target.el.setAttribute("data-swarm-conceal", "revealed");
      concealedElsRef.current.delete(target.el);
      swarmAudio.playSnap();

      ghost.remove();
      // Keep the red Figma spacing ruler visible briefly so the viewer admires the exact spacing
      setCursorTask(cursor, "spaced ✓");
      await waitScaled(460, epoch);
      wireframesRef.current.delete(tracker);
      tracker.remove();
    },
    [runBoxAction, waitScaled],
  );

  const stopAndGoLive = useCallback(() => {
    epochRef.current += 1;
    clearHudTimer();
    restoreAllElements();
    setPhase("idle");
    setHudVisible(false);
    spawnAmbientCoopCursor();
  }, [clearHudTimer, restoreAllElements, spawnAmbientCoopCursor]);

  // Core Sequence Orchestrator (Browse-Paced Full Tour & Graceful Hero Intro)
  const executeSwarmSequence = useCallback(
    async (scope: "hero" | "full", withTourOverride?: boolean) => {
      if (typeof window === "undefined") return;

      epochRef.current += 1;
      const epoch = epochRef.current;
      userScrolledDuringTourRef.current = false;
      clearHudTimer();
      hoveredElRef.current = null;
      updateInspectBox(null);
      restoreAllElements();
      clearAllCursors();

      if (typeof withTourOverride === "boolean") {
        setTourMode(withTourOverride);
        tourRef.current = withTourOverride;
      }

      if (scope === "full" && tourRef.current && window.scrollY > 120) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        await waitScaled(550, epoch);
      }

      const targets = scanSwarmTargets(scope);
      if (targets.length === 0) {
        spawnAmbientCoopCursor();
        return;
      }

      for (const t of targets) {
        t.el.setAttribute("data-swarm-conceal", "true");
        concealedElsRef.current.add(t.el);
      }

      setPhase(scope === "hero" ? "hero-intro" : "full-rebuild");
      setHudVisible(true);
      setProgress({
        current: 0,
        total: targets.length,
        currentLabel: targets[0].label,
      });

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw < 640;
      const agentCount =
        scope === "hero"
          ? Math.min(isMobile ? 3 : 4, SWARM_AGENTS.length)
          : Math.min(isMobile ? 4 : 6, SWARM_AGENTS.length);

      const spawnPoints = [
        [36, 48],
        [Math.max(40, vw - 210), 56],
        [44, Math.max(80, vh - 120)],
        [Math.max(40, vw - 215), Math.max(80, vh - 120)],
        [vw * 0.5 - 70, 44],
        [vw * 0.5 + 30, Math.max(80, vh - 110)],
      ];

      const activeCursors = SWARM_AGENTS.slice(0, agentCount)
        .map((ag, i) => {
          const [sx, sy] = spawnPoints[i % spawnPoints.length];
          return spawnCursorEntity(ag, sx, sy, false, ag.role);
        })
        .filter((c): c is LiveCursorEntity => c !== null);

      try {
        if (scope === "hero") {
          // Graceful Staggered Hero Intro (~3.5s comfortable watchable intro)
          let doneCount = 0;
          await Promise.all(
            targets.map(async (target, idx) => {
              const cursor = activeCursors[idx % activeCursors.length];
              await waitScaled(idx * 280, epoch);
              if (target.kind === "typewriter") {
                await runTypewriterAction(cursor, target, epoch, true);
              } else {
                await runBoxAction(cursor, target, epoch, true);
              }
              doneCount += 1;
              setProgress({
                current: doneCount,
                total: targets.length,
                currentLabel: target.label,
              });
            }),
          );
        } else {
          // Browse-Paced Storyboard Full Rebuild: 1 focal section (or 2 same-row items) per beat
          let idx = 0;
          while (idx < targets.length) {
            if (epochRef.current !== epoch) throw new Error("cancelled");

            const leadTarget = targets[idx];
            const wave: SwarmTarget[] = [leadTarget];
            const leadRect = leadTarget.el.getBoundingClientRect();
            const leadTop = leadRect.top + window.scrollY;

            // Only pair a 2nd item concurrently if it sits on the same horizontal row and isn't a duplicate of leadTarget
            if (idx + 1 < targets.length && activeCursors.length >= 2) {
              const nextT = targets[idx + 1];
              const nextTop = nextT.el.getBoundingClientRect().top + window.scrollY;
              if (
                nextT.kind !== "duplicate" &&
                leadTarget.kind !== "typewriter" &&
                nextT.kind !== "typewriter" &&
                Math.abs(nextTop - leadTop) <= 44
              ) {
                wave.push(nextT);
              }
            }

            const assignedSet = new Set<LiveCursorEntity>();
            const waveCursors = wave.map((_, wIdx) => {
              const c = activeCursors[(idx + wIdx) % activeCursors.length];
              assignedSet.add(c);
              return c;
            });
            const observerCursors = activeCursors.filter((c) => !assignedSet.has(c));

            setProgress({
              current: idx,
              total: targets.length,
              currentLabel: wave[0].label,
            });

            // Smoothly scroll section into comfortable reading position & bring teammate cursors along
            await ensureInViewport(leadTarget.el, epoch, observerCursors);

            await Promise.all(
              wave.map(async (target, wIdx) => {
                const cursor = waveCursors[wIdx];
                await waitScaled(wIdx * 220, epoch);
                if (target.kind === "typewriter") {
                  await runTypewriterAction(cursor, target, epoch, false);
                } else if (target.kind === "duplicate") {
                  await runDuplicateAction(cursor, target, epoch);
                } else {
                  await runBoxAction(cursor, target, epoch, false);
                }
              }),
            );

            idx += wave.length;
            setProgress({
              current: idx,
              total: targets.length,
              currentLabel: idx >= targets.length ? "Build complete ✓" : targets[idx].label,
            });
          }

          // Linger comfortably at the bottom before gently gliding back to top (if user didn't scroll manually)
          if (tourRef.current && !userScrolledDuringTourRef.current && window.scrollY > 240) {
            await waitScaled(1100, epoch);
            const startY = window.scrollY;
            const returnDur = Math.min(1650, Math.max(950, startY * 0.55));
            const returnStart = performance.now();
            await new Promise<void>((resolve, reject) => {
              const step = (now: number) => {
                if (epochRef.current !== epoch) {
                  reject(new Error("cancelled"));
                  return;
                }
                if (userScrolledDuringTourRef.current) {
                  resolve();
                  return;
                }
                const t = Math.min(1, ((now - returnStart) * speedRef.current) / returnDur);
                window.scrollTo(0, startY * (1 - easeInOutCubic(t)));
                if (t < 1) {
                  window.requestAnimationFrame(step);
                } else {
                  resolve();
                }
              };
              window.requestAnimationFrame(step);
            });
          }
        }

        if (epochRef.current !== epoch) return;

        swarmAudio.playComplete();
        restoreAllElements();
        setPhase("idle");

        for (const c of activeCursors) {
          c.el.style.opacity = "0";
        }
        await waitScaled(320, epoch);
        if (epochRef.current !== epoch) return;
        spawnAmbientCoopCursor();

        if (scope === "hero") {
          setHudVisible(false);
        } else {
          hudHideTimerRef.current = window.setTimeout(() => {
            setHudVisible(false);
          }, 4200);
        }
      } catch {
        // Cancelled via Esc / Go Live / Route navigation
      }
    },
    [
      clearAllCursors,
      clearHudTimer,
      ensureInViewport,
      restoreAllElements,
      runBoxAction,
      runDuplicateAction,
      runTypewriterAction,
      spawnAmbientCoopCursor,
      spawnCursorEntity,
      updateInspectBox,
      waitScaled,
    ],
  );

  const startFullRebuild = useCallback(
    (options?: { withTour?: boolean }) => {
      swarmAudio.unlockNow();
      executeSwarmSequence("full", options?.withTour);
    },
    [executeSwarmSequence],
  );

  const toggleBlueprintMode = useCallback(() => {
    swarmAudio.unlockNow();
    setBlueprintMode((prev) => {
      const next = !prev;
      if (next) swarmAudio.playSnap();
      if (!next && hoveredElRef.current) {
        hoveredElRef.current = null;
        updateInspectBox(null);
      }
      return next;
    });
  }, [updateInspectBox]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      swarmAudio.setEnabled(next);
      return next;
    });
  }, []);

  const toggleTourMode = useCallback(() => {
    swarmAudio.unlockNow();
    setTourMode((prev) => !prev);
  }, []);

  const setSpeed = useCallback((nextSpeed: SwarmSpeed) => {
    swarmAudio.unlockNow();
    setSpeedState(nextSpeed);
  }, []);

  const cycleSpeed = useCallback(() => {
    swarmAudio.unlockNow();
    setSpeedState((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 1));
  }, []);

  // Route navigation & First-Visit Hero Intro
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentRoute = pathname ?? "/";
    if (!currentRoute) return;

    epochRef.current += 1;
    clearHudTimer();
    restoreAllElements();
    setPhase("idle");
    setHudVisible(false);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seenIntro = window.sessionStorage.getItem(SWARM_INTRO_SESSION_KEY);

    if (!seenIntro && !reducedMotion) {
      window.sessionStorage.setItem(SWARM_INTRO_SESSION_KEY, "1");
      const timer = window.setTimeout(() => {
        executeSwarmSequence("hero");
      }, 110);
      return () => window.clearTimeout(timer);
    }

    spawnAmbientCoopCursor();
  }, [pathname, clearHudTimer, executeSwarmSequence, restoreAllElements, spawnAmbientCoopCursor]);

  // Global Swarm Rebuild Keyboard Shortcuts
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.altKey && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        if (phaseRef.current !== "idle") {
          stopAndGoLive();
        } else {
          startFullRebuild();
        }
        return;
      }

      if (e.altKey && e.shiftKey && e.code === "KeyB") {
        e.preventDefault();
        toggleBlueprintMode();
        return;
      }

      if (phaseRef.current !== "idle" || hudVisible) {
        if (e.key === "Escape" || e.key === "l" || e.key === "L") {
          e.preventDefault();
          stopAndGoLive();
        } else if (e.key === "1") {
          setSpeed(1);
        } else if (e.key === "2") {
          setSpeed(2);
        } else if (e.key === "3") {
          setSpeed(3);
        } else if (e.key === "t" || e.key === "T") {
          toggleTourMode();
        } else if (e.key === "m" || e.key === "M") {
          toggleSound();
        } else if (e.key === "r" || e.key === "R") {
          startFullRebuild();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    hudVisible,
    setSpeed,
    startFullRebuild,
    stopAndGoLive,
    toggleBlueprintMode,
    toggleSound,
    toggleTourMode,
  ]);

  const contextValue = useMemo<SwarmContextValue>(
    () => ({
      phase,
      isRebuilding: phase !== "idle",
      blueprintMode,
      soundEnabled,
      tourMode,
      speed,
      progress,
      hudVisible,
      startFullRebuild,
      stopAndGoLive,
      toggleBlueprintMode,
      toggleSound,
      toggleTourMode,
      setSpeed,
      cycleSpeed,
    }),
    [
      blueprintMode,
      cycleSpeed,
      hudVisible,
      phase,
      progress,
      setSpeed,
      soundEnabled,
      speed,
      startFullRebuild,
      stopAndGoLive,
      toggleBlueprintMode,
      toggleSound,
      toggleTourMode,
      tourMode,
    ],
  );

  const isRunning = phase !== "idle";
  const progressPercent =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <SwarmContext.Provider value={contextValue}>
      {children}

      {/* Viewport Overlay Portal for Inspect, Blueprints, and Swarm Bot Cursors */}
      <div className={styles.overlayRoot} data-swarm-ignore="true" aria-hidden="true">
        <div ref={inspectLayerRef} className={styles.inspectLayer}>
          <div ref={guideHRef} className={styles.guideH} />
          <div ref={guideVRef} className={styles.guideV} />
          <div ref={inspectBoxRef} className={styles.inspectBox}>
            <span className={styles.cornerTL} />
            <span className={styles.cornerTR} />
            <span className={styles.cornerBL} />
            <span className={styles.cornerBR} />
            <div ref={inspectBadgeRef} className={styles.inspectBadge}>
              Component · 0×0
            </div>
          </div>
        </div>

        <div ref={wireLayerRef} className={styles.wireLayer} />
        <div ref={cursorLayerRef} className={styles.cursorLayer} />
      </div>

      {/* Custom Multiplayer User Cursor Layer (0ms lag, stays above Lightbox) */}
      <div
        ref={userCursorLayerRef}
        className={styles.userCursorLayer}
        data-swarm-ignore="true"
        aria-hidden="true"
      >
        <div ref={userCursorRootRef} className={styles.userCursorRoot}>
          <div className={styles.userCursorInner}>
            <svg
              ref={userCursorSvgRef}
              className={styles.userCursorSvg}
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden="true"
            >
              <title>User cursor</title>
              <path
                d="M1.8 1.5L7.6 15.8L10.1 10.1L15.8 7.6L1.8 1.5Z"
                fill="#6366f1"
                stroke="#ffffff"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <div ref={userCursorPillRef} className={styles.userCursorPill}>
              <span className={styles.userCursorDot} />
              <span>You</span>
              <span ref={userCursorActionRef} className={styles.userCursorAction}>
                Exploring
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Swarm Control HUD Dock */}
      {hudVisible && (
        <section
          className={styles.hudDock}
          data-swarm-ignore="true"
          aria-label="Swarm Rebuild Controls"
        >
          <div className={styles.hudProgressTrack}>
            <div
              className={styles.hudProgressBar}
              style={{ width: `${isRunning ? progressPercent : 100}%` }}
            />
          </div>

          <div className={styles.hudStatusGroup}>
            <span className={`${styles.hudDot} ${!isRunning ? styles.hudDotDone : ""}`} />
            <span className={styles.hudLabel}>
              {isRunning
                ? `${progress.current}/${progress.total} · ${progress.currentLabel}`
                : "Swarm complete ✓"}
            </span>
          </div>

          <span className={styles.hudDivider} />

          <button
            type="button"
            onClick={cycleSpeed}
            className={`${styles.hudBtn} ${speed > 1 ? styles.hudBtnActive : ""}`}
            title="Build speed (Keys 1, 2, 3)"
          >
            {speed}×
          </button>

          {phase !== "hero-intro" && (
            <button
              type="button"
              onClick={toggleTourMode}
              className={`${styles.hudBtn} ${styles.hideMobile} ${tourMode ? styles.hudBtnActive : ""}`}
              title="Auto-scroll Tour mode (Key T)"
            >
              Tour
            </button>
          )}

          <button
            type="button"
            onClick={toggleSound}
            className={`${styles.hudBtn} ${soundEnabled ? styles.hudBtnActive : ""}`}
            title="Toggle Web Audio effects (Key M)"
          >
            {soundEnabled ? "🔊" : "🔇"}
          </button>

          {!isRunning ? (
            <button
              type="button"
              onClick={() => startFullRebuild()}
              className={styles.hudBtn}
              title="Replay Swarm Rebuild (Key R)"
            >
              ↻ Replay
            </button>
          ) : (
            <button
              type="button"
              onClick={stopAndGoLive}
              className={`${styles.hudBtn} ${styles.hudBtnPrimary}`}
              title="Skip and return to live page (Esc)"
            >
              Esc · Live
            </button>
          )}
        </section>
      )}
    </SwarmContext.Provider>
  );
};
