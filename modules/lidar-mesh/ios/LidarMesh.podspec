Pod::Spec.new do |s|
  s.name           = 'LidarMesh'
  s.version        = '1.0.0'
  s.summary        = 'ARKit LiDAR mesh scanning for Expo'
  s.description    = 'Enables ARKit scene reconstruction and provides mesh wireframe data'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

