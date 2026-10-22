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
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 832 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__audioContexts = [];
    window.__analysers = [];
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
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
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page
    .getByRole('button', { name: '포스터 올리기', exact: true })
    .waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.getByRole('slider').count(), 0);
  assert.equal(
    await page.locator('.layer-item,header,footer,.effect-options').count(),
    0,
  );
  const blankPaper = await page.locator('.paper').boundingBox();
  assert(Math.abs(blankPaper.width - 534) < 4);
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });
  record(
    'Figma paper, tapes and upload control replace the old workbench and element list',
  );

  const click = (name, target = page) =>
    target.getByRole('button', { name, exact: true }).click({ force: true });
  async function choose(name, target = page) {
    const button = target.getByRole('menuitem', { name, exact: true });
    await button.click({ force: true });
  }
  async function menu(name, target = page) {
    await target.keyboard.press('Escape');
    await click(name, target);
  }
  async function map(target = page) {
    await menu('다운로드', target);
    const promise = target.waitForEvent('download');
    await choose('좌표 · 경로 JSON', target);
    return JSON.parse(await readFile(await (await promise).path(), 'utf8'));
  }
  async function upload(
    buffer,
    name = 'fixture.png',
    mimeType = 'image/png',
    target = page,
  ) {
    await target
      .getByLabel('포스터 파일 선택')
      .setInputFiles({ name, mimeType, buffer });
    await target.waitForFunction(
      () =>
        document.querySelector('.paper')?.getAttribute('aria-busy') === 'false',
    );
    await target.getByLabel('왜곡되는 포스터', { exact: true }).waitFor();
  }
  async function sensor(x, y = 0, z = 0) {
    await page.evaluate(
      ({ x, y, z }) => {
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            acceleration: { x, y, z },
            accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 },
            interval: 50,
          }),
        );
      },
      { x, y, z },
    );
    await page.waitForTimeout(60);
  }
  async function spectrum() {
    return page.evaluate(() => {
      const analyser = window.__analysers[0];
      if (!analyser) return { centroid: 0, power: 0 };
      const values = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(values);
      let power = 0,
        weighted = 0;
      for (let i = 1; i < values.length; i++) {
        const p = 10 ** (values[i] / 10);
        power += p;
        weighted += (p * i * analyser.context.sampleRate) / analyser.fftSize;
      }
      const waveform = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(waveform);
      const rms = Math.sqrt(
        waveform.reduce((sum, v) => sum + v * v, 0) / waveform.length,
      );
      return { power, rms, centroid: weighted / Math.max(power, 1e-12) };
    });
  }
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = '#202020';
    ctx.fillRect(30, 30, 120, 70);
    ctx.fillRect(210, 140, 140, 85);
    ctx.fillStyle = '#ed552f';
    ctx.beginPath();
    ctx.arc(140, 350, 65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#202020';
    ctx.font = '32px Arial';
    ctx.fillText('HELLO POSTER', 30, 520);
    return {
      png: canvas.toDataURL('image/png').split(',')[1],
      jpg: canvas.toDataURL('image/jpeg').split(',')[1],
    };
  });
  const png = Buffer.from(image.png, 'base64');
  await upload(png);
  const initial = await map();
  assert(initial.elements.length >= 4);
  assert.deepEqual(initial.materialMix, { zigzag: 0.2, fracture: 0.8 });
  assert(
    initial.bounds.width > initial.width &&
      initial.bounds.height > initial.height,
  );
  assert.equal(initial.fixtures.length, 3);
  assert(initial.fixtures.every((e) => e.breakable === false));
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  record(
    'Uploaded elements and three unbreakable interface bodies share the full-screen arena',
  );

  await menu('노트북 움직임 감지');
  await choose('가속도 센서 확인');
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
      '제공되지',
    ),
  );
  record(
    'Absent hardware data is reported without claiming the laptop sensor connected',
  );
  await choose('가속도 센서 확인');
  await page.waitForFunction(() =>
    document
      .querySelector('.connection-detail')
      ?.textContent.includes('실제 가속도 데이터'),
  );
  await sensor(0);
  await sensor(0);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'connected',
  );
  await page.keyboard.press('Escape');
  const zero = await map();
  assert(zero.elements.every((e) => Math.hypot(e.dx, e.dy) < 0.01));
  record(
    'Two simulated acceleration samples establish input while zero movement preserves the layout',
  );

  for (let i = 0; i < 5; i++) await sensor(2.6, -0.6);
  const softSpectrum = await spectrum();
  const soft = await map();
  assert(soft.elements.some((e) => Math.hypot(e.dx, e.dy) > 4));
  assert(soft.elements.every((e) => e.kind !== 'fragment'));
  assert(soft.elements.every((e) => e.warp < 5));
  assert(
    soft.fixtures.some(
      (e, i) =>
        Math.hypot(e.x - initial.fixtures[i].x, e.y - initial.fixtures[i].y) >
        5,
    ),
  );
  record(
    'Gentle movement produces restrained warping and moves the unbreakable logo, About and adjust box',
  );
  await click('연주 소리');
  await page.waitForTimeout(450);
  const muted = await spectrum();
  assert(muted.rms < Math.max(softSpectrum.rms * 0.02, 1e-5));
  await click('연주 소리');
  record('Sound toggle mutes the actual Web Audio output');

  for (let i = 0; i < 12; i++) await sensor(i % 2 ? 11 : -11, 3);
  const hardSpectrum = await spectrum();
  assert(hardSpectrum.power > softSpectrum.power);
  assert(hardSpectrum.centroid > softSpectrum.centroid * 1.3);
  let broken;
  for (let i = 0; i < 10; i++) {
    broken = await map();
    if (broken.elements.some((e) => e.kind === 'fragment')) break;
    await sensor(i % 2 ? -12 : 12, 8);
    await page.waitForTimeout(150);
  }
  assert(broken.elements.some((e) => e.kind === 'fragment'));
  assert(
    broken.elements
      .filter((e) => e.kind === 'fragment')
      .every((e) => e.collisionVertices.length === 3),
  );
  assert(
    broken.elements.every(
      (e) =>
        e.deformationVertices.length === 18 &&
        e.deformationVertices.every(
          (v) => Number.isFinite(v.x) && Number.isFinite(v.y),
        ),
    ),
  );
  const weight = (data) =>
    data.elements.reduce((sum, e) => sum + e.areaWeight, 0);
  assert(Math.abs(weight(broken) - weight(initial)) < 0.01);
  assert(
    broken.elements.some(
      (e) => e.x < 0 || e.x > broken.width || e.y < 0 || e.y > broken.height,
    ),
  );
  assert.equal(broken.fixtures.length, 3);
  assert(
    broken.fixtures.every((e) => e.breakable === false && Number.isFinite(e.x)),
  );
  record(
    'Moderate strong input creates triangular fragments outside the paper while preserving interface bodies and area weights',
  );
  record('Stronger movement produces louder and brighter instrument output');
  await click('움직임 시각화');
  assert.equal(
    await page
      .getByRole('button', { name: '움직임 시각화', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  const mapped = await map();
  assert(mapped.settings.showPaths && mapped.settings.showLabels);
  assert(mapped.elements.some((e) => e.path.length > 2));
  assert.equal(await page.locator('.coordinate output').count(), 4);
  await page.screenshot({ path: 'test-results/fractured.png', fullPage: true });
  record(
    'One visualization control shows paths and coordinates without individual selection',
  );

  await menu('노트북 움직임 감지');
  await choose('움직임 감지 중지');
  await page.keyboard.press('Escape');
  for (const format of ['PNG', 'JPG', 'PDF']) {
    await menu('다운로드');
    const promise = page.waitForEvent('download');
    await choose(format);
    const bytes = await readFile(await (await promise).path());
    assert(bytes.length > 1000);
    if (format === 'PNG') {
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert(bytes.readUInt32BE(16) > 1500);
    }
    if (format === 'JPG')
      assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    record(`${format} downloads the expanded poster image`);
  }
  await upload(Buffer.from(image.jpg, 'base64'), 'fixture.jpg', 'image/jpeg');
  assert((await map()).elements.length >= 4);
  record('JPG upload still separates foreground regions');
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
  record(
    'PDF worker imports the first page and separates native text without adding page controls',
  );
  await upload(Buffer.from('broken'), 'bad.pdf', 'application/pdf');
  await page.getByRole('alert').waitFor();
  await click('알림 닫기');
  assert.equal((await map()).extraction, pdfMap.extraction);
  record('Invalid upload preserves the current poster');

  const cameraPage = await context.newPage();
  cameraPage.on('pageerror', (e) => errors.push(e.message));
  await cameraPage.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints) => {
        window.__cameraConstraints = constraints;
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext('2d'),
          pattern = document.createElement('canvas');
        pattern.width = 512;
        pattern.height = 256;
        const p = pattern.getContext('2d');
        let seed = 19371;
        for (let y = 0; y < 256; y += 4)
          for (let x = 0; x < 512; x += 4) {
            seed = (seed * 16807) % 2147483647;
            const value = (seed % 230) + 10;
            p.fillStyle = `rgb(${value},${value},${value})`;
            p.fillRect(x, y, 4, 4);
          }
        let offset = 0;
        const draw = () => {
          if (window.__cameraMove) offset = (offset + 3) % 128;
          ctx.drawImage(pattern, offset, 0, 320, 240, 0, 0, 320, 240);
        };
        draw();
        const stream = canvas.captureStream(24);
        window.__cameraStream = stream;
        const timer = setInterval(draw, 33);
        stream
          .getVideoTracks()[0]
          .addEventListener('ended', () => clearInterval(timer));
        return stream;
      },
    });
  });
  await cameraPage.goto(`http://127.0.0.1:${port}`);
  await upload(png, 'fixture.png', 'image/png', cameraPage);
  await menu('노트북 움직임 감지', cameraPage);
  await choose('카메라로 움직임 감지', cameraPage);
  await cameraPage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.getAttribute('data-state') === 'connected',
  );
  await cameraPage.waitForTimeout(450);
  assert.equal(
    await cameraPage.evaluate(() => window.__cameraConstraints.audio),
    false,
  );
  assert.equal(
    await cameraPage.evaluate(
      () => window.__cameraStream.getVideoTracks()[0].readyState,
    ),
    'live',
  );
  await cameraPage.evaluate(() => {
    window.__cameraMove = true;
  });
  await cameraPage.keyboard.press('Escape');
  await cameraPage.waitForTimeout(900);
  const cameraMap = await map(cameraPage);
  assert.equal(cameraMap.input.source, 'camera');
  assert(cameraMap.elements.some((e) => Math.hypot(e.dx, e.dy) > 4));
  record(
    'Simulated live camera stream drives the real optical flow and material without requesting a microphone',
  );
  await menu('노트북 움직임 감지', cameraPage);
  await choose('움직임 감지 중지', cameraPage);
  assert.equal(
    await cameraPage.evaluate(
      () => window.__cameraStream.getVideoTracks()[0].readyState,
    ),
    'ended',
  );
  assert.equal(
    await cameraPage.locator('video').evaluate((v) => v.srcObject),
    null,
  );
  await cameraPage.close();
  record('Stopping detection releases the camera track');

  await page.setViewportSize({ width: 390, height: 844 });
  await upload(png);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const bounds = await page.locator('.poster-canvas').boundingBox();
  assert.equal(bounds.width, 390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  record(
    'Mobile fits the paper and controls while retaining a viewport-wide physical arena',
  );
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(`\n${results.length} browser checks passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
