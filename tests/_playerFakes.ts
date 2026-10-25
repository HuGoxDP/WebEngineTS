// tests/_playerFakes.ts
// Minimal DOM doubles for the player tests. There is no jsdom here (vitest runs in node), and the code under test
// touches very little: a container that takes an iframe, the iframe's attributes and `contentWindow`, and a window
// that hands out `message` events. Ports are REAL (`MessageChannel` is a node global), so what crosses them is
// structured-cloned exactly as in a browser.

type Listener = (event: any) => void;

export class FakeEventTarget {
    private readonly _listeners = new Map<string, Set<Listener>>();
    addEventListener(type: string, listener: Listener): void {
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type)!.add(listener);
    }
    removeEventListener(type: string, listener: Listener): void {
        this._listeners.get(type)?.delete(listener);
    }
    listenerCount(type: string): number {
        return this._listeners.get(type)?.size ?? 0;
    }
    dispatch(type: string, event: unknown): void {
        for (const listener of [...(this._listeners.get(type) ?? [])]) listener(event);
    }
}

export interface Posted { data: any; targetOrigin: string; transfer: any[] }

/** A window that records what is posted to it. */
export class FakeWindow extends FakeEventTarget {
    posted: Posted[] = [];
    postMessage(data: unknown, targetOrigin: string, transfer: any[] = []): void {
        this.posted.push({ data, targetOrigin, transfer });
    }
}

export class FakeFrame {
    attrs: Record<string, string> = {};
    style = { cssText: "" };
    src = "";
    contentWindow: FakeWindow | null = new FakeWindow();
    isConnected = false;
    constructor(private readonly _container: FakeContainer) {}
    setAttribute(name: string, value: string): void { this.attrs[name] = value; }
    getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
    remove(): void {
        this.isConnected = false;
        this._container.children = this._container.children.filter(child => child !== this);
    }
}

export class FakeContainer {
    children: FakeFrame[] = [];
    created: FakeFrame[] = [];
    readonly window = new FakeEventTarget();
    readonly ownerDocument: any;
    constructor(baseURI: string) {
        this.ownerDocument = {
            baseURI,
            defaultView: this.window,
            createElement: (tag: string) => {
                if (tag !== "iframe") throw new Error(`unexpected element ${tag}`);
                const frame = new FakeFrame(this);
                this.created.push(frame);
                return frame;
            },
        };
    }
    appendChild(frame: FakeFrame): FakeFrame {
        frame.isConnected = true;
        this.children.push(frame);
        return frame;
    }
    /** The current frame (the last one created). */
    get frame(): FakeFrame { return this.created[this.created.length - 1]; }
}

/** A `message` event as the browser would deliver it to the host window. */
export const messageEvent = (source: unknown, data: unknown, origin = "null", ports: unknown[] = []) => ({ source, origin, data, ports });
