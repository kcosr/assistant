const path = require('node:path');

const isWork = process.env.ASSISTANT_DESKTOP_VARIANT === 'work';
const productName = isWork ? 'Assistant Work' : 'Assistant';
const appId = isWork ? 'com.assistant.desktop.work' : 'com.assistant.desktop';

module.exports = {
  appId,
  productName,
  directories: {
    output: isWork ? 'release/work' : 'release/default',
  },
  files: ['dist/**/*', 'package.json'],
  extraResources: [
    {
      from: path.join('..', 'web-client', 'public'),
      to: path.join('web-client', 'public'),
    },
    {
      from: 'icons',
      to: 'icons',
    },
  ],
  mac: {
    category: 'public.app-category.productivity',
    icon: 'icons/icon.icns',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Assistant uses the microphone for voice input.',
      NSSpeechRecognitionUsageDescription: 'Assistant uses speech recognition for voice input.',
    },
  },
  win: {
    icon: 'icons/icon.ico',
  },
  linux: {
    icon: 'icons',
    target: ['AppImage', 'deb'],
    category: 'Utility',
  },
};
