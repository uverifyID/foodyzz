const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for .cjs files
config.resolver.sourceExts.push('cjs');

// Block gradle and build directories
config.resolver.blockList = [
  /node_modules\/.*\/\.gradle\/.*/,
  /node_modules\/.*\/bin\/\.gradle\/.*/,
];

module.exports = config;
