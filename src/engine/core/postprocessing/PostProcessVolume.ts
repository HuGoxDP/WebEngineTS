import { Behaviour } from "../Behaviour";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import { PostEffect } from "./PostEffect";
import { PostProcessing } from "./PostProcessing";

/**
 * Keeps a list of post-processing effects in a scene.
 *
 * @remarks
 * {@link PostProcessing} is one global pipeline, so on its own it cannot be
 * saved, opened in an editor, or put on an object. This component is the part
 * that can: it owns the effects, saves them with the scene, and feeds them to
 * the pipeline while it is enabled.
 *
 * Effects join the pipeline when the component is enabled and leave it when it
 * is disabled or destroyed, so a scene with a volume in it and the same scene
 * without one render differently, and unloading the scene takes its effects
 * with it. Several volumes add up, in the order they were enabled.
 *
 * Closest to Unity's `Volume` with a profile, without the blending by
 * distance.
 *
 * ```ts
 * const volume = new GameObject("Post").addComponent(PostProcessVolume);
 * volume.effects = [new BloomEffect({ intensity: 1.2 }), new VignetteEffect()];
 * ```
 */
@Serializable({ typeName: "PostProcessVolume", category: "Rendering" })
export class PostProcessVolume extends Behaviour {

    private _effects: PostEffect[] = [];

    /**
     * The effects this volume contributes, in pipeline order.
     *
     * @remarks
     * An entry whose class is not registered — an effect from a package that is
     * not installed — is a placeholder rather than a `PostEffect`. It stays in
     * the list, so saving the scene does not delete it, and is simply not run.
     */
    @SerializedField({ type: FieldType.Array, elementType: FieldType.Object })
    public get effects(): PostEffect[] {
        return this._effects;
    }

    public set effects(value: PostEffect[]) {
        this._withdraw();
        this._effects = value;
        if (this.isActiveAndEnabled) this._contribute();
    }

    /**
     * Re-reads {@link effects} after the list was changed in place.
     *
     * @remarks
     * Assigning `effects` does this by itself; this is for `push` and `splice`,
     * which the volume cannot see.
     */
    public refresh(): void {
        this._withdraw();
        if (this.isActiveAndEnabled) this._contribute();
    }

    protected override onEnable(): void {
        this._contribute();
    }

    protected override onDisable(): void {
        this._withdraw();
    }

    private _contribute(): void {
        let added = false;
        for (const effect of this._effects) {
            if (!(effect instanceof PostEffect)) continue;
            PostProcessing.addEffect(effect);
            added = true;
        }
        if (added) PostProcessing.enabled = true;
    }

    private _withdraw(): void {
        for (const effect of this._effects) {
            if (effect instanceof PostEffect) PostProcessing.removeEffect(effect);
        }
    }
}
