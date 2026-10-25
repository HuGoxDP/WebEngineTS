export const ENGINE_MARKERS: string[];
export const HOST_ONLY_MARKERS: string[];
export function findMarkers(code: string | Buffer, markers: string[]): string[];
export function gzipBytes(code: string | Buffer): number;
export const BUDGETS: { standalone: number; playerHost: number; player: number };
