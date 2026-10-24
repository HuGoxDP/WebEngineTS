export const E2E_LAYOUTS: readonly string[];
export function candidateE2eDirs(startDir: string, env?: Record<string, string | undefined>): string[];
export function locatePlaywrightE2e(startDir: string, env?: Record<string, string | undefined>): string;
export function loadPlaywright(startDir: string, env?: Record<string, string | undefined>): any;
