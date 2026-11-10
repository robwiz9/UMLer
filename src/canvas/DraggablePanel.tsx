import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

interface DraggablePanelProps {
  readonly left: number;
  readonly top: number;
  readonly bounds: { readonly width: number; readonly height: number };
  readonly className: string;
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly originX: number;
  readonly originY: number;
}

const clampAxis = (value: number, min: number, max: number): number =>
  max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value));

/**
 * Floating-menu wrapper. Drag starts on the popover header but not on its
 * buttons or fields, so the close/lock controls keep their normal click
 * behaviour. Offsets reset whenever the menu is repositioned by focus changes.
 */
export const DraggablePanel = ({
  left,
  top,
  bounds,
  className,
  resetKey,
  children,
}: DraggablePanelProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    dragRef.current = null;
    setOffset({ x: 0, y: 0 });
  }, [left, top, resetKey]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".popover-head") === null) return;
    if (target.closest("button, input, textarea, select, a") !== null) return;

    const panel = panelRef.current;
    if (panel === null) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    try {
      panel.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events cannot own capture.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (drag === null || panel === null || drag.pointerId !== event.pointerId) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const minX = -left;
    const maxX = bounds.width - left - width;
    const minY = -top;
    const maxY = bounds.height - top - height;
    setOffset({
      x: clampAxis(drag.originX + event.clientX - drag.startX, minX, maxX),
      y: clampAxis(drag.originY + event.clientY - drag.startY, minY, maxY),
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (panelRef.current?.hasPointerCapture(event.pointerId) === true) {
      panelRef.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={panelRef}
      className={className}
      style={{ left: left + offset.x, top: top + offset.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {children}
    </div>
  );
};
