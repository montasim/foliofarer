---
status: accepted
---

# Keep V2 traversal compiler-led

V2 will retain Three.js through React Three Fiber but use compiler-produced walkable surfaces, collision polygons, navigation portals, terrain-height fields and runtime surface sampling instead of whole-world runtime physics. This fits the static portfolio landscape, preserves the existing streamed-cell architecture, and avoids paying a continuous physics or runtime-navmesh cost for Environmental Scenery. BVH acceleration, offline Recast navigation, or Rapier may be introduced only when measured requirements such as arbitrary mesh grounding, overlapping walkable elevations, jumping, moving platforms, vehicles, or physical props cannot be satisfied by the compiler-led model.
