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
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole('heading', { name: /질서를 흔들고/ }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="element-count"]')?.textContent ===
      '16',
  );
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  record('Desktop loads with 16 independently selectable sample elements');

  async function map() {
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '좌표 · 경로 JSON 저장', exact: true })
      .click();
    const file = await download;
    return JSON.parse(await readFile(await file.path(), 'utf8'));
  }
  const input = page.getByRole('slider', { name: '흔들기 민감도' });
  await input.focus();
  await input.press('Home');
  await page.getByRole('button', { name: '흔들어보기', exact: true }).click();
  await page.waitForTimeout(250);
  assert(
    (await map()).elements.every(
      (e) => Math.abs(e.dx) < 0.01 && Math.abs(e.dy) < 0.01,
    ),
  );
  record('Zero sensitivity keeps every element in its original position');

  await input.focus();
  await input.press('End');
  await page.getByRole('button', { name: '흔들어보기', exact: true }).click();
  await page.waitForTimeout(600);
  await page
    .getByRole('button', { name: '시뮬레이션 일시정지', exact: true })
    .click();
  const moved = await map();
  assert(moved.elements.some((e) => Math.hypot(e.dx, e.dy) > 10));
  assert(moved.elements.some((e) => e.path.length > 1));
  await page.waitForTimeout(250);
  const paused = await map();
  assert.deepEqual(
    moved.elements.map((e) => [e.x, e.y]),
    paused.elements.map((e) => [e.x, e.y]),
  );
  record(
    'Gravity moves elements, records paths, and pause freezes coordinates',
  );

  await page
    .getByRole('button', { name: '포스터 초기화', exact: true })
    .click();
  await page.getByRole('button', { name: /지그재그 ZIGZAG/ }).click();
  await page.getByRole('button', { name: '흔들어보기', exact: true }).click();
  await page.waitForTimeout(300);
  const warped = await map();
  assert(warped.elements.some((e) => e.warp > 5));
  assert(warped.elements.every((e) => e.deformationVertices.length === 18));
  record('Zigzag stores warp amounts and transformed mesh coordinates');

  await page.locator('.layer-item').first().click();
  await page.locator('.vertex-details summary').click();
  assert.equal(await page.locator('.vertex-details tbody tr').count(), 5);
  assert.equal(
    await page
      .locator('.coordinate-grid > span')
      .filter({ hasText: /^POSITION X/ })
      .count(),
    1,
  );
  record(
    'Selecting an element displays numerical positions and five mapped deformation points',
  );

  await page
    .getByRole('button', { name: '포스터 초기화', exact: true })
    .click();
  const canvasBounds = await page.locator('.poster-canvas').boundingBox();
  const cx = canvasBounds.x + canvasBounds.width / 2,
    cy = canvasBounds.y + canvasBounds.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy - 40, { steps: 5 });
  await page.waitForTimeout(80);
  await page.mouse.move(cx - 90, cy + 50, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert((await map()).elements.some((e) => e.warp > 0));
  record('Mouse or trackpad drag drives the physical effect');

  await page
    .getByRole('button', { name: '포스터 초기화', exact: true })
    .click();
  await page.getByRole('button', { name: /조각나기 FRACTURE/ }).click();
  await page.getByRole('button', { name: '흔들어보기', exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="element-count"]')?.textContent,
      ) > 16,
    undefined,
    { timeout: 6000 },
  );
  const broken = await map();
  assert(broken.elements.some((e) => e.kind === 'fragment' && e.parentId));
  assert(
    broken.elements
      .filter((e) => e.kind === 'fragment')
      .every((e) => e.collisionVertices.length === 3),
  );
  record('Actual collisions generate triangular fragments with parent IDs');

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
    await page
      .getByLabel('포스터 파일 선택')
      .setInputFiles({
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
  await page
    .getByLabel('포스터 파일 선택')
    .setInputFiles({
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

  await page
    .getByLabel('포스터 파일 선택')
    .setInputFiles({
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
