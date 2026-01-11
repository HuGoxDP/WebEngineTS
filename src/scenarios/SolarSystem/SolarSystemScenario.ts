import { Scenario, Vector3 } from "@engine";

export default class SolarSystemScenario extends Scenario {
    public async init(): Promise<void> {
        console.log("Solar System initialized!");

        const sun = this.createGameObject("Sun");
        // sun.addComponent(MeshRenderer)...
        sun.transform.position = Vector3.zero;
    }
}