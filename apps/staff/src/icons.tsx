/** Lucide icons (lucide.dev, ISC license), inlined: the staff tool uses only a few. */
type P = { size?: number; className?: string };
const svg = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

/** lucide "circle", filled: the recording light. */
export const RecDot = ({ size = 10, className }: P) => <svg {...svg(size)} className={className} fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>;
