// path: src/engine/core/KeyCode.ts

/**
 * Keyboard key codes mapped to DOM `KeyboardEvent.code` values.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.KeyCode`.
 *
 * Uses the physical key layout (`KeyboardEvent.code`) rather than
 * character output (`KeyboardEvent.key`), making it locale-independent.
 * For example, `KeyCode.KeyW` always refers to the physical W key
 * regardless of the user's keyboard layout (QWERTY, AZERTY, etc.).
 *
 * @example
 * ```ts
 * if (Input.getKeyDown(KeyCode.Space)) {
 *     this.jump();
 * }
 * ```
 */
export enum KeyCode {

    // ==================== LETTERS ====================

    KeyA = "KeyA",
    KeyB = "KeyB",
    KeyC = "KeyC",
    KeyD = "KeyD",
    KeyE = "KeyE",
    KeyF = "KeyF",
    KeyG = "KeyG",
    KeyH = "KeyH",
    KeyI = "KeyI",
    KeyJ = "KeyJ",
    KeyK = "KeyK",
    KeyL = "KeyL",
    KeyM = "KeyM",
    KeyN = "KeyN",
    KeyO = "KeyO",
    KeyP = "KeyP",
    KeyQ = "KeyQ",
    KeyR = "KeyR",
    KeyS = "KeyS",
    KeyT = "KeyT",
    KeyU = "KeyU",
    KeyV = "KeyV",
    KeyW = "KeyW",
    KeyX = "KeyX",
    KeyY = "KeyY",
    KeyZ = "KeyZ",

    // ==================== DIGITS ====================

    Digit0 = "Digit0",
    Digit1 = "Digit1",
    Digit2 = "Digit2",
    Digit3 = "Digit3",
    Digit4 = "Digit4",
    Digit5 = "Digit5",
    Digit6 = "Digit6",
    Digit7 = "Digit7",
    Digit8 = "Digit8",
    Digit9 = "Digit9",

    // ==================== FUNCTION KEYS ====================

    F1 = "F1",
    F2 = "F2",
    F3 = "F3",
    F4 = "F4",
    F5 = "F5",
    F6 = "F6",
    F7 = "F7",
    F8 = "F8",
    F9 = "F9",
    F10 = "F10",
    F11 = "F11",
    F12 = "F12",

    // ==================== MODIFIERS ====================

    ShiftLeft = "ShiftLeft",
    ShiftRight = "ShiftRight",
    ControlLeft = "ControlLeft",
    ControlRight = "ControlRight",
    AltLeft = "AltLeft",
    AltRight = "AltRight",
    MetaLeft = "MetaLeft",
    MetaRight = "MetaRight",
    CapsLock = "CapsLock",
    NumLock = "NumLock",
    ScrollLock = "ScrollLock",

    // ==================== WHITESPACE & EDITING ====================

    Space = "Space",
    Enter = "Enter",
    Tab = "Tab",
    Backspace = "Backspace",
    Delete = "Delete",
    Insert = "Insert",

    // ==================== NAVIGATION ====================

    Escape = "Escape",
    Home = "Home",
    End = "End",
    PageUp = "PageUp",
    PageDown = "PageDown",

    // ==================== ARROWS ====================

    ArrowUp = "ArrowUp",
    ArrowDown = "ArrowDown",
    ArrowLeft = "ArrowLeft",
    ArrowRight = "ArrowRight",

    // ==================== NUMPAD ====================

    Numpad0 = "Numpad0",
    Numpad1 = "Numpad1",
    Numpad2 = "Numpad2",
    Numpad3 = "Numpad3",
    Numpad4 = "Numpad4",
    Numpad5 = "Numpad5",
    Numpad6 = "Numpad6",
    Numpad7 = "Numpad7",
    Numpad8 = "Numpad8",
    Numpad9 = "Numpad9",
    NumpadAdd = "NumpadAdd",
    NumpadSubtract = "NumpadSubtract",
    NumpadMultiply = "NumpadMultiply",
    NumpadDivide = "NumpadDivide",
    NumpadDecimal = "NumpadDecimal",
    NumpadEnter = "NumpadEnter",

    // ==================== PUNCTUATION ====================

    Minus = "Minus",
    Equal = "Equal",
    BracketLeft = "BracketLeft",
    BracketRight = "BracketRight",
    Backslash = "Backslash",
    Semicolon = "Semicolon",
    Quote = "Quote",
    Comma = "Comma",
    Period = "Period",
    Slash = "Slash",
    Backquote = "Backquote",
}