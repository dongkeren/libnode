const { exitOnError, run } = require('./node-lib.js');
const { snapshot, timeSync } = require('./buildchain-diagnostics.js');

const [nodeGitUrl, nodeReference] = process.argv.slice(2);

if (nodeGitUrl) {
  process.env.KF_NODE_GIT_URL = nodeGitUrl;
}

if (nodeReference) {
  process.env.KF_NODE_REFERENCE = nodeReference;
}

async function main() {
  await snapshot('install-start');
  timeSync('pnpm-install', () => run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']));
  await snapshot('install-after-pnpm');
  timeSync('prepare-node-source', () => run('corepack', ['pnpm', 'prepare-node-source']));
  await snapshot('install-end');
}

if (require.main === module) main().catch(exitOnError);
