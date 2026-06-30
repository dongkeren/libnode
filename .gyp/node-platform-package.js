const childProcess = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const sywac = require('sywac');
const { exitOnError } = require('./node-lib.js');

const rootDir = path.dirname(__dirname);
const distDir = path.join(rootDir, 'dist', 'node');
const stageDir = path.resolve(rootDir, process.env.KF_PACKAGE_STAGE_DIR || path.join('build', 'stage', 'npm'));
const packageBuildDir = path.join(rootDir, 'build', 'npm');

const platformPackages = [
  {
    key: 'darwin-arm64',
    name: '@kungfu-tech/libnode-darwin-arm64',
    os: ['darwin'],
    cpu: ['arm64'],
  },
  {
    key: 'linux-x64',
    name: '@kungfu-tech/libnode-linux-x64',
    os: ['linux'],
    cpu: ['x64'],
  },
  {
    key: 'win32-x64',
    name: '@kungfu-tech/libnode-win32-x64',
    os: ['win32'],
    cpu: ['x64'],
  },
];

function readJson(file) {
  return fs.readJsonSync(path.join(rootDir, file));
}

function writeJson(file, value) {
  fs.writeJsonSync(file, value, { spaces: 2 });
  fs.appendFileSync(file, '\n');
}

function rootPackageJson() {
  return readJson('package.json');
}

function packageDirName(packageName) {
  return packageName.replace(/^@/, '').replace('/', '-');
}

function currentPlatformPackage() {
  const key = `${process.platform}-${process.arch}`;
  const descriptor = platformPackages.find((item) => item.key === key);

  if (!descriptor) {
    throw new Error(`Unsupported libnode platform package target: ${key}`);
  }

  return descriptor;
}

function copyIfExists(source, target) {
  if (fs.existsSync(source)) {
    fs.copySync(source, target, { dereference: false });
  }
}

function basePackageJson(sourcePackageJson, name, description) {
  return {
    name,
    version: sourcePackageJson.version,
    description,
    license: sourcePackageJson.license,
    author: sourcePackageJson.author,
    repository: sourcePackageJson.repository,
    publishConfig: sourcePackageJson.publishConfig,
  };
}

function optionalDependencyMap(version) {
  return Object.fromEntries(platformPackages.map((item) => [item.name, version]));
}

function writePackageReadme(packageRoot, packageName, description) {
  fs.writeFileSync(path.join(packageRoot, 'README.md'), `# ${packageName}\n\n${description}\n`);
}

function writePlatformIndex(packageRoot) {
  fs.writeFileSync(
    path.join(packageRoot, 'index.js'),
    [
      "const path = require('path');",
      '',
      "const distDir = path.join(__dirname, 'dist', 'node');",
      "exports.include = path.join(distDir, 'include');",
      'exports.libpath = distDir;',
      '',
    ].join('\n'),
  );
}

function prepareMainPackage() {
  const sourcePackageJson = rootPackageJson();
  const packageRoot = path.join(packageBuildDir, 'libnode');
  fs.emptyDirSync(packageRoot);

  const packageJson = {
    ...basePackageJson(
      sourcePackageJson,
      sourcePackageJson.name,
      'libnode entrypoint package with platform-specific optional dependencies',
    ),
    main: sourcePackageJson.main,
    files: ['src/js/', 'libnode.release.json', 'LICENSE', 'README.md'],
    optionalDependencies: optionalDependencyMap(sourcePackageJson.version),
  };

  writeJson(path.join(packageRoot, 'package.json'), packageJson);
  fs.copySync(path.join(rootDir, 'src', 'js'), path.join(packageRoot, 'src', 'js'));
  copyIfExists(path.join(rootDir, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
  copyIfExists(path.join(rootDir, 'libnode.release.json'), path.join(packageRoot, 'libnode.release.json'));
  writePackageReadme(
    packageRoot,
    sourcePackageJson.name,
    'This package resolves the matching libnode platform package at runtime.',
  );

  return packageRoot;
}

function preparePlatformPackage(descriptor) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Missing ${path.relative(rootDir, distDir)}. Run the build lifecycle before packaging.`);
  }

  const sourcePackageJson = rootPackageJson();
  const packageRoot = path.join(packageBuildDir, packageDirName(descriptor.name));
  fs.emptyDirSync(packageRoot);

  const packageJson = {
    ...basePackageJson(sourcePackageJson, descriptor.name, `libnode binaries for ${descriptor.key}`),
    main: 'index.js',
    files: ['index.js', 'dist/', 'libnode.release.json', 'LICENSE', 'README.md'],
    os: descriptor.os,
    cpu: descriptor.cpu,
  };

  writeJson(path.join(packageRoot, 'package.json'), packageJson);
  fs.copySync(distDir, path.join(packageRoot, 'dist', 'node'), {
    dereference: false,
  });
  copyIfExists(path.join(rootDir, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
  copyIfExists(path.join(rootDir, 'libnode.release.json'), path.join(packageRoot, 'libnode.release.json'));
  writePackageReadme(packageRoot, descriptor.name, `This package contains libnode binaries for ${descriptor.key}.`);
  writePlatformIndex(packageRoot);

  return packageRoot;
}

function npmPack(packageRoot) {
  fs.ensureDirSync(stageDir);
  const result = childProcess.spawnSync('npm', ['pack', '--pack-destination', stageDir], {
    cwd: packageRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${packageRoot}`);
  }
}

function shouldPackMain() {
  if (process.env.KF_PACK_MAIN_PACKAGE === 'true') return true;
  if (process.env.KF_PACK_MAIN_PACKAGE === 'false') return false;
  return process.platform === 'linux' && process.arch === 'x64';
}

async function packMain() {
  npmPack(prepareMainPackage());
}

async function packPlatform() {
  npmPack(preparePlatformPackage(currentPlatformPackage()));
}

async function pack() {
  await packPlatform();

  if (shouldPackMain()) {
    await packMain();
  }
}

async function verifySource() {
  const sourcePackageJson = rootPackageJson();
  const scripts = sourcePackageJson.scripts || {};

  if (sourcePackageJson.binary) {
    throw new Error('package.json must not define a node-pre-gyp binary block');
  }

  if (sourcePackageJson.dependencies?.['@mapbox/node-pre-gyp']) {
    throw new Error('package.json must not depend on @mapbox/node-pre-gyp');
  }

  for (const scriptName of ['preinstall', 'install', 'prebuild']) {
    if (scripts[scriptName]) {
      throw new Error(`package.json must not define ${scriptName}`);
    }
  }

  for (const descriptor of platformPackages) {
    if (!descriptor.name.startsWith(`${sourcePackageJson.name}-`)) {
      throw new Error(`Unexpected platform package name: ${descriptor.name}`);
    }
  }
}

async function main() {
  await sywac
    .command('pack', {
      desc: 'Pack the current platform package and, on linux-x64, the main package',
      run: pack,
    })
    .command('pack-main', {
      desc: 'Pack the main package with optional platform dependencies',
      run: packMain,
    })
    .command('pack-platform', {
      desc: 'Pack the current platform package',
      run: packPlatform,
    })
    .command('verify-source', {
      desc: 'Verify that source package metadata no longer uses node-pre-gyp',
      run: verifySource,
    })
    .help('-h, --help')
    .version('-v, --version')
    .parseAndExit();
}

if (require.main === module) main().catch(exitOnError);
