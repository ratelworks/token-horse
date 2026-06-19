#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoStates, getHorsePixels, getSkinShades, maneFlameShade, partAt } from './horse-token-runner.mjs';

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

function renderFrame(frameIndex, framePath, skin) {
  // 부위별 음영 hex (단색 스킨은 mane/hoof 가 body 와 동일)
  const palettes = {
    body: getSkinShades(skin, 'body'),
    mane: getSkinShades(skin, 'mane'),
    hoof: getSkinShades(skin, 'hoof'),
  };
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
      if (shade <= 0) return;
      const part = partAt(skin, rowIndex, columnIndex, shade);
      // 불꽃 갈기는 음영 대신 일렁이는 불꽃 레벨로 색을 고른다 (런타임 렌더와 동일)
      const eff = part === 'mane' ? (maneFlameShade(skin, rowIndex, columnIndex, frameIndex) ?? shade) : shade;
      pushPixel(args, palettes[part][eff], columnIndex, rowIndex);
    });
  });

  args.push(framePath);
  execFileSync('magick', args, { stdio: 'inherit' });
}

function main() {
  const args = process.argv.slice(2);
  const skin = getStringOption(args, 'skin', 'green');
  const outputFile = getStringOption(args, 'output', skin === 'green' ? 'horse-preview.gif' : `horse-preview-${skin}.gif`);
  const outputPath = join(dirname(fileURLToPath(import.meta.url)), outputFile);
  const workingDir = join(tmpdir(), `horse-token-runner-preview-${process.pid}`);
  const states = createDemoStates(PREVIEW_DURATION_SEC, PREVIEW_FPS);

  if (existsSync(workingDir)) rmSync(workingDir, { recursive: true, force: true });
  mkdirSync(workingDir, { recursive: true });

  states.forEach((state, index) => {
    renderFrame(state.frameIndex, join(workingDir, `frame-${String(index).padStart(3, '0')}.png`), skin);
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
