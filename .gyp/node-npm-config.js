#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PrebuiltHostConfig = 'binary_host_mirror';

const spawnOptsPipe = { stdio: 'pipe', windowsHide: true };

const packageJson = JSON.parse(fs.readFileSync(path.resolve(path.dirname(__dirname), 'package.json')));
const key = packageJson.binary.module_name;
const npmConfigKey = `${key}_${PrebuiltHostConfig}`;
const npmConfigEnvKey = `npm_config_${npmConfigKey}`;

const scope = (source) => `[${source}]`;

function getNpmConfigValue(key) {
  const result = spawnSync('npm', ['config', 'get', key], spawnOptsPipe);
  if (result.status !== 0) {
    return undefined;
  }
  return result.output
    .filter((e) => e && e.length > 0)
    .toString()
    .trimEnd();
}

function showAllConfig() {
  const envConfigValue = process.env[npmConfigEnvKey] || process.env[npmConfigEnvKey.toUpperCase()];
  const userConfigValue = getNpmConfigValue(npmConfigKey);
  const hasUserConfig = userConfigValue && userConfigValue !== 'undefined';
  const value = envConfigValue || (hasUserConfig ? userConfigValue : packageJson.binary.host);
  const source = envConfigValue ? 'env' : hasUserConfig ? 'user' : 'package.json';
  console.log(`[binary] ${npmConfigKey} = ${value} ${scope(source)}`);
}

if (require.main === module) {
  showAllConfig();
}
