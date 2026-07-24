const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Add support for .cjs files
config.resolver.sourceExts.push('cjs');

// Block gradle and build directories
config.resolver.blockList = [
  /node_modules\/.*\/\.gradle\/.*/,
  /node_modules\/.*\/bin\/\.gradle\/.*/,
];

module.exports = config;
