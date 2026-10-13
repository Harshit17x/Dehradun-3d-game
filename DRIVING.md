# Dehradun Drive

A procedural Three.js driving scene with exactly one controllable Ember GT,
an orderly Dehradun-inspired grid, and northern Mussoorie-style foothills.
The street layout and landmark placement are stylised, not geographically accurate.

## Play

Open **`dehradun-drive.html`** in a modern WebGL 2-capable browser. The file
embeds its JavaScript, Three.js, CSS and procedural assets: no internet,
CDN, API key, model downloads, fonts, or build tools are needed to play it.

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
```

The build writes the normal website to `dist-drive/`, then embeds the generated
JavaScript into `dehradun-drive.html`. `npm run preview` serves the production
website. Existing explorer code is retained in `src/`, its entry is
`valley-explorer.html`, and the original `dist/` is not overwritten.

### Files

- `index.html`: responsive scene shell, inline styles and accessible HUD.
- `src/drive-main.js`: WebGL setup, input, fixed-step loop, chase camera,
  minimap, reset/pause, context-loss messaging and teardown.
- `src/drive-world.js`: seeded procedural world, instancing and disposal.
- `src/drive-vehicle.js`: one detailed car, separately animated wheels and
  material-batched body details.
- `src/drive-physics.js`: rendering-independent physics and swept-circle
  collision against the complement of the road network.
- `src/drive-physics.test.js`: physics, geometry and resource-disposal checks.
- `build-standalone.mjs`: standalone offline packaging.

## Behaviour and rendering

- Metric world, north is −Z; 18 m-wide roads on a 410 × 410 m grid.
- Forward speed capped at 90 km/h; reverse capped at 28.8 km/h.
- Fixed 120 Hz simulation, smooth inertia, coasting resistance, speed-sensitive
  steering and render interpolation. No dependencies on a remote physics engine.
- A conservative 2.4 m circular footprint encloses the car. Continuous collision
  tests prevent tunnelling or cutting through sidewalks; glancing impacts slide
  along the boundary. Outer road ends stop the car.
- Exponential camera damping is independent of render frame rate. Desired chase
  positions are constrained to the street network to reduce building clipping.
- Standard depth fog, warm sun, hemisphere fill and soft PCF shadows.
- Static scenery is instanced; car details are batched within their animated
  groups. Device pixel ratio is capped at 1.75, and a local 2048² shadow map
  follows the vehicle. No model or texture downloads occur during gameplay.
- World, car, textures, shadow resources, input listeners and renderer have
  explicit cleanup. Resource tests verify idempotent world/car disposal; these
  are not a substitute for a long-duration GPU memory profile.

60 FPS is a target, not a hardware-independent guarantee. The live FPS counter
shows current render throughput. This project has Node regression tests and a
production build; no separate lint/typecheck pipeline is configured.
