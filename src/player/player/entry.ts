// src/player/player/entry.ts
// The player's real entry: binds the page's globals to the runtime and shows a refusal as text.
import { bootPlayer, type PlayerEngine } from "./PlayerRuntime";

const result = bootPlayer({
    window,
    importEngine: url => import(/* the engine is a separate file: the player never bundles it */ url) as Promise<PlayerEngine>,
});

if (!result.ok) {
    console.error(`[Player] ${result.reason}`);
    document.body.textContent = "This page only runs inside the scenario viewer.";
}
