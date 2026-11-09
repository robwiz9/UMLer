/**
 * Endpoint marker vocabulary.
 *
 * Markers are semantic, not glyph names. The renderer chooses a CeTZ built-in
 * mark or a registered custom mark, and the serializer can reuse the same
 * mapping. This is what lets the canvas popover and the exported Typst code
 * stay in agreement.
 */

import type { StrokePattern } from "./styles.ts";

export type UmlMarkerKind =
  | "inheritance"
  | "realization"
  | "aggregation"
  | "composition"
  | "directedAssociation"
  | "dependency";

export type ErMarkerKind = "one" | "many" | "zeroOrOne" | "oneOrMany" | "zeroOrMany";

/**
 * A generic arrow is deliberately outside UML/ER semantics. It is useful for
 * sketches, annotations or a diagram type whose semantics are not yet modeled.
 */
export type GenericMarkerKind = "arrow" | "filledArrow";

export interface UmlEndpointMarker {
  readonly family: "uml";
  readonly kind: UmlMarkerKind;
  /** Multiplier applied to the mark's length/width in the CeTZ export. */
  readonly scale?: number;
}

export interface ErEndpointMarker {
  readonly family: "er";
  readonly kind: ErMarkerKind;
  readonly scale?: number;
}

export interface GenericEndpointMarker {
  readonly family: "generic";
  readonly kind: GenericMarkerKind;
  readonly scale?: number;
}

export interface NoEndpointMarker {
  readonly family: "none";
  readonly kind: "none";
}

export type EndpointMarker =
  | UmlEndpointMarker
  | ErEndpointMarker
  | GenericEndpointMarker
  | NoEndpointMarker;

export type EdgeEnd = "source" | "target";

export interface MarkerDefinition {
  readonly family: "uml" | "er" | "generic" | "none";
  readonly label: string;
  readonly shortLabel: string;
  /** CeTZ symbol string or registered mark name. */
  readonly cetzSymbol: string | null;
  readonly fill: "hollow" | "solid" | "none";
  /** True when this marker is conventionally paired with a dashed line. */
  readonly dashed: boolean;
}

const UML_MARKERS: Record<UmlMarkerKind, MarkerDefinition> = {
  inheritance: {
    family: "uml",
    label: "Inheritance (hollow triangle)",
    shortLabel: "inheritance",
    cetzSymbol: "uml-hollow-triangle",
    fill: "hollow",
    dashed: false,
  },
  realization: {
    family: "uml",
    label: "Realization (dashed + hollow triangle)",
    shortLabel: "realization",
    cetzSymbol: "uml-hollow-triangle",
    fill: "hollow",
    dashed: true,
  },
  aggregation: {
    family: "uml",
    label: "Aggregation (hollow diamond)",
    shortLabel: "aggregation",
    cetzSymbol: "uml-hollow-diamond",
    fill: "hollow",
    dashed: false,
  },
  composition: {
    family: "uml",
    label: "Composition (filled diamond)",
    shortLabel: "composition",
    cetzSymbol: "uml-filled-diamond",
    fill: "solid",
    dashed: false,
  },
  directedAssociation: {
    family: "uml",
    label: "Directed association (open arrow)",
    shortLabel: "directed",
    cetzSymbol: "uml-open-arrow",
    fill: "none",
    dashed: false,
  },
  dependency: {
    family: "uml",
    label: "Dependency (dashed + open arrow)",
    shortLabel: "dependency",
    cetzSymbol: "uml-open-arrow",
    fill: "none",
    dashed: true,
  },
};

const ER_MARKERS: Record<ErMarkerKind, MarkerDefinition> = {
  one: {
    family: "er",
    label: "One",
    shortLabel: "1",
    cetzSymbol: "er-one",
    fill: "none",
    dashed: false,
  },
  many: {
    family: "er",
    label: "Many",
    shortLabel: "*",
    cetzSymbol: "er-many",
    fill: "none",
    dashed: false,
  },
  zeroOrOne: {
    family: "er",
    label: "Zero or one",
    shortLabel: "0..1",
    cetzSymbol: "er-zero-one",
    fill: "hollow",
    dashed: false,
  },
  oneOrMany: {
    family: "er",
    label: "One or many",
    shortLabel: "1..*",
    cetzSymbol: "er-one-many",
    fill: "none",
    dashed: false,
  },
  zeroOrMany: {
    family: "er",
    label: "Zero or many",
    shortLabel: "0..*",
    cetzSymbol: "er-zero-many",
    fill: "hollow",
    dashed: false,
  },
};

const NONE_MARKER: MarkerDefinition = {
  family: "none",
  label: "None",
  shortLabel: "none",
  cetzSymbol: null,
  fill: "none",
  dashed: false,
};

const GENERIC_MARKERS: Record<GenericMarkerKind, MarkerDefinition> = {
  arrow: {
    family: "generic",
    label: "Generic open arrow",
    shortLabel: "arrow",
    // CeTZ's built-in open angle; no UML/ER semantics attached.
    cetzSymbol: "straight",
    fill: "none",
    dashed: false,
  },
  filledArrow: {
    family: "generic",
    label: "Generic filled arrow",
    shortLabel: "filled arrow",
    // CeTZ's built-in triangle; the serializer sets fill to the stroke color.
    cetzSymbol: "triangle",
    fill: "solid",
    dashed: false,
  },
};

export const markerDefinition = (marker: EndpointMarker): MarkerDefinition => {
  if (marker.family === "none") return NONE_MARKER;
  if (marker.family === "uml") return UML_MARKERS[marker.kind];
  if (marker.family === "er") return ER_MARKERS[marker.kind];
  return GENERIC_MARKERS[marker.kind];
};

