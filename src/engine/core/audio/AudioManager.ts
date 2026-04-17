/**
 * Singleton that owns the Web Audio API AudioContext and master gain node.
 *
 * Lazily creates the AudioContext on first access (respects browser autoplay policy).
 * Call {@link resume} after a user gesture to unlock audio if it was suspended.
 */
export class AudioManager {

    private static _context: AudioContext | null = null;
    private static _masterGain: GainNode | null = null;

    /** The underlying AudioContext. Created lazily on first access. */
    public static get context(): AudioContext {
        if (!AudioManager._context) {
            AudioManager._context = new AudioContext();
            AudioManager._masterGain = AudioManager._context.createGain();
            AudioManager._masterGain.connect(AudioManager._context.destination);
        }
        return AudioManager._context;
    }

    /** @internal The master gain node; all audio routes through this. */
    public static get _masterGainNode(): GainNode {
        AudioManager.context;
        return AudioManager._masterGain!;
    }

    /** Master volume (0–1). Affects all audio sources. */
    public static get masterVolume(): number {
        return AudioManager._masterGain?.gain.value ?? 1;
    }

    public static set masterVolume(value: number) {
        AudioManager.context;
        AudioManager._masterGain!.gain.value = Math.max(0, value);
    }

    /**
     * Resumes the AudioContext after a user gesture.
     * Required by browsers that suspend audio until user interaction.
     */
    public static resume(): Promise<void> {
        if (AudioManager._context?.state === "suspended") {
            return AudioManager._context.resume();
        }
        return Promise.resolve();
    }

    /** @internal Tears down the AudioContext (called on engine reset). */
    public static _reset(): void {
        if (AudioManager._context) {
            void AudioManager._context.close();
            AudioManager._context = null;
            AudioManager._masterGain = null;
        }
    }

    private constructor() {}
}
