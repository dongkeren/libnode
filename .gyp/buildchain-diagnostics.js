const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const diagnosticsRoot = path.join(rootDir, 'build', 'stage', 'buildchain-diagnostics');

function platformId() {
  return process.env.BUILDCHAIN_PLATFORM_ID || `${process.platform}-${process.arch}`;
}

function safeName(value) {
  return String(value || 'unnamed')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function output(cmd, args, opts = {}) {
  const result = childProcess.spawnSync(cmd, args, {
    cwd: opts.cwd || rootDir,
    env: opts.env || process.env,
    encoding: 'utf8',
    shell: opts.shell || false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || 15000,
    windowsHide: true,
  });
  return {
    command: [cmd, ...args].join(' '),
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function commandExists(command) {
  const result =
    process.platform === 'win32'
      ? output('where', [command], { timeout: 5000 })
      : output('sh', ['-c', `command -v ${command}`], { timeout: 5000 });
  return result.status === 0 && result.stdout ? result.stdout.split(/\r?\n/)[0] : '';
}

function selectedEnv() {
  const names = [
    'BUILDCHAIN_SOURCE_SHA',
    'BUILDCHAIN_SOURCE_REF',
    'BUILDCHAIN_PLATFORM_ID',
    'BUILDCHAIN_PLATFORM_NAME',
    'BUILDCHAIN_VERSION',
    'BUILDCHAIN_CHANNEL',
    'RUNNER_NAME',
    'RUNNER_OS',
    'RUNNER_ARCH',
    'RUNNER_TEMP',
    'RUNNER_TOOL_CACHE',
    'GITHUB_ACTION',
    'GITHUB_ACTIONS',
    'GITHUB_ACTOR',
    'GITHUB_EVENT_NAME',
    'GITHUB_JOB',
    'GITHUB_REF',
    'GITHUB_REF_NAME',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_RUN_ID',
    'GITHUB_SHA',
    'GITHUB_WORKSPACE',
    'KF_COMPILER_CACHE',
    'KF_NODE_DISABLE_NETWORK_FALLBACK',
    'KF_NODE_GIT_MIRROR',
    'KF_NODE_GIT_URL',
    'KF_NODE_REFERENCE',
    'KF_NODE_REFERENCE_IF_ABLE',
    'KF_NODE_REFERENCE_REQUIRED',
    'KF_PACK_MAIN_PACKAGE',
    'KF_PACKAGE_STAGE_DIR',
    'KF_SKIP_FALLBACK_BUILD',
    'CC',
    'CXX',
    'CCACHE_BASEDIR',
    'CCACHE_DIR',
    'CCACHE_MAXSIZE',
    'CMAKE_BUILD_PARALLEL_LEVEL',
    'GYP_MSVS_VERSION',
    'JOBS',
    'MAKEFLAGS',
    'NUMBER_OF_PROCESSORS',
    'PYTHON',
    'SCCACHE_CACHE_SIZE',
    'SCCACHE_DIR',
    'SCCACHE_IDLE_TIMEOUT',
    'npm_config_jobs',
  ];

  const env = {};
  for (const name of names) {
    if (process.env[name] === undefined) continue;
    env[name] = redact(name, process.env[name]);
  }
  return env;
}

function redact(name, value) {
  if (/(TOKEN|PASSWORD|SECRET|KEY|AUTH|COOKIE|CREDENTIAL)/i.test(name)) return '<redacted>';
  return value;
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { error: error.message };
  }
}

async function buildchainToolkitSnapshot() {
  try {
    const buildchain = await import('@kungfu-tech/buildchain');
    const loadedConfig = buildchain.loadBuildchainConfig(rootDir);
    const validation = buildchain.validateBuildchainConfig(rootDir, {
      requireVersionState: true,
      requireLifecycleStages: ['install', 'build', 'verify', 'publish'],
    });
    const workspace = buildchain.getWorkspaceInfo ? buildchain.getWorkspaceInfo(rootDir) : undefined;

    return {
      import: '@kungfu-tech/buildchain',
      versionStrategy: buildchain.getVersionStrategy(loadedConfig),
      publish: buildchain.getPublishContract(loadedConfig),
      anchorManifest: buildchain.loadConfiguredAnchorManifest(rootDir, loadedConfig),
      lifecycleStages: {
        install: buildchain.getLifecycleStage(loadedConfig, 'install'),
        build: buildchain.getLifecycleStage(loadedConfig, 'build'),
        verify: buildchain.getLifecycleStage(loadedConfig, 'verify'),
        publish: buildchain.getLifecycleStage(loadedConfig, 'publish'),
      },
      packageManager: {
        detected: buildchain.detectPackageManager ? buildchain.detectPackageManager(rootDir) : undefined,
        workspace,
      },
      validation,
    };
  } catch (error) {
    return {
      import: '@kungfu-tech/buildchain',
      error: error.message,
    };
  }
}

function statPath(file) {
  try {
    const stat = fs.lstatSync(file);
    return {
      exists: true,
      type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      target: stat.isSymbolicLink() ? fs.readlinkSync(file) : undefined,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    return { exists: false, error: error.message };
  }
}

function dirStats(dir) {
  const result = { path: path.relative(rootDir, dir) || '.', exists: false, files: 0, dirs: 0, symlinks: 0, bytes: 0 };
  if (!fs.existsSync(dir)) return result;
  result.exists = true;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      result.error = error.message;
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        result.dirs += 1;
        stack.push(full);
      } else if (entry.isSymbolicLink()) {
        result.symlinks += 1;
      } else if (entry.isFile()) {
        result.files += 1;
        try {
          result.bytes += fs.statSync(full).size;
        } catch {
          // Best-effort diagnostics only.
        }
      }
    }
  }
  return result;
}

