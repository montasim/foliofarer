import * as THREE from "three"
import type {
  BuildingAccessType,
  BuildingPlot,
  BuildingUse,
  JourneyLandmarkId,
  JourneyLandmarkLayout,
  RoadSide,
  WorldPosition,
} from "@/lib/journey/types"

export const JOURNEY_STREET = {
  roadwayWidth: 5.8,
  curbOffset: 3.02,
  drainOffset: 3.23,
  sidewalkOffset: 4.02,
  sidewalkWidth: 1.3,
  outerEdge: 4.72,
  accessThresholdOffset: 3.4,
} as const

export const JOURNEY_PLOT_GEOMETRY = {
  institutionSideMargin: 4.1,
  institutionRearMargin: 3,
} as const

const JOURNEY_EDUCATION_ROAD_CENTERLINE: readonly WorldPosition[] = [
  [0, 0, 17],
  [0, 0, 9],
  [0, 0, 3],
  [0, 0, -7],
  [1, 0, -14],
  [4.2, 0, -18],
  [6.2, 0, -24],
  [4, 0, -28.5],
  [-0.5, 0, -31.5],
  [-2.5, 0, -37.5],
  [0, 0, -43],
  [4.5, 0, -47],
  [9.5, 0, -50],
  [13, 0, -54.5],
  [16.5, 0, -59],
  [21, 0, -68],
] as const

const JOURNEY_CAREER_ROAD_CENTERLINE: readonly WorldPosition[] = [
  ...JOURNEY_EDUCATION_ROAD_CENTERLINE,
  [25, 0, -77],
  [22, 0, -86],
  [16, 0, -94],
  [13, 0, -103],
  [17, 0, -112],
  [25, 0, -119],
  [31, 0, -128],
  [33, 0, -138],
] as const

const JOURNEY_LEARNING_ROAD_CENTERLINE: readonly WorldPosition[] = [
  ...JOURNEY_CAREER_ROAD_CENTERLINE,
  [28, 0, -147],
  [20, 0, -154],
  [14, 0, -162],
  [16, 0, -172],
  [23, 0, -181],
  [31, 0, -189],
] as const

const JOURNEY_PROJECT_ROAD_CENTERLINE: readonly WorldPosition[] = [
  ...JOURNEY_LEARNING_ROAD_CENTERLINE,
  [38, 0, -198],
  [41, 0, -209],
  [37, 0, -220],
  [29, 0, -228],
  [21, 0, -238],
  [22, 0, -249],
] as const

const JOURNEY_COMMUNITY_ROAD_CENTERLINE: readonly WorldPosition[] = [
  ...JOURNEY_PROJECT_ROAD_CENTERLINE,
  [18, 0, -260],
  [10, 0, -270],
  [4, 0, -281],
  [6, 0, -293],
  [14, 0, -303],
  [24, 0, -312],
] as const

export const JOURNEY_ROAD_CENTERLINE: readonly WorldPosition[] = [
  ...JOURNEY_COMMUNITY_ROAD_CENTERLINE,
  [33, 0, -322],
  [39, 0, -334],
  [36, 0, -347],
  [28, 0, -359],
  [20, 0, -369],
] as const

export const journeyStreetCurve = new THREE.CatmullRomCurve3(
  JOURNEY_ROAD_CENTERLINE.map(
    (position) => new THREE.Vector3(position[0], 0, position[2])
  ),
  false,
  "centripetal"
)

const educationStreetCurve = new THREE.CatmullRomCurve3(
  JOURNEY_EDUCATION_ROAD_CENTERLINE.map(
    (position) => new THREE.Vector3(position[0], 0, position[2])
  ),
  false,
  "centripetal"
)

const careerStreetCurve = new THREE.CatmullRomCurve3(
  JOURNEY_CAREER_ROAD_CENTERLINE.map(
    (position) => new THREE.Vector3(position[0], 0, position[2])
  ),
  false,
  "centripetal"
)

const learningStreetCurve = new THREE.CatmullRomCurve3(
  JOURNEY_LEARNING_ROAD_CENTERLINE.map(
    (position) => new THREE.Vector3(position[0], 0, position[2])
  ),
  false,
  "centripetal"
)

