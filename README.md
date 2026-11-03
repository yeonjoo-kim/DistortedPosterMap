# Poster Distorting Map

An installation instrument that separates an uploaded poster into pieces and drives their motion, deformation, collision and fracture from body landmarks or device movement. Images and camera frames stay on the viewer's device.

## Run

Use Node.js 24 and npm. No server, database, API key or secret is required.

```sh
npm ci --cache /workspace/.cache/npm --no-audit --no-fund
npm run dev -- --port 5173
```

The cache flag can be omitted outside the cloud workspace. `predev`, `prebuild` and `pretest:browser` run `scripts/prepare-tracking.mjs`. It copies the SDK, WASM and models unchanged from the pinned official `@mediapipe/holistic` package into the ignored `public/tracking/` directory. Browser inference uses these same-origin files, with no external inference service or runtime CDN.

```sh
npm test
npm run build
SMOKE_PRODUCTION=1 npm run test:browser
npm run preview
```

Browser tests use `/usr/bin/chromium` or `CHROMIUM_PATH`, start their own server on port 4175, and stop it afterwards. Software WebGL flags allow the real local model to run in headless Chromium. Screenshots are saved to the ignored `test-results/` directory.

## Exhibition setup

1. Upload a PDF, JPG or PNG poster, up to 50 MB. PDF import uses the first page. Upload does not automatically request camera access or open a camera dialog.
2. Open **Motion input** in the green panel and choose **Body nodes · fixed camera**. Allow browser and operating-system camera access. The first start downloads approximately 30 MB of tracking assets from this website and initializes the local model.
3. Keep the exhibition camera fixed and the performer well lit. Keep the face, hands and body in view. Use **Expand tracking view** to inspect nodes. Body, face and hand tracking requires a modern browser with WebAssembly and WebGL/hardware acceleration.
4. Nodes cover the head, torso, arms, legs, hands, individual finger joints/tips, eyes, nose and mouth. Colored part badges show detected/missing regions and their normalized movement percentages. Missing or occluded regions do not generate substitute movement.
5. The strongest active region, its percentage and the resulting poster response appear together. Motion below 8% is filtered out. At 8–34%, pieces move; at 35–64%, deformation and collisions become stronger; at 65% or more, body input enables fracture **when a piece collides**. A gesture does not split every piece immediately. A brief **FRACTURED** response confirms an actual split. Fragment counts are measured from the simulation.
6. **Pause motion** freezes the simulation, accumulated distances and sound. Live camera nodes keep running so input can be inspected without changing the poster. **Resume motion** continues from that state.
7. Drag the green **panel** by its grip or any non-button area with a mouse or touch. Arrow keys on the grip move it by 10 screen pixels; Shift moves by 40. Movement stays within the viewport. Hovering/interacting holds the panel so its buttons remain usable. After a drag or keyboard move it stays where placed for the current layout. A new upload or viewport resize restores its layout position. The camera preview is separate from the panel.
8. The page cannot scroll. The About dialog and input menu may scroll internally on very short screens; this does not move the underlying page, title or panel.

Camera tracking is local and processes one performer. It does not identify a person. Fine finger and facial tracking needs more image detail than large arm/leg gestures. Distance, lighting, occlusion, multiple overlapping people and browser/GPU performance affect accuracy. Input percentages measure normalized landmark speed, not physical centimeters or a medical measurement. Facial and fingertip motion uses face/hand-relative proportions; large body regions use body-relative scale.

## Other input modes

- **Camera movement · optical flow** keeps the previous whole-scene movement estimate for moving laptops/cameras. Use a textured, stationary background. Moving people or backgrounds can also trigger this mode. It does not assign anatomical nodes.
- **Device motion sensor** uses real `DeviceMotionEvent` acceleration when the browser exposes it. It reports connected only after two numeric samples and distinguishes unavailable data, denied permission and stale signals. A 2020 M1 MacBook Pro may not expose accelerometer data to the browser.
- Camera-motion/device-sensor input retains a 50% fracture threshold, shown in its response scale. Both modes use the same 8% rest gate and simulation.
- Switching modes, stopping tracking, hiding the page or unmounting releases camera tracks. The body inference instance is closed after any in-flight frame completes. The microphone is never requested. Video is neither recorded nor uploaded.

