const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// MediaPipe's ES build loads its WebAssembly runtime with a dynamic import() of a
// computed URL, which Metro refuses to bundle. Its CommonJS build loads the same
// runtime with a script tag, so the obstacle camera (web only) uses that one.
const mediapipeVision = path.join(__dirname, 'node_modules/@mediapipe/tasks-vision/vision_bundle.cjs');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  moduleName === '@mediapipe/tasks-vision'
    ? { type: 'sourceFile', filePath: mediapipeVision }
    : resolveRequest
      ? resolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);

module.exports = config;
