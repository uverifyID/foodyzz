// Works around the Xcode 26.4 Swift async miscompile that crashes Firebase phone
// auth on "Send Access Code" with SIGABRT: "freed pointer was not the last
// allocation" (swiftlang/swift stack-allocation-of-async-frames bug).
//
// Apple now requires the iOS 26 SDK (Xcode 26) for App Store uploads (error
// 90725), so we can no longer dodge the bug by pinning the EAS image to Xcode
// 16.4. The fix landed in Xcode 26.4.1, but EAS's newest iOS image is still
// Xcode 26.4 (macos-tahoe-26.4-xcode-26.4). Until EAS ships a >= 26.4.1 image,
// we build on 26.4 and disable the *optimizer* for FirebaseAuth's Swift: the
// miscompile only happens under optimization, so compiling that module at
// -Onone produces correct async codegen on every iOS version. FirebaseAuth is
// not perf-critical, so the cost is negligible.
//
// This is source-compiled Swift only — RecaptchaEnterprise ships as a prebuilt
// binary xcframework (compiled by Google, not Xcode 26.4) so it can't be the
// miscompiled code and needs no change here. See [[xcode26-phone-auth-swift-crash]].
//
// REMOVE this plugin (and repin eas.json to the >= 26.4.1 image) once EAS
// publishes one — then the compiler fix is native and -Onone is unnecessary.
//
// Runs in the Podfile post_install hook so it re-applies on every `pod install`
// (prebuild / run:ios / EAS).
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'withFirebaseAuthSwiftOptFix';
const SNIPPET = `
    # Firebase phone-auth Swift-async miscompile fix (Xcode 26.4) — ${MARKER}.js
    # Disable the optimizer for FirebaseAuth's Swift so withCheckedThrowingContinuation
    # is not miscompiled (SIGABRT "freed pointer was not the last allocation" on OTP).
    installer.pods_project.targets.each do |firebase_opt_target|
      if firebase_opt_target.name.start_with?('FirebaseAuth')
        firebase_opt_target.build_configurations.each do |firebase_opt_config|
          firebase_opt_config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'
        end
        Pod::UI.puts "[${MARKER}] SWIFT_OPTIMIZATION_LEVEL=-Onone for #{firebase_opt_target.name}"
      end
    end
`;

module.exports = function withFirebaseAuthSwiftOptFix(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');

      if (!contents.includes(MARKER)) {
        // Insert inside the post_install block, after react_native_post_install(...).
        const anchor = /react_native_post_install\([^)]*\)/;
        if (!anchor.test(contents)) {
          throw new Error(
            '[withFirebaseAuthSwiftOptFix] Could not find react_native_post_install(...) in the Podfile — the anchor changed; update this plugin.'
          );
        }
        contents = contents.replace(anchor, (m) => m + '\n' + SNIPPET);
        fs.writeFileSync(podfile, contents);
      }

      return config;
    },
  ]);
};
