import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const production = process.env.SMOKE_PRODUCTION === '1';
const port = 4175, base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(production ? ['preview'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser;
server.stdout.on('data', (s) => { output += s; });
server.stderr.on('data', (s) => { output += s; });
const errors = [], record = (text) => console.log(`PASS ${text}`);
async function fakeCamera(page, real = false) {
  const photo = real ? 'data:image/jpeg;base64,' + (await readFile('test-fixtures/pose.jpg')).toString('base64') : null;
  await page.addInitScript((photo) => {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__constraints = constraints;
      const c = document.createElement('canvas'); c.width = 640; c.height = 480;
      const ctx = c.getContext('2d');
      if (photo) { const img = new Image(); img.src = photo; await img.decode(); ctx.drawImage(img, 0, 0, 640, 480); }
      else { ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 640, 480); }
      const stream = c.captureStream(15); window.__stream = stream;
      setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 60);
      return stream;
    };
  }, photo);
  if (!real) await page.route('**/tracking/holistic.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.Holistic = class {
      setOptions() {} async initialize() {} onResults(fn) { this.fn=fn; this.sign=1; }
      async send() {
        this.sign *= -1;
        const pose=Array.from({length:33},()=>({x:.5,y:.3,visibility:0}));
        for(const [i,x,y] of [[0,.5,.2],[7,.46,.22],[8,.54,.22],[11,.4,.35],[12,.6,.35],[13,.3,.45],[14,.7,.45],[15,.2,.55],[16,.8,.55],[23,.44,.6],[24,.56,.6],[25,.44,.75],[26,.56,.75],[27,.44,.93],[28,.56,.93]]) pose[i]={x,y,visibility:.95};
        pose[15].y+=this.sign*(window.__amplitude||0); pose[16].y-=this.sign*(window.__amplitude||0);
        this.fn({poseLandmarks:pose});
      }
      async close() { window.__closed=true; }
    };` }));
}
async function inspectEngine(page) {
  if (production) return;
  await page.evaluate(async () => {
    const { PosterPhysics } = await import('/src/lib/physics.ts');
    const telemetry = PosterPhysics.prototype.telemetry;
    PosterPhysics.prototype.telemetry = function () { window.__engine = this; return telemetry.call(this); };
  });
}
const map = (page) => page.evaluate(() => window.__engine.mapData());
const click = (page, name) => page.getByRole('button', { name, exact: true }).click({ force: true });
async function upload(page, buffer, name = 'poster.png', mimeType = 'image/png') {
  await page.getByLabel('Poster file', { exact: true }).setInputFiles({ name, mimeType, buffer });
  await page.getByRole('dialog', { name: 'Crop poster' }).waitFor();
}
async function choose(page, label) {
  await click(page, 'Motion input');
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
}
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* wait for server */ }
    if (server.exitCode != null || i === 59) throw new Error(output);
    await new Promise((r) => setTimeout(r, 200));
  }
  await mkdir('test-results', { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await fakeCamera(page); await page.goto(base); await inspectEngine(page);
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 600;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffc8dd'; ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = '#111'; ctx.font = '48px Arial'; ctx.fillText('POSTER', 25, 140);
    ctx.fillStyle = '#245cff'; ctx.fillRect(50, 220, 130, 180);
    ctx.fillStyle = '#f14230'; ctx.fillRect(180, 220, 140, 180);
    return c.toDataURL().split(',')[1];
  }), 'base64');
  await upload(page, png);
  assert.equal(await page.evaluate(() => !!window.__constraints), false);
  const crop = page.getByRole('dialog', { name: 'Crop poster', exact: true });
  assert.equal(await crop.locator('h1,p,input').count(), 0);
  assert.deepEqual(await crop.getByRole('button').allTextContents(), ['Cancel', 'Use crop']);
  const surface = await page.locator('.crop-surface').boundingBox();
  await page.mouse.move(surface.x + surface.width * .05, surface.y + surface.height / 15);
  await page.mouse.down();
  await page.mouse.move(surface.x + surface.width * .9, surface.y + surface.height * 13 / 15);
  await page.mouse.up();
  await click(page, 'Use crop');
  await page.waitForFunction(() => document.querySelectorAll('.node-overlay circle').length >= 15);
  await page.waitForTimeout(1400);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => window.__constraints.audio), false);
  assert.equal(await page.locator('.studio.is-distorting').count(), 0);
  if (!production) { const initial = await map(page); assert(Math.abs(initial.width - 340) <= 1); assert(Math.abs(initial.height - 480) <= 1); assert(initial.elements.every((e) => e.dx === 0 && e.dy === 0)); }
  assert.equal(await page.locator('.input-heading,.coordinate-grid,.coordinate').count(), 0);
  record('Free-ratio crop applied; desktop automatically starts body tracking and holds the complete poster still');
  assert.equal(await page.locator('.input-meter,.response-scale,.output-count').count(), 0);
  assert.equal(await page.getByRole('button', { name: /Expand tracking/ }).count(), 0);
  const controls = page.getByRole('region', { name: 'Poster panel', exact: true });
  assert.deepEqual(await controls.locator('.round-toggle').allTextContents(), ['node', 'data', 'black']);
  assert.equal(await page.locator('.input-preview button').count(), 0);
  const offStyle = await controls.getByRole('button', { name: 'Black paths', exact: true }).evaluate((el) => {
    const s = getComputedStyle(el); return { opacity: s.opacity, radius: s.borderRadius, width: el.offsetWidth, height: el.offsetHeight };
  });
  assert.equal(offStyle.opacity, '0.3'); assert.equal(offStyle.radius, '50%'); assert.equal(offStyle.width, offStyle.height);
  const videoBox = await page.locator('.video-window').boundingBox();
  assert(Math.abs(videoBox.width / videoBox.height - 16 / 9) < .01);
  assert.equal(await page.locator('.node-overlay').getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  await click(page, 'Black paths');
  assert.equal(await controls.getByRole('button', { name: 'Black paths', exact: true }).getAttribute('aria-pressed'), 'true');
  await click(page, 'Show body nodes'); assert.equal(await page.locator('.node-overlay').count(), 0);
  await click(page, 'Show body nodes'); assert.equal(await page.locator('.node-overlay').count(), 1);
  await click(page, 'Show motion readings'); assert.equal(await page.locator('.part-presence,.causal-readout').count(), 0);
  await click(page, 'Show motion readings');
  const panel = page.getByRole('region', { name: 'Poster panel', exact: true });
  const preview = page.getByRole('complementary', { name: 'Motion input', exact: true });
  const cameraBefore = await preview.boundingBox(), panelBefore = await panel.boundingBox(), restartBefore = await page.getByRole('button', { name: 'Upload poster', exact: true }).boundingBox();
  assert(cameraBefore.y + cameraBefore.height < panelBefore.y);
  await page.screenshot({ path: 'test-results/updated-desktop-still.png' });
  await page.mouse.move(5, 5);
  await page.evaluate(() => { window.__amplitude = .12; });
  await page.waitForFunction(() => document.querySelector('.studio.is-distorting'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__amplitude = 0; });
  const cameraAfter = await preview.boundingBox(), restartAfter = await page.getByRole('button', { name: 'Upload poster', exact: true }).boundingBox();
  assert(Math.hypot(cameraAfter.x - cameraBefore.x, cameraAfter.y - cameraBefore.y) > 2);
  assert(Math.hypot(restartAfter.x - restartBefore.x, restartAfter.y - restartBefore.y) > 2, JSON.stringify({ restartBefore, restartAfter }));
  record('Motion moves poster pieces, camera preview and the + button; node and data toggles work');
  await click(page, 'Pause motion'); await page.waitForTimeout(100);
  if (!production) { const before = await map(page); await page.waitForTimeout(300); const after = await map(page); assert.deepEqual(before.elements, after.elements); }
  await click(page, 'Download'); assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['JPG', 'PDF']);
  for (const format of ['JPG', 'PDF']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: format, exact: true }).click();
    const bytes = await readFile(await (await pending).path());
    assert(bytes.length > 1000);
    if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    else assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    if (format === 'JPG') await click(page, 'Download');
  }
  await click(page, 'About');
  assert((await page.getByRole('dialog', { name: 'About', exact: true }).innerText()).includes('Don’t become a K-designer'));
  assert.equal(await page.getByRole('dialog').locator('li').count(), 2);
  await page.keyboard.press('Escape');
  record('Pause holds state; only JPG/PDF download correctly; About contains the translated essay');
  if (!production) {
    const physics = await page.evaluate(async () => {
      const { extractElements } = await import('/src/lib/extract.ts');
      const { PosterPhysics } = await import('/src/lib/physics.ts');
      const { DEFAULT_SETTINGS } = await import('/src/lib/types.ts');
      const source = document.createElement('canvas'); source.width = 240; source.height = 240;
      const ctx = source.getContext('2d'); ctx.fillStyle = '#ffc8dd'; ctx.fillRect(0, 0, 240, 240);
      ctx.fillStyle = '#000'; ctx.font = '40px Arial'; ctx.fillText('AB', 20, 80);
      const asset = extractElements(source, 'normal');
      const reconstructed = document.createElement('canvas'); reconstructed.width = 240; reconstructed.height = 240;
      const rc = reconstructed.getContext('2d');
      for (const el of asset.elements) rc.drawImage(el.sprite, el.x - el.width / 2, el.y - el.height / 2);
      const a = ctx.getImageData(0, 0, 240, 240).data, b = rc.getImageData(0, 0, 240, 240).data;
      let difference = 0; for (let p = 0; p < a.length; p++) difference = Math.max(difference, Math.abs(a[p] - b[p]));
      const blank = asset.background.getContext('2d').getImageData(0, 0, 240, 240).data.every((v) => v === 0);
      const engine = new PosterPhysics(asset, DEFAULT_SETTINGS);
      engine.setBounds({ x: -300, y: -300, width: 840, height: 840 });
      for (let i = 0; i < 240; i++) { engine.shake(.6, { x: Math.cos(i), y: Math.sin(i) }); engine.update(16); }
      const slowCount = engine.entities.length;
      const noSlowBreaks = engine.completedTrails.length === 0 && slowCount === asset.elements.length;
      let firstCount = 0, recursive = false;
      for (let i = 0; i < 1600; i++) { engine.shake(1, { x: Math.cos(i), y: Math.sin(i) }); engine.update(16); if (i === 120) firstCount = engine.entities.length; }
      recursive = engine.entities.some((e) => e.element.id.split('.').length >= 3);
      const count = engine.entities.length, sum = engine.entities.reduce((s,e) => s+e.areaWeight, 0);
      const finite = engine.mapData().elements.every((e) => e.sourceVertices.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
      const gravity = engine.engine.gravity.y;
      // A trail and its annotation must be painted before any foreground sprites.
      engine.settings.blackPaths = true;
      const strokeColors = [];
      let trailsPainted = false, pathUnderPieces = true;
      const renderCanvas = document.createElement('canvas'), render = renderCanvas.getContext('2d');
      const drawImage = render.drawImage.bind(render), stroke = render.stroke.bind(render);
      render.stroke = (...args) => { trailsPainted = true; strokeColors.push(render.strokeStyle); return stroke(...args); };
      render.drawImage = (...args) => { if (!trailsPainted) pathUnderPieces = false; return drawImage(...args); };
      engine.render(render, true); engine.dispose();
      return { blackStrokes: strokeColors.length > 0 && strokeColors.every((color) => color === '#000000'), difference, blank, noSlowBreaks, firstCount, count, recursive, sum, finite, gravity, pathUnderPieces };
    });
    assert.equal(physics.difference, 0); assert(physics.blank); assert(physics.noSlowBreaks); assert(physics.recursive);
    assert(physics.count > physics.firstCount); assert(Math.abs(physics.sum - 240 * 240) < .01);
    assert(physics.finite); assert.equal(physics.gravity, 0); assert(physics.pathUnderPieces); assert(physics.blackStrokes);
    record('All pixels reconstructed exactly; no fixed background remains; fragments split again with conserved area, zero gravity and paths underneath');
  }
  // Narrow touch devices offer exactly the two requested modes at startup.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' });
  const mobile = await mobileContext.newPage(); mobile.on('pageerror', (error) => errors.push(error.message));
  await fakeCamera(mobile); await mobile.goto(base); await upload(mobile, png);
  const cropSurface = await mobile.locator('.crop-surface').boundingBox();
  await mobile.mouse.move(cropSurface.x + 5, cropSurface.y + 5); await mobile.mouse.down();
  await mobile.mouse.move(cropSurface.x + cropSurface.width * .7, cropSurface.y + cropSurface.height * .6); await mobile.mouse.up();
  assert((await mobile.locator('.crop-selection').boundingBox()).width < cropSurface.width);
  await click(mobile, 'Use crop');
  await mobile.getByRole('dialog', { name: 'Choose motion input', exact: true }).waitFor();
  assert.equal(await mobile.evaluate(() => !!window.__constraints), false);
  await click(mobile, 'Device motion sensor');
  await mobile.waitForFunction(() => document.querySelector('.input-message')?.textContent.includes('actual acceleration'));
  await mobile.evaluate(async () => { for (let i=0;i<3;i++) { window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y: 0, z: 0 }, interval: 50 })); await new Promise((r) => setTimeout(r, 55)); } });
  await mobile.waitForFunction(() => document.querySelector('[data-testid="motion-status"]').dataset.state === 'connected');
  assert.equal(await mobile.locator('.studio.is-distorting').count(), 0);
  await mobile.evaluate(async () => { for (let i=0;i<5;i++) { window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 8, y: 4, z: 1 }, interval: 50 })); await new Promise((r) => setTimeout(r, 55)); } });
  await mobile.waitForFunction(() => document.querySelector('.studio.is-distorting'));
  assert(await mobile.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
  const mobilePanel = await mobile.getByRole('region', { name: 'Poster panel', exact: true }).boundingBox();
  assert(mobilePanel.x >= -1 && mobilePanel.y >= -1 && mobilePanel.x + mobilePanel.width <= 391 && mobilePanel.y + mobilePanel.height <= 845);
  await mobile.screenshot({ path: 'test-results/updated-mobile.png' });
  record('Mobile supports pointer cropping, startup choice, actual sensor samples and no page scrolling');
  // Verify native PDF loading still reaches cropping.
  const pdf = new jsPDF(); pdf.text('POSTER', 20, 40);
  await upload(page, Buffer.from(pdf.output('arraybuffer')), 'poster.pdf', 'application/pdf');
  await click(page, 'Use crop');
  await page.getByLabel('Distorted poster', { exact: true }).waitFor();
  record('PDF import still works through the crop workflow');
  const real = await context.newPage(); real.on('pageerror', (error) => errors.push(error.message));
  await fakeCamera(real, true); await real.goto(base); await upload(real, png); await click(real, 'Use crop');
  await real.waitForFunction(() => document.querySelectorAll('.node-overlay circle').length > 15, undefined, { timeout: 60000 });
  await choose(real, 'Stop tracking');
  assert.equal(await real.evaluate(() => window.__stream.getVideoTracks()[0].readyState), 'ended');
  record('The real self-hosted body tracker detects the fixture and releases the camera on stop');
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed (${production ? 'production' : 'development'}).`);
} finally {
  await browser?.close(); server.kill('SIGTERM');
}