const projectStreetCurve = new THREE.CatmullRomCurve3(
  JOURNEY_PROJECT_ROAD_CENTERLINE.map(
    (position) => new THREE.Vector3(position[0], 0, position[2])
  ),
  false,
  "centripetal"
)

const communityStreetCurve = new THREE.CatmullRomCurve3(
  JOURNEY_COMMUNITY_ROAD_CENTERLINE.map(
    (position) => new THREE.Vector3(position[0], 0, position[2])
  ),
  false,
  "centripetal"
)

export const JOURNEY_EDUCATION_ROAD_SCALE =
  educationStreetCurve.getLength() / journeyStreetCurve.getLength()
export const JOURNEY_CAREER_ROAD_SCALE =
  careerStreetCurve.getLength() / journeyStreetCurve.getLength()
export const JOURNEY_LEARNING_ROAD_SCALE =
  learningStreetCurve.getLength() / journeyStreetCurve.getLength()
export const JOURNEY_PROJECT_ROAD_SCALE =
  projectStreetCurve.getLength() / journeyStreetCurve.getLength()
export const JOURNEY_COMMUNITY_ROAD_SCALE =
  communityStreetCurve.getLength() / journeyStreetCurve.getLength()

export function educationRoadProgress(progress: number) {
  return progress * JOURNEY_EDUCATION_ROAD_SCALE
}

export function careerRoadProgress(progress: number) {
  return progress * JOURNEY_CAREER_ROAD_SCALE
}

export function learningRoadProgress(progress: number) {
  return progress * JOURNEY_LEARNING_ROAD_SCALE
}

export function projectRoadProgress(progress: number) {
  return progress * JOURNEY_PROJECT_ROAD_SCALE
}

export function communityRoadProgress(progress: number) {
  return progress * JOURNEY_COMMUNITY_ROAD_SCALE
}

const JOURNEY_ROAD_CLEARANCE_SAMPLES = Array.from(
  { length: 1001 },
  (_, index) => journeyStreetCurve.getPointAt(index / 1000)
)

export function getRoadFrame(progress: number) {
  const clamped = THREE.MathUtils.clamp(progress, 0, 1)
  const center = journeyStreetCurve.getPointAt(clamped)
  const tangent = journeyStreetCurve.getTangentAt(clamped).normalize()
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  return { center, tangent, normal }
}

function worldPosition(vector: THREE.Vector3): WorldPosition {
  return [vector.x, 0, vector.z]
}

export function positionBesideRoad(
  progress: number,
  roadSide: RoadSide,
  distance: number
): WorldPosition {
  const { center, normal } = getRoadFrame(progress)
  return worldPosition(center.addScaledVector(normal, roadSide * distance))
}

interface BuildingPlotInput {
  id: string
  use: BuildingUse
  accessType: BuildingAccessType
  roadProgress: number
  roadSide: RoadSide
  setback: number
  footprint: readonly [width: number, depth: number]
  accessWidth: number
  forecourtRadius?: number
}

