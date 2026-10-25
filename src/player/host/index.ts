// src/player/host/index.ts
// Public surface of `WebEngineTS/player-host`: the framework-agnostic client a host page uses to run
// scenarios in the sandboxed player. Imports no engine code.
export { PlayerHost, PLAYER_PROTOCOL_VERSION } from "./PlayerHost";
export type {
    PlayerCallbacks, PlayerHostOptions, PlayerMessage, PlayerMetrics, PlayerProgress, PlayerError, PlayerState, PlayerLoadSource,
} from "./PlayerHost";
