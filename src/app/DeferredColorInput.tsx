import { useEffect, useRef, useState } from "react";

interface DeferredColorInputProps {
  readonly id?: string;
  readonly name?: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onCommit: (color: string) => void;
}

/**
 * Native Color inputs fire a continuous stream of input events while the
 * picker is dragged. Keep those changes local and commit once the user pauses,
 * so a theme or text-style change does not rebuild the whole canvas every
 * frame.
 */
export const DeferredColorInput = ({
  id,
  name,
  value,
  disabled = false,
  title,
  onCommit,
}: DeferredColorInputProps) => {
  const [draft, setDraft] = useState(value);
  const dirtyRef = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (!dirtyRef.current) setDraft(value);
  }, [value]);

  const commit = (): void => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    commitRef.current(draft);
  };

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(commit, 140);
    return () => window.clearTimeout(timer);
  }, [draft]);

  return (
    <input
      id={id}
      name={name}
      type="color"
      value={draft}
      disabled={disabled}
      title={title}
      onChange={(event) => {
        dirtyRef.current = true;
        setDraft(event.target.value);
      }}
      onBlur={commit}
    />
  );
};
