import { EngineObject } from "./EngineObject.ts";
import { TypeRegistry } from "./reflection/TypeRegistry.ts";
import { getAllFields } from "./reflection/Decorators.ts";
import { ValueSerializer } from "./serialization/ValueSerializer.ts";

/** The JSON form of a {@link ScriptableObject}. */
export interface SerializedScriptableObject {
    /** Registered type name, from `@Serializable`. */
    type: string;
    /** The object's name. */
    name: string;
    /** Serialized `@SerializedField` values. */
    fields: Record<string, unknown>;
}

/**
 * A data asset that lives outside the scene graph.
 *
 * @remarks
 * Equivalent to Unity's `ScriptableObject`, and **not** to be confused with
 * this engine's {@link ScriptableBehaviour} — which, despite the name, is the
 * `MonoBehaviour` analogue and needs a GameObject. This one deliberately has
 * neither a GameObject nor a lifecycle: it is a bag of authored values.
 *
 * That is the point. A lesson's parameters, a table of planet masses, a
 * difficulty preset — none of them are things in the world, and making them
 * components forces a GameObject to exist for data that has no position.
 * Several scenes referring to one asset then share it rather than each holding
 * a copy that drifts.
 *
 * ```ts
 * @Serializable({ typeName: "ExperimentSettings" })
 * class ExperimentSettings extends ScriptableObject {
 *     @SerializedField() public gravity = 9.81;
 *     @SerializedField() public sampleCount = 20;
 * }
 *
 * const settings = ScriptableObject.create(ExperimentSettings, "Earth");
 * ```
 *
 * **Serialization:** a component field holding one of these should be declared
 * `@SerializedField({ type: FieldType.Asset })`. It has no file behind it, so
 * the scene carries it in its asset table and every component referring to it
 * gets the same instance back — the same treatment materials receive.
 */
export abstract class ScriptableObject extends EngineObject {

    /**
     * Creates an instance.
     *
     * @remarks
     * Equivalent to Unity's `ScriptableObject.CreateInstance`. A plain `new`
     * works too; this exists because it is the name Unity users look for, and
     * because it names the asset in one step.
     *
     * @param type - the concrete subclass.
     * @param name - display name. Defaults to the class name.
     */
    public static create<T extends ScriptableObject>(
        type: new () => T,
        name?: string,
    ): T {
        const instance = new type();
        if (name !== undefined) instance.name = name;
        return instance;
    }

    /**
     * Rebuilds one from its JSON form.
     *
     * @param json - from {@link toJSON}.
     * @returns the object, or null if its class is not registered — a scenario
     *          whose script was removed should not take the whole load with it.
     */
    public static fromJSON(json: SerializedScriptableObject): ScriptableObject | null {
        const ctor = TypeRegistry.get(json.type);
        if (!ctor) {
            console.warn(`[ScriptableObject] Unknown type "${json.type}" — skipped`);
            return null;
        }

        const instance = new ctor() as ScriptableObject;
        instance.name = json.name;

        for (const field of getAllFields(ctor)) {
            if (!field.serialize) continue;
            if (!(field.name in json.fields)) continue;
            (instance as any)[field.name] = ValueSerializer.deserialize(
                json.fields[field.name], field.type, undefined, field.elementType,
            );
        }
        return instance;
    }

    protected constructor(name?: string) {
        super(name);
    }

    /**
     * This object's values as JSON.
     *
     * @remarks
     * Standalone: for an asset saved as its own file. A reference *from a
     * scene* does not use this — the scene's asset table carries it, so that
     * two components pointing at one asset still point at one after loading.
     *
     * References to scene objects cannot be expressed here, since a data asset
     * outlives any particular scene; such a field serializes as null.
     */
    public toJSON(): SerializedScriptableObject {
        const typeName = TypeRegistry.getTypeName(this);
        if (typeName === null) {
            throw new Error(
                `[ScriptableObject] ${this.constructor.name} needs @Serializable`
                + " with an explicit typeName before it can be saved.",
            );
        }

        const fields: Record<string, unknown> = {};
        for (const field of getAllFields(this.constructor as never)) {
            if (!field.serialize) continue;
            fields[field.name] = ValueSerializer.serialize(
                (this as any)[field.name], field.type, undefined, field.elementType,
            );
        }

        return { type: typeName, name: this.name, fields };
    }
}
