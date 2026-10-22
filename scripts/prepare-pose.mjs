import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const names = [
  'pose.js',
  'pose_web.binarypb',
  'pose_landmark_lite.tflite',
  'pose_landmark_full.tflite',
  'pose_solution_packed_assets_loader.js',
  'pose_solution_packed_assets.data',
  'pose_solution_simd_wasm_bin.js',
  'pose_solution_simd_wasm_bin.wasm',
  'pose_solution_simd_wasm_bin.data',
  'pose_solution_wasm_bin.js',
  'pose_solution_wasm_bin.wasm',
];
await mkdir('public/pose', { recursive: true });
await Promise.all(
  names.map((name) =>
    copyFile(`node_modules/@mediapipe/pose/${name}`, `public/pose/${name}`),
  ),
);
await writeFile(
  'public/pose/NOTICE.txt',
  'MediaPipe Pose 0.5.1675469404, Copyright Google LLC. Apache-2.0.\nhttps://github.com/google-ai-edge/mediapipe/blob/master/LICENSE\nSDK, WASM and models are copied unchanged from the pinned official @mediapipe/pose npm package.\n',
);
console.log('Prepared self-hosted MediaPipe Pose assets.');
