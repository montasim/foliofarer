# Compile the V2 Portfolio World from code

V2 of the Portfolio World will be authored from deterministic TypeScript data
and generators. Roads, sidewalks, building footprints, scenery placements,
collision shapes, navigation data, and render batches are compiled before the
application build. The browser will load generated district packages rather
than performing spatial validation or constructing one React component per
environment object.

The build-time compiler is the source of spatial truth. It unions intersecting
road surfaces before triangulation, derives pedestrian surfaces and crossings
from that topology, validates complete building and scenery footprints, and
fails generation when a road, sidewalk, entrance, or clearance rule is broken.
Navigation may only cross a road where the compiled world also draws a
crosswalk. Terrain cell borders must share identical heights; water may not be
walkable; a road may cross water only through a compiled bridge with valid
land approaches; and buildings, vegetation, roads, water, bridge clearances,
and arrival areas must pass complete-footprint overlap and slope validation.

Generated output is divided into spatial cells. Repeated environmental objects
are stored as district-local instance transforms, while unique static geometry
is merged by material. The runtime loads one compact navigation graph, then
streams nearby render and collision cells with hysteresis. Assisted routes are
string-pulled through the compiler's shared triangle portals, preserving the
walkable/crosswalk topology without sending the avatar through every triangle
centroid. React remains responsible for semantic portfolio interfaces;
continuous player coordinates and per-frame world state do not enter the React
component tree.

The visual world is permanently code-authored. It does not use a manual 3D
editor, manually modelled or imported environmental meshes, baked renders,
image-generated scenery, raster foliage, texture packs, or other externally
authored environmental visual assets. Terrain, water, sky, vegetation,
buildings, infrastructure, material variation, and environmental animation are
constructed from TypeScript, numeric compiler output, Three.js geometry, and
small shader or lookup data declared in source code. Existing application
fonts and interface icons are outside this environmental constraint. WebGL is
only the browser display layer; it is not an asset-authoring workflow.

WebGL2 remains the production renderer until an identical GPU-backed vertical
slice demonstrates a material benefit from another backend. Renderer changes
do not replace draw-call, streaming, navigation, accessibility, or performance
budgets.
