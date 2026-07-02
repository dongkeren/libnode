const { exitOnError, patchEnv, run } = require('./node-lib.js');
const { commandExists, prepareWindowsPythonEnv } = require('./build-env.js');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const os = require('os');
const sywac = require('sywac');
const convert = require('xml-js');
const { snapshot, timeSync } = require('./buildchain-diagnostics.js');

const arch = process.arch;
const rootDir = path.dirname(__dirname);
const nodeSrcDir = path.join(rootDir, 'node');
const nodeDistDir = path.join(rootDir, 'dist', 'node');

function flag(name) {
  return /^(1|true|yes|on)$/i.test(process.env[name] || '');
}

function buildJobs() {
  const value = Number(process.env.KF_BUILD_JOBS || '');
  if (Number.isInteger(value) && value > 0) return value;
  return os.cpus().length;
}

function cacheRoot() {
  if (process.env.KF_COMPILER_CACHE_ROOT) return path.resolve(process.env.KF_COMPILER_CACHE_ROOT);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), 'Kungfu', 'build-cache');
  }
  return path.join(os.homedir(), '.cache', 'kungfu', 'build-cache');
}

function ensureEnv(name, value) {
  if (!process.env[name]) process.env[name] = value;
}

function runCacheTool(tool, args) {
  run(tool, args, { check: false });
}

function prepareUnixCompilerCache(mode) {
  if (mode === 'sccache') {
    const sccache = commandExists('sccache');
    if (!sccache) return false;
    ensureEnv('SCCACHE_DIR', path.join(cacheRoot(), 'sccache', 'libnode', `${process.platform}-${arch}`));
    process.env.CC = `sccache ${process.env.CC || (process.platform === 'darwin' ? 'cc' : 'gcc')}`;
    process.env.CXX = `sccache ${process.env.CXX || (process.platform === 'darwin' ? 'c++' : 'g++')}`;
    runCacheTool('sccache', ['--start-server']);
    console.log(`compiler cache: sccache (${process.env.SCCACHE_DIR})`);
    return true;
  }

  const ccache = commandExists('ccache');
  if (!ccache) return false;
  ensureEnv('CCACHE_DIR', path.join(cacheRoot(), 'ccache', 'libnode', `${process.platform}-${arch}`));
  process.env.CC = `ccache ${process.env.CC || (process.platform === 'darwin' ? 'cc' : 'gcc')}`;
  process.env.CXX = `ccache ${process.env.CXX || (process.platform === 'darwin' ? 'c++' : 'g++')}`;
  runCacheTool('ccache', ['--show-stats']);
  console.log(`compiler cache: ccache (${process.env.CCACHE_DIR})`);
  return true;
}

function prepareWindowsCompilerCache(mode) {
  const ccacheDir = process.env.KF_NODE_WIN_CCACHE_PATH || path.dirname(commandExists('ccache') || '');
  if ((mode === 'auto' || mode === 'ccache') && ccacheDir && fs.existsSync(path.join(ccacheDir, 'ccache.exe'))) {
    ensureEnv('CCACHE_DIR', path.join(cacheRoot(), 'ccache', 'libnode', `win32-${arch}`));
    runCacheTool(path.join(ccacheDir, 'ccache.exe'), ['--show-stats']);
    console.log(`compiler cache: ccache (${process.env.CCACHE_DIR})`);
    return ['ccache', ccacheDir];
  }

  const sccache = commandExists('sccache');
  if ((mode === 'auto' || mode === 'sccache') && sccache) {
    ensureEnv('SCCACHE_DIR', path.join(cacheRoot(), 'sccache', 'libnode', `win32-${arch}`));
    runCacheTool('sccache', ['--start-server']);
    console.log(`compiler cache: sccache available (${process.env.SCCACHE_DIR}); vcbuild ccache wrapper not injected`);
  }
  return [];
}

function prepareCompilerCache() {
  if (flag('KF_DISABLE_COMPILER_CACHE')) return [];
  const mode = (process.env.KF_COMPILER_CACHE || 'auto').toLowerCase();
  if (mode === '0' || mode === 'false' || mode === 'off' || mode === 'none') return [];

  if (process.platform === 'win32') {
    return timeSync('prepare-windows-compiler-cache', () => prepareWindowsCompilerCache(mode));
  }

  if (!timeSync('prepare-unix-compiler-cache', () => prepareUnixCompilerCache(mode))) {
    console.log('compiler cache: unavailable');
  }
  return [];
}

function showCompilerCacheStats() {
  timeSync('compiler-cache-stats', () => {
    if (process.env.CCACHE_DIR && commandExists('ccache')) {
      runCacheTool('ccache', ['--show-stats']);
    }
    if (process.env.SCCACHE_DIR && commandExists('sccache')) {
      runCacheTool('sccache', ['--show-stats']);
    }
  });
}

function cleanNodeBuildState() {
  const generatedPaths = ['out', 'Release', 'Debug', 'config.gypi', 'config.mk'];
  for (const entry of generatedPaths) {
    fse.removeSync(path.join(nodeSrcDir, entry));
  }

  for (const entry of fs.readdirSync(nodeSrcDir)) {
    if (/\.(sln|vcxproj|vcxproj\.filters|vcxproj\.user)$/.test(entry)) {
      fse.removeSync(path.join(nodeSrcDir, entry));
    }
  }
}

