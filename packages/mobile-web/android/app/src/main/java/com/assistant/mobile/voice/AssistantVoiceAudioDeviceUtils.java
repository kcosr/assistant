package com.assistant.mobile.voice;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;

import java.util.ArrayList;
import java.util.List;

final class AssistantVoiceAudioDeviceUtils {
    static final class InputDeviceOption {
        final String id;
        final String label;

        InputDeviceOption(String id, String label) {
            this.id = id;
            this.label = label;
        }
    }

    private AssistantVoiceAudioDeviceUtils() {}

    static List<InputDeviceOption> listInputDevices(Context context) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) {
            return new ArrayList<>();
        }
        AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS);
        List<InputDeviceOption> options = new ArrayList<>(devices.length);
        for (AudioDeviceInfo device : devices) {
            options.add(
                new InputDeviceOption(
                    String.valueOf(device.getId()),
                    describeInputDevice(device)
                )
            );
        }
        return options;
    }

    static AudioDeviceInfo findInputDevice(Context context, int id) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) {
            return null;
        }
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (device.getId() == id) {
                return device;
            }
        }
        return null;
    }

    static String describeInputDevice(AudioDeviceInfo device) {
        if (device == null) {
            return "Unknown";
        }

        String typeName;
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC:
                typeName = "Phone mic";
                break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                typeName = "Bluetooth headset mic";
                break;
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
                typeName = "BLE headset mic";
                break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                typeName = "Wired headset mic";
                break;
            case AudioDeviceInfo.TYPE_USB_DEVICE:
                typeName = "USB mic";
                break;
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                typeName = "USB headset mic";
                break;
            case AudioDeviceInfo.TYPE_TELEPHONY:
                typeName = "Telephony mic";
                break;
            default:
                typeName = "Input device";
                break;
        }

        CharSequence productName = device.getProductName();
        String product = productName == null ? "" : productName.toString().trim();
        if (product.isEmpty()) {
            return typeName + " [id:" + device.getId() + "]";
        }
        return typeName + " (" + product + ") [id:" + device.getId() + "]";
    }
}
