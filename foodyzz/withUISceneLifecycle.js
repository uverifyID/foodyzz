// Fixes "Application failed to launch: UIScene life cycle is required for apps
// built with this SDK" on the iOS 26/27 SDK (Xcode 27).
//
// UIKit now refuses to launch an app that still uses the old
// application/window life cycle. Expo SDK 54 (react-native 0.81) starts React
// Native from AppDelegate.didFinishLaunchingWithOptions with its own UIWindow,
// which is exactly the pattern UIKit rejects. Expo's own fix landed in SDK 57
// (`ios.enableSceneSupport`), so until this project upgrades, adopt the scene
// life cycle here:
//
//   1. Info.plist declares a UIApplicationSceneManifest with one scene whose
//      delegate is `$(PRODUCT_MODULE_NAME).SceneDelegate`.
//   2. SceneDelegate adopts the window AppDelegate already built and attaches it
//      to the connecting UIWindowScene. The manifest alone is not enough: a
//      window with no `windowScene` never appears, so the app shows black.
//
// AppDelegate itself is left exactly as Expo generates it, on purpose. Moving
// `startReactNative` into the scene (the upstream SDK 57 shape) breaks
// expo-dev-client: ExpoDevLauncherAppDelegateSubscriber runs during
// didFinishLaunchingWithOptions and aborts with "Cannot find the keyWindow"
// because the scene has not connected yet. Creating the window in the app
// delegate as before and re-parenting it here satisfies both.
//
// Deep links and universal links arriving while the app is cold-started reach
// the scene (connectionOptions), not the AppDelegate, so they are forwarded to
// RCTLinkingManager here too; the AppDelegate's own handlers still cover the
// warm-start cases.
//
// Runs as a dangerous mod because it rewrites the generated AppDelegate.swift,
// so it re-applies on every prebuild. Idempotent via the marker below.
const { withDangerousMod, withInfoPlist } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'withUISceneLifecycle';

const SCENE_DELEGATE = `

// UIScene life cycle for the iOS 26/27 SDK — ${MARKER}.js
// The window is still created (and made key) by AppDelegate during launch, which
// is what expo-dev-client expects; it just has no scene yet, so UIKit would never
// show it. Adopt it here and attach it to the scene that is connecting.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }

    let appDelegate = UIApplication.shared.delegate as? AppDelegate
    let window = appDelegate?.window ?? UIWindow(windowScene: windowScene)
    window.windowScene = windowScene
    self.window = window
    appDelegate?.window = window
    window.makeKeyAndVisible()

    // A cold start from a link delivers it here instead of to the AppDelegate.
    for context in connectionOptions.urlContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
    for userActivity in connectionOptions.userActivities {
      RCTLinkingManager.application(UIApplication.shared, continue: userActivity) { _ in }
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(UIApplication.shared, continue: userActivity) { _ in }
  }
}
`;

function patchAppDelegate(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!contents.includes('class ReactNativeDelegate')) {
    throw new Error(
      `[${MARKER}] AppDelegate.swift does not look like the Expo SDK 54 template. Update the plugin.`
    );
  }
  // AppDelegate is untouched; the scene delegate is appended to the same file so
  // it lands in the app's own module (UISceneDelegateClassName uses PRODUCT_MODULE_NAME).
  return contents + SCENE_DELEGATE;
}

module.exports = function withUISceneLifecycle(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

  return withDangerousMod(config, [
    'ios',
    (config) => {
      const root = config.modRequest.platformProjectRoot;
      const appDelegate = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, 'AppDelegate.swift'))
        .find((candidate) => fs.existsSync(candidate));

      if (!appDelegate) {
        throw new Error(`[${MARKER}] Could not find AppDelegate.swift under ${root}.`);
      }

      const contents = fs.readFileSync(appDelegate, 'utf8');
      const patched = patchAppDelegate(contents);
      if (patched !== contents) fs.writeFileSync(appDelegate, patched);

      return config;
    },
  ]);
};
