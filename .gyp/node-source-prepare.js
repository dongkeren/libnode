const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const release = JSON.parse(fs.readFileSync(path.join(repoRoot, 'libnode.release.json'), 'utf8'));
const gitmodulesPath = path.join(repoRoot, '.gitmodules');
const nodeSrcDir = path.join(repoRoot, 'node');
const defaultNodeUrl = 'https://github.com/nodejs/node.git';

function flag(name) {
  return /^(1|true|yes|on)$/i.test(process.env[name] || '');
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const result = childProcess.spawnSync(cmd, args, {
    cwd: opts.cwd || repoRoot,
    stdio: opts.stdio || 'inherit',
    encoding: opts.encoding,
    windowsHide: true,
  });
  if (opts.check === false) return result;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${result.status}`);
  }
  return result;
}

function output(cmd, args, opts = {}) {
  const result = run(cmd, args, { ...opts, stdio: 'pipe', encoding: 'utf8', check: false });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function gitmodules(key) {
  return output('git', ['config', '-f', gitmodulesPath, '--get', key]);
}

function currentNodeHead() {
  const toplevel = output('git', ['-C', nodeSrcDir, 'rev-parse', '--show-toplevel']);
  if (!toplevel || fs.realpathSync(toplevel) !== fs.realpathSync(nodeSrcDir)) return '';
  return output('git', ['-C', nodeSrcDir, 'rev-parse', 'HEAD']);
}

function nodeIsReady() {
  return currentNodeHead() === release.nodeCommit;
}

function configureSubmodule(url) {
  run('git', ['submodule', 'sync', '--', 'node']);
  run('git', ['config', 'submodule.node.url', url]);
}

function submoduleUpdate(referencePath) {
  const args = ['submodule', 'update', '--init', '--force', '--checkout', '--recursive', '--progress'];
  if (referencePath) {
    args.push('--reference', referencePath);
  }
  args.push('--', 'node');
  return run('git', args, { check: false });
}

function gitPath(gitPathArgs) {
  return output('git', ['rev-parse', '--git-path', ...gitPathArgs]);
}

function resetIncompleteNodeCheckout() {
  if (!fs.existsSync(nodeSrcDir) || currentNodeHead()) return;
  console.warn('removing incomplete node submodule checkout');
  run('git', ['submodule', 'deinit', '-f', '--', 'node'], { check: false });
  const modulesNodeDir = gitPath(['modules/node']);
  if (modulesNodeDir) {
    fs.rmSync(path.resolve(repoRoot, modulesNodeDir), { recursive: true, force: true });
  }
  fs.rmSync(nodeSrcDir, { recursive: true, force: true });
}

function looksLikeSshUrl(url) {
  return /^(ssh:\/\/|git@|[^/]+@[^:]+:)/.test(url || '');
}

function prepareGitNetworkEnv(url) {
  if (!process.env.GIT_TERMINAL_PROMPT) {
    process.env.GIT_TERMINAL_PROMPT = '0';
  }
  if (looksLikeSshUrl(url) && !process.env.GIT_SSH_COMMAND) {
    process.env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15';
  }
}

function maybeReferencePath() {
  const referencePath = process.env.KF_NODE_REFERENCE || process.env.KF_NODE_REFERENCE_IF_ABLE || '';
  if (!referencePath) return '';
  if (fs.existsSync(referencePath)) return referencePath;
  if (flag('KF_NODE_REFERENCE_REQUIRED')) {
    throw new Error(`KF_NODE_REFERENCE does not exist: ${referencePath}`);
  }
  console.warn(`KF_NODE_REFERENCE is not available, continuing without reference: ${referencePath}`);
  return '';
}

function referenceIsShallow(referencePath) {
  return output('git', ['-C', referencePath, 'rev-parse', '--is-shallow-repository']) === 'true';
}

function usableReferencePath() {
  const referencePath = maybeReferencePath();
  if (!referencePath) return '';
  if (!output('git', ['-C', referencePath, 'rev-parse', '--git-dir'])) {
    if (flag('KF_NODE_REFERENCE_REQUIRED')) {
      throw new Error(`KF_NODE_REFERENCE is not a git repository: ${referencePath}`);
    }
    console.warn(`KF_NODE_REFERENCE is not a git repository, continuing without reference: ${referencePath}`);
    return '';
  }
  if (!referenceIsShallow(referencePath)) return referencePath;
  if (flag('KF_NODE_REFERENCE_REQUIRED')) {
    throw new Error(`KF_NODE_REFERENCE is shallow and cannot be used as a git clone reference: ${referencePath}`);
  }
  console.warn(`KF_NODE_REFERENCE is shallow, continuing without reference: ${referencePath}`);
  return '';
}

function useReferenceAlternates(referencePath) {
  if (!referencePath) return;
  const referenceObjects = output('git', ['-C', referencePath, 'rev-parse', '--git-path', 'objects']);
  if (!referenceObjects) return;
  const referenceObjectsPath = path.isAbsolute(referenceObjects)
    ? referenceObjects
    : path.resolve(referencePath, referenceObjects);
  const alternates = output('git', ['-C', nodeSrcDir, 'rev-parse', '--git-path', 'objects/info/alternates']);
  if (!alternates) return;
  const alternatesPath = path.isAbsolute(alternates) ? alternates : path.resolve(nodeSrcDir, alternates);
  fs.mkdirSync(path.dirname(alternatesPath), { recursive: true });
  fs.writeFileSync(alternatesPath, `${referenceObjectsPath}\n`);
}

function updateFrom(url, referencePath) {
  prepareGitNetworkEnv(url);
  configureSubmodule(url);

  if (!currentNodeHead()) {
    fs.mkdirSync(nodeSrcDir, { recursive: true });
    const initResult = run('git', ['-C', nodeSrcDir, 'init'], { check: false });
    if (initResult.status !== 0) {
      console.warn(`node git init failed for ${url}`);
      return false;
    }
    run('git', ['-C', nodeSrcDir, 'remote', 'remove', 'origin'], { check: false });
    const remoteResult = run('git', ['-C', nodeSrcDir, 'remote', 'add', 'origin', url], { check: false });
    if (remoteResult.status !== 0) {
      console.warn(`node remote setup failed for ${url}`);
      return false;
    }
    useReferenceAlternates(referencePath);
  } else {
    run('git', ['-C', nodeSrcDir, 'remote', 'set-url', 'origin', url], { check: false });
  }

  const fetchResult = run(
    'git',
    [
      '-C',
      nodeSrcDir,
      'fetch',
      '--depth=1',
      '--tags',
      '--force',
      '--progress',
      'origin',
      `refs/tags/${release.nodeTag}:refs/tags/${release.nodeTag}`,
    ],
    { check: false },
  );
  if (fetchResult.status !== 0) {
    console.warn(`node fetch failed from ${url}`);
    return false;
  }

  const checkoutResult = run('git', ['-C', nodeSrcDir, 'checkout', '--force', release.nodeCommit], { check: false });
  if (checkoutResult.status === 0) return true;
  console.warn(`node checkout failed from ${url}`);
  return false;
}

function main() {
  const gitmodulesTag = gitmodules('submodule.node.tag');
  if (gitmodulesTag !== release.nodeTag) {
    throw new Error(`node submodule tag mismatch: expected ${release.nodeTag}, got ${gitmodulesTag}`);
  }

  if (nodeIsReady()) {
    console.log(`node source already prepared: ${release.nodeCommit}`);
    return;
  }

  const configuredUrl =
    process.env.KF_NODE_GIT_URL || process.env.KF_NODE_GIT_MIRROR || gitmodules('submodule.node.url') || defaultNodeUrl;
  const referencePath = usableReferencePath();
  resetIncompleteNodeCheckout();
  if (updateFrom(configuredUrl, referencePath)) {
    if (nodeIsReady()) return;
    throw new Error(`node checkout mismatch after update: expected ${release.nodeCommit}, got ${currentNodeHead()}`);
  }

  if (flag('KF_NODE_DISABLE_NETWORK_FALLBACK') || configuredUrl === defaultNodeUrl) {
    throw new Error('node source prepare failed and network fallback is disabled or unavailable');
  }

  console.warn(`retrying node source prepare from ${defaultNodeUrl}`);
  if (!updateFrom(defaultNodeUrl, referencePath) || !nodeIsReady()) {
    throw new Error(`node checkout mismatch after fallback: expected ${release.nodeCommit}, got ${currentNodeHead()}`);
  }
}

main();
