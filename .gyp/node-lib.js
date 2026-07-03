const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.exitOnError = function (error) {
  console.error(error);
  process.exit(-1);
};

exports.patchEnv = function () {
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('NPM_') || key.startsWith('npm_')) {
      delete process.env[key];
    }
  });
};

exports.run = function (cmd, argv, opts = {}) {
  opts.check = opts.check === undefined || opts.check;
  opts.cwd = fs.realpathSync(path.resolve(opts.cwd || process.cwd()));
  console.log(`$ ${cmd} ${argv.join(' ')}`);
  const result = spawnSync(cmd, argv, {
    shell: process.platform === 'win32',
    stdio: 'inherit',
    windowsHide: true,
    ...opts,
  });
  if (opts.check && (result.error || result.status === null || result.status !== 0)) {
    if (result.error) {
      console.error(result.error.message);
    }
    if (result.signal) {
      console.error(`${cmd} exited with signal ${result.signal}`);
    }
    process.exit(result.status === null ? 1 : result.status);
  }
  return result;
};
