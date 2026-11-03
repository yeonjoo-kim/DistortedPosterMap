import { copyFile, mkdir, writeFile } from 'node:fs/promises';
const files = [
  'holistic.js',
  'holistic.binarypb',
  'holistic_solution_packed_assets.data',
  'holistic_solution_packed_assets_loader.js',
  'holistic_solution_simd_wasm_bin.data',
  'holistic_solution_simd_wasm_bin.js',
  'holistic_solution_simd_wasm_bin.wasm',
  'holistic_solution_wasm_bin.js',
  'holistic_solution_wasm_bin.wasm',
  'pose_landmark_lite.tflite',
  'pose_landmark_full.tflite',
];
await mkdir('public/tracking', { recursive: true });
await Promise.all(
  files.map((file) =>
    copyFile(
      `node_modules/@mediapipe/holistic/${file}`,
      `public/tracking/${file}`,
    ),
  ),
);
await writeFile(
  'public/tracking/NOTICE.txt',
  'MediaPipe Holistic 0.5.1675471629. Copyright Google LLC. Apache-2.0.\nhttps://github.com/google-ai-edge/mediapipe/blob/master/LICENSE\nSDK, models and WASM copied unchanged from the pinned official npm package.\n',
);
console.log('Prepared local body, face and hand tracking assets.');
