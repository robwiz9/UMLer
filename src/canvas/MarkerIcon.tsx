import type { ReactNode } from "react";
import type { EndpointMarker } from "../model/markers.ts";
import type { EdgeEnd } from "../model/markers.ts";

interface MarkerIconProps {
  readonly marker: EndpointMarker;
  readonly end?: EdgeEnd;
}

/** Compact SVG preview used by the endpoint terminal menu. */
export const MarkerIcon = ({ marker, end = "target" }: MarkerIconProps) => {
  const mirror = end === "source" ? "translate(44 0) scale(-1 1)" : undefined;
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const tip = 42;
  let body: ReactNode;
  if (marker.family === "none") {
    body = <line x1={2} y1={9} x2={tip} y2={9} {...common} />;
  } else if (marker.family === "er") {
    if (marker.kind === "one") {
      body = (
        <>
          <line x1={2} y1={9} x2={tip} y2={9} {...common} />
          <line x1={tip - 4} y1={2} x2={tip - 4} y2={16} {...common} />
        </>
      );
    } else if (marker.kind === "zeroOrOne") {
      body = (
        <>
          <line x1={2} y1={9} x2={tip} y2={9} {...common} />
          <circle cx={tip - 5} cy={9} r={4.2} fill="white" stroke="currentColor" strokeWidth={1.2} />
          <line x1={tip - 13} y1={2} x2={tip - 13} y2={16} {...common} />
        </>
      );
    } else {
      const hasCircle = marker.kind === "zeroOrMany";
      const hasBar = marker.kind === "oneOrMany";
      const apex = tip - 12;
      body = (
        <>
          <line x1={2} y1={9} x2={tip} y2={9} {...common} />
          {hasCircle ? <circle cx={tip - 16} cy={9} r={4.2} fill="white" stroke="currentColor" strokeWidth={1.2} /> : null}
          {hasBar ? <line x1={tip - 16} y1={2} x2={tip - 16} y2={16} {...common} /> : null}
          <line x1={apex} y1={9} x2={tip} y2={2} {...common} />
          <line x1={apex} y1={9} x2={tip} y2={9} {...common} />
          <line x1={apex} y1={9} x2={tip} y2={16} {...common} />
        </>
      );
    }
  } else if (marker.family === "uml") {
    if (marker.kind === "inheritance" || marker.kind === "realization") {
      body = (
        <>
          <line x1={2} y1={9} x2={tip - 10} y2={9} {...common} strokeDasharray={marker.kind === "realization" ? "3 3" : undefined} />
          <polygon points={`${tip},9 ${tip - 10},3 ${tip - 10},15`} fill="white" stroke="currentColor" strokeWidth={1.2} />
        </>
      );
    } else if (marker.kind === "aggregation" || marker.kind === "composition") {
      body = (
        <>
          <line x1={2} y1={9} x2={tip - 14} y2={9} {...common} />
          <polygon
            points={`${tip},9 ${tip - 6},3 ${tip - 12},9 ${tip - 6},15`}
            fill={marker.kind === "composition" ? "currentColor" : "white"}
            stroke="currentColor"
            strokeWidth={1.2}
          />
        </>
      );
    } else {
      body = (
        <>
          <line x1={2} y1={9} x2={tip - 10} y2={9} {...common} strokeDasharray={marker.kind === "dependency" ? "3 3" : undefined} />
          <polyline points={`${tip - 10},3 ${tip},9 ${tip - 10},15`} {...common} />
        </>
      );
    }
  } else if (marker.kind === "filledArrow") {
    body = (
      <>
        <line x1={2} y1={9} x2={tip - 11} y2={9} {...common} />
        <polygon points={`${tip},9 ${tip - 11},3 ${tip - 11},15`} fill="currentColor" stroke="currentColor" strokeWidth={1} />
      </>
    );
  } else {
    body = (
      <>
        <line x1={2} y1={9} x2={tip - 11} y2={9} {...common} />
        <polyline points={`${tip - 11},3 ${tip},9 ${tip - 11},15`} {...common} />
      </>
    );
  }

  return (
    <svg viewBox="0 0 44 18" width="44" height="18" aria-hidden="true" className="marker-icon">
      <g transform={mirror}>{body}</g>
    </svg>
  );
};
