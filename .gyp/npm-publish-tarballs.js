const fs = require('fs');
const path = require('path');
const { exitOnError, run } = require('./node-lib.js');

const roots = process.argv.slice(2);

function collectTarballs(root, output) {
  const stat = fs.statSync(root);

  if (stat.isFile()) {
    if (root.endsWith('.tgz')) output.push(path.resolve(root));
    return;
  }

  for (const entry of fs.readdirSync(root)) {
    collectTarballs(path.join(root, entry), output);
  }
}

function isMainPackageTarball(file) {
  return /^kungfu-tech-libnode-[0-9]/.test(path.basename(file));
}

function publishTarball(file) {
  const distTag = process.env.KF_NPM_DIST_TAG || 'latest';
  const args = ['publish', file, '--access', 'public', '--tag', distTag];

  if (process.env.KF_NPM_PUBLISH_DRY_RUN === 'true') {
    args.push('--dry-run');
  }

  run('npm', args);
}

async function main() {
  if (roots.length === 0) {
    throw new Error('Usage: node .gyp/npm-publish-tarballs.js <artifact-dir> [...]');
  }

  const tarballs = [];
  for (const root of roots) {
    collectTarballs(root, tarballs);
  }

  const uniqueByName = new Map();
  for (const file of tarballs) {
    const name = path.basename(file);
    if (!uniqueByName.has(name)) {
      uniqueByName.set(name, file);
    }
  }

  const uniqueTarballs = [...uniqueByName.values()].sort((left, right) => {
    const leftMain = isMainPackageTarball(left);
    const rightMain = isMainPackageTarball(right);
    if (leftMain === rightMain) return left.localeCompare(right);
    return leftMain ? 1 : -1;
  });

  if (uniqueTarballs.length === 0) {
    throw new Error(`No npm tarballs found under: ${roots.join(', ')}`);
  }

  for (const file of uniqueTarballs) {
    publishTarball(file);
  }
}

if (require.main === module) main().catch(exitOnError);
