const { exitOnError } = require('./node-lib.js');
const fse = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');
const sywac = require('sywac');
const { snapshot, timeSync } = require('./buildchain-diagnostics.js');

const rootDir = path.dirname(__dirname);

const dist = (buildType) => {
  const nodeDistDir = path.join(rootDir, 'dist', 'node');
  const exts = ['.json', '.node', '.dylib', '.so', '.dll', '.lib'];

  const globFiles = (pattern) =>
    globSync(pattern, {
      nodir: true,
      windowsPathsNoEscape: true,
    });
  const include = (p) => path.basename(p).includes('.so.') || exts.includes(path.extname(p));
  const match = (p) => fse.lstatSync(p).isFile() && include(p);
  const copy = (p) => fse.copySync(p, path.join(nodeDistDir, path.basename(p)));
  const copyFiles = (pattern) => globFiles(pattern).filter(match).forEach(copy);
  const copyHeaders = (source) => {
    const target = path.join(nodeDistDir, 'include');
    const sourceRoot = path.resolve(source);
    globFiles(path.join(sourceRoot, '**', '*.h')).forEach((p) => {
      const header = path.resolve(p);
      fse.copySync(header, path.join(target, path.relative(sourceRoot, header)));
    });
  };
  const makeSymbolLink = (pattern, ext) => {
    const target = path.join(nodeDistDir, `libnode.${ext}`);
    const link = (p) => fse.symlinkSync(path.basename(p), target);
    globFiles(path.join(nodeDistDir, pattern)).sort().reverse().slice(0, 1).forEach(link);
  };

  fse.ensureDirSync(nodeDistDir);
  fse.emptyDirSync(nodeDistDir);

  copyFiles(path.join(rootDir, 'build', buildType, '*.*'));
  copyFiles(path.join(rootDir, 'node', buildType, 'libnode*'));
  copyFiles(path.join(rootDir, 'node', 'out', buildType, 'libnode*'));

  copyHeaders(path.join(rootDir, 'node', 'src'));
  copyHeaders(path.join(rootDir, 'node', 'deps', 'v8', 'include'));
  copyHeaders(path.join(rootDir, 'node', 'deps', 'uv', 'include'));

  makeSymbolLink('libnode.*.dylib', 'dylib');
  makeSymbolLink('libnode.so.*', 'so');
};

const cli = sywac
  .path('--build-type', { defaultValue: 'Release' })
  .help('--help')
  .version('--version')
  .outputSettings({ maxWidth: 75 });

module.exports = cli;

async function main() {
  const argv = await cli.parseAndExit();
  await snapshot('node-dist-start');
  timeSync('node-dist-assemble', () => dist(argv['build-type']));
  await snapshot('node-dist-end');
}

if (require.main === module) main().catch(exitOnError);