export function createBuildingPlot(input: BuildingPlotInput): BuildingPlot {
  const isLandmark = input.use !== "residential"
  const minimumSetback = isLandmark ? 4 : 2
  if (input.setback < minimumSetback) {
    throw new Error(
      `${input.id} requires a ${minimumSetback}-unit minimum roadside setback`
    )
  }
  if (
    (isLandmark && input.accessType !== "landmark-lane") ||
    (input.use === "residential" && input.accessType !== "residential-driveway")
  ) {
    throw new Error(
      `${input.id} has an access type that does not match its use`
    )
  }
  if (input.footprint[0] <= 0 || input.footprint[1] <= 0) {
    throw new Error(`${input.id} requires a positive building footprint`)
  }

  const { center, tangent, normal } = getRoadFrame(input.roadProgress)
  const outward = normal.clone().multiplyScalar(input.roadSide)
  const towardRoad = outward.clone().multiplyScalar(-1)
  const buildingDistance =
    JOURNEY_STREET.outerEdge + input.setback + input.footprint[1] / 2
  const building = center.clone().addScaledVector(outward, buildingDistance)
  const entrance = building
    .clone()
    .addScaledVector(towardRoad, input.footprint[1] / 2 + 0.04)
  const forecourtOffset = isLandmark ? Math.min(3.15, input.setback * 0.55) : 0
  const checkpoint = entrance
    .clone()
    .addScaledVector(towardRoad, forecourtOffset)
  const roadConnection = center
    .clone()
    .addScaledVector(outward, JOURNEY_STREET.accessThresholdOffset)
  const sidewalkCrossing = center
    .clone()
    .addScaledVector(outward, JOURNEY_STREET.sidewalkOffset)
  const sidewalkAnchor = center
    .clone()
    .addScaledVector(outward, JOURNEY_STREET.outerEdge)
  const buildingRotationY = Math.atan2(towardRoad.x, towardRoad.z)

  const plotHalfWidth =
    input.footprint[0] / 2 +
    (isLandmark ? JOURNEY_PLOT_GEOMETRY.institutionSideMargin : 0)
  const plotRearEdge =
    -input.footprint[1] / 2 -
    (isLandmark ? JOURNEY_PLOT_GEOMETRY.institutionRearMargin : 0)
  const plotFrontEdge = input.footprint[1] / 2 + input.setback
  let wholeRoadClearance = Number.POSITIVE_INFINITY

  for (const roadPoint of JOURNEY_ROAD_CLEARANCE_SAMPLES) {
    const relativeX = roadPoint.x - building.x
    const relativeZ = roadPoint.z - building.z
    const plotX = relativeX * tangent.x + relativeZ * tangent.z
    const plotZ = relativeX * towardRoad.x + relativeZ * towardRoad.z
    const outsideX = Math.max(Math.abs(plotX) - plotHalfWidth, 0)
    const outsideZ = Math.max(plotRearEdge - plotZ, 0, plotZ - plotFrontEdge)
    wholeRoadClearance = Math.min(
      wholeRoadClearance,
      Math.hypot(outsideX, outsideZ)
    )
  }

  const requiredWholeRoadClearance = isLandmark
    ? JOURNEY_STREET.outerEdge - 0.12
    : JOURNEY_STREET.roadwayWidth / 2 + 0.55
  if (wholeRoadClearance < requiredWholeRoadClearance) {
    throw new Error(
      `${input.id} crosses another part of the street; move the plot or change its road side`
    )
  }

  return {
    ...input,
    forecourtRadius: input.forecourtRadius ?? 0,
    buildingPosition: worldPosition(building),
    buildingRotationY,
    entrancePosition: worldPosition(entrance),
    checkpointPosition: worldPosition(checkpoint),
    roadConnectionPosition: worldPosition(roadConnection),
    sidewalkCrossingPosition: worldPosition(sidewalkCrossing),
    sidewalkAnchorPosition: worldPosition(sidewalkAnchor),
  }
}

