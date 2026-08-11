# Place the Journey Experience on a dedicated route

The floating Journey Entrance will open the full-screen `/journey` route in the same tab rather than placing the Journey Experience in a modal over the Standard Portfolio. The route opens with the renderer-independent Journey Atlas; World Exploration and its Three.js payload load only after an explicit Visitor choice. A dedicated route supports browser history and direct sharing while isolating world input and interface layers from the Standard Portfolio's chat and floating widgets.

## Amendment — 2026-07-24

The dedicated-route decision remains, but the Atlas-first chooser is superseded. The Journey Entrance and direct navigation to `/journey` now run the capability check and enter World Exploration automatically when it is available. The renderer-independent Journey Atlas and Journey Passport remain accessible DOM interfaces from within the world, and the Journey Atlas becomes the automatic entrance when World Exploration cannot start.
