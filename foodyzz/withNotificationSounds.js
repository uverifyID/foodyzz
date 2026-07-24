// Bundles custom notification sounds into the native projects so background /
// killed pushes can play them. We can't use expo-notifications' built-in `sounds`
// option because it copies the SAME file list to both platforms — and iOS needs
// .caf while Android needs .mp3 with the same basename, which collide in
// android/res/raw. So we copy each platform its own format:
//   assets/sounds/IOS/*.caf      -> iOS app bundle (referenced as "<name>.caf")
//   assets/sounds/android/*.mp3  -> android/app/src/main/res/raw (channel sound)
//
// Mirrors expo-notifications' own setNotificationSounds implementations.
// NOTE: folder casing matters — EAS builds on case-sensitive Linux, so "IOS"
// must match the on-disk folder name exactly.
const { withXcodeProject, withDangerousMod, IOSConfig } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const SOUNDS = ['bell', 'confirmation', 'doorbell', 'happybell', 'officering', 'oldphone', 'quicktone', 'vintage'];
const ANDROID_RES_RAW = 'android/app/src/main/res/raw';

// iOS: copy each .caf next to the app sources and add it to the Resources build phase.
function withIosNotificationSounds(config) {
  return withXcodeProject(config, (config) => {
    const { projectRoot, projectName } = config.modRequest;
    if (!projectName) throw new Error('[withNotificationSounds] Unable to resolve iOS project name.');
    let project = config.modResults;
    const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);
    for (const name of SOUNDS) {
      const fileName = `${name}.caf`;
      const src = path.resolve(projectRoot, 'assets', 'sounds', 'IOS', fileName);
      fs.copyFileSync(src, path.resolve(sourceRoot, fileName));
      if (!project.hasFile(`${projectName}/${fileName}`)) {
        project = IOSConfig.XcodeUtils.addResourceFileToGroup({
          filepath: `${projectName}/${fileName}`,
          groupName: projectName,
          isBuildFile: true,
          project,
        });
      }
    }
    config.modResults = project;
    return config;
  });
}

// Android: copy each .mp3 into res/raw so a notification channel can reference it.
function withAndroidNotificationSounds(config) {
  return withDangerousMod(config, ['android', (config) => {
    const { projectRoot } = config.modRequest;
    const rawDir = path.resolve(projectRoot, ANDROID_RES_RAW);
    if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
    for (const name of SOUNDS) {
      const fileName = `${name}.mp3`;
      const src = path.resolve(projectRoot, 'assets', 'sounds', 'android', fileName);
      fs.copyFileSync(src, path.resolve(rawDir, fileName));
    }
    return config;
  }]);
}

module.exports = function withNotificationSounds(config) {
  config = withIosNotificationSounds(config);
  config = withAndroidNotificationSounds(config);
  return config;
};