export const JOURNEY_BUILDING_PLOTS = {
  "rangpur-zilla-school": createBuildingPlot({
    id: "rangpur-zilla-school",
    use: "institution",
    accessType: "landmark-lane",
    roadProgress: educationRoadProgress(0.3),
    roadSide: -1,
    setback: 8.6,
    footprint: [10.8, 4.4],
    accessWidth: 2.7,
    forecourtRadius: 1.65,
  }),
  "carmichael-college": createBuildingPlot({
    id: "carmichael-college",
    use: "institution",
    accessType: "landmark-lane",
    roadProgress: educationRoadProgress(0.61),
    roadSide: -1,
    setback: 6.8,
    footprint: [9.4, 4],
    accessWidth: 2.8,
    forecourtRadius: 1.75,
  }),
  baust: createBuildingPlot({
    id: "baust",
    use: "institution",
    accessType: "landmark-lane",
    roadProgress: educationRoadProgress(0.9),
    roadSide: 1,
    setback: 7.2,
    footprint: [10.2, 4.2],
    accessWidth: 2.9,
    forecourtRadius: 1.8,
  }),
  "codez-info-tech": createBuildingPlot({
    id: "codez-info-tech",
    use: "office",
    accessType: "landmark-lane",
    roadProgress: careerRoadProgress(0.6),
    roadSide: 1,
    setback: 6.4,
    footprint: [8.2, 4.1],
    accessWidth: 2.6,
    forecourtRadius: 1.5,
  }),
  drra: createBuildingPlot({
    id: "drra",
    use: "office",
    accessType: "landmark-lane",
    roadProgress: careerRoadProgress(0.71),
    roadSide: -1,
    setback: 6.8,
    footprint: [8.8, 4.2],
    accessWidth: 2.7,
    forecourtRadius: 1.6,
  }),
  "multiversal-software": createBuildingPlot({
    id: "multiversal-software",
    use: "office",
    accessType: "landmark-lane",
    roadProgress: careerRoadProgress(0.82),
    roadSide: -1,
    setback: 6.5,
    footprint: [8.4, 4.2],
    accessWidth: 2.7,
    forecourtRadius: 1.55,
  }),
  mymedicalhub: createBuildingPlot({
    id: "mymedicalhub",
    use: "office",
    accessType: "landmark-lane",
    roadProgress: careerRoadProgress(0.93),
    roadSide: 1,
    setback: 7.4,
    footprint: [10.4, 4.6],
    accessWidth: 2.9,
    forecourtRadius: 1.8,
  }),
  "learning-library": createBuildingPlot({
    id: "learning-library",
    use: "library",
    accessType: "landmark-lane",
    roadProgress: learningRoadProgress(0.86),
    roadSide: -1,
    setback: 7.8,
    footprint: [13.8, 5.4],
    accessWidth: 3,
    forecourtRadius: 1.9,
  }),
  "project-workshop": createBuildingPlot({
    id: "project-workshop",
    use: "workshop",
    accessType: "landmark-lane",
    roadProgress: projectRoadProgress(0.86),
    roadSide: 1,
    setback: 8.2,
    footprint: [14.8, 6.2],
    accessWidth: 3.1,
    forecourtRadius: 2,
  }),
  "community-hall": createBuildingPlot({
    id: "community-hall",
    use: "civic",
    accessType: "landmark-lane",
    roadProgress: communityRoadProgress(0.89),
    roadSide: -1,
    setback: 8,
    footprint: [13.5, 5.8],
    accessWidth: 3.1,
    forecourtRadius: 2,
  }),
  "contact-pavilion": createBuildingPlot({
    id: "contact-pavilion",
    use: "pavilion",
    accessType: "landmark-lane",
    roadProgress: 0.94,
    roadSide: 1,
    setback: 8.8,
    footprint: [12.8, 5.4],
    accessWidth: 3,
    forecourtRadius: 2.1,
  }),
} as const

export const JOURNEY_HOUSE_PLOTS: readonly BuildingPlot[] = [
  createBuildingPlot({
    id: "home-arrival-west",
    use: "residential",
    accessType: "residential-driveway",
    roadProgress: educationRoadProgress(0.19),
    roadSide: -1,
    setback: 2.7,
    footprint: [3.6, 3.2],
    accessWidth: 1.55,
  }),
  createBuildingPlot({
    id: "home-arrival-east",
    use: "residential",
    accessType: "residential-driveway",
    roadProgress: educationRoadProgress(0.2),
    roadSide: 1,
    setback: 2.4,
    footprint: [3.6, 3.2],
    accessWidth: 1.5,
  }),
  createBuildingPlot({
    id: "home-school-east",
    use: "residential",
    accessType: "residential-driveway",
    roadProgress: educationRoadProgress(0.36),
    roadSide: 1,
    setback: 2.8,
    footprint: [3.6, 3.2],
    accessWidth: 1.55,
  }),
  createBuildingPlot({
    id: "home-school-south-east",
    use: "residential",
    accessType: "residential-driveway",
    roadProgress: educationRoadProgress(0.49),
    roadSide: 1,
    setback: 2.5,
    footprint: [3.6, 3.2],
    accessWidth: 1.5,
  }),
  createBuildingPlot({
    id: "home-college-east",
    use: "residential",
    accessType: "residential-driveway",
    roadProgress: educationRoadProgress(0.68),
    roadSide: 1,
    setback: 2.9,
    footprint: [3.6, 3.2],
    accessWidth: 1.6,
  }),
  createBuildingPlot({
    id: "home-baust-west",
    use: "residential",
    accessType: "residential-driveway",
    roadProgress: educationRoadProgress(0.91),
    roadSide: -1,
    setback: 2.6,
    footprint: [3.6, 3.2],
    accessWidth: 1.5,
  }),
] as const

