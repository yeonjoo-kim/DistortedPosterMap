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
    viewport: { width: 1440, height: 1000 },
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
  await page.getByRole('heading', { name: /질서를 흔들고/ }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="element-count"]')?.textContent ===
      '16',
  );
  assert.equal(await page.getByRole('slider').count(), 0);
  assert.equal(await page.locator('.effect-options').count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  record(
    'Continuous clay instrument has no effect selector or physical parameter sliders',
  );

  async function map() {
    const promise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '좌표 · 경로 JSON 저장', exact: true })
      .click();
    const file = await promise;
    return JSON.parse(await readFile(await file.path(), 'utf8'));
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
  await page
    .getByRole('button', { name: '가속도 센서로 연주', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="motion-status"]')
        ?.classList.contains('unavailable'),
    undefined,
    { timeout: 6500 },
  );
  assert(
    (await page.getByTestId('motion-status').textContent()).includes(
      '제공되지',
    ),
  );
  record(
    'Sensor API without incoming hardware data reports unavailable instead of connected',
  );
  await page
    .getByRole('button', { name: '가속도 센서로 연주', exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="motion-status"]')
      ?.textContent.includes('실제 가속도 데이터'),
  );
  await sensor(0);
  assert(
    (await page.getByTestId('motion-status').textContent()).includes('확인 중'),
  );
  await sensor(0);
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="motion-status"]')
      ?.classList.contains('connected'),
  );
  assert(
    (await map()).elements.every(
      (e) => Math.abs(e.dx) < 0.01 && Math.abs(e.dy) < 0.01,
    ),
  );
  record(
    'Two simulated measured samples establish sensor input; zero motion stays silent and still',
  );
  assert.equal(
    await page.evaluate(() => window.__audioContexts[0].state),
    'running',
  );

  for (let i = 0; i < 5; i++) await sensor(2.6, -0.6);
  const softSpectrum = await spectrum();
  await page.waitForTimeout(180);
  await page
    .getByRole('button', { name: '시뮬레이션 일시정지', exact: true })
    .click();
  const soft = await map();
  assert.equal(soft.input.source, 'sensor');
  assert(soft.elements.some((e) => Math.hypot(e.dx, e.dy) > 4 && e.warp > 0));
  assert(soft.elements.every((e) => e.kind !== 'fragment'));
  assert(soft.elements.some((e) => e.scaleX > 1 && e.scaleY < 1));
  assert(
    !('effect' in soft.settings) &&
      !('intensity' in soft.settings) &&
      !('gravity' in soft.settings) &&
      !('restitution' in soft.settings),
  );
  record(
    'Gentle sensor movement blends gravity, soft deformation and collision squash without fragments',
  );
  await page.waitForTimeout(250);
  const paused = await map();
  assert.deepEqual(
    soft.elements.map((e) => [e.x, e.y, e.warp]),
    paused.elements.map((e) => [e.x, e.y, e.warp]),
  );
  await page.waitForTimeout(250);
  const silentSpectrum = await spectrum();
  assert(
    silentSpectrum.rms < Math.max(softSpectrum.rms * 0.02, 1e-5),
    JSON.stringify({ softSpectrum, silentSpectrum }),
  );
  record(
    'Pause freezes material coordinates and fades the instrument to silence',
  );

  await page
    .getByRole('button', { name: '포스터 초기화', exact: true })
    .click();
  await sensor(18, -10, 5);
  await sensor(18, -10, 5);
  await page.waitForTimeout(130);
  const hardSpectrum = await spectrum();
  assert(hardSpectrum.power > softSpectrum.power);
  assert(
    hardSpectrum.centroid > softSpectrum.centroid * 1.3,
    `Soft centroid ${softSpectrum.centroid}, hard ${hardSpectrum.centroid}`,
  );
  record(
    'Web Audio output becomes louder and spectrally brighter for stronger simulated motion',
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="element-count"]')?.textContent,
      ) > 16,
    undefined,
    { timeout: 6000 },
  );
  await page
    .getByRole('button', { name: '시뮬레이션 일시정지', exact: true })
    .click();
  const broken = await map();
  assert(broken.elements.some((e) => e.kind === 'fragment' && e.parentId));
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
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
        ),
    ),
  );
  record(
    'Stronger motion fractures collision-loaded clay while retaining mapped geometry',
  );
  await page.locator('.layer-item').first().click();
  await page.locator('.vertex-details summary').click();
  assert.equal(await page.locator('.vertex-details tbody tr').count(), 5);
  record(
    'Selected clay elements show numerical deformation paths and coordinates',
  );
  await page
    .getByRole('button', { name: '움직임 감지 중지', exact: true })
    .click();
  assert(
    (await page.getByTestId('motion-status').textContent()).includes(
      '멈췄습니다',
    ),
  );
  record('Disconnect removes the live motion input');

  for (const format of ['PNG', 'JPG', 'PDF']) {
    await page
      .getByRole('button', { name: '포스터 저장', exact: true })
      .click();
    await page
      .getByRole('button', { name: new RegExp(`^${format} `) })
      .first()
      .click();
    const promise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: `${format} 포스터 저장`, exact: true })
      .click();
    const file = await promise,
      bytes = await readFile(await file.path());
    assert(bytes.length > 1000);
    if (format === 'PNG') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    if (format === 'JPG')
      assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    if (format === 'PDF') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    record(`${format} export downloads a valid file`);
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
  for (const format of ['png', 'jpg']) {
    await page.getByLabel('포스터 파일 선택').setInputFiles({
      name: `fixture.${format}`,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      buffer: Buffer.from(image[format], 'base64'),
    });
    await page.waitForFunction(
      (name) =>
        document.querySelector('.document-name')?.textContent.includes(name),
      `fixture.${format}`,
    );
    const data = await map();
    assert(data.elements.length >= 4);
    assert.equal(data.width, 400);
    assert.equal(data.height, 600);
    record(
      `${format.toUpperCase()} upload separates actual foreground regions`,
    );
  }
  const pdf = new jsPDF({ unit: 'pt', format: [400, 600] });
  pdf.setFontSize(32);
  pdf.text('NATIVE PDF TEXT', 30, 70);
  pdf.setFillColor(237, 85, 47);
  pdf.rect(70, 200, 150, 150, 'F');
  pdf.addPage();
  pdf.text('SECOND PAGE', 30, 70);
  pdf.rect(100, 150, 100, 100, 'F');
  await page.getByLabel('포스터 파일 선택').setInputFiles({
    name: 'fixture.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf.output('arraybuffer')),
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('.document-name')
        ?.textContent.includes('fixture.pdf'),
    undefined,
    { timeout: 15000 },
  );
  const pdfData = await map();
  assert(
    pdfData.elements.some(
      (e) => e.kind === 'text' && e.label.includes('NATIVE PDF TEXT'),
    ),
  );
  await page.getByLabel('PDF 페이지', { exact: true }).selectOption('2');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.layer-name')].some((el) =>
      el.textContent.includes('SECOND PAGE'),
    ),
  );
  record(
    'Multipage PDF renders in its worker and preserves native text elements',
  );

  await page.getByLabel('포스터 파일 선택').setInputFiles({
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('broken'),
  });
  await page.getByRole('alert').waitFor();
  assert(
    (await page.locator('.document-name').textContent()).includes(
      'fixture.pdf',
    ),
  );
  record('Invalid upload shows an error and preserves the current poster');

  await page.getByRole('button', { name: '사용 가이드', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  record('Help dialog opens and closes with keyboard');

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
  await cameraPage
    .getByRole('button', { name: '카메라로 움직임 감지', exact: true })
    .click();
  await cameraPage.waitForFunction(() =>
    document
      .querySelector('[data-testid="motion-status"]')
      ?.classList.contains('connected'),
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
  await cameraPage.waitForFunction(
    () =>
      document.querySelector('.canvas-status')?.textContent.includes('변형 중'),
    undefined,
    { timeout: 6000 },
  );
  assert(
    (await cameraPage.getByTestId('motion-reading').textContent()).includes(
      'CAMERA ESTIMATE',
    ),
  );
  record(
    'Simulated live camera frames drive the real optical-flow pipeline without mouse input or microphone',
  );
  await cameraPage
    .getByRole('button', { name: '움직임 감지 중지', exact: true })
    .click();
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
  record('Stopping camera motion releases the video track and preview');
  const deniedPage = await context.newPage();
  deniedPage.on('pageerror', (e) => errors.push(e.message));
  await deniedPage.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    });
  });
  await deniedPage.goto(`http://127.0.0.1:${port}`);
  await deniedPage
    .getByRole('button', { name: '카메라로 움직임 감지', exact: true })
    .click();
  await deniedPage.waitForFunction(() =>
    document
      .querySelector('[data-testid="motion-status"]')
      ?.classList.contains('denied'),
  );
  assert(
    (await deniedPage.getByTestId('motion-status').textContent()).includes(
      '허용되지',
    ),
  );
  await deniedPage.close();
  record(
    'Camera permission denial is reported without pretending motion detection is connected',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /샘플 사용/ }).click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const stage = await page.locator('.poster-canvas').boundingBox();
  assert(stage.width > 150 && stage.width < 390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  record('Mobile layout has a fitted canvas and no horizontal overflow');
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(`\n${results.length} browser checks passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
