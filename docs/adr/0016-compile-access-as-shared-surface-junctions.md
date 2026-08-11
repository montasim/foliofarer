---
status: accepted
---

# Compile access as shared surface junctions

Landmark Access Lanes and Residential Driveways will meet the main road through compiler-generated curb, sidewalk, shoulder, or drainage junctions derived from shared topology. An arrival building and its Landmark checkpoint will reference the same road-to-door access surface, with the retained Arrival Forecourt cut out and triangulated once instead of layering coplanar paths. The compiler will preserve pedestrian continuity and reject protruding slabs, arbitrary road overlap, disconnected entrances, duplicate access meshes, or visible seams. This supersedes ADR-0011's stop-at-the-sidewalk workaround now that V2 can generate plausible junction topology.
