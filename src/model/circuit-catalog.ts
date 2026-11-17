/**
 * Circuit component catalogue.
 *
 * Symbols are pure local geometry, with the component centre at (0, 0) and
 * y-down screen orientation. `symbol(standard)` returns primitives that the
 * layout pass rotates, translates and measures. Nothing here reads the DOM.
 */

import type {
  CircuitComponentKind,
  CircuitFillRole,
  CircuitStandard,
  CircuitStrokeRole,
  CircuitSymbolPrimitive,
} from "./circuit.ts";
import { CIRCUIT_PREFIX } from "./circuit.ts";
import type { Point } from "./geometry.ts";
import { add, normalize, point, rect, scale, sub } from "./geometry.ts";

export interface CircuitPinDef {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** Local point where the pin lead leaves the component body. */
  readonly bx: number;
  readonly by: number;
  readonly nx: number;
  readonly ny: number;
}

export type CircuitComponentGroup =
  | "passive"
  | "sources"
  | "semiconductors"
  | "outputs"
  | "meters";

export interface CircuitComponentDef {
  readonly kind: CircuitComponentKind;
  readonly label: string;
  readonly prefix: string;
  readonly group: CircuitComponentGroup;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly pins: readonly CircuitPinDef[];
  readonly labelOffset: Point;
  readonly symbol: (standard: CircuitStandard) => readonly CircuitSymbolPrimitive[];
}

type Fill = CircuitFillRole;
type Stroke = CircuitStrokeRole;

const p = (x: number, y: number): Point => point(x, y);

const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: Stroke = "body",
): CircuitSymbolPrimitive => ({
  kind: "polyline",
  points: [p(x1, y1), p(x2, y2)],
  stroke,
});

const polyline = (
  points: readonly Point[],
  stroke: Stroke = "body",
  fill: Fill = "none",
  closed?: boolean,
): CircuitSymbolPrimitive => ({
  kind: "polyline",
  points,
  stroke,
  fill,
  closed,
});

const box = (
  x: number,
  y: number,
  width: number,
  height: number,
  stroke: Stroke = "body",
  fill: Fill = "none",
  radius?: number,
): CircuitSymbolPrimitive => ({
  kind: "rect",
  frame: rect(x, y, width, height),
  stroke,
  fill,
  radius,
});

const arrowHead = (
  from: Point,
  tip: Point,
  size = 7,
): CircuitSymbolPrimitive => {
  const direction = normalize(sub(tip, from));
  const perpendicular = point(-direction.y, direction.x);
  const back = sub(tip, scale(direction, size));
  const half = size * 0.42;
  return polyline(
    [
      add(back, scale(perpendicular, half)),
      tip,
      sub(back, scale(perpendicular, half)),
    ],
    "body",
    "ink",
    true,
  );
};

const dot = (
  x: number,
  y: number,
  radius: number,
  stroke: Stroke = "body",
  fill: Fill = "none",
): CircuitSymbolPrimitive => ({
  kind: "circle",
  center: p(x, y),
  radius,
  stroke,
  fill,
});

const curve = (
  start: Point,
  c1: Point,
  c2: Point,
  end: Point,
  stroke: Stroke = "body",
  fill: Fill = "none",
): CircuitSymbolPrimitive => ({ kind: "bezier", start, c1, c2, end, stroke, fill });

const label = (x: number, y: number, text: string): CircuitSymbolPrimitive => ({
  kind: "text",
  point: p(x, y),
  text,
  anchor: "center",
});

const horizontalBody = (
  standard: CircuitStandard,
  width = 36,
  height = 18,
): readonly CircuitSymbolPrimitive[] => {
  if (standard === "iec") {
    return [box(-width / 2, -height / 2, width, height, "body", "paper")];
  }
  // Symmetric US zigzag: the first and last ramps are half-width so every
  // segment keeps the same angle, matching the reference symbol.
  const xs = [-0.5, -0.4, -0.2, 0, 0.2, 0.4, 0.5].map((ratio) => ratio * width);
  const ys = [0, -height / 2, height / 2, -height / 2, height / 2, -height / 2, 0];
  return [
    polyline(
      xs.map((x, index) => p(x, ys[index] ?? 0)),
      "body",
    ),
  ];
};

const resistor = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => [
  ...horizontalBody(standard),
];

const capacitor = (): readonly CircuitSymbolPrimitive[] => [
  line(-4.5, -12, -4.5, 12),
  line(4.5, -12, 4.5, 12),
];

const polarizedCapacitor = (): readonly CircuitSymbolPrimitive[] => [
  box(-12, -6.5, 24, 4, "body", "none", 1),
  line(-12, 4.5, 12, 4.5),
  line(-10, -12, -16, -12),
  line(-13, -15, -13, -9),
];

