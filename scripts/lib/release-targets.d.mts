export interface Consumer { name: string; dir: string; copyTgz: boolean; spec: string }
export interface VirtualLab { dir: string; layout: string; ignored: string[] }
export interface Plan {
    lab: VirtualLab | null;
    consumers: Consumer[];
    transcoderTargets: { name: string; dest: string }[];
    bundleConsumers: { name: string; dir: string; dest: string; files: string[] }[];
}
export const VIRTUAL_LAB_LAYOUTS: string[];
export const REQUIRED_PACKAGE_FILES: string[];
export function resolveVirtualLab(parent: string, exists?: (path: string) => boolean): VirtualLab | null;
export function planTargets(parent: string, tgzName: string, exists?: (path: string) => boolean): Plan;
export function missingFromTarball(files: string[], required?: string[]): string[];
export function copyTarball(
    consumer: Consumer, tgzPath: string, tgzName: string,
    deps?: { exists?: (path: string) => boolean; copy?: (from: string, to: string) => void },
): "copied" | "skipped";
export function findWorkspaceParent(engineDir: string, exists?: (path: string) => boolean): string;
