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

1. Upload a PDF, JPG or PNG, up to 50 MB. PDFs use their first page. Before requesting camera access, a **Crop poster** dialog lets you select any aspect ratio, move the selection, resize its corners, or use arrow keys to move it and Shift+arrow keys to resize it. Only **Cancel** and **Use crop** appear; **Cancel** leaves the previous poster in place.
2. After **Use crop**, desktops start **Body nodes** automatically. Phones and tablets first offer **Body nodes · camera** or **Device motion sensor**. Sensor permission is requested from that button gesture. The panel’s **Motion input** menu can switch between these modes or stop tracking.
3. For body input, allow camera access and keep the camera fixed with the performer’s face, hands and body visible. The local model needs WebAssembly and WebGL. The first detected frames establish a baseline for 800 ms. At least two consecutive measured body samples of 12% or more release the initial poster. Zero input, missing landmarks and sensor noise do not release it.
4. The translucent panel has six controls: **Path**, **Data**, **Download**, Pause/Play, **Setting** (activity icon), and the circular **+** new-poster button. Paths and Data default to OFF. **Path** shows black trajectories. **Data** instead unfolds body-part percentages above the controls, enables the camera’s node overlay, and shows routes colored by the body region that caused movement. Clicking an active Path/Data button turns that mode off. The modes are mutually exclusive.
5. The camera is a fixed **16:9** video-only frame, with no status messages or numbers. Its overlay contains only colored nodes/links when Data is ON. Natural camera proportions are preserved with letterboxing; nodes use the same fit. Sensor mode hides the video frame. Tracking continues with Data OFF.
6. **Setting → Motion detection** contains exactly **Body Nodes** and **Device Motion Sensor**. Sound ON/OFF is in the parent Setting menu. Pause freezes physics, trails and sound while tracking stays live. **+** opens the file picker to choose a new poster and then the crop dialog. Confirming the crop replaces the poster with Path/Data OFF. The Setting menu does not contain a Change poster item.
7. Drag any non-button panel area with a mouse or touch. Releasing the pointer immediately ends the drag and leaves the panel there; no second click is needed. Arrow keys with the panel focused move it (Shift moves faster). Unplaced controls and all four tapes move/rotate with the performance; a manually placed panel stays where released until a new upload or viewport resize.
8. **Download** offers arena JPG/raster PDF and **Separate PNGs · ZIP**. The ZIP contains one tightly cropped transparent PNG per current visible poster piece, retaining its current bend, compression and rotation. It excludes paths, controls and tapes. A ZIP avoids browser multiple-download blocking. Arena exports use the current black/colored path mode and include pieces outside the original paper. Browser checks validate ZIP compatibility/CRCs with Python 3’s standard `zipfile` module.


The page itself cannot scroll. Crop/About dialogs and the input menu can scroll internally on short screens. Real camera accuracy depends on lighting, distance, occlusion, framing and GPU/browser performance. Tracking is local, handles one performer and does not identify people. The microphone is never requested; video is not recorded or uploaded. Stopping tracking, hiding the page or unmounting releases the camera and inference instance.

## Extraction and motion

The long image edge is rendered at up to 1,200 pixels. Color/edge analysis runs at up to 640 pixels: a small weighted color palette simplifies texture, then connected regions follow the visible color boundaries and cutouts. Only neighboring regions merge when simplifying noise or very complex images. A large continuous background remains one shape, with holes for its foreground elements; no regular grid or equal-area tiles are added. All sprites, including backgrounds, can later break and retain source-resolution colors and alpha. There is no stationary colored paper underneath. This approximates Pathfinder’s Divide appearance using raster color masks; it does not reconstruct hidden SVG paths, recognize objects semantically or perform OCR. Same-color touching elements and very fine details may merge.

All pieces remain fixed until the first measured gesture passes the startup gate. Once released, they move across the viewport with **zero gravity**, low air resistance, elastic boundary collisions and a weak circulating current. Small movements do not cause new fracture. Broad measured input above 80% must coincide with vigorous **actual piece translation or rotation** to accumulate edge fatigue. Local facial expressions and fingertip articulation can move/bend pieces without enabling chipping. Fatigue decays at rest and during slower input.

Once fatigue builds, a small occupied edge/corner chips off (about 1.5–18% of visible pixels, preferring 6%), leaving the main shape intact. Sampling the alpha mask finds real occupied edges on irregular/previously broken pieces. Both the remaining core and its chips can keep shedding smaller pieces during vigorous movement; ancestry depth no longer stops a large core from chipping. At most one chip event occurs per 1.25 seconds. Minimum visible area/dimensions and a 650-piece budget limit tiny debris. Tapes are separate unbreakable physical interface bodies and roll with the same input.

Paths, displacement guides and coordinate annotations are drawn **before** all poster pieces. DOM interface controls sit above the arena. Data-mode route segments retain the color of the body region that drove them; sensor input falls back to stable per-piece saturated RGB colors. Path mode overrides all routes/guides to black. Parent trails remain with a cross at the split, and children inherit cumulative travel. Old samples are thinned during long performances, retaining the start and recent route.

The panel omits coordinate readouts and generic input/status messages. In path annotations, X/Y is the current center, dX/dY the displacement from the original center, L accumulated center travel, R rotation in degrees and W bend amplitude. Units are analyzed poster pixels with the original poster’s top-left as (0,0); negative coordinates are valid. Numeric annotations prioritize widely traveled pieces and avoid interface bodies/other cards.

The supplied `MetaAccanthis.ttf` is used before movement and `MetaAccanthisAlternate.ttf` afterwards. Embedded poster text remains part of its image. About contains the artist’s translated statement.

## Validation and deployment

Unit tests cover color separation and pixel ownership, input/noise thresholds, body-region measurements, rest gating, finite physics, suspension, collision recovery, dragging, path history and cumulative travel. Browser tests cover crop geometry and mobile pointer selection, automatic desktop body tracking, no-motion stability, Path/Data modes, video-only 16:9 preview with aligned nodes, six translucent-panel controls, exact two-option motion menu, black/body-colored path switching, rolling tapes, pause, JPG/PDF export, PDF import and mobile sensor selection/input. Development-browser checks also verify exact sprite reconstruction, transparent residual background, progressive edge chipping with a large remaining core and conserved area/source coordinates, transparent per-piece snapshots, and paths below pieces.

Deterministic gesture cases replace the tracker’s SDK response in the test browser. A separate case runs the **real self-hosted Holistic model** on the public person-image fixture in `test-fixtures/`. These checks do not replace a test with the exhibition camera, mobile sensors and lighting on site.

Vercel is connected to `yeonjoo-kim/DistortedPosterMap`, branch `main`; `vercel.json` runs `npm run build` and serves `dist`. Pushing main triggers the connected deployment. Local changes and passing tests do not publish the live website.

https://distortedpostermap.vercel.app/
