export type SwarmMode = "gate" | "build" | "present";

export type SwarmSkill = "draw" | "type" | "move" | "color";

export type SwarmSlotKind = "draw" | "drag" | "type" | "fill" | "pop" | "line";

export interface SwarmAgentSpec {
  id: number;
  name: string;
  skill: SwarmSkill;
  color: string;
  ink: string;
  homeSpot: [number, number];
}

export interface SwarmSlot {
  id: string;
  el: HTMLElement;
  kind: SwarmSlotKind;
  sectionIndex: number;
  docTop: number;
  wave: 0 | 1 | 2;
  rightAligned?: boolean;
  textSnapshot?: string;
  dragFrom?: { dx: number; dy: number; bend: number; tiltDeg: number };
}

export interface SwarmSectionGroup {
  index: number;
  triggerScrollY: number;
  anchorTop: number;
  slots: SwarmSlot[];
}

export interface SwarmContextValue {
  mode: SwarmMode;
  autoScrolling: boolean;
  musicEnabled: boolean;
  buildProgress: number;
  isComplete: boolean;
  enterPortfolio: (withSound: boolean) => void;
  skipGateToFinal: () => void;
  replayBuild: () => void;
  viewFinalDesign: () => void;
  toggleAutoScroll: () => void;
  toggleMusic: () => void;
}

export const SWARM_AGENTS: SwarmAgentSpec[] = [
  { id: 0, name: "Frame", skill: "draw", color: "#F85023", ink: "#FFFFFF", homeSpot: [0.14, 0.18] },
  { id: 1, name: "Kern", skill: "type", color: "#7B61FF", ink: "#FFFFFF", homeSpot: [0.81, 0.21] },
  { id: 2, name: "Snap", skill: "move", color: "#0D99FF", ink: "#FFFFFF", homeSpot: [0.1, 0.47] },
  { id: 3, name: "Hue", skill: "color", color: "#14AE5C", ink: "#FFFFFF", homeSpot: [0.85, 0.5] },
  { id: 4, name: "Glyph", skill: "type", color: "#E83E8C", ink: "#FFFFFF", homeSpot: [0.16, 0.66] },
  { id: 5, name: "Align", skill: "move", color: "#F59E0B", ink: "#18181B", homeSpot: [0.79, 0.65] },
  { id: 6, name: "Grid", skill: "draw", color: "#0891B2", ink: "#FFFFFF", homeSpot: [0.28, 0.12] },
  { id: 7, name: "Nudge", skill: "move", color: "#65A30D", ink: "#FFFFFF", homeSpot: [0.67, 0.13] },
];
