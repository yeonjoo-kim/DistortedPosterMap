import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const port = 4175;
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    ...(process.env.SMOKE_PRODUCTION === '1' ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverOutput = '';
server.stdout.on('data', (data) => {
  serverOutput += data;
});
server.stderr.on('data', (data) => {
  serverOutput += data;
});
let browser;
const errors = [];
const results = [];
const record = (text) => {
  results.push(text);
  console.log(`PASS ${text}`);
};
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {
      /* Await local server startup. */
    }
    if (server.exitCode != null) throw new Error(serverOutput);
    if (i === 59) throw new Error(`Server not ready: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await mkdir('test-results', { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__audioContexts = [];
    window.__analysers = [];
    window.__trackingText = [];
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      constructor(...args) {
        super(...args);
        window.__audioContexts.push(this);
      }
      createAnalyser() {
        const node = super.createAnalyser();
        node.smoothingTimeConstant = 0;
        window.__analysers.push(node);
        return node;
      }
    };
    const text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      if (
        /^(E\d|dX|L )/.test(String(value)) &&
        window.__trackingText.length < 2000
      )
        window.__trackingText.push({ value: String(value), font: this.font });
      return text.call(this, value, ...args);
    };
  });
  const base = `http://127.0.0.1:${port}`;
  const click = async (name, target = page) => {
    const button = target.getByRole('button', { name, exact: true });
    await button.hover({ force: true });
    await button.click({ force: true });
  };
  const choose = async (name, target = page) =>
    target.getByRole('menuitem', { name, exact: true }).click({ force: true });
  async function open(name, target = page) {
    await target.keyboard.press('Escape');
    await click(name, target);
  }
  async function map(target = page) {
    await open('Download', target);
    const pending = target.waitForEvent('download');
    await choose('Coordinates & paths · JSON', target);
    return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  }
  async function upload(
    buffer,
    name = 'fixture.png',
    mimeType = 'image/png',
    target = page,
  ) {
    await target
      .getByLabel('Poster file', { exact: true })
      .setInputFiles({ name, mimeType, buffer });
    await target.waitForFunction(
      () =>
        document.querySelector('.paper')?.getAttribute('aria-busy') === 'false',
    );
    await target.getByLabel('Distorted poster', { exact: true }).waitFor();
    assert.equal(await target.getByRole('dialog').count(), 0);
  }
  async function sensor(x, y = 0, z = 0) {
    await page.evaluate(
      ({ x, y, z }) =>
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            acceleration: { x, y, z },
            accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 },
            interval: 50,
          }),
        ),
      { x, y, z },
    );
    await page.waitForTimeout(65);
  }
  async function spectrum() {
    return page.evaluate(() => {
      const analyser = window.__analysers[0];
      if (!analyser) return { rms: 0, power: 0, centroid: 0 };
      const values = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(values);
      let power = 0,
        weighted = 0;
      for (let i = 1; i < values.length; i++) {
        const p = 10 ** (values[i] / 10);
        power += p;
        weighted += (p * i * analyser.context.sampleRate) / analyser.fftSize;
      }
      const wave = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(wave);
      return {
        power,
        centroid: weighted / Math.max(power, 1e-12),
        rms: Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0) / wave.length),
      };
    });
  }
  await page.goto(base);
  await page
    .getByRole('button', { name: 'Upload poster', exact: true })
    .waitFor();
  await page.evaluate(() =>
    Promise.all([
      document.fonts.load('20px MetaAccanthis'),
      document.fonts.load('20px MetaAccanthisAlternate'),
    ]),
  );
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.getByRole('slider').count(), 0);
  assert(!/[가-힣]/.test(await page.locator('body').innerText()));
  assert(
    (
      await page
        .locator('.wordmark')
        .evaluate((el) => getComputedStyle(el).fontFamily)
    ).includes('MetaAccanthis'),
  );
  await page.screenshot({ path: 'test-results/home.png' });
  record(
    'English interface loads the supplied font without extra startup dialogs',
  );
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = '#222';
    ctx.fillRect(30, 30, 120, 70);
    ctx.fillRect(210, 140, 140, 85);
    ctx.fillStyle = '#ed552f';
    ctx.beginPath();
    ctx.arc(140, 350, 65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.font = '32px Arial';
    ctx.fillText('HELLO POSTER', 30, 520);
    return {
      png: c.toDataURL('image/png').split(',')[1],
      jpg: c.toDataURL('image/jpeg').split(',')[1],
    };
  });
  const png = Buffer.from(image.png, 'base64');
  await upload(png);
  assert.equal(
    await page.locator('.tracking-stats,.tracking-key,.tracking-units').count(),
    0,
  );
  assert.equal(await page.locator('.coordinate output').count(), 4);
  const initial = await map();
  assert(initial.settings.showPaths && initial.settings.showLabels);
  assert(initial.elements.length >= 4);
  assert(new Set(initial.elements.map((e) => e.trailColor)).size > 2);
  assert(initial.elements.every((e) => /^rgb\(/.test(e.trailColor)));
  record(
    'The highlighted panel statistics and legends are removed; four poster coordinates remain',
  );
  const panel = page.getByRole('region', { name: 'Poster panel', exact: true });
  const beforeDrag = await panel.boundingBox(),
    grip = await page
      .getByRole('button', { name: 'Move panel', exact: true })
      .boundingBox();
  await page.mouse.move(grip.x + 35, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x - 180, grip.y - 95, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterDrag = await panel.boundingBox();
  assert(afterDrag.x < beforeDrag.x - 150 && afterDrag.y < beforeDrag.y - 60);
  await page.getByRole('button', { name: 'Move panel', exact: true }).focus();
  const keyboardBefore = await panel.boundingBox();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(80);
  assert((await panel.boundingBox()).x > keyboardBefore.x + 30);
  await page.mouse.move(10, 10);
  const placedPanel = await panel.boundingBox();
  record(
    'Mouse dragging and arrow keys reposition the panel within the viewport',
  );
  await page.screenshot({ path: 'test-results/desktop.png' });
  await click('About');
  await page.getByRole('dialog', { name: 'About', exact: true }).waitFor();
  assert(
    (await page.getByRole('dialog').innerText()).includes(
      'not your body or the laptop',
    ),
  );
  await page.keyboard.press('Escape');
  record(
    'About explains that trails measure poster piece centers in poster pixels',
  );
  await open('Motion input');
  await choose('Device motion sensor');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'unavailable',
    undefined,
    { timeout: 6500 },
  );
  assert(
    (await page.locator('.connection-detail').textContent()).includes(
      'No acceleration data',
    ),
  );
  await choose('Device motion sensor');
  await page.waitForFunction(() =>
    document
      .querySelector('.connection-detail')
      ?.textContent.includes('actual acceleration'),
  );
  await sensor(0);
  await sensor(0);
  await sensor(1);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'connected',
  );
  await page.keyboard.press('Escape');
  assert((await map()).elements.every((e) => Math.hypot(e.dx, e.dy) < 0.01));
  record(
    'A device sensor is connected only after two actual samples, with no motion at zero',
  );
  await page.evaluate(() => {
    window.__trackingText = [];
  });
  for (let i = 0; i < 6; i++) await sensor(2.6, -0.6);
  const softSpectrum = await spectrum(),
    soft = await map();
  assert(soft.elements.some((e) => Math.hypot(e.dx, e.dy) > 4));
  assert(soft.elements.every((e) => e.kind !== 'fragment'));
  const panelAfterMotion = await panel.boundingBox();
  assert(
    Math.abs(panelAfterMotion.x - placedPanel.x) < 1 &&
      Math.abs(panelAfterMotion.y - placedPanel.y) < 1,
  );
  assert(
    (
      await page
        .locator('.coordinate output')
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily)
    ).includes('MetaAccanthisAlternate'),
  );
  assert(
    await page.evaluate(() =>
      window.__trackingText.some((line) =>
        line.font.includes('MetaAccanthisAlternate'),
      ),
    ),
  );
  record(
    'Motion switches both UI numbers and canvas annotations to the alternate supplied font',
  );
  await click('Pause motion');
  await page.waitForTimeout(350);
  const paused = await map();
  await sensor(18, -15, 2);
  await page.waitForTimeout(200);
  const still = await map();
  assert.deepEqual(
    paused.elements.map((e) => [e.x, e.y, e.rotation, e.distance]),
    still.elements.map((e) => [e.x, e.y, e.rotation, e.distance]),
  );
  assert((await spectrum()).rms < 1e-5);
  const positionsBeforeWheel = await page
    .locator('.wordmark,.about-button,.mapping-panel')
    .evaluateAll((nodes) =>
      nodes.map((el) => {
        const box = el.getBoundingClientRect();
        return [box.x, box.y];
      }),
    );
  await page.mouse.wheel(0, 1800);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    ),
    false,
  );
  assert.deepEqual(
    await page
      .locator('.wordmark,.about-button,.mapping-panel')
      .evaluateAll((nodes) =>
        nodes.map((el) => {
          const box = el.getBoundingClientRect();
          return [box.x, box.y];
        }),
      ),
    positionsBeforeWheel,
  );
  record(
    'Pause freezes poster position, rotation, accumulated distance and audio, and wheel scrolling moves nothing',
  );
  await click('Resume motion');
  for (let i = 0; i < 12; i++) await sensor(i % 2 ? 15 : -15, 8);
  const hardSpectrum = await spectrum();
  assert(hardSpectrum.power > softSpectrum.power);
  assert(
    hardSpectrum.centroid > softSpectrum.centroid * 1.3,
    JSON.stringify({ softSpectrum, hardSpectrum }),
  );
  let broken;
  for (let i = 0; i < 8; i++) {
    broken = await map();
    if (broken.elements.some((e) => e.kind === 'fragment')) break;
    await sensor(18, 10);
    await page.waitForTimeout(150);
  }
  assert(broken.elements.some((e) => e.kind === 'fragment'));
  assert(broken.completedTrails.length > 0);
  assert(
    broken.elements.every(
      (e) => Number.isFinite(e.distance) && e.deformationVertices.length === 18,
    ),
  );
  const colors = new Map(broken.elements.map((e) => [e.id, e.trailColor]));
  const again = await map();
  assert(
    again.elements
      .filter((e) => colors.has(e.id))
      .every((e) => colors.get(e.id) === e.trailColor),
  );
  record(
    'Stronger input creates fragments, louder/brighter sound and stable saturated RGB trails',
  );
  await click('Show paths and numbers');
  assert.equal(
    await page
      .getByRole('button', { name: 'Show paths and numbers', exact: true })
      .getAttribute('aria-pressed'),
    'false',
  );
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    window.__trackingText = [];
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__trackingText.length), 0);
  await click('Show paths and numbers');
  await click('Pause motion');
  await page.screenshot({ path: 'test-results/fractured.png' });
  for (const format of ['PNG', 'JPG', 'PDF']) {
    await open('Download');
    const pending = page.waitForEvent('download');
    await choose(format);
    const bytes = await readFile(await (await pending).path());
    assert(bytes.length > 1000);
    if (format === 'PNG') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    if (format === 'JPG')
      assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    record(`${format} exports the current poster and path overlay`);
  }
  await upload(Buffer.from(image.jpg, 'base64'), 'fixture.jpg', 'image/jpeg');
  assert((await map()).elements.length >= 4);
  const pdf = new jsPDF({ unit: 'pt', format: [400, 600] });
  pdf.setFontSize(32);
  pdf.text('NATIVE PDF TEXT', 30, 70);
  pdf.setFillColor(237, 85, 47);
  pdf.rect(70, 200, 150, 150, 'F');
  pdf.addPage();
  pdf.text('SECOND PAGE', 30, 70);
  await upload(
    Buffer.from(pdf.output('arraybuffer')),
    'fixture.pdf',
    'application/pdf',
  );
  const pdfMap = await map();
  assert(
    pdfMap.elements.some(
      (e) => e.kind === 'text' && e.label.includes('NATIVE PDF TEXT'),
    ),
  );
  await upload(Buffer.from('broken'), 'bad.pdf', 'application/pdf');
  await page.getByRole('alert').waitFor();
  assert(!/[가-힣]/.test(await page.getByRole('alert').textContent()));
  await click('Dismiss message');
  assert.equal((await map()).extraction, pdfMap.extraction);
  record(
    'JPG, native-text PDF and invalid uploads keep working with English feedback',
  );

  // Camera lifecycle + optical flow, independent of the human tracker.
  async function fakeCamera(target, photo = null) {
    await target.addInitScript((photo) => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints) => {
          window.__cameraConstraints = constraints;
          const c = document.createElement('canvas');
          c.width = 640;
          c.height = 480;
          const ctx = c.getContext('2d');
          let image = null;
          if (photo) {
            image = new Image();
            image.src = photo;
            await image.decode();
          }
          const pattern = document.createElement('canvas');
          pattern.width = 900;
          pattern.height = 480;
          const p = pattern.getContext('2d');
          let seed = 19371;
          for (let y = 0; y < 480; y += 8)
            for (let x = 0; x < 900; x += 8) {
              seed = (seed * 16807) % 2147483647;
              const v = (seed % 230) + 10;
              p.fillStyle = `rgb(${v},${v},${v})`;
              p.fillRect(x, y, 8, 8);
            }
          let offset = 0;
          const draw = () => {
            if (image) ctx.drawImage(image, 0, 0, 640, 480);
            else {
              if (window.__cameraMove) offset = (offset + 7) % 200;
              ctx.drawImage(pattern, offset, 0, 640, 480, 0, 0, 640, 480);
            }
          };
          draw();
          const stream = c.captureStream(15);
          window.__cameraStream = stream;
          setInterval(draw, 60);
          return stream;
        },
      });
    }, photo);
  }
  const camera = await context.newPage();
  camera.on('pageerror', (error) => errors.push(error.message));
  await fakeCamera(camera);
  await camera.goto(base);
  await upload(png, 'fixture.png', 'image/png', camera);
  assert.equal(
    await camera.evaluate(() => !!window.__cameraConstraints),
    false,
  );
  await open('Motion input', camera);
  await choose('Camera movement · optical flow', camera);
  await camera.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'connected',
  );
  await camera.keyboard.press('Escape');
  await camera.evaluate(() => {
    window.__cameraMove = true;
  });
  await camera.waitForTimeout(1000);
  const cameraData = await map(camera);
  assert.equal(cameraData.input.source, 'camera');
  assert(cameraData.elements.some((e) => Math.hypot(e.dx, e.dy) > 2));
  assert.equal(
    await camera.evaluate(() => window.__cameraConstraints.audio),
    false,
  );
  await open('Motion input', camera);
  await choose('Stop tracking', camera);
  assert.equal(
    await camera.evaluate(
      () => window.__cameraStream.getVideoTracks()[0].readyState,
    ),
    'ended',
  );
  await camera.close();
  record(
    'Optical flow is still available and stopping it releases the camera without a microphone',
  );

  // Deterministic node samples test the complete input-to-physics mapping.
  const bodyPage = await context.newPage();
  bodyPage.on('pageerror', (error) => errors.push(error.message));
  await fakeCamera(bodyPage);
  await bodyPage.route('**/tracking/holistic.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    window.Holistic=class {
      constructor(){this.sign=1;} setOptions(){} async initialize(){} onResults(fn){this.callback=fn;}
      async send(){if(window.__bodyFail)throw new Error("Simulated tracking failure");this.sign*=-1;const pose=Array.from({length:33},()=>({x:.5,y:.3,visibility:0}));for(const[id,x,y]of [[0,.5,.2],[7,.46,.22],[8,.54,.22],[11,.4,.35],[12,.6,.35],[13,.3,.45],[14,.7,.45],[15,.2,.55],[16,.8,.55],[23,.44,.6],[24,.56,.6],[25,.44,.75],[26,.56,.75],[27,.44,.93],[28,.56,.93]])pose[id]={x,y,visibility:.95};const amp=window.__bodyAmplitude||0;pose[15].y+=this.sign*amp;pose[16].y-=this.sign*amp;
      const face=Array.from({length:478},()=>({x:.5,y:.23,visibility:0}));for(const[id,x,y]of [[10,.5,.17],[152,.5,.3],[234,.45,.23],[454,.55,.23],[33,.46,.21],[133,.49,.21],[159,.475,.205],[145,.475,.215],[263,.54,.21],[362,.51,.21],[386,.525,.205],[374,.525,.215],[468,.475,.21],[473,.525,.21],[1,.5,.23],[2,.5,.24],[4,.5,.232],[5,.5,.225],[98,.49,.24],[327,.51,.24],[13,.5,.26],[14,.5,.27],[61,.48,.265],[291,.52,.265],[78,.485,.265],[308,.515,.265]])face[id]={x,y,visibility:.95};
      const hand=base=>Array.from({length:21},(_,i)=>({x:base+(i%4)*.008,y:.55-Math.floor(i/4)*.012,visibility:.95}));this.callback({poseLandmarks:pose,faceLandmarks:face,leftHandLandmarks:hand(.2),rightHandLandmarks:hand(.76)});}
      async close(){window.__modelClosed=true;}
    };`,
    }),
  );
  await bodyPage.goto(base);
  await upload(png, 'fixture.png', 'image/png', bodyPage);
  await open('Motion input', bodyPage);
  await choose('Body nodes · fixed camera', bodyPage);
  await bodyPage.keyboard.press('Escape');
  await bodyPage.waitForFunction(
    () => document.querySelectorAll('.node-overlay circle').length > 60,
  );
  assert.equal(await bodyPage.locator('[data-detected=true]').count(), 9);
  assert(
    (await map(bodyPage)).elements.every((e) => Math.hypot(e.dx, e.dy) < 0.01),
  );
  await bodyPage.evaluate(() => {
    window.__bodyAmplitude = 0.02;
  });
  await bodyPage.waitForFunction(
    () =>
      document.querySelector('[aria-label="Poster response"]')?.textContent ===
      'MOVE',
  );
  const gentleBody = await map(bodyPage);
  assert.equal(gentleBody.input.source, 'body');
  assert(
    gentleBody.input.body.parts.some(
      (p) => p.part === 'Arms' && p.strength > 0,
    ),
  );
  await bodyPage.evaluate(() => {
    window.__bodyAmplitude = 0.06;
  });
  await bodyPage.waitForFunction(
    () =>
      document.querySelector('[aria-label="Poster response"]')?.textContent ===
      'BEND',
  );
  const bending = await map(bodyPage);
  assert.equal(bending.elements.filter((e) => e.kind === 'fragment').length, 0);
  await bodyPage.evaluate(() => {
    window.__bodyAmplitude = 0.2;
  });
  let bodyMap;
  for (let i = 0; i < 12; i++) {
    await bodyPage.waitForTimeout(200);
    bodyMap = await map(bodyPage);
    if (
      bodyMap.fractures > 0 ||
      bodyMap.elements.some((e) => e.kind === 'fragment')
    )
      break;
  }
  assert(bodyMap.elements.some((e) => e.kind === 'fragment'));
  assert(bodyMap.input.body.effect === 'BREAK ON IMPACT');
  await click('Pause motion', bodyPage);
  const frozen = await map(bodyPage);
  await bodyPage.waitForTimeout(350);
  const frozenAgain = await map(bodyPage);
  assert.deepEqual(
    frozen.elements.map((e) => [e.x, e.y, e.distance]),
    frozenAgain.elements.map((e) => [e.x, e.y, e.distance]),
  );
  assert(
    (await bodyPage.locator('.causal-readout').innerText()).includes('PAUSED'),
  );
  await bodyPage.screenshot({ path: 'test-results/body-nodes.png' });
  await bodyPage.setViewportSize({ width: 1280, height: 720 });
  const compactPreview = await bodyPage.locator('.input-preview').boundingBox();
  const compactTitle = await bodyPage.locator('.wordmark').boundingBox();
  assert(compactPreview.x + compactPreview.width < compactTitle.x);
  assert(compactPreview.y + compactPreview.height <= 720);
  await click('About', bodyPage);
  await bodyPage.getByRole('dialog', { name: 'About', exact: true }).waitFor();
  await bodyPage.keyboard.press('Escape');
  await bodyPage.screenshot({ path: 'test-results/short-exhibition.png' });
  record(
    'Short desktop viewports keep the tracking preview clear of the title and About',
  );
  await bodyPage.evaluate(() => {
    window.__bodyFail = true;
  });
  await bodyPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'unavailable',
  );
  assert.equal(
    await bodyPage.locator('.causal-readout strong').textContent(),
    '0%',
  );
  assert.equal(await bodyPage.locator('.node-overlay circle').count(), 0);
  assert.equal(
    await bodyPage.evaluate(
      () => window.__cameraStream.getVideoTracks()[0].readyState,
    ),
    'ended',
  );
  record(
    'Tracking failures clear stale nodes and movement values and release the camera',
  );
  await open('Motion input', bodyPage);
  await choose('Stop tracking', bodyPage);
  assert.equal(
    await bodyPage.evaluate(
      () => window.__cameraStream.getVideoTracks()[0].readyState,
    ),
    'ended',
  );
  await bodyPage.waitForFunction(() => window.__modelClosed === true);
  await bodyPage.close();
  record(
    'Simulated full-body, hand and face nodes produce MOVE, BEND and collision fractures; pause and cleanup hold',
  );

  // Real local model inference, separate from the deterministic node simulation.
  const real = await context.newPage();
  real.on('pageerror', (error) => errors.push(error.message));
  await fakeCamera(
    real,
    'data:image/jpeg;base64,' +
      (await readFile('test-fixtures/pose.jpg')).toString('base64'),
  );
  await real.goto(base);
  await upload(png, 'fixture.png', 'image/png', real);
  await open('Motion input', real);
  await choose('Body nodes · fixed camera', real);
  await real.keyboard.press('Escape');
  await real.waitForFunction(
    () => document.querySelectorAll('[data-detected=true]').length === 9,
    undefined,
    { timeout: 120000 },
  );
  const regions = await real
    .locator('[data-detected=true]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.part));
  assert(regions.includes('Arms') && regions.includes('Head'));
  assert.equal(regions.length, 9);
  console.log('Real model detected:', regions.join(', '));
  await real.screenshot({ path: 'test-results/holistic-real.png' });
  await open('Motion input', real);
  await choose('Stop tracking', real);
  assert.equal(
    await real.evaluate(
      () => window.__cameraStream.getVideoTracks()[0].readyState,
    ),
    'ended',
  );
  await real.close();
  record(
    'The real self-hosted Holistic model detects nodes on an actual person image',
  );

  const denied = await context.newPage();
  await denied.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    }),
  );
  await denied.goto(base);
  await upload(png, 'fixture.png', 'image/png', denied);
  await open('Motion input', denied);
  await choose('Body nodes · fixed camera', denied);
  await denied.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'denied',
  );
  assert(
    (await denied.locator('.connection-detail').textContent()).includes(
      'permission denied',
    ),
  );
  await denied.close();
  record(
    'Denied camera permission is shown clearly without pretending nodes are connected',
  );

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(base);
  await upload(png, 'fixture.png', 'image/png', mobile);
  const mobilePanel = mobile.getByRole('region', {
      name: 'Poster panel',
      exact: true,
    }),
    touchBefore = await mobilePanel.boundingBox();
  const session = await mobileContext.newCDPSession(mobile),
    start = { x: touchBefore.x + 60, y: touchBefore.y + 70 };
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y, id: 1 }],
  });
  for (let i = 1; i <= 8; i++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x - i * 6, y: start.y - i * 14, id: 1 }],
    });
    await mobile.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await mobile.waitForTimeout(100);
  const touchAfter = await mobilePanel.boundingBox();
  assert(touchAfter.y < touchBefore.y - 80);
  assert(touchAfter.x >= 0 && touchAfter.y >= 0);
  assert.equal(await mobile.evaluate(() => scrollY), 0);
  assert.equal(
    await mobile.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
    false,
  );
  await mobile.screenshot({ path: 'test-results/mobile.png' });
  await mobileContext.close();
  record(
    'Touch dragging moves the panel on mobile without scrolling or overflowing the page',
  );
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log(`\n${results.length} browser checks passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
