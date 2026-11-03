import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';
import { spawn, execFileSync } from 'node:child_process';
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
  await click(page, 'Setting');
  await page.getByRole('menuitem', { name: 'Motion detection', exact: true }).click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Body Nodes', 'Device Motion Sensor']);
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
  const crop = page.getByRole('dialog', { name: 'Crop poster', exact: true });
  assert.equal(await crop.locator('h1,p,input').count(), 0);
  assert.deepEqual(await crop.getByRole('button').allTextContents(), ['Cancel', 'Use crop']);
  const surface = await page.locator('.crop-surface').boundingBox();
  await page.mouse.move(surface.x + surface.width * .05, surface.y + surface.height / 15); await page.mouse.down();
  await page.mouse.move(surface.x + surface.width * .9, surface.y + surface.height * 13 / 15); await page.mouse.up();
  await click(page, 'Use crop');
  await page.waitForFunction(() => document.querySelector('[data-testid="motion-status"]').dataset.state === 'connected');
  await page.waitForTimeout(1200);
  const panel = page.getByRole('region', { name: 'Poster panel', exact: true });
  const preview = page.getByRole('complementary', { name: 'Motion input', exact: true });
  assert.equal(await panel.getByRole('button').count(), 6);
  assert.equal(await panel.getByRole('button', { name: 'Path', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await panel.getByRole('button', { name: 'Data', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await preview.innerText(), '');
  assert.equal(await page.locator('.node-overlay,.panel-data,.coordinate-grid').count(), 0);
  assert(!(await panel.innerText()).includes('Poster map'));
  const videoBox = await page.locator('.video-window').boundingBox();
  assert(Math.abs(videoBox.width / videoBox.height - 16 / 9) < .01);
  const transparency = await panel.evaluate((el) => ({ panel: getComputedStyle(el).backgroundColor, restart: getComputedStyle(el.querySelector('.restart-button')).backgroundColor }));
  const alpha = (color) => Number.parseFloat(color.split(',').at(-1));
  assert(Math.abs(alpha(transparency.panel) - 224 / 255) < .005);
  assert.equal(alpha(transparency.panel), alpha(transparency.restart));
  if (!production) {
    const initial = await map(page);
    assert(Math.abs(initial.width - 340) <= 1 && Math.abs(initial.height - 480) <= 1);
    assert(!initial.settings.showPaths); assert(initial.elements.every((e) => e.dx === 0 && e.dy === 0));
  }
  record('Clean 16:9 camera; six translucent-panel controls; Path/Data/nodes default OFF');
  await click(page, 'Path');
  if (!production) { await page.waitForTimeout(40); const m = await map(page); assert(m.settings.showPaths && m.settings.blackPaths); }
  await click(page, 'Data');
  await page.waitForFunction(() => document.querySelectorAll('.node-overlay circle').length >= 15);
  assert.equal(await panel.locator('[aria-label="Detected body parts"]').count(), 1);
  assert((await panel.innerText()).includes('Head 0%'));
  assert(!/input\s*0|paused|tracking stopped/i.test(await panel.innerText()));
  assert.equal(await preview.innerText(), '');
  assert.equal(await page.locator('.node-overlay title').count(), 0);
  assert.equal(await panel.getByRole('button', { name: 'Path', exact: true }).getAttribute('aria-pressed'), 'false');
  if (!production) { await page.waitForTimeout(40); const m = await map(page); assert(m.settings.showPaths && !m.settings.blackPaths); }
  await click(page, 'Setting');
  assert.equal(await page.getByRole('menuitem', { name: /^Sound/ }).count(), 1);
  assert.equal(await page.getByRole('menuitem').count(), 2);
  assert.equal(await page.getByRole('menuitem', { name: 'Change poster', exact: true }).count(), 0);
  await page.getByRole('menuitem', { name: 'Motion detection', exact: true }).click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Body Nodes', 'Device Motion Sensor']);
  await page.keyboard.press('Escape'); await page.mouse.move(5, 5);
  const cameraBefore = await preview.boundingBox(), tapesBefore = await page.locator('.tape').evaluateAll((els) => els.map((el) => el.style.transform));
  await page.screenshot({ path: 'test-results/updated-desktop-still.png' });
  await page.evaluate(() => { window.__amplitude = .18; });
  await page.waitForFunction(() => document.querySelector('.studio.is-distorting'));
  await page.waitForTimeout(1800); await page.evaluate(() => { window.__amplitude = 0; });
  const cameraAfter = await preview.boundingBox(), tapesAfter = await page.locator('.tape').evaluateAll((els) => els.map((el) => el.style.transform));
  assert(Math.hypot(cameraAfter.x - cameraBefore.x, cameraAfter.y - cameraBefore.y) > 2);
  assert(tapesAfter.some((value, i) => value !== tapesBefore[i]));
  record('Data unfolds in panel and enables colored paths/nodes; clean camera; two motion choices; tapes roll');
  await click(page, 'Pause motion'); await page.waitForTimeout(120);
  if (!production) { const before = await map(page); await page.waitForTimeout(200); assert.deepEqual(before.elements, (await map(page)).elements); }
  const b = await panel.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 12); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 130, b.y - 60, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(80); assert.equal(await panel.getAttribute('data-dragging'), 'false');
  const placed = await panel.boundingBox(); await page.mouse.move(20, 20); await page.waitForTimeout(120);
  const released = await panel.boundingBox();
  assert(Math.abs(placed.x - released.x) < 1 && Math.abs(placed.y - released.y) < 1);
  record('Dragging releases on pointer-up and stays placed without a second click, including while paused');
  await click(page, 'Download');
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['JPG', 'PDF', 'Separate PNGs · ZIP']);
  for (const format of ['JPG', 'PDF', 'Separate PNGs · ZIP']) {
    const pending = page.waitForEvent('download'); await page.getByRole('menuitem', { name: format, exact: true }).click();
    const downloaded = await pending, file = await downloaded.path(), bytes = await readFile(file);
    assert(bytes.length > 100);
    if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    else if (format === 'JPG') assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    else {
      const result = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert all(n.endswith(".png") and z.read(n)[:8] == b"\\x89PNG\\r\\n\\x1a\\n" for n in z.namelist()); print(json.dumps({"count":len(z.namelist())}))', file], { encoding: 'utf8' }));
      assert(result.count > 1);
      if (!production) assert.equal(result.count, await page.evaluate(() => window.__engine.pieceSnapshots().length));
    }
    if (format !== 'Separate PNGs · ZIP') await click(page, 'Download');
  }
  const picker = page.waitForEvent('filechooser');
  await click(page, 'Change poster');
  await (await picker).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('dialog', { name: 'Crop poster', exact: true }).waitFor();
  await click(page, 'Use crop');
  await page.waitForFunction(() => document.querySelector('[data-testid="motion-status"]').dataset.state === 'connected');
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.studio.is-distorting').count(), 0);
  assert.equal(await panel.getByRole('button', { name: 'Path', exact: true }).getAttribute('aria-pressed'), 'false');
  if (!production) assert((await map(page)).elements.every((e) => e.dx === 0 && e.dy === 0));
  record('JPG/PDF and compatible ZIP of individual PNGs export; + opens file picker and crop to replace the poster; Setting has no Change poster item');
  if (!production) {
    const result = await page.evaluate(async () => {
      const { extractElements } = await import('/src/lib/extract.ts');
      const { PosterPhysics } = await import('/src/lib/physics.ts');
      const { DEFAULT_SETTINGS } = await import('/src/lib/types.ts');
      const source = document.createElement('canvas'); source.width = 240; source.height = 240;
      source.getContext('2d').fillStyle = '#ffc8dd'; source.getContext('2d').fillRect(0, 0, 240, 240);
      const asset = extractElements(source, 'normal'), engine = new PosterPhysics(asset, { ...DEFAULT_SETTINGS });
      engine.setBounds({ x: -300, y: -300, width: 840, height: 840 });
      for (let i = 0; i < 180; i++) { engine.shake(.6, { x: Math.cos(i), y: Math.sin(i) }); engine.update(16); }
      const slowSafe = engine.completedTrails.length === 0;
      let firstRatio = 0, firstCount = 0;
      for (let i = 0; i < 1800; i++) {
        engine.shake(1, { x: Math.cos(i * .1), y: Math.sin(i * .1) }); engine.update(16);
        if (!firstRatio && engine.completedTrails.length) { firstRatio = Math.max(...engine.entities.map((e) => e.areaWeight)) / (240 * 240); firstCount = engine.entities.length; }
      }
      const recursive = engine.entities.some((e) => e.element.id.split('.').length > 3);
      const continued = engine.completedTrails.length > 4 && engine.entities.length > firstCount;
      const area = engine.entities.reduce((sum, e) => sum + e.areaWeight, 0);
      const pieces = engine.pieceSnapshots(), transparent = pieces.some((p) => {
        const data = p.canvas.getContext('2d').getImageData(0, 0, p.canvas.width, p.canvas.height).data;
        return data.some((v, i) => i % 4 === 3 && v === 0);
      });
      const finite = engine.mapData().elements.every((e) => e.sourceVertices.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
      engine.settings.showPaths = true; engine.settings.blackPaths = false;
      for (let i = 0; i < 24; i++) {
        engine.applyMotion({ source: 'body', strength: .4, fractureStrength: .4, magnitude: 1, confidence: 1,
          direction: { x: -1, y: 0 }, body: { dominant: 'Arms', parts: [], nodes: [], effect: 'BEND' } }); engine.update(16);
      }
      const c = document.createElement('canvas'), ctx = c.getContext('2d'), colors = [], stroke = ctx.stroke.bind(ctx);
      ctx.stroke = (...args) => { colors.push(ctx.strokeStyle); return stroke(...args); };
      engine.render(ctx); const causalColor = colors.includes('#ff365f'); colors.length = 0;
      engine.settings.blackPaths = true; engine.render(ctx); const black = colors.length > 0 && colors.every((v) => v === '#000000');
      engine.dispose(); return { slowSafe, firstRatio, recursive, continued, area, transparent, finite, causalColor, black };
    });
    assert(result.slowSafe); assert(result.firstRatio >= .82 && result.firstRatio < 1);
    assert(result.recursive && result.continued); assert(Math.abs(result.area - 240 * 240) < .01);
    assert(result.transparent && result.finite && result.causalColor && result.black);
    record('Vigorous pieces repeatedly shed small edge chips, preserve main body/area, export transparent shapes and record body-colored routes');
  }
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' });
  const mobile = await mobileContext.newPage(); mobile.on('pageerror', (e) => errors.push(e.message));
  await fakeCamera(mobile); await mobile.goto(base); await upload(mobile, png); await click(mobile, 'Use crop');
  await mobile.getByRole('dialog', { name: 'Choose motion input', exact: true }).waitFor();
  await click(mobile, 'Device Motion Sensor');
  await mobile.evaluate(async () => { for (let i=0;i<8;i++) { window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y: 0, z: 0 }, interval: 60 })); await new Promise((r) => setTimeout(r, 65)); } });
  await mobile.waitForFunction(() => document.querySelector('[data-testid="motion-status"]').dataset.state === 'connected');
  await click(mobile, 'Data');
  assert(!/input\s*0|paused|tracking stopped/i.test(await mobile.locator('.mapping-panel').innerText()));
  assert.equal(await mobile.locator('.input-preview').innerText(), '');
  await mobile.evaluate(async () => { for (let i=0;i<5;i++) { window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 8, y: 4, z: 1 }, interval: 60 })); await new Promise((r) => setTimeout(r, 65)); } });
  await mobile.waitForFunction(() => document.querySelector('.studio.is-distorting'));
  await click(mobile, 'Pause motion');
  const mb = await mobile.locator('.mapping-panel').boundingBox();
  assert(mb.x >= -1 && mb.y >= -1 && mb.x + mb.width <= 391 && mb.y + mb.height <= 845);
  const touch = await mobileContext.newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mb.x + 30, y: mb.y + 10 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mb.x + 15, y: mb.y - 30 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await mobile.locator('.mapping-panel').getAttribute('data-dragging'), 'false');
  await mobile.screenshot({ path: 'test-results/updated-mobile.png' });
  record('Mobile sensor choice, expanding data panel, viewport bounds and touch release work');
  const pdf = new jsPDF(); pdf.text('POSTER', 20, 40);
  await upload(page, Buffer.from(pdf.output('arraybuffer')), 'poster.pdf', 'application/pdf'); await click(page, 'Use crop');
  await page.getByLabel('Distorted poster', { exact: true }).waitFor();
  const real = await context.newPage(); real.on('pageerror', (e) => errors.push(e.message));
  await fakeCamera(real, true); await real.goto(base); await upload(real, png); await click(real, 'Use crop'); await click(real, 'Data');
  await real.waitForFunction(() => document.querySelectorAll('.node-overlay circle').length > 15, undefined, { timeout: 60000 });
  await choose(real, 'Device Motion Sensor');
  assert.equal(await real.evaluate(() => window.__stream.getVideoTracks()[0].readyState), 'ended');
  record('PDF import and real local body model work; mode switching releases camera');
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed (${production ? 'production' : 'development'}).`);
} finally { await browser?.close(); server.kill('SIGTERM'); }
