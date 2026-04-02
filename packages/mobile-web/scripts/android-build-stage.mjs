#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

export const REQUIRED_ANDROID_SOURCE_FILES = [
  'android/build.gradle',
  'android/gradle.properties',
  'android/gradle/wrapper/gradle-wrapper.jar',
  'android/gradle/wrapper/gradle-wrapper.properties',
  'android/gradlew',
  'android/gradlew.bat',
  'android/settings.gradle',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/proguard-rules.pro',
  'android/app/src/main/java/com/assistant/mobile/MainActivity.java',
  'android/app/src/main/java/com/assistant/mobile/backend/AssistantBackendChooserActivity.java',
  'android/app/src/main/java/com/assistant/mobile/backend/AssistantLaunchActivity.java',
  'android/app/src/main/java/com/assistant/mobile/backend/AssistantLaunchConfigPlugin.java',
  'android/app/src/main/java/com/assistant/mobile/voice/AssistantVoicePlugin.java',
  'android/app/src/main/java/com/assistant/mobile/attachments/AssistantAttachmentOpenPlugin.java',
  'android/app/src/main/res/layout/activity_main.xml',
  'android/app/src/main/res/values/styles.xml',
  'android/app/src/main/res/xml/file_paths.xml',
];

function relativePosix(baseDir, targetPath) {
  return path.relative(baseDir, targetPath).split(path.sep).join('/');
}

function shouldCopyMobilePath(relativePath) {
  if (!relativePath || relativePath === '.') {
    return true;
  }

  if (relativePath === '.build' || relativePath.startsWith('.build/')) {
    return false;
  }

  const excludedPrefixes = [
    'android/.gradle',
    'android/build',
    'android/app/build',
  ];

  if (excludedPrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) {
    return false;
  }

  if (relativePath === 'android/local.properties') {
    return false;
  }

  return true;
}

export function assertAndroidProjectPresent(mobileDir) {
  const missing = REQUIRED_ANDROID_SOURCE_FILES.filter(
    (relativePath) => !fs.existsSync(path.join(mobileDir, relativePath)),
  );

  if (missing.length === 0) {
    return;
  }

  const details = missing.map((relativePath) => `  - ${relativePath}`).join('\n');
  throw new Error(
    `Committed Android source tree is incomplete.\nMissing required files:\n${details}\nRestore packages/mobile-web/android from git instead of regenerating it during deploy.`,
  );
}

export function createAndroidBuildStage({
  repoRoot,
  mobileDir,
  flavorName,
  stageBaseDir = path.join(repoRoot, '.build', 'android-stage'),
} = {}) {
  if (!repoRoot || !mobileDir || !flavorName) {
    throw new Error('repoRoot, mobileDir, and flavorName are required');
  }

  assertAndroidProjectPresent(mobileDir);

  const webPublicDir = path.join(repoRoot, 'packages', 'web-client', 'public');
  if (!fs.existsSync(webPublicDir)) {
    throw new Error(`Built web-client assets not found: ${webPublicDir}`);
  }

  const stageRoot = path.join(stageBaseDir, flavorName);
  const stageRepoRoot = path.join(stageRoot, 'repo');
  const stagePackagesDir = path.join(stageRepoRoot, 'packages');
  const stagedMobileDir = path.join(stagePackagesDir, 'mobile-web');
  const stagedWebPublicDir = path.join(stagePackagesDir, 'web-client', 'public');
  const sourceNodeModulesDir = path.join(repoRoot, 'node_modules');
  const stagedNodeModulesDir = path.join(stageRepoRoot, 'node_modules');
  const stagedMobileNodeModulesDir = path.join(stagedMobileDir, 'node_modules');

  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stagePackagesDir, { recursive: true });

  fs.cpSync(mobileDir, stagedMobileDir, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = relativePosix(mobileDir, sourcePath);
      return shouldCopyMobilePath(relativePath);
    },
  });

  fs.mkdirSync(path.dirname(stagedWebPublicDir), { recursive: true });
  fs.cpSync(webPublicDir, stagedWebPublicDir, {
    recursive: true,
  });

  let sourceMobileNodeModulesDir = path.join(mobileDir, 'node_modules');
  if (!fs.existsSync(sourceMobileNodeModulesDir) && fs.existsSync(sourceNodeModulesDir)) {
    const resolvedRootNodeModulesDir = fs.realpathSync(sourceNodeModulesDir);
    const resolvedRepoRoot = path.dirname(resolvedRootNodeModulesDir);
    const candidateMobileNodeModulesDir = path.join(
      resolvedRepoRoot,
      'packages',
      'mobile-web',
      'node_modules',
    );
    if (fs.existsSync(candidateMobileNodeModulesDir)) {
      sourceMobileNodeModulesDir = candidateMobileNodeModulesDir;
    }
  }

  if (fs.existsSync(sourceNodeModulesDir)) {
    fs.symlinkSync(sourceNodeModulesDir, stagedNodeModulesDir, 'dir');
  }
  if (fs.existsSync(sourceMobileNodeModulesDir)) {
    fs.symlinkSync(sourceMobileNodeModulesDir, stagedMobileNodeModulesDir, 'dir');
  } else if (fs.existsSync(sourceNodeModulesDir)) {
    fs.symlinkSync(sourceNodeModulesDir, stagedMobileNodeModulesDir, 'dir');
  }

  assertAndroidProjectPresent(stagedMobileDir);

  return {
    stageRoot,
    stageRepoRoot,
    stagedMobileDir,
    stagedWebPublicDir,
    debugApkPath: path.join(
      stagedMobileDir,
      'android',
      'app',
      'build',
      'outputs',
      'apk',
      'debug',
      'app-debug.apk',
    ),
  };
}

export function createTempAndroidStageBase(prefix = 'assistant-mobile-stage-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
