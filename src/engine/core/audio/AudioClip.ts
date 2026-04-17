/**
 * Stores a decoded audio asset ready for playback.
 *
 * @remarks
 * Equivalent to Unity's `AudioClip`. Wraps a Web Audio API `AudioBuffer`.
 * Load via `Resources.load<AudioClip>("sound.mp3")`.
 */
export class AudioClip {

    /** @internal The raw decoded audio buffer. */
    public readonly _buffer: AudioBuffer;

    /** The clip's asset name (filename without extension). */
    public readonly name: string;

    /** @internal */
    constructor(buffer: AudioBuffer, name: string = "") {
        this._buffer = buffer;
        this.name = name;
    }

    /** Total playback duration in seconds. */
    public get duration(): number { return this._buffer.duration; }

    /** Number of audio channels (1 = mono, 2 = stereo). */
    public get channels(): number { return this._buffer.numberOfChannels; }

    /** Sample rate in Hz (e.g. 44100). */
    public get frequency(): number { return this._buffer.sampleRate; }

    /** Total number of sample frames. */
    public get samples(): number { return this._buffer.length; }
}
