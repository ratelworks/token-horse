#!/usr/bin/env node
// OSS 위생 게이트 — publish/CI에서 내부 정보 누출과 버전 불일치를 차단한다.
// 위반 발견 시 exit 1 (prepublishOnly가 npm publish를 차단).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_FILES = ['README.md', 'README.ko.md', 'CHANGELOG.md', 'package.json', 'AGENTS.md', 'THREAT_MODEL.md'];
const FORBIDDEN_PATTERNS = [
  [/\/Users\/[A-Za-z]+/u, '로컬 절대 경로'],
  [/dev\/(A_|Agent_HQ)\//u, '내부 작업공간 경로'],
  [/[A-Za-z0-9._%+-]+@gmail\.com/u, '개인 이메일'],
  [/\b\d{3}-\d{2}-\d{5}\b/u, '사업자등록번호 형식'],
  [/\b\d{6}-\d{7}\b/u, '법인등록번호 형식'],
];

let violations = 0;

for (const fileName of TARGET_FILES) {
  const filePath = join(ROOT, fileName);
  if (!existsSync(filePath)) continue;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const [pattern, label] of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`[hygiene] ${fileName}:${index + 1} — ${label}: ${line.trim().slice(0, 80)}`);
        violations += 1;
      }
    }
  });
}

// 버전 동기화: package.json version == CHANGELOG 최신 헤더
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const latestHeader = changelog.match(/^## \[?(\d+\.\d+\.\d+)\]?/mu)?.[1];
if (latestHeader !== pkg.version) {
  console.error(`[hygiene] 버전 불일치 — package.json ${pkg.version} ≠ CHANGELOG 최신 헤더 ${latestHeader ?? '(없음)'}`);
  violations += 1;
}

if (violations > 0) {
  console.error(`[hygiene] ${violations}건 위반 — publish 차단`);
  process.exit(1);
}
console.log('[hygiene] OK');
