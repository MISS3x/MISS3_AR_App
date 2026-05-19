require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ARRulerNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = { "Radim Petruska" => "radim.petruska@gmail.com" }
  s.homepage       = 'https://github.com/MISS3x/MISS3_AR_App'
  s.platform       = :ios, '13.0'
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/MISS3x/MISS3_AR_App' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'GLTFSceneKit'
  s.dependency 'Euclid', '~> 0.8'

  s.source_files = "**/*.{h,m,mm,swift,cpp}"
end
