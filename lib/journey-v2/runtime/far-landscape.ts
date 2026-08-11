import * as THREE from "three"
import { FAR_LANDSCAPE_GEOMETRY_ID_V3 } from "@/lib/journey-v2/contracts/world"
import type { JourneyWorldAssetRegistry } from "@/lib/journey-v2/runtime/scene-assets"

/**
 * Always-resident visual ground beneath the streamed world.
 *
 * The compiler builds this from the authoritative terrain, road and water
 * data. It deliberately owns no collision, navigation, shadows or gameplay;
 * detailed streamed cells cover it whenever they are resident.
 */
export class JourneyFarLandscape {
  readonly object = new THREE.Group()
  private readonly mesh: THREE.Mesh | null

  constructor(registry: JourneyWorldAssetRegistry) {
    this.object.name = "journey-v3-far-landscape"
    const definition = registry.geometryDefinition(
      FAR_LANDSCAPE_GEOMETRY_ID_V3
    )
    if (!definition) {
      this.mesh = null
      return
    }

    this.mesh = new THREE.Mesh(
      registry.geometry(definition.id),
      registry.material(definition.materialId)
    )
    this.mesh.name = FAR_LANDSCAPE_GEOMETRY_ID_V3
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.renderOrder = -70
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
    this.object.add(this.mesh)
  }

  dispose() {
    this.object.removeFromParent()
    this.mesh?.removeFromParent()
  }
}
