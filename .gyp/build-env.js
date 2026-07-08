const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const defaultWindowsPythonUrl =
  'http://192.168.100.222:8088/python-build-standalone/20260610/cpython-3.13.14+20260610-x86_64-pc-windows-msvc-install_only_stripped.tar.gz';
const defaultWindowsPythonSha256 = '2933d50847057b9131ff89578a220b9206c40fd6bc34d0c12afb716bd9bf8fc9';

function pathKey(env) {
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
}

function prependPath(env, dir) {
  if (!dir) return;
  const key = pathKey(env);
  env[key] = `${dir}${path.delimiter}${env[key] || ''}`;
  console.log(`PATH += ${dir}`);
}

function commandOutput(cmd, argv, env = process.env) {
  const result = childProcess.spawnSync(cmd, argv, {
    encoding: 'utf8',
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function commandExists(command, env = process.env) {
  if (process.platform === 'win32') {
    return commandOutput('where', [command], env).split(/\r?\n/).filter(Boolean)[0] || '';
  }
  return commandOutput('sh', ['-c', `command -v ${command}`], env);
}

function pythonDirFromPyLauncher(env = process.env) {
  const result = childProcess.spawnSync('py', ['-3', '-c', 'import os,sys; print(os.path.dirname(sys.executable))'], {
    encoding: 'utf8',
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function sha256File(filepath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filepath));
  return hash.digest('hex');
}

function runDirect(cmd, argv, env = process.env) {
  console.log(`$ ${cmd} ${argv.join(' ')}`);
  const result = childProcess.spawnSync(cmd, argv, {
    env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}

function downloadWindowsPython(url, archivePath, env = process.env) {
  const powershell =
    commandExists('pwsh', env) || commandExists('powershell.exe', env) || commandExists('powershell', env);
  if (!powershell) {
    console.error('Windows Python cache bootstrap requires PowerShell or pwsh');
    process.exit(1);
  }
  runDirect(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${archivePath}'`,
    ],
    env,
  );
}

function usePython(env, pythonExe, options = {}) {
  if (options.force) {
    env.PYTHON = pythonExe;
  } else {
    env.PYTHON = env.PYTHON || pythonExe;
  }
  prependPath(env, path.dirname(pythonExe));
  return pythonExe;
}

function ensureWindowsPythonFromCache(env = process.env) {
  const url = env.KF_WINDOWS_PYTHON_URL || defaultWindowsPythonUrl;
  const expectedSha256 = env.KF_WINDOWS_PYTHON_SHA256 || defaultWindowsPythonSha256;
  const toolsDir = path.resolve('.buildchain', 'tools', 'python-windows');
  const archivePath = path.join(toolsDir, path.basename(url));
  const pythonDir = path.join(toolsDir, 'python');
  const pythonExe = path.join(pythonDir, 'python.exe');

  if (fs.existsSync(pythonExe)) {
    return usePython(env, pythonExe);
  }

  fs.mkdirSync(toolsDir, { recursive: true });
  if (!fs.existsSync(archivePath) || sha256File(archivePath) !== expectedSha256) {
    downloadWindowsPython(url, archivePath, env);
  }
  const actualSha256 = sha256File(archivePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Windows Python cache checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }

  runDirect('tar', ['-xzf', archivePath, '-C', toolsDir], env);
  if (!fs.existsSync(pythonExe)) {
    throw new Error(`Windows Python cache did not produce ${pythonExe}`);
  }
  return usePython(env, pythonExe);
}

function prepareWindowsPythonEnv(env = process.env) {
  if (process.platform !== 'win32') return '';
  const configuredPython = env.KF_WINDOWS_PYTHON_EXE || env.KF_WINDOWS_SYSTEM_PYTHON || '';
  if (configuredPython && fs.existsSync(configuredPython)) {
    return usePython(env, configuredPython, { force: true });
  }
  const existingPython = env.PYTHON || commandExists('python.exe', env);
  if (existingPython) return usePython(env, existingPython);

  const pyLauncherDir = pythonDirFromPyLauncher(env);
  const pyLauncherPython = path.join(pyLauncherDir, 'python.exe');
  if (pyLauncherDir && fs.existsSync(pyLauncherPython)) {
    return usePython(env, pyLauncherPython);
  }
  return ensureWindowsPythonFromCache(env);
}

module.exports = {
  commandExists,
  prepareWindowsPythonEnv,
};
