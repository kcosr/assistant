package com.assistant.mobile.voice;

import static org.junit.Assert.*;

import android.os.Build;
import com.getcapacitor.Bridge;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PluginMethodHandle;

import java.lang.reflect.Constructor;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoicePluginSpeechBridgeTest {
    @Test public void capacitorDiscoversCredentialManagementAndCatalogMethods() throws Exception {
        // Index the actual Capacitor plugin metadata without loading its runtime or a WebView.
        Constructor<PluginHandle> constructor = PluginHandle.class.getDeclaredConstructor(Class.class, Bridge.class);
        constructor.setAccessible(true);
        PluginHandle handle = constructor.newInstance(AssistantVoicePlugin.class, null);
        assertEquals("AssistantNativeVoice", handle.getId());
        Map<String, PluginMethodHandle> methods = new HashMap<>();
        for (PluginMethodHandle method : handle.getMethods()) methods.put(method.getName(), method);
        for (String name : new String[] { "manageSpeechCredential", "discoverSpeechModels" }) {
            assertTrue("Missing callable native bridge method: " + name, methods.containsKey(name));
            assertEquals(PluginMethod.RETURN_PROMISE, methods.get(name).getReturnType());
            assertArrayEquals(new Class<?>[] { PluginCall.class }, methods.get(name).getMethod().getParameterTypes());
        }
    }
}