export const JOURNEY_TOWN_ROAD_PROGRESS = educationRoadProgress(0.11)
export const JOURNEY_CROSSWALK_PROGRESS = [
  JOURNEY_TOWN_ROAD_PROGRESS,
  careerRoadProgress(0.565),
  careerRoadProgress(0.755),
  careerRoadProgress(0.9),
  learningRoadProgress(0.8),
  projectRoadProgress(0.81),
  communityRoadProgress(0.84),
  0.82,
  ...Object.values(JOURNEY_BUILDING_PLOTS)
    .filter((plot) => plot.roadSide === 1)
    .map((plot) => plot.roadProgress),
] as const
const townFrame = getRoadFrame(JOURNEY_TOWN_ROAD_PROGRESS)
const townSide: RoadSide = -1
const townSidewalk = townFrame.center
  .clone()
  .addScaledVector(townFrame.normal, townSide * JOURNEY_STREET.outerEdge)
const townCheckpoint = townFrame.center
  .clone()
  .addScaledVector(
    townFrame.normal,
    townSide * (JOURNEY_STREET.outerEdge + 12.3)
  )

function layoutFromPlot(plot: BuildingPlot): JourneyLandmarkLayout {
  return {
    plot,
    buildingPosition: plot.buildingPosition,
    buildingRotationY: plot.buildingRotationY,
    entrancePosition: plot.entrancePosition,
    checkpointPosition: plot.checkpointPosition,
    sidewalkAnchorPosition: plot.sidewalkAnchorPosition,
  }
}

export const JOURNEY_LANDMARK_LAYOUTS: Record<
  JourneyLandmarkId,
  JourneyLandmarkLayout
> = {
  "town-square": {
    plot: null,
    buildingPosition: worldPosition(townCheckpoint),
    buildingRotationY: 0,
    entrancePosition: worldPosition(townCheckpoint),
    checkpointPosition: worldPosition(townCheckpoint),
    sidewalkAnchorPosition: worldPosition(townSidewalk),
  },
  "rangpur-zilla-school": layoutFromPlot(
    JOURNEY_BUILDING_PLOTS["rangpur-zilla-school"]
  ),
  "carmichael-college": layoutFromPlot(
    JOURNEY_BUILDING_PLOTS["carmichael-college"]
  ),
  baust: layoutFromPlot(JOURNEY_BUILDING_PLOTS.baust),
  "codez-info-tech": layoutFromPlot(JOURNEY_BUILDING_PLOTS["codez-info-tech"]),
  drra: layoutFromPlot(JOURNEY_BUILDING_PLOTS.drra),
  "multiversal-software": layoutFromPlot(
    JOURNEY_BUILDING_PLOTS["multiversal-software"]
  ),
  mymedicalhub: layoutFromPlot(JOURNEY_BUILDING_PLOTS.mymedicalhub),
  "learning-library": layoutFromPlot(
    JOURNEY_BUILDING_PLOTS["learning-library"]
  ),
  "project-workshop": layoutFromPlot(
    JOURNEY_BUILDING_PLOTS["project-workshop"]
  ),
  "community-hall": layoutFromPlot(JOURNEY_BUILDING_PLOTS["community-hall"]),
  "contact-pavilion": layoutFromPlot(
    JOURNEY_BUILDING_PLOTS["contact-pavilion"]
  ),
}

export const JOURNEY_ENTRANCE_LAYOUTS = [
  JOURNEY_LANDMARK_LAYOUTS["rangpur-zilla-school"],
  JOURNEY_LANDMARK_LAYOUTS["carmichael-college"],
  JOURNEY_LANDMARK_LAYOUTS.baust,
  JOURNEY_LANDMARK_LAYOUTS["codez-info-tech"],
  JOURNEY_LANDMARK_LAYOUTS.drra,
  JOURNEY_LANDMARK_LAYOUTS["multiversal-software"],
  JOURNEY_LANDMARK_LAYOUTS.mymedicalhub,
  JOURNEY_LANDMARK_LAYOUTS["learning-library"],
  JOURNEY_LANDMARK_LAYOUTS["project-workshop"],
  JOURNEY_LANDMARK_LAYOUTS["community-hall"],
  JOURNEY_LANDMARK_LAYOUTS["contact-pavilion"],
] as const

const journeyStartGround = positionBesideRoad(
  educationRoadProgress(0.075),
  -1,
  JOURNEY_STREET.outerEdge + 3.2
)

export const JOURNEY_START_POSITION = [
  journeyStartGround[0],
  1.1,
  journeyStartGround[2],
] as const
