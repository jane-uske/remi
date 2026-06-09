#!/usr/bin/env ruby
# Generates RemiWatch.xcodeproj: a single-target, standalone watchOS SwiftUI app.
# Re-runnable — it rebuilds the project from the Swift sources next to this script.
#
# Requires the `xcodeproj` gem:  gem install --user-install xcodeproj
require "xcodeproj"
require "fileutils"

ROOT      = File.expand_path(__dir__)
PROJ_PATH = File.join(ROOT, "RemiWatch.xcodeproj")
SRC_DIR   = File.join(ROOT, "RemiWatch")
BUNDLE_ID = "run.remi.watch"

FileUtils.rm_rf(PROJ_PATH)

project = Xcodeproj::Project.new(PROJ_PATH)

target = project.new_target(
  :application,
  "RemiWatch",
  :watchos,
  "10.0"
)

# Group + file refs for every Swift source and the asset catalog.
group = project.new_group("RemiWatch", "RemiWatch")
swift_files = Dir.glob(File.join(SRC_DIR, "*.swift")).sort
swift_files.each do |path|
  ref = group.new_reference(path)
  target.add_file_references([ref])
end

assets = group.new_reference(File.join(SRC_DIR, "Assets.xcassets"))
target.add_resources([assets])

# Info.plist lives in the source dir; reference it but do not compile/bundle it.
group.new_reference(File.join(SRC_DIR, "Info.plist"))

common = {
  "PRODUCT_NAME"                          => "$(TARGET_NAME)",
  "PRODUCT_BUNDLE_IDENTIFIER"             => BUNDLE_ID,
  "SDKROOT"                               => "watchos",
  "TARGETED_DEVICE_FAMILY"                => "4",
  "WATCHOS_DEPLOYMENT_TARGET"             => "10.0",
  "SWIFT_VERSION"                         => "5.0",
  "GENERATE_INFOPLIST_FILE"               => "NO",
  "INFOPLIST_FILE"                        => "RemiWatch/Info.plist",
  "ASSETCATALOG_COMPILER_APPICON_NAME"    => "AppIcon",
  "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "AccentColor",
  "CODE_SIGN_STYLE"                       => "Automatic",
  "CODE_SIGNING_REQUIRED"                 => "NO",
  "CODE_SIGNING_ALLOWED"                  => "NO",
  "MARKETING_VERSION"                     => "1.0",
  "CURRENT_PROJECT_VERSION"               => "1",
  "SWIFT_EMIT_LOC_STRINGS"                => "YES",
  "ENABLE_PREVIEWS"                       => "YES",
}

target.build_configurations.each do |config|
  config.build_settings.merge!(common)
  if config.name == "Debug"
    config.build_settings["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = "DEBUG"
    config.build_settings["SWIFT_OPTIMIZATION_LEVEL"] = "-Onone"
  end
end

# Project-level deployment target so the watchOS SDK resolves cleanly.
project.build_configurations.each do |config|
  config.build_settings["WATCHOS_DEPLOYMENT_TARGET"] = "10.0"
  config.build_settings["SDKROOT"] = "watchos"
end

# A shared scheme so xcodebuild -scheme RemiWatch works without the IDE.
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(PROJ_PATH, "RemiWatch", true)

puts "Generated #{PROJ_PATH}"
puts "Sources: #{swift_files.map { |f| File.basename(f) }.join(", ")}"
