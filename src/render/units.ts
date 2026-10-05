import { PT_PER_MM } from '../schema';

// Geometry is expressed through the CSS variable --u (one millimetre).
// Print/check set --u: 1mm; the editor sets it to a zoomed pixel length.
export const mm = (n: number) => `calc(${n} * var(--u))`;
export const pt = (n: number) => `calc(${n / PT_PER_MM} * var(--u))`;
