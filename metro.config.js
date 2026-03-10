const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push(
  'glb', 'gltf', 'obj', 'mtl', 'vrx', 'hdr', 'bin', 'arobject'
);

module.exports = config;
