export type Policy = {
    csp: [string, string[]][];
    /** Tokens of the header's `sandbox` directive, or null for no such directive. */
    sandbox: string[] | null;
    /** The iframe attribute's tokens when they differ from the header's; null omits the attribute. */
    attr?: string[] | null;
    allow: string[];
};
export type Ablation = {
    id: string; label: string; policy: Policy;
    alsoStream?: boolean; control?: boolean; direct?: boolean; foreign?: boolean;
};
export function basePolicy(origin: string): Policy;
export function cspHeader(policy: Policy): string;
export function sandboxAttribute(policy: Policy): string | null;
export function allowAttribute(policy: Policy): string;
export function withoutDirective(policy: Policy, name: string): Policy;
export function withoutToken(policy: Policy, name: string, token: string): Policy;
export function withoutSandboxHeader(policy: Policy): Policy;
export function withoutSandboxAttribute(policy: Policy): Policy;
export function withoutSandbox(policy: Policy, token: string): Policy;
export function withoutAllow(policy: Policy, feature: string): Policy;
export function withSelfForOrigin(policy: Policy): Policy;
export function withSandbox(policy: Policy, token: string, where?: "both" | "attribute"): Policy;
export function ablations(base: Policy): Ablation[];
