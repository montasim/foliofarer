import * as THREE from "three"
import { JOURNEY_V2_PALETTE } from "@/lib/journey-v2/design"
import type {
  JourneyWorldGeometryDefinition,
  JourneyWorldMaterialDefinition,
} from "@/lib/journey-v2/runtime/types"

const TOON_VERTEX_SHADER = /* glsl */ `
  uniform float uJourneyTime;
  uniform float uJourneyWind;
  uniform vec2 uJourneyBreezeDirection;
  varying vec3 vJourneyNormal;
  varying vec3 vJourneyColor;
  varying float vJourneyColorWeight;
  varying vec3 vJourneyWorldPosition;
  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vec3 transformed = position;
    if (uJourneyWind > 0.0) {
      float anchor = smoothstep(0.0, 1.25, max(position.y, 0.0));
      float phase = position.x * 1.91 + position.z * 1.37 + uJourneyTime * 1.65;
      float summerPulse = 0.72
        + sin(uJourneyTime * 0.43) * 0.18
        + sin(uJourneyTime * 0.17 + 1.8) * 0.1;
      vec2 breeze = normalize(uJourneyBreezeDirection);
      vec2 crossBreeze = vec2(-breeze.y, breeze.x);
      transformed.xz += breeze
        * sin(phase)
        * uJourneyWind
        * anchor
        * summerPulse;
      transformed.xz += crossBreeze
        * cos(phase * 0.73)
        * uJourneyWind
        * anchor
        * 0.34;
    }

    vec4 localPosition = vec4(transformed, 1.0);
    vec3 localNormal = normal;
    #ifdef USE_INSTANCING
      localPosition = instanceMatrix * localPosition;
      localNormal = mat3(instanceMatrix) * localNormal;
    #endif

    vec4 worldPosition = modelMatrix * localPosition;
    vec4 mvPosition = viewMatrix * worldPosition;
    vJourneyWorldPosition = worldPosition.xyz;
    vJourneyNormal = normalize(mat3(modelMatrix) * localNormal);
    vJourneyColor = vec3(1.0);
    vJourneyColorWeight = 0.0;
    #ifdef USE_COLOR
      vJourneyColor = color;
      vJourneyColorWeight = 1.0;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vJourneyColor = instanceColor;
      vJourneyColorWeight = 1.0;
    #endif
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const TOON_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uJourneyColor;
  uniform vec3 uJourneySkyColor;
  uniform vec3 uJourneySunDirection;
  uniform float uJourneyUnlit;
  varying vec3 vJourneyNormal;
  varying vec3 vJourneyColor;
  varying float vJourneyColorWeight;
  varying vec3 vJourneyWorldPosition;
  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec3 base = mix(uJourneyColor, vJourneyColor, vJourneyColorWeight);
    float lambert = max(dot(normalize(vJourneyNormal), normalize(uJourneySunDirection)), 0.0);
    float band = 0.48;
    if (lambert > 0.82) {
      band = 1.0;
    } else if (lambert > 0.55) {
      band = 0.82;
    } else if (lambert > 0.25) {
      band = 0.65;
    }
    vec3 lit = base * band + uJourneySkyColor * (0.055 + 0.035 * (1.0 - lambert));
    vec3 outgoing = mix(lit, base, uJourneyUnlit);
    gl_FragColor = vec4(outgoing, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

const WATER_VERTEX_SHADER = /* glsl */ `
  uniform float uJourneyTime;
  uniform vec2 uJourneyFlowDirection;
  uniform vec2 uJourneyBreezeDirection;
  uniform float uJourneyFlowSpeed;
  uniform float uJourneyFlowStrength;
  varying vec3 vJourneyWorldPosition;
  varying vec3 vJourneyNormal;
  #include <common>
  #include <fog_pars_vertex>

  void main() {
    vec3 transformed = position;
    vec2 flowDirection = normalize(uJourneyFlowDirection);
    vec2 flowNormal = vec2(-flowDirection.y, flowDirection.x);
    float alongFlow = dot(position.xz, flowDirection);
    float acrossFlow = dot(position.xz, flowNormal);
    float flowTime = uJourneyTime * (0.4 + uJourneyFlowSpeed * 1.8);
    float waveA = sin(alongFlow * 0.28 - flowTime);
    float waveB = cos(acrossFlow * 0.21 + alongFlow * 0.08 + flowTime * 0.37);
    vec2 breezeDirection = normalize(uJourneyBreezeDirection);
    float breezePhase = dot(position.xz, breezeDirection) * 0.38
      - uJourneyTime * 0.62;
    float breezeRipple = sin(breezePhase)
      * (0.004 + 0.002 * sin(uJourneyTime * 0.43));
    transformed.y += (waveA + waveB) * (0.008 + uJourneyFlowStrength * 0.014)
      + breezeRipple;
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vec4 mvPosition = viewMatrix * worldPosition;
    vJourneyWorldPosition = worldPosition.xyz;
    vJourneyNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uJourneyTime;
  uniform vec3 uJourneyWaterColor;
  uniform vec3 uJourneyWaterDeep;
  uniform vec3 uJourneySkyColor;
  uniform vec2 uJourneyFlowDirection;
  uniform vec2 uJourneyBreezeDirection;
  uniform float uJourneyFlowSpeed;
  uniform float uJourneyFlowStrength;
  varying vec3 vJourneyWorldPosition;
  varying vec3 vJourneyNormal;
  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vJourneyWorldPosition);
    float fresnel = pow(1.0 - max(dot(normalize(vJourneyNormal), viewDirection), 0.0), 2.1);
    vec2 flowDirection = normalize(uJourneyFlowDirection);
    vec2 flowNormal = vec2(-flowDirection.y, flowDirection.x);
    float alongFlow = dot(vJourneyWorldPosition.xz, flowDirection);
    float acrossFlow = dot(vJourneyWorldPosition.xz, flowNormal);
    float flowTime = uJourneyTime * (0.55 + uJourneyFlowSpeed * 2.25);
    float directionalPhase = alongFlow * 0.72 - flowTime
      + sin(acrossFlow * 0.24) * 0.72;
    float flowBand = pow(0.5 + 0.5 * sin(directionalPhase), 7.0);
    float smallRipple = sin(acrossFlow * 0.74 + alongFlow * 0.11 + flowTime * 0.21)
      * cos(alongFlow * 0.31 - flowTime * 0.46);
    float breezeRipple = sin(
      dot(vJourneyWorldPosition.xz, normalize(uJourneyBreezeDirection)) * 0.82
      - uJourneyTime * 0.62
    ) * 0.018;
    float flowSignal = (flowBand * 0.12 + smallRipple * 0.035)
      * uJourneyFlowStrength + breezeRipple;
    vec3 water = mix(uJourneyWaterDeep, uJourneyWaterColor, 0.56 + flowSignal);
    water = mix(water, uJourneySkyColor, 0.17 + fresnel * 0.34);
    gl_FragColor = vec4(water, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export interface JourneyAnimatedMaterial {
  material: THREE.Material
  update: (elapsed: number) => void
}

function materialRole(definition: JourneyWorldMaterialDefinition) {
  return `${definition.id} ${definition.kind}`.toLowerCase()
}

export function createJourneyCodeMaterial(
  definition: JourneyWorldMaterialDefinition
): JourneyAnimatedMaterial {
  const role = materialRole(definition)
  const isWater = role.includes("water")
  if (isWater) {
    const flowDirection =
      "flowDirection" in definition &&
      Array.isArray(definition.flowDirection) &&
      definition.flowDirection.length === 2
        ? definition.flowDirection
        : ([1, 0] as const)
    const flowSpeed =
      "flowSpeed" in definition && Number.isFinite(definition.flowSpeed)
        ? (definition.flowSpeed ?? 0.2)
        : 0.2
    const flowStrength =
      "flowStrength" in definition && Number.isFinite(definition.flowStrength)
        ? (definition.flowStrength ?? 0.35)
        : 0.35
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uJourneyTime: { value: 0 },
        uJourneyWaterColor: {
          value: new THREE.Color(definition.color || JOURNEY_V2_PALETTE.water),
        },
        uJourneyWaterDeep: {
          value: new THREE.Color(JOURNEY_V2_PALETTE.waterDeep),
        },
        uJourneySkyColor: { value: new THREE.Color(JOURNEY_V2_PALETTE.sky) },
        uJourneyFlowDirection: {
          value: new THREE.Vector2(
            flowDirection[0],
            flowDirection[1]
          ).normalize(),
        },
        uJourneyBreezeDirection: {
          value: new THREE.Vector2(0.82, 0.57).normalize(),
        },
        uJourneyFlowSpeed: { value: flowSpeed },
        uJourneyFlowStrength: { value: flowStrength },
      },
    ])
    const material = new THREE.ShaderMaterial({
      name: definition.id,
      uniforms,
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      fog: true,
      toneMapped: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    })
    return {
      material,
      update: (elapsed) => {
        uniforms.uJourneyTime.value = elapsed
      },
    }
  }

  const unlit = definition.kind === "unlit"
  const wind =
    role.includes("grass") ||
    role.includes("canopy") ||
    role.includes("leaf") ||
    role.includes("foliage")
      ? role.includes("grass")
        ? 0.105
        : 0.065
      : 0
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uJourneyTime: { value: 0 },
      uJourneyWind: { value: wind },
      uJourneyBreezeDirection: {
        value: new THREE.Vector2(0.82, 0.57).normalize(),
      },
      uJourneyColor: { value: new THREE.Color(definition.color) },
      uJourneySkyColor: { value: new THREE.Color(JOURNEY_V2_PALETTE.skyHaze) },
      uJourneySunDirection: {
        value: new THREE.Vector3(0.45, 0.78, 0.34).normalize(),
      },
      uJourneyUnlit: { value: unlit ? 1 : 0 },
    },
  ])
  const material = new THREE.ShaderMaterial({
    name: definition.id,
    uniforms,
    vertexShader: TOON_VERTEX_SHADER,
    fragmentShader: TOON_FRAGMENT_SHADER,
    fog: true,
    toneMapped: true,
    vertexColors:
      "vertexColors" in definition && definition.vertexColors === true,
    side: role.includes("grass") ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: unlit,
    polygonOffsetFactor: unlit ? -2 : 0,
    polygonOffsetUnits: unlit ? -2 : 0,
  })
  return {
    material,
    update: (elapsed) => {
      uniforms.uJourneyTime.value = elapsed
    },
  }
}

export function applyJourneyVertexColors(
  geometry: THREE.BufferGeometry,
  definition: JourneyWorldGeometryDefinition
) {
  const colors = (
    definition as JourneyWorldGeometryDefinition & {
      colors?: number[]
    }
  ).colors
  if (
    Array.isArray(colors) &&
    colors.length === definition.positions.length &&
    colors.every(Number.isFinite)
  ) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  }
}
