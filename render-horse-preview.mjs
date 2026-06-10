#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoStates, getGreenShades, getHorsePixels } from './horse-token-runner.mjs';

const PREVIEW_DURATION_SEC = 6;
const PREVIEW_FPS = 16;
const PIXEL_SIZE = 4;
const PADDING_X = 14;
const PADDING_Y = 8;
const BACKGROUND = '#050708';

function getStringOption(args, name, fallback) {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function pushPixel(args, color, x, y) {
  const left = PADDING_X + x * PIXEL_SIZE;
  const top = PADDING_Y + y * PIXEL_SIZE;
  args.push('-fill', color, '-draw', `rectangle ${left},${top} ${left + PIXEL_SIZE - 1},${top + PIXEL_SIZE - 1}`);
}

function renderFrame(frameIndex, framePath) {
  const shades = getGreenShades();
  const rows = getHorsePixels(frameIndex);
  const outputWidth = PADDING_X * 2 + rows[0].length * PIXEL_SIZE;
  const outputHeight = PADDING_Y * 2 + rows.length * PIXEL_SIZE;
  const args = [
    '-size',
    `${outputWidth}x${outputHeight}`,
    `xc:${BACKGROUND}`,
  ];

  rows.forEach((row, rowIndex) => {
    row.forEach((shade, columnIndex) => {
      if (shade > 0) pushPixel(args, shades[shade], columnIndex, rowIndex);
    });
  });

  args.push(framePath);
  execFileSync('magick', args, { stdio: 'inherit' });
}

function main() {
  const args = process.argv.slice(2);
  const outputFile = getStringOption(args, 'output', 'horse-preview.gif');
  const outputPath = join(dirname(fileURLToPath(import.meta.url)), outputFile);
  const workingDir = join(tmpdir(), `horse-token-runner-preview-${process.pid}`);
  const states = createDemoStates(PREVIEW_DURATION_SEC, PREVIEW_FPS);

  if (existsSync(workingDir)) rmSync(workingDir, { recursive: true, force: true });
  mkdirSync(workingDir, { recursive: true });

  states.forEach((state, index) => {
    renderFrame(state.frameIndex, join(workingDir, `frame-${String(index).padStart(3, '0')}.png`));
  });

  const framePaths = readdirSync(workingDir)
    .filter((fileName) => fileName.endsWith('.png'))
    .sort()
    .map((fileName) => join(workingDir, fileName));

  execFileSync('magick', ['-delay', '6', ...framePaths, '-loop', '0', outputPath], { stdio: 'inherit' });
  rmSync(workingDir, { recursive: true, force: true });
  console.log(outputPath);
}

main();
