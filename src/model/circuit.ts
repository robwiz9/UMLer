/**
 * Circuit-diagram vocabulary.
 *
 * This module owns the parts of a circuit scene that are semantic: component
 * kinds, standards, junction styles, rotation steps and the primitive contract
 * shared by the canvas and the CeTZ exporter. The actual symbols live in
 * `circuit-catalog.ts`; this file must stay free of DOM and React imports.
 */

import type { SceneDocument } from "./scene.ts";
import type { Point, Rect } from "./geometry.ts";
import { rect } from "./geometry.ts";
import type { TextMeasurement } from "./layout.ts";

export type CircuitStandard = "iec" | "ansi";

export type CircuitComponentKind =
  | "resistor"
  | "capacitor"
  | "coil"
  | "potentiometer"
  | "voltage-source"
  | "current-source"
  | "ac-source"
  | "battery"
  | "diode"
  | "led"
  | "zener-diode"
  | "transistor-npn"
  | "transistor-pnp"
  | "mosfet-n"
  | "mosfet-p"
  | "voltmeter"
  | "ammeter"
  | "switch"
  | "lightbulb";

export type CircuitJunctionStyle = "filled" | "solid" | "hollow" | "none";

export const DEFAULT_JUNCTION_STYLE: CircuitJunctionStyle = "filled";

/** Visible dot radius; `solid` is the legacy XL filled dot. */
export const junctionRadius = (style: CircuitJunctionStyle): number => {
  if (style === "filled") return 3;
  if (style === "solid") return 4.5;
  if (style === "hollow") return 4.5;
  return 4.5;
};

export type Rotation45 = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;

export const ROTATIONS: readonly Rotation45[] = [0, 45, 90, 135, 180, 225, 270, 315];

export const isRotation45 = (value: number): value is Rotation45 =>
  Number.isFinite(value) && value % 45 === 0 && value >= 0 && value < 360;

export const normalizeRotation = (value: number): Rotation45 => {
  const wrapped = ((Math.round(value / 45) * 45) % 360 + 360) % 360;
  return wrapped as Rotation45;
};

/** AABB of a local component frame rotated around its centre. */
export const rotatedFrameBounds = (
  frame: Rect,
  width: number,
  height: number,
  rotation: Rotation45,
): Rect => {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Point[] = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((corner) => ({
    x: cx + corner.x * cos - corner.y * sin,
    y: cy + corner.x * sin + corner.y * cos,
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return rect(minX, minY, Math.max(1, Math.max(...xs) - minX), Math.max(1, Math.max(...ys) - minY));
};

export interface CircuitSettings {
  readonly standard: CircuitStandard;
  /** "bridge" draws the omega hop; "plain" is a print/legacy escape hatch. */
  readonly crossings: "bridge" | "plain";
  readonly bridgeRadius: number;
}

export const DEFAULT_CIRCUIT: CircuitSettings = {
  standard: "iec",
  crossings: "bridge",
  bridgeRadius: 6,
};

export const resolveCircuitSettings = (scene: SceneDocument): CircuitSettings =>
  scene.circuit ?? DEFAULT_CIRCUIT;

export const setCircuitStandard = (
  scene: SceneDocument,
  standard: CircuitStandard,
): SceneDocument => ({
  ...scene,
  circuit: { ...resolveCircuitSettings(scene), standard },
  revision: scene.revision + 1,
  meta: { ...scene.meta, updatedAt: new Date().toISOString() },
});

export type CircuitStrokeRole = "body" | "thin" | "none";
export type CircuitFillRole = "none" | "paper" | "ink";

export type CircuitGeometryPrimitive =
  | {
      readonly kind: "polyline";
      readonly points: readonly Point[];
      readonly closed?: boolean;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    }
  | {
      readonly kind: "circle";
      readonly center: Point;
      readonly radius: number;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    }
  | {
      readonly kind: "rect";
      readonly frame: Rect;
      readonly radius?: number;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    }
  | {
      readonly kind: "bezier";
      readonly start: Point;
      readonly c1: Point;
      readonly c2: Point;
      readonly end: Point;
      readonly stroke?: CircuitStrokeRole;
      readonly fill?: CircuitFillRole;
    };

/** Catalog symbols are local and carry raw text. The layout measures them. */
export type CircuitSymbolPrimitive =
  | CircuitGeometryPrimitive
  | {
      readonly kind: "text";
      readonly point: Point;
      readonly text: string;
      readonly anchor?: "start" | "center" | "end";
    };

/** Absolute, layout-resolved primitives consumed by DOM and CeTZ. */
export type CircuitPrimitive =
  | CircuitGeometryPrimitive
  | {
      readonly kind: "text";
      readonly point: Point;
      readonly text: string;
      readonly measurement: TextMeasurement;
      readonly anchor?: "start" | "center" | "end";
    };

/** Reference designator prefix for each component kind. */
export const CIRCUIT_PREFIX: Record<CircuitComponentKind, string> = {
  resistor: "R",
  capacitor: "C",
  coil: "L",
  potentiometer: "RV",
  "voltage-source": "V",
  "current-source": "I",
  "ac-source": "V",
  battery: "B",
  diode: "D",
  led: "D",
  "zener-diode": "D",
  "transistor-npn": "Q",
  "transistor-pnp": "Q",
  "mosfet-n": "Q",
  "mosfet-p": "Q",
  voltmeter: "VM",
  ammeter: "AM",
  switch: "SW",
  lightbulb: "LP",
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Next reference designator for a prefix. Uses max+1, not the lowest free
 * number, so deleting R2 does not make the next resistor R2 again. Copy/paste
 * never calls this: pasted labels are intentionally preserved.
 */
export const nextComponentLabel = (scene: SceneDocument, prefix: string): string => {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(?:_"?(\\d+)"?|(\\d+))$`);
  let max = 0;
  for (const node of Object.values(scene.nodes)) {
    if (node.kind !== "circuitComponent") continue;
    const match = pattern.exec(node.name);
    if (match !== null) {
      max = Math.max(max, Number(match[1] ?? match[2]));
    }
  }
  return `${prefix}_${max + 1}`;
};

export const circuitPrefixFor = (
  kind: CircuitComponentKind,
  standard?: CircuitStandard,
): string =>
  standard === "iec" && (kind === "voltage-source" || kind === "ac-source")
    ? "U"
    : CIRCUIT_PREFIX[kind];
