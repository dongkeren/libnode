const { exitOnError, run } = require('./node-lib.js');

const [nodeGitUrl, nodeReference] = process.argv.slice(2);

if (nodeGitUrl) {
  process.env.KF_NODE_GIT_URL = nodeGitUrl;
}

if (nodeReference) {
  process.env.KF_NODE_REFERENCE = nodeReference;
}

async function main() {
  run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']);
  run('corepack', ['pnpm', 'prepare-node-source']);
}

if (require.main === module) main().catch(exitOnError);