const runWinPatch = () => {
  // Workaround from https://github.com/nodejs/node/issues/34539
  const loadXml = (filepath) => {
    const xml_raw = fs.readFileSync(filepath).toString();
    const xml_str = xml_raw.replace(/&/g, '&#038;');
    return convert.xml2js(xml_str, { compact: false });
  };
  const buildXml = (obj) => {
    return convert.js2xml(obj, { compact: false, spaces: 2 });
  };
  const fixVcxproj = (filepath, fix) => {
    const vcxproj = loadXml(filepath);
    fix(vcxproj.elements[0]);
    const xml_raw = buildXml(vcxproj).toString();
    const xml_str = xml_raw.replace(/&amp;(?=(apos|quot|[gl]t);|#)/g, '&');
    fs.writeFileSync(filepath, xml_str);
  };
  const libnodeRefs = {};
  fixVcxproj(path.join(nodeSrcDir, 'libnode.vcxproj'), (vcxproj) => {
    const delimiter = ';';
    const winmmLib = 'WinMM.lib';
    for (const itemDefinitionGroup of vcxproj.elements.filter((e) => e.name === 'ItemDefinitionGroup')) {
      const link = itemDefinitionGroup.elements.filter((e) => e.name === 'Link')[0];
      const additionalDependencies = link.elements.filter((e) => e.name === 'AdditionalDependencies')[0];
      var deps = additionalDependencies.elements[0].text.split(delimiter);
      if (!deps.filter((d) => d.toUpperCase() === winmmLib.toUpperCase()).length) {
        deps.push(winmmLib);
      }
      additionalDependencies.elements[0].text = deps.join(delimiter);
    }
    for (const itemGroup of vcxproj.elements.filter((e) => e.name === 'ItemGroup')) {
      itemGroup.elements
        .filter((e) => e.name === 'ProjectReference')
        .forEach((r) => {
          libnodeRefs[r.attributes.Include] = r;
        });
    }
  });
  fixVcxproj(path.join(nodeSrcDir, 'node.vcxproj'), (vcxproj) => {
    for (const itemGroup of vcxproj.elements.filter((e) => e.name === 'ItemGroup')) {
      projectReferences = itemGroup.elements.filter((e) => e.name === 'ProjectReference');
      if (projectReferences.length) {
        itemGroup.elements = itemGroup.elements.filter((e) => {
          return e.name !== 'ProjectReference' || !(e.attributes.Include in libnodeRefs);
        });
      }
    }
  });
};

const buildWin = () => {
  patchEnv();
  timeSync('clean-node-build-state', cleanNodeBuildState);
  timeSync('prepare-windows-python-env', prepareWindowsPythonEnv);
  const cacheArgs = prepareCompilerCache();
  timeSync('vcbuild-projgen', () =>
    run(path.join('.', 'vcbuild.bat'), ['dll', arch, 'release', 'projgen', 'nobuild', ...cacheArgs], {
      cwd: nodeSrcDir,
    }),
  );
  timeSync('windows-vcxproj-patch', runWinPatch);
  timeSync('vcbuild-dll', () =>
    run(path.join('.', 'vcbuild.bat'), ['dll', 'noprojgen', ...cacheArgs], { cwd: nodeSrcDir }),
  );
  showCompilerCacheStats();
};

const buildUnix = () => {
  timeSync('clean-node-build-state', cleanNodeBuildState);
  prepareCompilerCache();
  console.log(`build jobs: ${buildJobs()}`);
  timeSync('node-configure-shared', () => run('sh', [path.join('.', 'configure'), '--shared'], { cwd: nodeSrcDir }));
  timeSync('node-make-shared', () => run('make', ['-j', `${buildJobs()}`], { cwd: nodeSrcDir }));
  showCompilerCacheStats();
};

const build = process.platform === 'win32' ? buildWin : buildUnix;

const stamp = (buildType) => {
  const result = run('git', ['rev-parse', 'HEAD'], { cwd: nodeSrcDir, stdio: 'pipe' });
  const gitHead = result.output
    .filter((e) => e && e.length > 0)
    .toString()
    .trim();
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json')));
  const userInfo = os.userInfo();
  const buildInfo = {
    version: packageJson.version,
    git: {
      revision: gitHead,
    },
    build: {
      user: userInfo.username,
      timestamp: new Date(),
    },
  };
  const targetDir = path.join(rootDir, 'build', buildType);
  fse.ensureDirSync(targetDir);
  const buildInfoFile = path.join(targetDir, 'libnodebuildinfo.json');
  fs.writeFileSync(buildInfoFile, JSON.stringify(buildInfo, null, 2));
};

const cli = sywac
  .path('--build-type', { defaultValue: 'Release' })
  .help('--help')
  .version('--version')
  .outputSettings({ maxWidth: 75 });

module.exports = cli;

async function main() {
  const argv = await cli.parseAndExit();
  await snapshot('node-make-start');
  timeSync('node-native-build', build);
  timeSync('node-native-stamp', () => stamp(argv['build-type']));
  await snapshot('node-make-end');
}

if (require.main === module && !process.env.KF_SKIP_MAKE_LIBNODE) main().catch(exitOnError);
