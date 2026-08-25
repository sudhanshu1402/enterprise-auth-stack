#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ponytail: width is glyph-count * CELL, so a face wider than 0.6em clips; fix is a real text shaper.
const CELL = 8.4;
const LINE = 22;
const PAD = 26;
const BAR = 38;

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

const COLOR = {
  bg: '#0d1117',
  bar: '#161b22',
  panel: '#161b22',
  chrome: '#30363d',
  head: '#e6edf3',
  dim: '#7d8590',
  text: '#c9d1d9',
  bad: '#f85149',
  warn: '#d29922',
  good: '#3fb950',
  cool: '#58a6ff',
};

function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A quote in a label would close the attribute early and break the whole file.
function attr(text) {
  return escape(text).replace(/"/g, '&quot;');
}

// SVG collapses runs of spaces, so alignment is held by non-breaking spaces of the same width.
function cells(text) {
  return escape(text).replace(/ /g, '\u00a0');
}

function frame(width, height, title, ariaLabel = title) {
  const dots = ['#ff5f57', '#febc2e', '#28c840']
    .map((fill, i) => `<circle cx="${20 + i * 18}" cy="19" r="6" fill="${fill}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${attr(ariaLabel)}">
  <rect width="${width}" height="${height}" rx="10" fill="${COLOR.bg}" stroke="${COLOR.chrome}"/>
  <path d="M0 10a10 10 0 0 1 10-10h${width - 20}a10 10 0 0 1 10 10v28H0z" fill="${COLOR.bar}"/>
  ${dots}
  <text x="${PAD + 48}" y="23" font-family="${MONO}" font-size="12" fill="${COLOR.dim}">${escape(title)}</text>`;
}

function box(lines, title) {
  return {
    width: Math.round(Math.max(...lines.map((l) => l.length), title.length + 24) * CELL + PAD * 2),
    height: BAR + lines.length * LINE + PAD,
  };
}

// The verdict word decides the tint; everything before it stays plain body text.
function colorOf(line) {
  if (/verify .*\bok\b/.test(line)) return COLOR.good;
  if (/FAILED/.test(line)) return COLOR.bad;
  if (/^rotate\b/.test(line)) return COLOR.warn;
  return COLOR.text;
}

function bodyLine(line, x, y) {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="14" font-weight="500" fill="${colorOf(line)}">${cells(line)}</text>`;
}

// A blank or changed capture must fail the build, not quietly redraw the picture.
function must(lines, expected) {
  for (const want of expected) {
    if (!lines.some((line) => want.test(line))) {
      throw new Error(`${want} is missing from the captured output:\n${lines.join('\n')}`);
    }
  }
  return lines;
}

// GitHub Actions colours vitest output, which made the summary filter match nothing.
function plain(out) {
  return out.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');
}

const DEMO_ENV = {
  ...process.env,
  TZ: 'UTC',
  NO_COLOR: '1',
  DOTENV_CONFIG_QUIET: 'true',
  NODE_ENV: 'development',
};

function demoLines() {
  const out = execFileSync(
    join(ROOT, 'node_modules', '.bin', 'ts-node'),
    ['--transpile-only', join(ROOT, 'scripts', 'demo-sign-verify-rotate.ts')],
    { encoding: 'utf8', env: DEMO_ENV, cwd: ROOT },
  );
  const lines = plain(out).replace(/\n+$/, '').split('\n');
  return must(lines, [
    /^sign\s+tenant-acme admin -> token issued, exp 3600s$/,
    /^verify token ok\s+sub=okta\|demo-user role=admin tenantId=tenant-acme$/,
    /^rotate JWT_SECRET_DEV_ONLY -> new value$/,
    /^verify old token against rotated secret: FAILED \(signature invalid\)$/,
    /^sign\s+tenant-acme admin -> token issued under rotated secret$/,
    /^verify new token ok\s+sub=okta\|demo-user role=admin tenantId=tenant-acme$/,
  ]);
}

function testCounts() {
  const out = execFileSync(
    join(ROOT, 'node_modules', '.bin', 'vitest'),
    ['run'],
    { encoding: 'utf8', env: DEMO_ENV, cwd: ROOT },
  );
  const lines = plain(out).split('\n');
  must(lines, [/Test Files\s+\d+ passed/, /Tests\s+\d+ passed/]);
  const files = lines.find((l) => /Test Files\s+\d+ passed/.test(l));
  const tests = lines.find((l) => /Tests\s+\d+ passed/.test(l));
  const suiteCount = files.match(/(\d+) passed/)[1];
  const testCount = tests.match(/(\d+) passed/)[1];
  return { suiteCount, testCount };
}

function demo() {
  const command = 'ts-node scripts/demo-sign-verify-rotate.ts';
  const lines = [`$ ${command}`, ...demoLines()];
  const title = 'sign, verify, rotate';
  const { width, height } = box(lines, title);
  const rows = lines
    .map((line, i) => {
      const y = BAR + 16 + i * LINE;
      if (i === 0) {
        return `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="14" font-weight="500"><tspan fill="${COLOR.good}">$&#160;</tspan><tspan fill="${COLOR.head}">${cells(command)}</tspan></text>`;
      }
      return bodyLine(line, PAD, y);
    })
    .join('\n    ');
  const label =
    'sign, verify, rotate: issueInternalToken signs a JWT and jwt.verify accepts it; ' +
    'the signing secret rotates; the old token FAILS verification against the rotated ' +
    'secret; a new token issued under the rotated secret verifies clean';
  return `${frame(width, height, title, label)}
  ${rows}
</svg>
`;
}

