const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidPathFix(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;

      // Replace dynamic Node.js path resolutions with static relative paths
      // Fix entryFile resolution
      contents = contents.replace(/entryFile = file\(\[.*resolveAppEntry.*text\.trim\(\)\)/g,
        '    entryFile = file("../../app/index.tsx")');

      // Fix React Native directory resolution
      contents = contents.replace(/reactNativeDir = new File\(\[.*'react-native\/package\.json'.*text\.trim\(\)\)\.getParentFile\(\)\.getAbsoluteFile\(\)/g,
        '    reactNativeDir = file("../../node_modules/react-native")');
      
      // Fix Hermes command resolution
      contents = contents.replace(/hermesCommand = new File\(\[.*'react-native\/package\.json'.*text\.trim\(\)\)\.getParentFile\(\)\.getAbsolutePath\(\) \+ "\/sdks\/hermesc\/%OS-BIN%\/hermesc"/g,
        '    hermesCommand = file("../../node_modules/react-native/sdks/hermesc/%OS-BIN%/hermesc").getAbsolutePath()');

      // Fix Codegen directory resolution
      contents = contents.replace(/codegenDir = new File\(\[.*'@react-native\/codegen\/package\.json'.*text\.trim\(\)\)\.getParentFile\(\)\.getAbsoluteFile\(\)/g,
        '    codegenDir = file("../../node_modules/@react-native/codegen")');
      
      // Fix CLI resolution
      contents = contents.replace(/cliFile = new File\(\[.*'@expo\/cli'.*text\.trim\(\)\)/g,
        '    cliFile = file("../../node_modules/expo/bin/cli")');

      // Fix the native_modules resolution (The specific Line 33 failure)
      contents = contents.replace(/apply from: new File\(\[.*cli-platform-android.*text\.trim\(\), "\.\.\/native_modules\.gradle"\)/g,
        '    apply from: file("../../node_modules/@react-native-community/cli-platform-android/native_modules.gradle")');

      // Fix Maven repositories paths
      contents = contents.replace(/url\(new File\(\[.*'react-native\/package\.json'.*text\.trim\(\), '\.\.\/android'\)\)/g,
        'url(new File(rootDir, "../node_modules/react-native/android"))');
      contents = contents.replace(/url\(new File\(\[.*'jsc-android\/package\.json'.*text\.trim\(\), '\.\.\/dist'\)\)/g,
        'url(new File(rootDir, "../node_modules/jsc-android/dist"))');

      // Fix for "Could not get unknown property 'release' for SoftwareComponent container" 
      // 1. Remove deprecated publishNonDefault if it exists
      contents = contents.replace(/\s*publishNonDefault\s*=\s*true/g, '');

      // 2. Inject modern publishing block into the android section if not already present
      if (!contents.includes('publishing {') || !contents.includes('singleVariant("release")')) {
        const publishingBlock = '\n    publishing {\n        singleVariant("release")\n    }\n';
        contents = contents.replace(/^android\s*\{/m, `android {${publishingBlock}`);
      }

      config.modResults.contents = contents;
    }
    return config;
  });
};