const coil = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => {
  const result: CircuitSymbolPrimitive[] = [];
  const count = standard === "ansi" ? 3 : 4;
  const step = 36 / count;
  const amplitude = standard === "ansi" ? 11 : 7;
  for (let index = 0; index < count; index += 1) {
    const x0 = -18 + step * index;
    const x1 = x0 + step;
    result.push(
      curve(
        p(x0, 0),
        p(x0, amplitude * 1.34),
        p(x1, amplitude * 1.34),
        p(x1, 0),
        "body",
      ),
    );
  }
  return result;
};

const potentiometer = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => {
  const result: CircuitSymbolPrimitive[] = [
    ...resistor(standard),
    polyline([p(-4, -13), p(0, -6), p(4, -13)], "body", "ink", true),
  ];
  return result;
};

const sourceCircle = (standard: CircuitStandard, inner: readonly CircuitSymbolPrimitive[]) => {
  void standard;
  return [
    dot(0, 0, 18, "body", "paper"),
    ...inner,
  ];
};

const voltageSource = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] =>
  standard === "iec"
    ? sourceCircle(standard, [
        line(-9, -4, 9, -4),
        line(-9, 4, 9, 4),
      ])
    : sourceCircle(standard, [label(0, -6, "+"), label(0, 7, "−")]);

const currentSource = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] =>
  standard === "iec"
    ? [
        line(0, -27, 0, -21),
        dot(0, -6, 15, "body", "none"),
        dot(0, 6, 15, "body", "none"),
        line(0, 21, 0, 27),
      ]
    : sourceCircle(standard, [
        line(0, 8, 0, -8, "body"),
        polyline([p(-4, -4), p(0, -9), p(4, -4)], "body", "ink", true),
      ]);

const acSource = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => {
  const points: Point[] = [];
  for (let index = 0; index <= 16; index += 1) {
    const t = index / 16;
    points.push(p(-9 + t * 18, -5 * Math.sin(t * Math.PI * 2)));
  }
  return sourceCircle(standard, [polyline(points, "body")]);
};

