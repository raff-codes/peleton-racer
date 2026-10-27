const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// three >= 0.186 ships an ESM-only build; its `require` entry (three.cjs) is a shim that calls
// `process.emitWarning`, which doesn't exist in React Native. R3F's native bundle `require`s three,
// so always resolve the bare specifier to the ES module build.
const threeModule = path.join(path.dirname(require.resolve('three', { paths: [__dirname] })), 'three.module.js');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: threeModule };
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
