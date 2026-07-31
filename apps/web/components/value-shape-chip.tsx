import type { ValueShape } from '@repo/db/schema/_shared';

/**
 * `value_shape` renders as a chip: `len 0 · expected ^[0-9]{15}$`.
 * architecture.md Part III §1.3.
 *
 * This component is the only thing in the UI that displays anything derived
 * from a client value, and it can only display the SHAPE — there is no prop
 * through which a raw value could reach it.
 */
export function ValueShapeChip({ shape }: { shape: ValueShape | null }) {
  if (shape === null) return <span className="opacity-40">—</span>;

  const parts: string[] = [];
  if (shape.len !== null) parts.push(`len ${String(shape.len)}`);
  if (shape.charset !== null) parts.push(shape.charset);
  if (shape.regexClass !== null) parts.push(shape.regexClass);
  if (shape.expected !== null) parts.push(`expected ${shape.expected}`);

  if (parts.length === 0) return <span className="opacity-40">—</span>;

  return (
    <span className="mono rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
      {parts.join(' · ')}
    </span>
  );
}
