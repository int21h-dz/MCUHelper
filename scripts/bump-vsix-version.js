#!/usr/bin/env node
/**
 * Двухуровневая версия MAJOR.MINOR: MAJOR задаётся аргументом (из package-vsix.bat),
 * MINOR — max(release, package.json) для этого MAJOR + 1.
 * В package.json пишется MAJOR.MINOR.0 (semver для vsce), в лог — MAJOR.MINOR.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');
const pkgPath = path.join(root, 'extension', 'package.json');
const vsixPrefix = 'mcuhelper-vscode-';
const vsixSuffix = '.vsix';
const versionFieldRe = /("version"\s*:\s*")(\d+\.\d+(?:\.\d+)?)(")/;

const args = process.argv.slice(2);
const noBump = args.includes('--no-bump') || args.includes('-n');
const majorArg = args.find((a) => a !== '--no-bump' && a !== '-n');
const releaseMajor = Number.parseInt(majorArg ?? process.env.RELEASE_MAJOR ?? '0', 10);
if (!Number.isFinite(releaseMajor) || releaseMajor < 0) {
  console.error('ОШИБКА: укажите неотрицательный MAJOR (аргумент или RELEASE_MAJOR).');
  process.exit(1);
}

/** @param {string} s */
function parseVersion(s) {
  const text = String(s).trim();
  const legacy = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (legacy) return { major: +legacy[1], minor: +legacy[2] };
  const twoLevel = /^(\d+)\.(\d+)$/.exec(text);
  if (twoLevel) return { major: +twoLevel[1], minor: +twoLevel[2] };
  return null;
}

/** @param {string} fileName */
function versionFromVsixName(fileName) {
  if (!fileName.startsWith(vsixPrefix) || !fileName.endsWith(vsixSuffix)) return null;
  return parseVersion(fileName.slice(vsixPrefix.length, -vsixSuffix.length));
}

/** @param {{ major: number, minor: number } | null} current @param {{ major: number, minor: number }} candidate */
function pickMaxMinor(current, candidate) {
  if (candidate.major !== releaseMajor) return current;
  if (!current || candidate.minor > current.minor) return candidate;
  return current;
}

const pkgText = fs.readFileSync(pkgPath, 'utf8');
const versionMatch = versionFieldRe.exec(pkgText);
if (!versionMatch) {
  console.error(`ОШИБКА: поле version не найдено в ${pkgPath}`);
  process.exit(1);
}

/** @type {{ major: number, minor: number } | null} */
const currentParsed = parseVersion(versionMatch[2]);
if (!currentParsed) {
  console.error(`ОШИБКА: некорректная версия в ${pkgPath}: ${versionMatch[2]}`);
  process.exit(1);
}

if (noBump) {
  const currentLabel = `${currentParsed.major}.${currentParsed.minor}`;
  process.stderr.write(`Версия без инкремента: ${currentLabel}\n`);
  process.stdout.write(versionMatch[2]);
  process.exit(0);
}

/** @type {{ major: number, minor: number } | null} */
let maxVer = pickMaxMinor(null, currentParsed);

if (fs.existsSync(releaseDir)) {
  for (const name of fs.readdirSync(releaseDir)) {
    const fromFile = versionFromVsixName(name);
    if (fromFile) maxVer = pickMaxMinor(maxVer, fromFile);
  }
}

const nextMinor = (maxVer?.minor ?? 0) + 1;
const nextLabel = `${releaseMajor}.${nextMinor}`;
const nextVersion = `${nextLabel}.0`;
const prevLabel = maxVer ? `${maxVer.major}.${maxVer.minor}` : `${releaseMajor}.0`;

const updatedPkgText = pkgText.replace(versionFieldRe, `$1${nextVersion}$3`);
fs.writeFileSync(pkgPath, updatedPkgText, 'utf8');

process.stderr.write(`Версия релиза: ${prevLabel} -> ${nextLabel}\n`);
process.stdout.write(nextVersion);
