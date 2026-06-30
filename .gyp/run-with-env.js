const childProcess = require('child_process');
const { prepareWindowsPythonEnv } = require('./build-env.js');

const args = process.argv.slice(2);
const delimiterIndex = args.indexOf('--');

if (delimiterIndex <= 0 || delimiterIndex === args.length - 1) {
  console.error('usage: node .gyp/run-with-env.js NAME=value [NAME=value ...] -- command [args ...]');
  process.exit(2);
}

const env = { ...process.env };
for (const assignment of args.slice(0, delimiterIndex)) {
  const index = assignment.indexOf('=');
  if (index <= 0) {
    console.error(`invalid env assignment: ${assignment}`);
    process.exit(2);
  }
  env[assignment.slice(0, index)] = assignment.slice(index + 1);
}

prepareWindowsPythonEnv(env);

const [cmd, ...cmdArgs] = args.slice(delimiterIndex + 1);
console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
const result = childProcess.spawnSync(cmd, cmdArgs, {
  env,
  shell: true,
  stdio: 'inherit',
  windowsHide: true,
});

process.exit(result.status === null ? 1 : result.status);
