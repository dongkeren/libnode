const { exitOnError } = require('./node-lib.js');
const childProcess = require('child_process');
const fse = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');
const sywac = require('sywac');

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
  const boolEnv = (name) => /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
  const falseEnv = (name) => /^(0|false|no|off)$/i.test(String(process.env[name] || '').trim());
  const formatBytes = (value) => `${(value / 1024 / 1024).toFixed(1)} MiB`;
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
  const stripArgs = (p) => {
    const mode = process.env.KF_STRIP_LIBNODE_MODE || 'release';

    if (process.platform === 'darwin' && path.extname(p) === '.dylib') {
      return mode === 'debug' ? ['-S', p] : ['-x', p];
    }

    if (process.platform === 'linux' && path.basename(p).startsWith('libnode.so')) {
      return mode === 'debug' ? ['--strip-debug', p] : ['--strip-unneeded', p];
    }

    return [];
  };
  const stripNativeOutputs = () => {
    if (boolEnv('KF_DISABLE_STRIP_LIBNODE') || falseEnv('KF_STRIP_LIBNODE')) {
      console.log('libnode dist strip disabled');
      return;
    }

    const strip = process.env.KF_STRIP_LIBNODE_TOOL || (process.platform === 'darwin' ? '/usr/bin/strip' : 'strip');
    const files = globFiles(path.join(nodeDistDir, 'libnode*'))
      .filter((p) => fse.lstatSync(p).isFile())
      .map((p) => ({ path: p, args: stripArgs(p) }))
      .filter((item) => item.args.length > 0);

    if (files.length === 0) {
      console.log(`libnode dist strip skipped on ${process.platform}`);
      return;
    }

    for (const item of files) {
      const before = fse.statSync(item.path).size;
      const result = childProcess.spawnSync(strip, item.args, { encoding: 'utf8' });
      if (result.error || result.status !== 0) {
        const reason = result.error ? result.error.message : result.stderr || result.stdout || `exit ${result.status}`;
        throw new Error(`Failed to strip ${path.relative(rootDir, item.path)}: ${reason}`);
      }
      const after = fse.statSync(item.path).size;
      console.log(`stripped ${path.relative(rootDir, item.path)}: ${formatBytes(before)} -> ${formatBytes(after)}`);
    }
  };

  fse.ensureDirSync(nodeDistDir);
  fse.emptyDirSync(nodeDistDir);

  copyFiles(path.join(rootDir, 'build', buildType, '*.*'));
  copyFiles(path.join(rootDir, 'node', buildType, 'libnode*'));
  copyFiles(path.join(rootDir, 'node', 'out', buildType, 'libnode*'));
  stripNativeOutputs();

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
  dist(argv['build-type']);
}

if (require.main === module) main().catch(exitOnError);