function glance() {
  const { suiteCount, testCount } = testCounts();
  const tiles = [
    ['IDENTITY IN', 'SAML 2.0', 'Okta, Azure, OneLogin', COLOR.cool],
    ['PROVISIONING', 'SCIM 2.0', 'create, patch, delete', COLOR.cool],
    ['FAILURE IT STOPS', 'stale cert', 'resolved fresh per login', COLOR.warn],
    ['VERIFIED', `${testCount} tests`, `0 network, ${suiteCount} suites`, COLOR.good],
  ];
  // 195px tile holds 24 glyphs at font-size 12, 14 at font-size 16.
  for (const [, big, small] of tiles) {
    if (small.length > 24 || big.length > 14) throw new Error(`tile text too long: ${big} / ${small}`);
  }
  const width = 880;
  const height = 150;
  const boxes = tiles
    .map(([role, big, small, fill], i) => {
      const x = 20 + i * 215;
      return `<rect x="${x}" y="30" width="195" height="96" rx="8" fill="${COLOR.panel}" stroke="${COLOR.chrome}"/>
    <text x="${x + 16}" y="56" fill="${COLOR.dim}" font-size="11" letter-spacing="1">${role}</text>
    <text x="${x + 16}" y="82" fill="${fill}" font-size="16" font-weight="600">${cells(big)}</text>
    <text x="${x + 16}" y="106" fill="${COLOR.dim}" font-size="12">${cells(small)}</text>`;
    })
    .join('\n    ');
  const label =
    `enterprise-auth-stack at a glance: SAML 2.0 identity in from Okta, Azure or OneLogin, ` +
    `SCIM 2.0 provisioning, the failure it stops is a stale cert resolved fresh per login, ` +
    `verified by ${testCount} tests across ${suiteCount} suites with no network calls`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${attr(label)}">
  <rect width="${width}" height="${height}" rx="10" fill="${COLOR.bg}" stroke="${COLOR.chrome}"/>
  <g font-family="${MONO}">
    ${boxes}
  </g>
</svg>
`;
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
for (const [name, markup] of [
  ['glance.svg', glance()],
  ['demo.svg', demo()],
]) {
  writeFileSync(join(ROOT, 'assets', name), markup);
  process.stdout.write(`wrote assets/${name}\n`);
}
