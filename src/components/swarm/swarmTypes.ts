export type SwarmSpeed = 1 | 2 | 3;

export type SwarmPhase = "idle" | "hero-intro" | "full-rebuild";

export type SwarmTargetKind = "nav" | "typewriter" | "box" | "duplicate";

export interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  color: string;
}

export interface SwarmTarget {
  id: string;
  el: HTMLElement;
  kind: SwarmTargetKind;
  label: string;
  textSnapshot?: string;
  sourceEl?: HTMLElement;
}

export interface SwarmProgress {
  current: number;
  total: number;
  currentLabel: string;
}

export interface SwarmContextValue {
  phase: SwarmPhase;
  isRebuilding: boolean;
  blueprintMode: boolean;
  soundEnabled: boolean;
  tourMode: boolean;
  speed: SwarmSpeed;
  progress: SwarmProgress;
  hudVisible: boolean;
  startFullRebuild: (options?: { withTour?: boolean }) => void;
  stopAndGoLive: () => void;
  toggleBlueprintMode: () => void;
  toggleSound: () => void;
  toggleTourMode: () => void;
  setSpeed: (speed: SwarmSpeed) => void;
  cycleSpeed: () => void;
}

export const SWARM_AGENTS: SwarmAgent[] = [
  { id: "binh", name: "Binh.tsx", role: "Lead FE", color: "#06b6d4" },
  { id: "react", name: "React 19", role: "Components", color: "#3b82f6" },
  { id: "nextjs", name: "Next.js", role: "App Router", color: "#8b5cf6" },
  { id: "tailwind", name: "Tailwind", role: "Design System", color: "#10b981" },
  { id: "figma", name: "Figma Spec", role: "Blueprint", color: "#ec4899" },
  { id: "motion", name: "Motion FX", role: "60fps", color: "#f59e0b" },
];
