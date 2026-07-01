const fs = require('fs-extra');
const path = require('path');
const sywac = require('sywac');
const { prepareWindowsPythonEnv } = require('./build-env.js');
const { exitOnError, run } = require('./node-lib.js');

const rootDir = path.dirname(__dirname);
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');
const addonModuleName = 'link_node';

function runNodeGyp(args) {
  prepareWindowsPythonEnv(process.env);
  run(process.execPath, [nodeGyp, `--module_name=${addonModuleName}`, ...args], {
    cwd: rootDir,
    env: process.env,
  });
}

async function build() {
  runNodeGyp(['configure', 'build']);
  run(process.execPath, ['.gyp/node-dist.js'], {
    cwd: rootDir,
    env: process.env,
  });
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
