# Dehradun Drive

A geographic Three.js driving scene with exactly one controllable Ember GT,
real mapped roads and closed building footprints from OpenStreetMap, plus an
approximate 3D treatment of mapped places such as Ghanta Ghar and named shops.
The streets and POI coordinates are geographic; façades, building heights and
the clock-tower mesh are visual approximations, not a survey or photogrammetry.

## Play

Open **`dehradun-drive.html`** in a modern WebGL 2-capable browser for the
offline geographic OSM mode. It embeds its JavaScript, Three.js, CSS and map
dataset; no CDN, API key, model downloads, fonts, or build tools are needed for
that local mode.

When running with `npm run dev` or `npm run preview`, the **Google 3D** button
loads Google Maps as the basemap and renders the same mapped buildings and the
single car through Google's `WebGLOverlayView`. This requires the Maps
JavaScript API, billing, a browser-referrer restriction, and a vector-capable
Google Map ID. Configure these only in private environment settings:

```sh
VITE_GOOGLE_MAPS_API_KEY=your_key_here
VITE_GOOGLE_MAP_ID=your_vector_map_id
```

The key is served only by the local Vite `/api/maps-config` runtime endpoint;
it is not written into source or the standalone HTML. If Google fails to load,
the app explicitly reports the reason and remains playable in geographic OSM
mode. Google mode is not embedded in the offline HTML because its runtime
configuration endpoint is intentionally server-backed.

| Control | Action |
| --- | --- |
| W / Up | Accelerate; brake when reversing |
| S / Down | Brake, then reverse |
| A / Left | Steer left |
| D / Right | Steer right |
| Space | Brake to a stop |
| P / Pause button | Pause or resume |
| R / Reset button | Reset car and trip to Rajpur Road |

Coarse-pointer devices receive on-screen driving buttons. Losing window focus
or hiding the tab pauses driving and clears held inputs. Use Resume to continue.

## Development

```sh
npm install
npm run dev
npm test
npm run build
npm run fetch:map
```

The build writes the normal website to `dist-drive/`, then embeds the generated
JavaScript into `dehradun-drive.html`. `npm run preview` serves the production
website and the runtime Google config endpoint. `npm run fetch:map` refreshes a
bounded central-Dehradun extract from public OpenStreetMap Overpass servers and
replaces `src/dehradun-data.json` only after a complete response. Existing
explorer code is retained in `src/`, its entry is
`valley-explorer.html`, and the original `dist/` is not overwritten.

### Files

- `index.html`: responsive scene shell, inline styles and accessible HUD.
- `src/drive-main.js`: geographic WebGL setup, input, fixed-step loop, chase
  camera, minimap, mapped labels, reset/pause, Google 3D toggle, context-loss
  messaging and teardown.
- `src/dehradun-data.json`: bounded OSM roads, buildings and named places with
  source URL, timestamp, license and counts.
- `scripts/fetch-dehradun.mjs`: repeatable public-data refresh script; it does
  not read or write API keys.
- `src/geo-world.js`: OSM-footprint architecture, mapped place awnings, and
  approximate Clock Tower detail.
- `src/geo-driving.js`: geographic polyline driving, actual-road collision,
  full car capsule clearance, Clock Tower obstacle, and swept turns.
- `src/google-drive-overlay.js`: optional Google vector map plus shared
  Three.js WebGL overlay with auth, timeout and context-loss handling.
- `vite.config.js`: private runtime Google Maps configuration endpoint.
- `src/drive-world.js`: legacy synthetic world retained for comparison only.
- `src/drive-vehicle.js`: one detailed car, separately animated wheels and
  material-batched body details.
- `src/drive-physics.js`: legacy synthetic-grid physics retained for comparison
  tests; the game entry uses geographic physics instead.
- `src/drive-physics.test.js` and `src/geo-driving.test.js`: physics,
  geographic alignment, full-footprint collision, geometry and disposal checks.
- `build-standalone.mjs`: standalone offline packaging.

## Behaviour and rendering

- Metric world, north is −Z; local metres are converted from the committed
  latitude/longitude origin. Roads are actual surveyed OSM ways in the bounded
  central-Dehradun extract, not a generated axis grid.
- Forward speed capped at 60 km/h; reverse capped at 18 km/h.
- Fixed 120 Hz simulation, smooth inertia, coasting resistance, speed-sensitive
  steering and render interpolation. No dependencies on a remote physics engine.
- A conservative 2.4 m circular footprint encloses the car. Continuous collision
  tests prevent tunnelling or cutting through sidewalks; glancing impacts slide
  along the boundary. Outer road ends stop the car.
- Exponential camera damping is independent of render frame rate. Desired chase
  positions are constrained to the street network to reduce building clipping.
- Standard depth fog, warm sun, hemisphere fill and soft PCF shadows.
- Mapped architecture is batched by facade material; car details are batched
  within their animated groups. Device pixel ratio is capped at 1.75, and a
  local 2048² shadow map follows the vehicle. Google mode shares Google's
  WebGL context and never resizes or clears the basemap canvas.
- World, car, textures, shadow resources, input listeners and renderer have
  explicit cleanup. Resource tests verify idempotent world/car disposal; these
  are not a substitute for a long-duration GPU memory profile.

60 FPS is a target, not a hardware-independent guarantee. The live FPS counter
shows current render throughput. The current checks are Node regression tests,
map-data validation and a production build; no separate lint/typecheck pipeline
is configured.
