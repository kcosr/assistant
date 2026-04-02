import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  assertAndroidProjectPresent,
  createAndroidBuildStage,
  createTempAndroidStageBase,
  REQUIRED_ANDROID_SOURCE_FILES,
} from './android-build-stage.mjs';

function writeFile(filePath, contents = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function createFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-android-stage-repo-'));
  const mobileDir = path.join(repoRoot, 'packages', 'mobile-web');
  const webPublicDir = path.join(repoRoot, 'packages', 'web-client', 'public');

  writeFile(path.join(webPublicDir, 'index.html'), '<html></html>');
  writeFile(path.join(webPublicDir, 'config.js'), 'window.ASSISTANT_API_HOST = "https://assistant";');
  writeFile(path.join(mobileDir, 'package.json'), '{"name":"@assistant/mobile-web"}');
  writeFile(path.join(mobileDir, 'capacitor.config.json'), '{"appId":"com.assistant.app","appName":"Assistant","webDir":"../web-client/public"}');
  writeFile(path.join(mobileDir, 'flavors.json'), '{"default":{"appId":"com.assistant.app","appName":"Assistant","apiHost":"https://assistant"}}');

  for (const relativePath of REQUIRED_ANDROID_SOURCE_FILES) {
    writeFile(path.join(mobileDir, relativePath), `fixture:${relativePath}`);
  }

  writeFile(path.join(mobileDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
  writeFile(path.join(mobileDir, 'android', '.gradle', 'cache.txt'));
  writeFile(path.join(mobileDir, '.build', 'stale.txt'));

  return { repoRoot, mobileDir };
}

describe('assertAndroidProjectPresent', () => {
  it('fails when required committed android files are missing', () => {
    const { mobileDir } = createFixtureRepo();
    fs.rmSync(path.join(mobileDir, REQUIRED_ANDROID_SOURCE_FILES[0]), { force: true });

    expect(() => assertAndroidProjectPresent(mobileDir)).toThrow(
      'Committed Android source tree is incomplete.',
    );
  });
});

describe('createAndroidBuildStage', () => {
  it('copies the mobile project into an ignored staging area without build artifacts', () => {
    const { repoRoot, mobileDir } = createFixtureRepo();
    const stageBaseDir = createTempAndroidStageBase();

    const result = createAndroidBuildStage({
      repoRoot,
      mobileDir,
      flavorName: 'default',
      stageBaseDir,
    });

    expect(fs.existsSync(path.join(result.stagedMobileDir, 'android', 'app', 'build'))).toBe(false);
    expect(fs.existsSync(path.join(result.stagedMobileDir, 'android', '.gradle'))).toBe(false);
    expect(fs.existsSync(path.join(result.stagedMobileDir, '.build'))).toBe(false);
    expect(fs.existsSync(path.join(result.stagedWebPublicDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(result.stagedMobileDir, REQUIRED_ANDROID_SOURCE_FILES[1]))).toBe(
      true,
    );
  });
});
