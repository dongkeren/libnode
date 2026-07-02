const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function lifecycleSummary(validation) {
  return (validation.lifecycleStages || []).map((stage) => `${stage.name}:${stage.mode}`).join(', ');
}

async function main() {
  const buildchain = await import('@kungfu-tech/buildchain');
  const loadedConfig = buildchain.loadBuildchainConfig(rootDir);
  const validation = buildchain.validateBuildchainConfig(rootDir, {
    requireVersionState: true,
    requireLifecycleStages: ['install', 'build', 'verify', 'publish'],
  });
  const versionStrategy = buildchain.getVersionStrategy(loadedConfig);
  const publish = buildchain.getPublishContract(loadedConfig);

  console.log(
    `buildchain config ok: ${versionStrategy.strategy}/${versionStrategy.next}, lifecycle [${lifecycleSummary(
      validation,
    )}], publish ${publish.mode}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
