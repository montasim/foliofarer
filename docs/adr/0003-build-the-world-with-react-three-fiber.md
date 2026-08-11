---
status: superseded by ADR-0015
---

# Build the world with React Three Fiber

The Portfolio World will use Three.js through React Three Fiber, Drei for scene utilities, and React Three Rapier for collision handling. Version one will build original reusable low-poly scenery and the Montasim Avatar directly from scene geometry, with the option to replace components later using optimized glTF/GLB assets. This keeps the game within the portfolio's React 19 architecture, provides a supported physics integration, and avoids introducing a separate embedded game engine; Assisted Travel will follow a lightweight town waypoint graph.

Performance optimization will first improve the measured behavior of this architecture rather than replacing its rendering or physics engines. React Three Fiber or React Three Rapier may be reconsidered only if profiling later proves that one prevents the accepted performance target, because an unproven engine rewrite would put collision, movement, and Journey Experience Contract compatibility at disproportionate risk.
