export type SwarmMode = "gate" | "build" | "present";

export type SwarmSkill = "draw" | "type" | "move" | "color";

export type SwarmSlotKind = "draw" | "drag" | "type" | "fill" | "pop" | "line";

export interface SwarmAgentSpec {
  id: number;
  name: string;
  skill: SwarmSkill;
  color: string;
  ink: string;
}

export interface SwarmSlot {
  id: string;
  el: HTMLElement;
  kind: SwarmSlotKind;
  sectionIndex: number;
  docTop: number;
  textSnapshot?: string;
  dragFrom?: { dx: number; dy: number; tiltDeg: number };
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
  { id: 0, name: "Frame", skill: "draw", color: "#F85023", ink: "#FFFFFF" },
  { id: 1, name: "Kern", skill: "type", color: "#7B61FF", ink: "#FFFFFF" },
  { id: 2, name: "Snap", skill: "move", color: "#0D99FF", ink: "#FFFFFF" },
  { id: 3, name: "Hue", skill: "color", color: "#14AE5C", ink: "#FFFFFF" },
  { id: 4, name: "Glyph", skill: "type", color: "#E83E8C", ink: "#FFFFFF" },
  { id: 5, name: "Align", skill: "move", color: "#F59E0B", ink: "#18181B" },
  { id: 6, name: "Grid", skill: "draw", color: "#0891B2", ink: "#FFFFFF" },
  { id: 7, name: "Nudge", skill: "move", color: "#65A30D", ink: "#FFFFFF" },
];