function gitSnapshot() {
  return {
    rootHead: output('git', ['rev-parse', 'HEAD']),
    rootStatus: output('git', ['status', '--short', '--untracked-files=no']),
    nodeHead: output('git', ['-C', 'node', 'rev-parse', 'HEAD']),
    nodeStatus: output('git', ['-C', 'node', 'status', '--short', '--untracked-files=no']),
    nodeCountObjects: output('git', ['-C', 'node', 'count-objects', '-vH'], { timeout: 30000 }),
  };
}

function toolSnapshot() {
  const tools = {};
  const commands = [
    ['node', ['--version']],
    ['corepack', ['--version']],
    ['pnpm', ['--version']],
    ['python', ['--version']],
    ['python3', ['--version']],
    ['git', ['--version']],
    ['ccache', ['--version']],
    ['sccache', ['--version']],
    ['clang', ['--version']],
    ['gcc', ['--version']],
    ['cmake', ['--version']],
    ['ninja', ['--version']],
  ];
  for (const [cmd, args] of commands) {
    if (!commandExists(cmd)) continue;
    tools[cmd] = output(cmd, args, { timeout: 15000 });
  }
  return tools;
}

function cacheSnapshot() {
  const npmCache =
    process.platform === 'win32'
      ? output('cmd.exe', ['/c', 'npm config get cache 2>nul'])
      : output('sh', ['-c', 'npm config get cache 2>/dev/null || true'], { timeout: 10000 });
  const caches = {
    ccacheStats: commandExists('ccache') ? output('ccache', ['-s'], { timeout: 30000 }) : undefined,
    sccacheStats: commandExists('sccache') ? output('sccache', ['--show-stats'], { timeout: 30000 }) : undefined,
    paths: {
      ccacheDir: process.env.CCACHE_DIR ? statPath(process.env.CCACHE_DIR) : undefined,
      sccacheDir: process.env.SCCACHE_DIR ? statPath(process.env.SCCACHE_DIR) : undefined,
      npmCache,
    },
  };
  return caches;
}

function platformSnapshot() {
  const snapshot = {};
  if (process.platform === 'darwin') {
    snapshot.sysctl = output('sysctl', [
      '-n',
      'hw.ncpu',
      'hw.physicalcpu',
      'hw.logicalcpu',
      'hw.perflevel0.physicalcpu',
      'hw.perflevel0.logicalcpu',
      'hw.perflevel1.physicalcpu',
      'hw.perflevel1.logicalcpu',
      'machdep.cpu.brand_string',
    ]);
    snapshot.xcode = commandExists('xcodebuild') ? output('xcodebuild', ['-version'], { timeout: 20000 }) : undefined;
    snapshot.thermal = commandExists('pmset') ? output('pmset', ['-g', 'therm'], { timeout: 10000 }) : undefined;
  } else if (process.platform === 'linux') {
    snapshot.nproc = output('nproc', []);
    snapshot.lscpu = output('lscpu', [], { timeout: 15000 });
    snapshot.memory = output('free', ['-h']);
  } else if (process.platform === 'win32') {
    snapshot.version = output('cmd.exe', ['/c', 'ver']);
    snapshot.processor = output(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | ConvertTo-Json -Compress',
      ],
      { timeout: 20000 },
    );
    snapshot.cl = output('cmd.exe', ['/c', 'where cl']);
  }
  return snapshot;
}