const battery = (standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => {
  void standard;
  return [
    line(-18, -4.5, 18, -4.5),
    line(-9, 4.5, 9, 4.5),
    line(-10, -12, -16, -12),
    line(-13, -15, -13, -9),
  ];
};

const diodeBody = (): readonly CircuitSymbolPrimitive[] => [
  polyline([p(-9, -9), p(-9, 9), p(9, 0)], "body", "ink", true),
  line(9, -9, 9, 9),
];

const diode = (_standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => diodeBody();

const led = (_standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => [
  ...diodeBody(),
  polyline([p(4, -10), p(12, -18)], "thin"),
  polyline([p(9, -8), p(17, -16)], "thin"),
  polyline([p(8, -17), p(12, -18), p(12, -14)], "thin", "ink", true),
  polyline([p(13, -15), p(17, -16), p(17, -12)], "thin", "ink", true),
];

const zener = (_standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => [
  polyline([p(-9, -9), p(-9, 9), p(9, 0)], "body", "ink", true),
  polyline([p(6, -9), p(9, -9), p(9, 9), p(12, 9)], "body"),
];

const transistor = (
  standard: CircuitStandard,
  kind: "npn" | "pnp",
): readonly CircuitSymbolPrimitive[] => {
  const result: CircuitSymbolPrimitive[] = [
    line(-10, -12, -10, 12),
  ];
  if (standard === "iec") result.unshift(dot(0, 0, 22, "body", "paper"));
  const arrow = kind === "npn"
    ? arrowHead(p(-10, 6), p(17, 17), 6.5)
    : arrowHead(p(18, 18), p(-7, 4.2), 6.5);
  result.push(arrow);
  return result;
};

const mosfet = (
  standard: CircuitStandard,
  kind: "n" | "p",
): readonly CircuitSymbolPrimitive[] => {
  const result: CircuitSymbolPrimitive[] = [
    line(-12, -10, -12, 10),
    line(-6, -10, -6, -4),
    line(-6, -3, -6, 3),
    line(-6, 4, -6, 10),
    line(-6, -7, 12, -7),
    line(-6, 7, 12, 7),
    // Body/source rail: the IEC reference connects the middle body line to
    // the source only; it does not bridge all the way to the drain.
    line(12, 0, 12, 7),
    line(-6, 0, 12, 0),
  ];
  if (standard === "iec") result.unshift(dot(0, 0, 22, "body", "paper"));
  result.push(
    kind === "n"
      ? arrowHead(p(12, 0), p(2, 0), 6)
      : arrowHead(p(0, 0), p(10, 0), 6),
  );
  return result;
};

const meter = (letter: string, standard: CircuitStandard): CircuitSymbolPrimitive[] =>
  sourceCircle(standard, [label(0, 0, letter)]);

const switchSymbol = (_standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => [
  dot(-12, 0, 2.5, "body", "paper"),
  dot(12, 0, 2.5, "body", "paper"),
  line(-12, 0, 10, -10),
];

export const switchSymbolForState = (
  standard: CircuitStandard,
  closed: boolean,
): readonly CircuitSymbolPrimitive[] =>
  closed
    ? [
        dot(-12, 0, 2.5, "body", "paper"),
        dot(12, 0, 2.5, "body", "paper"),
        line(-12, 0, 12, 0),
      ]
    : switchSymbol(standard);

const lightbulb = (_standard: CircuitStandard): readonly CircuitSymbolPrimitive[] => [
  dot(0, 0, 18, "body", "paper"),
  line(-9, -9, 9, 9),
  line(-9, 9, 9, -9),
];

const commonPins = (bodyX = 18): readonly CircuitPinDef[] => [
  { id: "A", label: "A", x: -27, y: 0, bx: -bodyX, by: 0, nx: -1, ny: 0 },
  { id: "B", label: "B", x: 27, y: 0, bx: bodyX, by: 0, nx: 1, ny: 0 },
];

const capacitorPins = (): readonly CircuitPinDef[] => [
  { id: "A", label: "A", x: -18, y: 0, bx: -4.5, by: 0, nx: -1, ny: 0 },
  { id: "B", label: "B", x: 18, y: 0, bx: 4.5, by: 0, nx: 1, ny: 0 },
];

const polarizedCapacitorPins = (): readonly CircuitPinDef[] => [
  { id: "+", label: "+", x: 0, y: -18, bx: 0, by: -6.5, nx: 0, ny: -1 },
  { id: "−", label: "−", x: 0, y: 18, bx: 0, by: 4.5, nx: 0, ny: 1 },
];

const diodePins = (): readonly CircuitPinDef[] => [
  { id: "A", label: "A", x: -18, y: 0, bx: -9, by: 0, nx: -1, ny: 0 },
  { id: "B", label: "B", x: 18, y: 0, bx: 9, by: 0, nx: 1, ny: 0 },
];

const verticalPins = (): readonly CircuitPinDef[] => [
  { id: "+", label: "+", x: 0, y: -27, bx: 0, by: -18, nx: 0, ny: -1 },
  { id: "−", label: "−", x: 0, y: 27, bx: 0, by: 18, nx: 0, ny: 1 },
];

const batteryPins = (): readonly CircuitPinDef[] => [
  { id: "+", label: "+", x: 0, y: -18, bx: 0, by: -4.5, nx: 0, ny: -1 },
  { id: "−", label: "−", x: 0, y: 18, bx: 0, by: 4.5, nx: 0, ny: 1 },
];

const transistorPins = (): readonly CircuitPinDef[] => [
  { id: "B", label: "B", x: -27, y: 0, bx: -10, by: 0, nx: -1, ny: 0 },
  { id: "C", label: "C", x: 18, y: -18, bx: -10, by: -6, nx: 0.7071, ny: -0.7071 },
  { id: "E", label: "E", x: 18, y: 18, bx: -10, by: 6, nx: 0.7071, ny: 0.7071 },
];

const mosfetPins = (): readonly CircuitPinDef[] => [
  { id: "G", label: "G", x: -27, y: 0, bx: -12, by: 0, nx: -1, ny: 0 },
  { id: "D", label: "D", x: 18, y: -18, bx: 12, by: -7, nx: 0.7071, ny: -0.7071 },
  { id: "S", label: "S", x: 18, y: 18, bx: 12, by: 7, nx: 0.7071, ny: 0.7071 },
];

const def = (
  kind: CircuitComponentKind,
  label: string,
  group: CircuitComponentGroup,
  description: string,
  keywords: readonly string[],
  width: number,
  height: number,
  pins: readonly CircuitPinDef[],
  labelOffset: Point,
  symbol: (standard: CircuitStandard) => readonly CircuitSymbolPrimitive[],
): CircuitComponentDef => ({
  kind,
  label,
  prefix: CIRCUIT_PREFIX[kind],
  group,
  description,
  keywords,
  width,
  height,
  pins,
  labelOffset,
  symbol,
});

export const CIRCUIT_COMPONENTS: readonly CircuitComponentDef[] = [
  def("resistor", "Resistor", "passive", "Fixed resistance", ["resistance", "ohm", "r"], 54, 36, commonPins(), p(0, 22), resistor),
  def("capacitor", "Capacitor", "passive", "Stores charge between two plates", ["cap", "farad", "c"], 36, 36, capacitorPins(), p(0, 22), capacitor),
  def("capacitor-polarized", "Polarized capacitor", "passive", "Electrolytic capacitor with marked positive plate", ["polarized", "electrolytic", "cap", "farad", "c"], 36, 36, polarizedCapacitorPins(), p(28, 0), polarizedCapacitor),
  def("coil", "Coil", "passive", "Inductor / choke", ["inductor", "choke", "henry", "l"], 54, 36, commonPins(), p(0, 22), coil),
  def("potentiometer", "Potentiometer", "passive", "Variable resistor with a wiper", ["pot", "trimmer", "rheostat", "rv"], 54, 54, [
    ...commonPins(),
    { id: "W", label: "W", x: 0, y: -18, bx: 0, by: -9, nx: 0, ny: -1 },
  ], p(0, 32), potentiometer),
  def("voltage-source", "Voltage source", "sources", "DC voltage source", ["vsource", "dc", "voltage", "generator"], 36, 54, verticalPins(), p(28, 0), voltageSource),
  def("current-source", "Current source", "sources", "Ideal current source", ["isource", "current", "generator"], 36, 54, verticalPins(), p(28, 0), currentSource),
  def("ac-source", "AC source", "sources", "Alternating voltage source", ["alternating", "sine", "ac", "generator"], 36, 54, verticalPins(), p(28, 0), acSource),
  def("battery", "Battery", "sources", "Single-cell DC source", ["cell", "accumulator", "battery"], 36, 36, batteryPins(), p(28, 0), battery),
  def("diode", "Diode", "semiconductors", "Rectifier diode", ["rectifier", "d"], 36, 36, diodePins(), p(0, 22), diode),
  def("led", "LED", "semiconductors", "Light-emitting diode", ["light", "emitting", "lamp", "d"], 36, 36, diodePins(), p(0, 22), led),
  def("zener-diode", "Zener diode", "semiconductors", "Voltage-reference diode", ["zener", "regulator", "reference", "d"], 36, 36, diodePins(), p(0, 22), zener),
  def("transistor-npn", "NPN transistor", "semiconductors", "Bipolar NPN transistor", ["bjt", "npn", "q"], 54, 54, transistorPins(), p(0, 36), (standard) => transistor(standard, "npn")),
  def("transistor-pnp", "PNP transistor", "semiconductors", "Bipolar PNP transistor", ["bjt", "pnp", "q"], 54, 54, transistorPins(), p(0, 36), (standard) => transistor(standard, "pnp")),
  def("mosfet-n", "N-MOSFET", "semiconductors", "N-channel enhancement MOSFET", ["fet", "nmos", "enhancement", "q"], 54, 54, mosfetPins(), p(0, 36), (standard) => mosfet(standard, "n")),
  def("mosfet-p", "P-MOSFET", "semiconductors", "P-channel enhancement MOSFET", ["fet", "pmos", "enhancement", "q"], 54, 54, mosfetPins(), p(0, 36), (standard) => mosfet(standard, "p")),
  def("switch", "Switch", "outputs", "Single-pole switch", ["sw", "spst", "toggle", "break"], 54, 36, commonPins(12), p(0, 22), switchSymbol),
  def("lightbulb", "Lightbulb", "outputs", "Incandescent lamp / load", ["lamp", "bulb", "light", "load", "lp"], 54, 36, commonPins(), p(0, 25), lightbulb),
  def("voltmeter", "Voltmeter", "meters", "Voltage meter", ["voltmeter", "multimeter", "meter"], 36, 54, verticalPins(), p(28, 0), (standard) => meter("V", standard)),
  def("ammeter", "Ammeter", "meters", "Current meter", ["ammeter", "multimeter", "meter"], 36, 54, verticalPins(), p(28, 0), (standard) => meter("A", standard)),
];

export const circuitComponent = (
  kind: CircuitComponentKind,
): CircuitComponentDef | undefined =>
  CIRCUIT_COMPONENTS.find((component) => component.kind === kind);

export const circuitComponentOrFallback = (
  kind: CircuitComponentKind,
): CircuitComponentDef =>
  circuitComponent(kind) ?? CIRCUIT_COMPONENTS[0] as CircuitComponentDef;

export const circuitComponentsByGroup = (): readonly {
  readonly group: CircuitComponentGroup;
  readonly label: string;
  readonly components: readonly CircuitComponentDef[];
}[] => {
  const labels: Record<CircuitComponentGroup, string> = {
    passive: "Passive",
    sources: "Sources",
    semiconductors: "Semiconductors",
    outputs: "Outputs",
    meters: "Meters",
  };
  return (["passive", "sources", "semiconductors", "outputs", "meters"] as const).map((group) => ({
    group,
    label: labels[group],
    components: CIRCUIT_COMPONENTS.filter((component) => component.group === group),
  }));
};

