// Fixes the Xcode 27 build failure "The iOS Simulator deployment target
// 'IPHONEOS_DEPLOYMENT_TARGET' is set to 11.0, but the range of supported
// deployment target versions is 15.0 to 27.0.x".
//
// Many pods (Firebase, Stripe, gRPC, abseil, react-native-maps, ...) ship
// resource / privacy bundle targets that still declare iOS 9–13. Xcode 26 only
// warned about that; Xcode 27 makes it a hard error. The app itself already
// targets 15.1 (expo-build-properties), so raise every pod target below that to
// the same floor. It changes no runtime behaviour: nothing can run below 15.1.
//
// Runs in the Podfile post_install hook so it re-applies on every `pod install`
// (prebuild / run:ios / EAS). Same insertion approach as withFmtConstevalFix.js.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'withPodsMinDeploymentTarget';
const MIN_IOS = '15.1';
const SNIPPET = `
    # Xcode 27 rejects pod targets below iOS 15 — ${MARKER}.js
    installer.pods_project.targets.each do |pods_min_target|
      pods_min_target.build_configurations.each do |pods_min_config|
        pods_min_current = pods_min_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if pods_min_current.nil? || Gem::Version.new(pods_min_current) < Gem::Version.new('${MIN_IOS}')
          pods_min_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'
        end
      end
    end
`;

const POST_INSTALL_CALL = 'react_native_post_install(';

// Index just past the closing paren of react_native_post_install(...); counts parens
// because the SDK 54 argument list contains nested calls (see withFmtConstevalFix.js).
function endOfPostInstallCall(contents) {
  const start = contents.indexOf(POST_INSTALL_CALL);
  if (start === -1) return -1;

  let depth = 0;
  for (let i = start + POST_INSTALL_CALL.length - 1; i < contents.length; i++) {
    if (contents[i] === '(') depth++;
    else if (contents[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

module.exports = function withPodsMinDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');

      if (!contents.includes(MARKER)) {
        const insertAt = endOfPostInstallCall(contents);
        if (insertAt === -1) {
          throw new Error(
            '[withPodsMinDeploymentTarget] Could not find react_native_post_install(...) in the Podfile — the anchor changed; update this plugin.'
          );
        }
        contents = contents.slice(0, insertAt) + '\n' + SNIPPET + contents.slice(insertAt);
        fs.writeFileSync(podfile, contents);
      }

      return config;
    },
  ]);
};
