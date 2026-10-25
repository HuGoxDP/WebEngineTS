export function parseNginxLocations(conf: string): Record<string, Record<string, string>>;
export function expandVariables(value: string, origin: string): string;
export function headersFor(locations: Record<string, Record<string, string>>, path: string, origin: string): Record<string, string>;
