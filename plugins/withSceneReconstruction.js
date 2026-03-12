const { withInfoPlist } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to enable scene reconstruction for LiDAR mesh.
 * 
 * ViroReact manages its own ARSession, so we can't directly configure it.
 * Instead, we add a capability flag that our native module checks at runtime.
 * The native module will attempt to reconfigure the session to add .mesh reconstruction.
 */
const withSceneReconstruction = (config) => {
  return withInfoPlist(config, (config) => {
    // Add a custom key to signal that scene reconstruction should be enabled
    config.modResults.LidarMeshEnabled = true;
    
    // Ensure AR usage description exists
    if (!config.modResults.NSCameraUsageDescription) {
      config.modResults.NSCameraUsageDescription = 
        'This app uses the camera for augmented reality features including LiDAR room scanning.';
    }
    
    return config;
  });
};

module.exports = withSceneReconstruction;