async function snapshotPayload(phase) {
  return {
    schema: 1,
    contract: 'kungfu-libnode-buildchain-diagnostics',
    phase,
    timestamp: nowIso(),
    platform: {
      id: platformId(),
      processPlatform: process.platform,
      processArch: process.arch,
      runnerOs: process.env.RUNNER_OS || '',
      runnerArch: process.env.RUNNER_ARCH || '',
    },
    process: {
      pid: process.pid,
      node: process.version,
      execPath: process.execPath,
      cwd: process.cwd(),
      rootDir,
    },
    os: {
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      loadavg: os.loadavg(),
      uptime: os.uptime(),
    },
    env: selectedEnv(),
    package: readJsonIfExists(path.join(rootDir, 'package.json')),
    release: readJsonIfExists(path.join(rootDir, 'libnode.release.json')),
    buildchain: await buildchainToolkitSnapshot(),
    git: gitSnapshot(),
    tools: toolSnapshot(),
    caches: cacheSnapshot(),
    platformDetails: platformSnapshot(),
    paths: {
      node: statPath(path.join(rootDir, 'node')),
      distNode: statPath(path.join(rootDir, 'dist', 'node')),
      buildStage: statPath(path.join(rootDir, 'build', 'stage')),
      buildRelease: statPath(path.join(rootDir, 'build', 'Release')),
    },
    dirStats: {
      dist: dirStats(path.join(rootDir, 'dist')),
      buildStage: dirStats(path.join(rootDir, 'build', 'stage')),
      buildNpm: dirStats(path.join(rootDir, 'build', 'npm')),
    },
  };
}

function writeJson(file, payload) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function appendStepSummary(markdown) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function snapshot(phase) {
  const payload = await snapshotPayload(phase);
  const file = path.join(diagnosticsRoot, platformId(), `${safeName(phase)}.json`);
  writeJson(file, payload);
  console.log(`buildchain_diagnostics=${path.relative(rootDir, file).split(path.sep).join('/')}`);
  appendStepSummary(
    `### libnode diagnostics: ${phase}\n\n\`${path.relative(rootDir, file).split(path.sep).join('/')}\`\n`,
  );
  return payload;
}

function timingFile(name) {
  return path.join(diagnosticsRoot, platformId(), `timing-${safeName(name)}.json`);
}

function writeTiming(name, start, end, status, extra = {}) {
  const payload = {
    schema: 1,
    contract: 'kungfu-libnode-buildchain-timing',
    name,
    platform: platformId(),
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    durationMs: end.getTime() - start.getTime(),
    status,
    ...extra,
  };
  const file = timingFile(name);
  writeJson(file, payload);
  console.log(`buildchain_timing=${path.relative(rootDir, file).split(path.sep).join('/')}`);
  appendStepSummary(`- ${name}: ${payload.durationMs} ms (${status})`);
  return payload;
}

function timeSync(name, fn) {
  const start = new Date();
  console.log(`::group::libnode ${name}`);
  try {
    const value = fn();
    writeTiming(name, start, new Date(), 'ok');
    return value;
  } catch (error) {
    writeTiming(name, start, new Date(), 'failed', { error: error.message });
    throw error;
  } finally {
    console.log('::endgroup::');
  }
}

function timeCommand(name, command, args) {
  return timeSync(name, () => {
    console.log(`$ ${command} ${args.join(' ')}`);
    const result = childProcess.spawnSync(command, args, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.status !== 0) {
      process.exit(result.status === null ? 1 : result.status);
    }
    return result;
  });
}

function printUsage() {
  console.error('usage: node .gyp/buildchain-diagnostics.js snapshot <phase>');
  console.error('   or: node .gyp/buildchain-diagnostics.js time <name> -- <command> [args...]');
}

async function main() {
  const [command, name, separator, ...rest] = process.argv.slice(2);
  if (command === 'snapshot' && name) {
    await snapshot(name);
    return;
  }
  if (command === 'time' && name && separator === '--' && rest.length) {
    timeCommand(name, rest[0], rest.slice(1));
    return;
  }
  printUsage();
  process.exit(2);
}

module.exports = {
  snapshot,
  timeSync,
};

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
