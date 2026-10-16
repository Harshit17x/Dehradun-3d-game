# Dehradun Drive

A Google Maps vector 3D driving scene with exactly one controllable Ember GT,
real mapped roads and closed building footprints from OpenStreetMap, plus an
approximate 3D treatment of mapped places such as Ghanta Ghar and named shops.
The streets and POI coordinates are geographic; façades, building heights and
the clock-tower mesh are visual approximations, not a survey or photogrammetry.

## Play

Run with `npm run dev` or `npm run preview`. The app starts directly in Google
Maps vector 3D mode and renders the mapped buildings and single car through
Google's `WebGLOverlayView`. This requires the Maps
JavaScript API, billing, a browser-referrer restriction, and a vector-capable
Google Map ID. Configure these only in private environment settings:

```sh
VITE_GOOGLE_MAPS_API_KEY=your_key_here
VITE_GOOGLE_MAP_ID=your_vector_map_id
```

The key is served only by the local Vite `/api/maps-config` runtime endpoint;
it is not written into source or the standalone HTML. If Google fails to load,
the app reports the reason and keeps the drive paused rather than silently
switching to a different renderer.

The Google-backed mapped overlay includes a **Go to Dehradun place** search. Enter a mapped
place, street, market, neighbourhood, or landmark and the app requests the
bounded city cell around it, replaces the current OSM roads/buildings, and
spawns the car on the nearest mapped road. The city loader covers a bounded
Dehradun city region (`30.24–30.43 N`, `77.94–78.17 E`), not the entire
district or every rural road. Public OSM data is loaded in overlapping cells
to keep the browser and physics workload bounded.

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
website and the runtime Google config endpoint. `npm run fetch:map` refreshes the
full bounded Dehradun city region (`30.24–30.43 N`, `77.94–78.17 E`) from public
OpenStreetMap Overpass servers and replaces `src/dehradun-data.json` only after a
complete response. Use `npm run fetch:central` for the smaller central extract
when testing with a limited Overpass endpoint. Existing
explorer code is retained in `src/`, its entry is
`valley-explorer.html`, and the original `dist/` is not overwritten.

### Files

- `index.html`: responsive scene shell, inline styles and accessible HUD.
- `src/drive-main.js`: Google vector 3D setup, mapped overlay streaming, input,
  fixed-step loop, reset/pause, search and teardown.
- `src/dehradun-data.json`: bounded OSM roads, buildings and named places with
  source URL, timestamp, license and counts.
- `scripts/fetch-dehradun.mjs`: repeatable public-data refresh script; it does
  not read or write API keys.
- `src/geo-world.js`: OSM-footprint architecture, mapped place awnings, and
  approximate Clock Tower detail.
- `src/map-chunks.js`: spatial OSM partitioning and nearest-first incremental
  scenery streaming. The collision network remains available for the whole
  city while visual chunks are built and unloaded around the car.
- `src/mapped-surface.js`: low-allocation typed-array road strips, markings,
  ground and boundary meshes used by streamed chunks.
- `src/geo-driving.js`: geographic polyline driving, actual-road collision,
  full car capsule clearance, Clock Tower obstacle, and swept turns.
- `src/google-drive-overlay.js`: Google vector map plus shared Three.js WebGL
  overlay with auth, timeout and context-loss handling.
- `src/city-loader.js`, `server/city-map.js`, `server/geocode.js`: bounded
  city-cell loading and place search. Google Geocoding is used server-side when
  the key is configured; otherwise the server uses public Nominatim. Client
  responses are validated and stale requests are aborted.
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
- Google Maps owns the vector 3D chase camera; the shared Three.js overlay keeps
  the mapped car and scenery in the same geographic frame.
- Full-city scenery is streamed in 320 m chunks: one nearest missing chunk is
  built per animation update, with a 720 m load radius and 980 m unload
  hysteresis. Distant buildings and road meshes are disposed as the car moves;
  the complete OSM collision network remains authoritative so streaming never
  makes a road temporarily undrivable.
- Mapped architecture is batched by facade material; car details are batched
  within their animated groups. Google mode shares Google's WebGL context and
  never resizes or clears the basemap canvas. The OSM physics and search layer
  remains the authoritative drivable network; Google 3D is visual surface data
  and is not treated as automatically walkable collision geometry.
- Traffic signals, pedestrian crossings, barriers and street lamps are only
  rendered when supplied by OSM. Signal poles are explicitly inferred from a
  mapped control node and nearby road edge; their exact physical pole placement
  and timing are not available from ordinary OSM tags. Unknown gates are not
  sealed as walls; explicit closed/locked/access=no barriers can collide.
- World, car, textures, shadow resources, input listeners and renderer have
  explicit cleanup. Resource tests verify idempotent world/car disposal; these
  are not a substitute for a long-duration GPU memory profile.

60 FPS is a target, not a hardware-independent guarantee. The live FPS counter
shows current render throughput. The current checks are Node regression tests,
map-data validation and a production build; no separate lint/typecheck pipeline
is configured.

## Accuracy boundary

This project can make a convincing geographically anchored driving prototype,
but it cannot honestly promise a fully surveyed GTA-scale replica from a Google
API key alone. Google Maps JavaScript/3D basemaps provide map imagery and native
map geometry; they do not grant a downloadable, editable database of every
traffic-light pole, lane marking, curb, shop façade, barrier state, or live
traffic signal phase. Those details are therefore either mapped OSM features,
explicitly marked inferences, or generic visual approximations. For true
photorealistic buildings and city-wide road-level accuracy, use an authorized
Google Photorealistic 3D Tiles workflow or licensed survey/photogrammetry data,
then optimize/stream it in tiles rather than bundling the whole city into one
HTML file. See Google's [WebGL Overlay View](https://developers.google.com/maps/documentation/javascript/webgl/webgl-overlay-view)
and [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)
documentation for the licensing and renderer requirements.
