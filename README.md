# Poster Distorting Map

An installation instrument that separates a poster into color and boundary regions, including its background. Body landmarks or device motion move, bend and repeatedly fracture the pieces. Files and camera frames stay on the viewer’s device.

## Development

Use Node.js 24 and npm. No database, API key or secret is required.

```sh
npm ci --cache /workspace/.cache/npm --no-audit --no-fund
npm run dev -- --port 5173
```

The cache flag is optional outside the cloud workspace. `predev`, `prebuild` and `pretest:browser` copy the pinned official `@mediapipe/holistic` SDK, models and WASM unchanged into ignored `public/tracking/`. Browser inference uses these same-origin files without a runtime CDN or external inference service.

```sh
npm test
npm run build
npm run test:browser
SMOKE_PRODUCTION=1 npm run test:browser
```

Browser tests use `/usr/bin/chromium` or `CHROMIUM_PATH`, run their own server on port 4175, and stop it afterwards. Software WebGL enables real local-model inference in headless Chromium. Screenshots are written to ignored `test-results/`.

## Use

1. Upload a PDF, JPG or PNG, up to 50 MB. PDFs use their first page. Before requesting camera access, a **Crop poster** dialog lets you select any aspect ratio, move the selection, resize its corners, or enter pixel coordinates and dimensions. **Full image** resets the crop; **Cancel** leaves the previous poster in place.
2. After **Use crop**, desktops start **Body nodes** automatically. Phones and tablets first offer **Body nodes · camera** or **Device motion sensor**. Sensor permission is requested from that button gesture. The panel’s **Motion input** menu can switch between these modes or stop tracking.
3. For body input, allow camera access and keep the camera fixed with the performer’s face, hands and body visible. The local model needs WebAssembly and WebGL. The first detected frames establish a baseline for 800 ms. At least two consecutive measured body samples of 12% or more release the initial poster. Zero input, missing landmarks and sensor noise do not release it.
4. **Nodes ON/OFF** controls skeleton/node rendering; **Data ON/OFF** controls body-part percentages and the response readout. Both affect display only, so hiding them keeps motion tracking active. The preview initially sits above the green panel and moves with the performance.
5. **Pause motion** freezes poster physics, path accumulation and sound while camera tracking stays live. **Resume motion** continues the same composition. **Sound** toggles the instrument.
6. Drag the green panel with a mouse or touch, or use arrow keys on its grip (Shift moves faster). Hovering holds it for interaction. A manually placed panel stays put until a new upload or viewport resize. The camera preview is held while interacting with its toggles. The title, About, panel, preview and circular upload/+ button respond to motion as unbreakable interface bodies.
7. **Download** offers JPG and raster PDF. Paths/numbers follow the panel’s ON/OFF toggle. Export covers the whole arena, including pieces outside the original paper; interface bodies are excluded. Refreshing resets the session.

The page itself cannot scroll. Crop/About dialogs and the input menu can scroll internally on short screens. Real camera accuracy depends on lighting, distance, occlusion, framing and GPU/browser performance. Tracking is local, handles one performer and does not identify people. The microphone is never requested; video is not recorded or uploaded. Stopping tracking, hiding the page or unmounting releases the camera and inference instance.

## Extraction and motion

The long image edge is rendered at up to 1,200 pixels. Color/edge analysis runs at up to 640 pixels: touching regions with a sufficiently strong color edge separate, disconnected glyphs remain independent, and small antialias/noise regions join neighbors. Large flat areas are subdivided, so paper/background pixels also become movable, breakable pieces. Sprites retain source-resolution colors and alpha; there is no stationary colored paper underneath. This is color-based segmentation, not semantic object recognition or OCR. Same-color touching elements and very fine details may merge.

All pieces remain fixed until the first measured gesture passes the startup gate. Once released, they move across the viewport with **zero gravity**, low air resistance, elastic boundary collisions and a weak circulating current. Repeated movement accumulates material damage; stronger movement accumulates it faster. Strong collisions can also split a piece. New fragments can split again as movement continues. Minimum size/area, a maximum fracture depth and a 650-body budget bound the simulation. Very small pieces stop splitting.

Paths, displacement guides and coordinate annotations are drawn **before** all poster pieces. DOM interface controls sit above the arena. Each piece gets a stable saturated RGB trail color; new fragments get new colors. Parent trails remain with a cross at the split, and children inherit cumulative travel. Old samples are thinned during long performances, retaining the start and recent route.

Panel coordinates are the area-weighted position/offset of all pieces. X/Y is the current center, dX/dY the displacement from the original center, L accumulated center travel, R rotation in degrees and W bend amplitude. Units are analyzed poster pixels with the original poster’s top-left as (0,0); negative coordinates are valid. Numeric annotations prioritize widely traveled pieces and avoid interface bodies/other cards.

The supplied `MetaAccanthis.ttf` is used before movement and `MetaAccanthisAlternate.ttf` afterwards. Embedded poster text remains part of its image. About contains the artist’s translated statement.

## Validation and deployment

Unit tests cover color separation and pixel ownership, input/noise thresholds, body-region measurements, rest gating, finite physics, suspension, collision recovery, dragging, path history and cumulative travel. Browser tests cover crop geometry and mobile pointer selection, automatic desktop body tracking, no-motion stability, node/data toggles, moving camera/+ controls, pause, JPG/PDF export, PDF import and mobile sensor selection/input. Development-browser checks also verify exact sprite reconstruction, transparent residual background, recursive fracture with conserved area/source coordinates, and paths below pieces.

Deterministic gesture cases replace the tracker’s SDK response in the test browser. A separate case runs the **real self-hosted Holistic model** on the public person-image fixture in `test-fixtures/`. These checks do not replace a test with the exhibition camera, mobile sensors and lighting on site.

Vercel is connected to `yeonjoo-kim/DistortedPosterMap`, branch `main`; `vercel.json` runs `npm run build` and serves `dist`. Pushing main triggers the connected deployment. Local changes and passing tests do not publish the live website.

https://distortedpostermap.vercel.app/
