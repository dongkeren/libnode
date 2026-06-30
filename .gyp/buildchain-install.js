const { exitOnError, run } = require('./node-lib.js');

const [nodeGitUrl, nodeReference] = process.argv.slice(2);

if (nodeGitUrl) {
  process.env.KF_NODE_GIT_URL = nodeGitUrl;
}

if (nodeReference) {
  process.env.KF_NODE_REFERENCE = nodeReference;
}

async function main() {
  run('corepack', ['yarn', '--network-timeout=5000000', 'install', '--frozen-lockfile', '--ignore-scripts']);
  run('node', ['.gyp/node-npm-config.js']);
  run('corepack', ['yarn', 'prepare-node-source']);
}

if (require.main === module) main().catch(exitOnError);
