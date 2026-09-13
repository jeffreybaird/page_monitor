import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { loadEnv } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
if (process.argv.slice(2).some((arg) => arg !== '--release')) {
  throw new Error('Usage: node scripts/package-submission.mjs [--release]');
}
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options });
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const configPath = join(root, 'docs/submission/release.json');
const config = existsSync(configPath) ? json(configPath) : {};
const productIds = Object.fromEntries(
  [
    ['chrome', 'production'],
    ['firefox', 'firefox'],
  ].map(([browser, mode]) => [
    browser,
    loadEnv(mode, root, 'VITE_').VITE_EXTPAY_EXTENSION_ID?.trim() || null,
  ]),
);
const blockers = [];
for (const [browser, id] of Object.entries(productIds)) {
  if (id && !/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error(`Invalid public product ID for ${browser}.`);
  if (!id) {
    blockers.push(`Configure a valid VITE_EXTPAY_EXTENSION_ID for ${browser}.`);
  }
}
if (
  !existsSync(join(root, 'LICENSE')) ||
  !readFileSync(join(root, 'LICENSE'), 'utf8').trim()
) {
  blockers.push('Add the project LICENSE after resolving distribution rights.');
}
function isPublicHttps(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.hostname.includes('.') &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        url.hostname,
      ) &&
      !/\.(localhost|local|test|invalid|example)$/.test(url.hostname) &&
      !/(^|\.)example\.(com|net|org)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
for (const key of ['privacyUrl', 'supportUrl', 'sourceAvailabilityUrl']) {
  if (!isPublicHttps(config[key]))
    blockers.push(`Set a public HTTPS ${key} in docs/submission/release.json.`);
}
const attestations = Object.fromEntries(
  [
    'livePaymentsVerified',
    'firefoxConsentVerified',
    'privacyPolicyPublished',
  ].map((key) => [key, config[key] === true]),
);
for (const [key, verified] of Object.entries(attestations)) {
  if (!verified)
    blockers.push(
      `Complete ${key} and set it to true in docs/submission/release.json.`,
    );
}
if (release && blockers.length) {
  throw new Error(
    `Release preflight failed before building:\n${blockers.join('\n')}`,
  );
}

const tracked = run('git', ['ls-files', '-z']).split('\0').filter(Boolean);
const rootFiles = new Set([
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'eslint.config.js',
  'playwright.config.ts',
  'sidepanel.html',
  'offscreen.html',
  'README.md',
  'LICENSE',
]);
const allowed = (name) =>
  (rootFiles.has(name) || /^(src|public|scripts|docs|tests)\//.test(name)) &&
  !name
    .split('/')
    .some(
      (part) =>
        part.startsWith('.') ||
        /^(AGENTS\.md|CLAUDE\.md|node_modules)$/i.test(part),
    ) &&
  !/(^|\/)(credentials?|secrets?)(\.|\/|$)|\.(pem|key|p12|pfx)$/i.test(name);
const sourceFiles = tracked.filter(allowed).sort();
const untrackedSource = run('git', [
  'ls-files',
  '--others',
  '--exclude-standard',
  '-z',
])
  .split('\0')
  .filter((name) => name && allowed(name));
for (const name of untrackedSource) {
  blockers.push(
    `Track ${name} so the source archive includes the working build inputs.`,
  );
}
for (const required of [
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'scripts/package-submission.mjs',
  'docs/submission/build.md',
]) {
  if (!sourceFiles.includes(required))
    blockers.push(`Track ${required} before final packaging.`);
}
if (release && blockers.length) throw new Error(blockers.join('\n'));
const version = json(join(root, 'package.json')).version;
if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error('Invalid package version.');
const buildInfo = {
  version,
  mode: release ? 'release' : 'candidate',
  ready: release && blockers.length === 0,
  blockers,
  productIds,
  attestations,
  privacyUrl: isPublicHttps(config.privacyUrl) ? config.privacyUrl : null,
  supportUrl: isPublicHttps(config.supportUrl) ? config.supportUrl : null,
  sourceAvailabilityUrl: isPublicHttps(config.sourceAvailabilityUrl)
    ? config.sourceAvailabilityUrl
    : null,
  node: process.version,
  npm: run('npm', ['--version']).trim(),
  commit: run('git', ['rev-parse', 'HEAD']).trim(),
  workingTreeDirty: Boolean(run('git', ['status', '--porcelain']).trim()),
  generatedAt: new Date().toISOString(),
};
const staging = mkdtempSync(join(tmpdir(), 'page-monitor-submission-'));
const output = join(root, 'artifacts/submission/packages');
const archives = [];
function filesBelow(directory, prefix = '') {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(join(directory, name));
      if (stat.isSymbolicLink())
        throw new Error(`Refusing symlink: ${relative}`);
      return stat.isDirectory()
        ? filesBelow(join(directory, name), relative)
        : [relative];
    });
}
function copyFiles(from, to, files) {
  for (const file of files) {
    if (!lstatSync(join(from, file)).isFile())
      throw new Error(`Not a regular file: ${file}`);
    mkdirSync(dirname(join(to, file)), { recursive: true });
    copyFileSync(join(from, file), join(to, file));
  }
}
function archive(directory, label) {
  const name = `page-monitor-${version}-${label}${release ? '' : '-candidate'}.zip`;
  const path = join(staging, name);
  const files = filesBelow(directory);
  if (files.some((file) => /[\r\n]/.test(file)))
    throw new Error('Archive filenames cannot contain newlines.');
  run('zip', ['-X', '-q', path, '-@'], {
    cwd: directory,
    input: files.join('\n') + '\n',
  });
  const contents = run('unzip', ['-Z1', path]).trim().split('\n').sort();
  if (JSON.stringify(contents) !== JSON.stringify(files))
    throw new Error(`Archive contents mismatch: ${name}`);
  run('unzip', ['-tq', path]);
  archives.push({
    name,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    files: contents.length,
  });
}
try {
  for (const [browser, script, directory] of [
    ['chrome', 'build', 'dist'],
    ['firefox', 'build:firefox', 'dist-firefox'],
  ]) {
    rmSync(join(root, directory), { recursive: true, force: true });
    run('npm', ['run', script], {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_EXTPAY_EXTENSION_ID: productIds[browser] ?? '',
      },
    });
    const built = join(root, directory);
    const manifest = json(join(built, 'manifest.json'));
    if (manifest.version !== version)
      throw new Error(`${browser} manifest/package version mismatch.`);
    const entrypoints = [
      manifest.action?.default_popup,
      manifest.side_panel?.default_path,
      manifest.sidebar_action?.default_panel,
      manifest.background?.service_worker,
      ...(manifest.background?.scripts ?? []),
      ...Object.values(manifest.icons ?? {}),
    ].filter(Boolean);
    if (
      !entrypoints.length ||
      entrypoints.some((file) => !existsSync(join(built, file)))
    )
      throw new Error(`${browser} manifest entry point missing.`);
    const destination = join(staging, browser);
    copyFiles(built, destination, filesBelow(built));
    writeFileSync(
      join(destination, 'BUILD-INFO.json'),
      JSON.stringify(buildInfo, null, 2) + '\n',
    );
    archive(destination, browser);
  }
  const source = join(staging, 'source');
  copyFiles(root, source, sourceFiles);
  for (const [packageName, input, outputName] of [
    ['extpay', 'dist/ExtPay.module.js', 'ExtPay.module.js'],
    [
      'webextension-polyfill',
      'dist/browser-polyfill.js',
      'browser-polyfill.js',
    ],
  ]) {
    const destination = join(source, 'third-party', packageName);
    mkdirSync(destination, { recursive: true });
    const installed = join(root, 'node_modules', packageName);
    for (const [from, to] of [
      [input, outputName],
      ['LICENSE', 'LICENSE'],
      ['package.json', 'package.json'],
    ]) {
      if (!lstatSync(join(installed, from)).isFile())
        throw new Error(
          `Missing regular dependency source: ${packageName}/${from}`,
        );
      copyFileSync(join(installed, from), join(destination, to));
    }
  }

  writeFileSync(
    join(source, 'BUILD-INFO.json'),
    JSON.stringify(buildInfo, null, 2) + '\n',
  );
  writeFileSync(
    join(source, 'REBUILD.md'),
    `# Rebuild Page Monitor ${version}\n\nUse Node ${buildInfo.node} and npm ${buildInfo.npm}. Run \`npm ci\`. To restore or modify the included library inputs, follow the third-party replacement commands in docs/submission/build.md. Then:\n\n\`\`\`sh\nVITE_EXTPAY_EXTENSION_ID='${productIds.chrome ?? ''}' npm run build\nVITE_EXTPAY_EXTENSION_ID='${productIds.firefox ?? ''}' npm run build:firefox\n\`\`\`\n\nChrome output: dist/. Firefox output: dist-firefox/. The ID is public configuration, not a credential. BUILD-INFO.json is packaging metadata and is added after building; executable assets do not depend on it. See docs/submission/build.md.\n`,
  );
  archive(source, 'source');
  // Publish only a complete set of freshly verified archives.
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const { name } of archives)
    copyFileSync(join(staging, name), join(output, name));
  writeFileSync(
    join(output, 'SHA256SUMS'),
    archives.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n') + '\n',
  );
  writeFileSync(
    join(output, 'report.json'),
    JSON.stringify({ ...buildInfo, archives }, null, 2) + '\n',
  );
  process.stdout.write(
    `${release ? 'Release' : 'Candidate'} archives prepared in ${output}.\n${blockers.join('\n')}\n`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
