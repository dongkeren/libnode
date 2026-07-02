const fs = require('fs-extra');
const path = require('path');
const sywac = require('sywac');
const { prepareWindowsPythonEnv } = require('./build-env.js');
const { exitOnError, run } = require('./node-lib.js');
const { snapshot, timeSync } = require('./buildchain-diagnostics.js');

const rootDir = path.dirname(__dirname);
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
const addonModuleName = 'link_node';

function runNodeGyp(args) {
  prepareWindowsPythonEnv(process.env);
  return run(process.execPath, [nodeGyp, `--module_name=${addonModuleName}`, ...args], {
    cwd: rootDir,
    env: process.env,
  });
}

async function build() {
  await snapshot('node-gyp-build-start');
  timeSync('node-gyp-configure-build', () => runNodeGyp(['configure', 'build']));
  await snapshot('node-gyp-build-end');
}

async function clean() {
  runNodeGyp(['clean']);
  fs.removeSync(path.join(rootDir, 'dist'));
  fs.removeSync(path.join(rootDir, 'build', 'npm'));
  fs.removeSync(path.join(rootDir, 'build', 'stage'));
}

async function rebuild() {
  await clean();
  await build();
}

async function main() {
  await sywac
    .command('build', {
      desc: 'Build libnode with node-gyp and assemble dist/node',
      run: build,
    })
    .command('clean', {
      desc: 'Clean node-gyp and package staging outputs',
      run: clean,
    })
    .command('rebuild', {
      desc: 'Clean and rebuild libnode',
      run: rebuild,
    })
    .help('-h, --help')
    .version('-v, --version')
    .parseAndExit();
}

if (require.main === module) main().catch(exitOnError);