export const markerSymbol = (marker: EndpointMarker): string | null =>
  markerDefinition(marker).cetzSymbol;

/**
 * Distance the connector path is pulled back from the anchor so it does not
 * draw through an open/forked terminal. Zero means the line may meet the
 * anchor itself (for example the simple ER "one" bar).
 */
export const markerLineInset = (marker: EndpointMarker): number => {
  if (marker.family === "none") return 0;
  if (marker.family === "er") {
    if (marker.kind === "many" || marker.kind === "oneOrMany" || marker.kind === "zeroOrMany") {
      return 12;
    }
    if (marker.kind === "zeroOrOne") return 6;
    return 0;
  }
  if (marker.family === "uml") {
    if (marker.kind === "aggregation" || marker.kind === "composition") return 12;
    if (marker.kind === "inheritance" || marker.kind === "realization") return 10;
    // Open angle arrows are drawn as two legs around the line; keep the line
    // running to the vertex so it visibly connects to the arrow point.
    return 0;
  }
  if (marker.family === "generic") {
    return marker.kind === "filledArrow" ? 12 : 0;
  }
  return 12;
};

/** Approximate marker footprint used for label-vs-terminal clearance. */
export const markerExtent = (marker: EndpointMarker): number => {
  if (marker.family === "none") return 0;
  if (marker.family === "er") {
    if (marker.kind === "one") return 4;
    if (marker.kind === "zeroOrOne") return 12;
    return 15;
  }
  if (marker.family === "uml") {
    if (marker.kind === "inheritance" || marker.kind === "realization") return 12;
    if (marker.kind === "aggregation" || marker.kind === "composition") return 14;
    return 12;
  }
  return 12;
};

export const UML_MARKER_OPTIONS: readonly {
  readonly kind: UmlMarkerKind;
  readonly definition: MarkerDefinition;
}[] = (Object.keys(UML_MARKERS) as UmlMarkerKind[]).map((kind) => ({
  kind,
  definition: UML_MARKERS[kind],
}));

export const ER_MARKER_OPTIONS: readonly {
  readonly kind: ErMarkerKind;
  readonly definition: MarkerDefinition;
}[] = (Object.keys(ER_MARKERS) as ErMarkerKind[]).map((kind) => ({
  kind,
  definition: ER_MARKERS[kind],
}));

export const GENERIC_MARKER_OPTIONS: readonly {
  readonly kind: GenericMarkerKind;
  readonly definition: MarkerDefinition;
}[] = (Object.keys(GENERIC_MARKERS) as GenericMarkerKind[]).map((kind) => ({
  kind,
  definition: GENERIC_MARKERS[kind],
}));

/**
 * ER endpoint presentation is a UI mode, not a second stored geometry model.
 *   - crowFoot: set a marker and (optionally) a text label
 *   - label:    clear the marker and require a source/target cardinality label
 *   - plain:    clear both marker and endpoint label
 *
 * The edge still stores the concrete marker + label fields, so mixed
 * presentations (crow's foot on one end, text on the other) are representable.
 */
export type ErEndpointMode = "crowFoot" | "label" | "plain";

export const ER_ENDPOINT_MODES: readonly {
  readonly mode: ErEndpointMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    mode: "crowFoot",
    label: "Crow's foot",
    description: "Draw one of the five crow's-foot terminals; a text label is optional.",
  },
  {
    mode: "label",
    label: "Text cardinality",
    description: "No marker; the endpoint label carries the cardinality (for example 0..n or 1).",
  },
  {
    mode: "plain",
    label: "Plain line",
    description: "No marker and no endpoint label; the line carries no extra endpoint meaning.",
  },
];

/**
 * Quick-select chips shared by cardinality labels and the ER endpoint menu.
 * The label is free text; these are only shortcuts. In particular `0..n` and
 * `1..n` are endpoint cardinalities, not a whole-relationship `m:n` badge.
 */
export const CARDINALITY_CHIPS = ["0", "1", "0..1", "0..n", "1..n", "1..*", "*"] as const;
export type CardinalityChip = (typeof CARDINALITY_CHIPS)[number];

export type UmlRelationshipKind =
  | "association"
  | "directedAssociation"
  | "inheritance"
  | "realization"
  | "aggregation"
  | "composition"
  | "dependency";

export interface UmlRelationshipPreset {
  readonly label: string;
  readonly source: UmlMarkerKind | null;
  readonly target: UmlMarkerKind | null;
  readonly pattern: StrokePattern;
}

/**
 * Endpoint-menu presets. Aggregation/composition assume the *whole* is the
 * source; the endpoint menu can invert that without changing the data model.
 */
export const UML_RELATIONSHIP_PRESETS: Record<UmlRelationshipKind, UmlRelationshipPreset> = {
  association: {
    label: "Association",
    source: null,
    target: null,
    pattern: "solid",
  },
  directedAssociation: {
    label: "Directed association",
    source: null,
    target: "directedAssociation",
    pattern: "solid",
  },
  inheritance: {
    label: "Inheritance / generalization",
    source: null,
    target: "inheritance",
    pattern: "solid",
  },
  realization: {
    label: "Realization",
    source: null,
    target: "realization",
    pattern: "dashed",
  },
  aggregation: {
    label: "Aggregation",
    source: "aggregation",
    target: null,
    pattern: "solid",
  },
  composition: {
    label: "Composition",
    source: "composition",
    target: null,
    pattern: "solid",
  },
  dependency: {
    label: "Dependency",
    source: null,
    target: "dependency",
    pattern: "dashed",
  },
};
