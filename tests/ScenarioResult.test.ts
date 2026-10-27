// tests/ScenarioResult.test.ts
// ============================================================
// ScenarioBehaviour.reportResult and the Scenario.onResult host hook. The guard policy under test: the score is
// clamped into 0..1, a non-finite or non-number score is dropped, reports outside start..destroy are ignored,
// and an identical report is not sent twice.
// ============================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ScenarioBehaviour } from "../src/engine/core/scenario/ScenarioBehaviour";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import { parseStreamingManifest, toScenarioManifest } from "../src/engine/core/assets/StreamingManifest";
import type { IScenarioResult } from "../src/engine/core/scenario/ScenarioTypes";

class Probe extends ScenarioBehaviour {
    report(result: { score: number; completed?: boolean }): void { this.reportResult(result); }
    reportAny(result: unknown): void { this.reportResult(result as { score: number }); }
}

function started(): { probe: Probe; got: IScenarioResult[] } {
    const probe = new Probe();
    const got: IScenarioResult[] = [];
    probe._systemSetResultSink(r => got.push(r));
    probe._systemUpdate();
    return { probe, got };
}

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); Scenario.onResult = null; (Scenario as any)._current = null; });

describe("DW-1.1: reportResult", () => {
    test("DW_1_1 an in-range report reaches the sink, completed defaulting to false", () => {
        const { probe, got } = started();
        probe.report({ score: 0.5 });
        probe.report({ score: 0.75, completed: true });
        expect(got).toEqual([{ score: 0.5, completed: false }, { score: 0.75, completed: true }]);
    });

    test("DW_1_1 out-of-range scores are clamped to 0..1", () => {
        const { probe, got } = started();
        probe.report({ score: 7 });
        probe.report({ score: -3 });
        expect(got.map(r => r.score)).toEqual([1, 0]);
    });

    test("DW_1_1 NaN, +-Infinity and non-number scores are dropped", () => {
        const { probe, got } = started();
        for (const score of [Number.NaN, Infinity, -Infinity, "1", null, undefined, {}]) probe.reportAny({ score });
        probe.reportAny(null);
        probe.reportAny(undefined);
        expect(got).toEqual([]);
    });

    test("DW_1_1 a non-boolean completed counts as false", () => {
        const { probe, got } = started();
        probe.reportAny({ score: 0.2, completed: "yes" });
        expect(got).toEqual([{ score: 0.2, completed: false }]);
    });

    test("DW_1_1 reports before start() are ignored, and accepted from inside start()", () => {
        class Early extends Probe {
            override awake(): void { this.report({ score: 1 }); }
            override start(): void { this.report({ score: 0.4 }); }
        }
        const probe = new Early();
        const got: IScenarioResult[] = [];
        probe._systemSetResultSink(r => got.push(r));
        probe.report({ score: 0.9 });
        void probe._systemInit({} as never);
        expect(got).toEqual([]);
        probe._systemUpdate();
        expect(got).toEqual([{ score: 0.4, completed: false }]);
    });

    test("DW_1_1 reports after destroy are ignored, even from onDestroy", () => {
        class Late extends Probe { override onDestroy(): void { this.report({ score: 1 }); } }
        const probe = new Late();
        const got: IScenarioResult[] = [];
        probe._systemSetResultSink(r => got.push(r));
        probe._systemUpdate();
        probe._systemDestroy();
        probe.report({ score: 0.3 });
        expect(got).toEqual([]);
    });

    test("DW_1_1 a report with no sink installed does nothing", () => {
        const probe = new Probe();
        probe._systemUpdate();
        expect(() => probe.report({ score: 1 })).not.toThrow();
    });

    test("DW_1_1 identical repeats are not re-sent; a changed score or completed flag is", () => {
        const { probe, got } = started();
        probe.report({ score: 0.5 });
        probe.report({ score: 0.5 });
        probe.report({ score: 0.5, completed: false });
        probe.report({ score: 0.5, completed: true });
        probe.report({ score: 0.5, completed: true });
        probe.report({ score: 0.6, completed: true });
        probe.report({ score: 2 });
        probe.report({ score: 1 });
        expect(got).toEqual([
            { score: 0.5, completed: false }, { score: 0.5, completed: true },
            { score: 0.6, completed: true }, { score: 1, completed: false },
        ]);
    });

    test("the sink receives a copy, so a mutating handler cannot corrupt de-duplication", () => {
        const probe = new Probe();
        const got: IScenarioResult[] = [];
        probe._systemSetResultSink(r => { got.push({ ...r }); r.score = 0; });
        probe._systemUpdate();
        probe.report({ score: 0.5 });
        probe.report({ score: 0.5 });
        expect(got).toHaveLength(1);
    });
});

describe("Scenario.onResult", () => {
    const deliver = (s: Scenario, r: IScenarioResult) => (s as any)._deliverResult(r);

    test("the active scenario's result reaches the host hook", () => {
        const s = new Scenario();
        (Scenario as any)._current = s;
        const hook = vi.fn();
        Scenario.onResult = hook;
        deliver(s, { score: 0.5, completed: true });
        expect(hook).toHaveBeenCalledWith({ score: 0.5, completed: true });
    });

    test("a scenario that is not the active one is ignored, as is a missing hook", () => {
        const s = new Scenario();
        const hook = vi.fn();
        Scenario.onResult = hook;
        deliver(s, { score: 1, completed: true });
        expect(hook).not.toHaveBeenCalled();
        (Scenario as any)._current = s;
        Scenario.onResult = null;
        expect(() => deliver(s, { score: 1, completed: true })).not.toThrow();
    });

    test("a throwing hook is logged and does not propagate", () => {
        const s = new Scenario();
        (Scenario as any)._current = s;
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        Scenario.onResult = () => { throw new Error("boom"); };
        expect(() => deliver(s, { score: 1, completed: true })).not.toThrow();
        expect(error).toHaveBeenCalled();
    });
});

describe("manifest graded field", () => {
    test("the streaming manifest carries a boolean graded through to the scenario manifest", () => {
        const base = { schema: 1, id: "a", name: "A", entry: "scripts/main.js", scripts: [{ path: "scripts/main.js", url: "m.js" }], assets: [] };
        expect(toScenarioManifest(parseStreamingManifest({ ...base, graded: true })).graded).toBe(true);
        expect(toScenarioManifest(parseStreamingManifest({ ...base, graded: false })).graded).toBe(false);
        expect("graded" in toScenarioManifest(parseStreamingManifest(base))).toBe(false);
        expect("graded" in toScenarioManifest(parseStreamingManifest({ ...base, graded: "yes" }))).toBe(false);
    });
});
