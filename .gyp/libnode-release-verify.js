const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const releasePath = path.join(repoRoot, 'libnode.release.json');
const packagePath = path.join(repoRoot, 'package.json');
const gitmodulesPath = path.join(repoRoot, '.gitmodules');
const nodeSrcDir = path.join(repoRoot, 'node');

const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
}

function git(args, opts = {}) {
  const result = childProcess.spawnSync('git', args, {
    cwd: opts.cwd || repoRoot,
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    windowsHide: true,
  });
  if (opts.check === false) {
    return result;
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    fail(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function gitmodules(key) {
  return git(['config', '-f', gitmodulesPath, '--get', key]);
}

function verifyReleaseManifest() {
  if (release.schema !== 1) fail('libnode.release.json schema must be 1');
  if (!/^\d+\.\d+\.\d+$/.test(release.nodeVersion)) fail('nodeVersion must be x.y.z');
  assertEqual(release.nodeTag, `v${release.nodeVersion}`, 'nodeTag');
  if (!/^[0-9a-f]{40}$/.test(release.nodeCommit)) fail('nodeCommit must be a 40-char sha1');
  if (!Number.isInteger(release.libnodeRevision) || release.libnodeRevision < 0) {
    fail('libnodeRevision must be a non-negative integer');
  }
  assertEqual(release.npmVersion, `${release.nodeVersion}-kf.${release.libnodeRevision}`, 'npmVersion');
}

function verifyPackageVersion() {
  assertEqual(packageJson.version, release.npmVersion, 'package.json version');
  if (!packageJson.name || !packageJson.name.startsWith('@kungfu-tech/')) {
    fail('package name must use @kungfu-tech scope');
  }
}

function verifySubmoduleContract() {
  assertEqual(gitmodules('submodule.node.path'), 'node', 'node submodule path');
  assertEqual(gitmodules('submodule.node.tag'), release.nodeTag, 'node submodule tag');
}

function verifyNodeCheckout() {
  const toplevel = git(['-C', nodeSrcDir, 'rev-parse', '--show-toplevel'], { check: false });
  const nodeTopLevel = (toplevel.stdout || '').trim();
  if (toplevel.status !== 0 || fs.realpathSync(nodeTopLevel) !== fs.realpathSync(nodeSrcDir)) {
    fail('node source is not initialized; run pnpm prepare-node-source');
  }
  const head = git(['-C', nodeSrcDir, 'rev-parse', 'HEAD']);
  assertEqual(head, release.nodeCommit, 'node checkout commit');
}

verifyReleaseManifest();
verifyPackageVersion();
verifySubmoduleContract();
verifyNodeCheckout();
console.log(
  `libnode release contract ok: node ${release.nodeTag} (${release.nodeCommit}) -> npm ${release.npmVersion}`,
);
