import { describe, expect, it } from 'vitest';

import {
  findNativeDependencyMismatches,
  getPinnedNativeDependencies,
} from './verify-native-dependencies.mjs';

describe('native dependency verification', () => {
  const packageJson = {
    dependencies: {
      '@capacitor/android': '8.0.0',
      '@capacitor/core': '8.0.0',
      unrelated: '^1.0.0',
    },
    devDependencies: {
      '@capacitor/cli': '8.0.0',
    },
  };

  it('checks only pinned Capacitor packages', () => {
    expect(getPinnedNativeDependencies(packageJson)).toEqual([
      ['@capacitor/android', '8.0.0'],
      ['@capacitor/core', '8.0.0'],
      ['@capacitor/cli', '8.0.0'],
    ]);
    expect(findNativeDependencyMismatches(packageJson, () => '8.0.0')).toEqual([]);
  });

  it('reports ranges, missing packages, and installed-version drift', () => {
    const invalidPackageJson = {
      dependencies: {
        '@capacitor/android': '^8.0.0',
        '@capacitor/core': '8.0.0',
        '@capgo/capacitor-share-target': '8.0.2',
      },
    };

    expect(
      findNativeDependencyMismatches(invalidPackageJson, (name) => {
        if (name === '@capacitor/core') {
          return '8.4.2';
        }
        throw new Error('missing');
      }),
    ).toEqual([
      '@capacitor/android: dependency must be pinned exactly, found ^8.0.0',
      '@capacitor/core: expected 8.0.0, installed 8.4.2',
      '@capgo/capacitor-share-target: expected 8.0.2, package is not installed',
    ]);
  });
});