## Panel, typography and paths

The green **Poster panel** retains four readouts: Position X/Y and Offset X/Y, plus paths toggle, Download, Pause/Resume, Motion input and Sound. The former mean-distance/maximum-bend row, legend and explanatory text highlighted in the requested screenshot are removed. The explanation is available in **About** instead.

Every generated interface string is English. The user-provided `MetaAccanthis.ttf` is used before movement and `MetaAccanthisAlternate.ttf` after the first deformation, including UI numbers and canvas annotations. A new upload restores the initial font. Text already embedded in an uploaded poster remains part of its original image.

**Trails describe poster pieces, not the performer's body or laptop.**

- X/Y: the piece center's current coordinates.
- dX/dY: displacement from its original center.
- L: cumulative center travel, sampled every physics step independently of drawing density.
- R: rotation in degrees.
- W: horizontal bend amplitude.

The origin is the original poster's top-left. Position and distance units are pixels of the analyzed poster, not screen pixels or physical-world distances. Panel coordinates are the area-weighted center/offset of all pieces. Negative coordinates are valid after pieces leave the original paper.

Each piece receives a randomly assigned saturated RGB trail color that remains stable while it moves. New fragments get their own colors. Parent trails are retained, and a cross marks the split position. Fragments inherit accumulated parent travel and record their own route from birth. Older route samples are thinned for long performances while retaining the start and recent details. Numeric cards prioritize up to 12 widely traveled pieces (6 on small screens) and avoid overlapping UI/other cards; all elements remain in the JSON map.

The baseline damp-clay physics mixes gravity, collision squash/recovery, low-amplitude zigzag bending and triangular fracture. `MATERIAL_MIX` stays at zigzag 0.2 / fracture 0.8 as response weights, not a literal count/pixel ratio. Poster pieces can move across the entire viewport. The title, About and panel remain unbreakable physical bodies.

## Import and export

Connected pixel regions and native PDF text regions are separated automatically. Complex images may use tiles. This is not semantic AI object segmentation or OCR; overlapping elements can merge. The long image edge is analyzed at up to 1,200 pixels. Unseparated pixels remain on the paper background.

PNG/JPG/image-based PDF exports capture the current poster arena, including pieces outside the paper. UI is excluded. Path/number overlays follow the ON/OFF toggle. JSON always retains all original/current positions, distances, deformation vertices, parent trails, stable trail colors and the latest applied input data. Camera observations may continue while paused, but do not alter that applied-input record. PDF export is raster, and 2× output is enlargement rather than vector reconstruction. Refreshing resets the session.

## Validation and deployment

Unit tests cover region separation, input/noise thresholds, anatomical-region measurements, exact reaction boundaries, RGB saturation, body-only fracture gating, dragging while paused, path history and cumulative travel. Browser tests exercise mouse and touch dragging, page scroll prevention, English text/fonts/numbers, pause/resume/audio, synthetic acceleration, optical flow, deterministic full landmark sequences and their MOVE/BEND/fracture results, permissions/cleanup and image/PDF/JSON exports.

A separate browser case runs the **real self-hosted Holistic model** on the public TensorFlow.js person-image fixture. Deterministic body-gesture cases replace only the SDK response in the test browser; they are not tests of real human performance. The user's actual exhibition camera/computer has not been tested from this cloud environment. Validate lighting, framing, permissions and performance on-site before opening the exhibition.

Vercel is connected to `yeonjoo-kim/DistortedPosterMap`, branch `main`. `vercel.json` specifies Vite, `npm run build` and `dist`. Pushing main triggers the connected deployment.

https://distortedpostermap.vercel.app/
