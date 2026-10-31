package __PACKAGE_NAME__;

import android.app.Activity;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

/**
 * AppLock — local Capacitor plugin (installed automatically by
 * scripts/build-apk.js into the android/ project, registered in MainActivity).
 *
 * Purpose: gate the app behind the DEVICE SCREEN LOCK — fingerprint / face /
 * iris / PIN / pattern / password — every time the app opens (and again after
 * it has been backgrounded long enough; see src/store/appLockStore.ts). The
 * owner asked for exactly the phone's own lock-screen credentials, so NO app
 * PIN is stored anywhere: the Android system authenticates the user and this
 * plugin only reports success/failure back to JavaScript.
 *
 * Implementation notes:
 * - androidx.biometric (BiometricManager + BiometricPrompt) for API 23+
 *   forward/backward compatibility. The gradle dependency is injected into
 *   android/app/build.gradle by scripts/build-apk.js (Step 5.7d).
 * - Allowed authenticators = BIOMETRIC_WEAK | DEVICE_CREDENTIAL: the system
 *   dialog shows fingerprint/face when enrolled and automatically falls back
 *   to the screen lock (PIN / pattern / password). Devices with NO screen
 *   lock at all report available=false and the app simply does not lock —
 *   there is NO possible lockout.
 * - setNegativeButtonText is intentionally NOT set: androidx throws
 *   IllegalArgumentException when a negative button text is combined with
 *   DEVICE_CREDENTIAL authenticators (the credential UI brings its own).
 * - isAvailable() maps BiometricManager.canAuthenticate(): BIOMETRIC_SUCCESS
 *   → available=true, anything else (NONE_ENROLLED, HW_UNAVAILABLE, ...) →
 *   available=false.
 * - authenticate() always RESOLVES (never rejects) with { ok, code, message }
 *   so the JS side can distinguish user-cancel from real failures. Resolving
 *   later from the auth callback is the same pattern the official Capacitor
 *   Geolocation plugin uses.
 */
@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {

    /** Authenticator set: biometrics OR the device credential (PIN/pattern/password). */
    private static final int AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_WEAK
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        Activity activity = getActivity();
        if (activity == null) {
            ret.put("available", false);
            ret.put("code", -1);
            call.resolve(ret);
            return;
        }
        try {
            BiometricManager bm = BiometricManager.from(activity);
            int can = bm.canAuthenticate(AUTHENTICATORS);
            ret.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
            ret.put("code", can);
        } catch (Exception e) {
            // Very old / odd ROMs — fail open: no lock gate, app stays usable.
            ret.put("available", false);
            ret.put("code", -2);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        final Activity activity = getActivity();
        if (!(activity instanceof FragmentActivity)) {
            call.resolve(new JSObject()
                    .put("ok", false)
                    .put("code", -1)
                    .put("message", "no-fragment-activity"));
            return;
        }
        final FragmentActivity fragmentActivity = (FragmentActivity) activity;
        final String title = call.getString("title", "Unlock app");
        final String subtitle = call.getString("subtitle", "");

        Executor executor = ContextCompat.getMainExecutor(fragmentActivity);

        BiometricPrompt.AuthenticationCallback callback = new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                call.resolve(new JSObject().put("ok", true));
            }

            @Override
            public void onAuthenticationError(int errorCode, CharSequence errString) {
                call.resolve(new JSObject()
                        .put("ok", false)
                        .put("code", errorCode)
                        .put("message", errString != null ? errString.toString() : ""));
            }
        };

        try {
            BiometricPrompt prompt = new BiometricPrompt(fragmentActivity, executor, callback);
            BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title == null || title.trim().isEmpty() ? "Unlock app" : title)
                    .setAllowedAuthenticators(AUTHENTICATORS);
            if (subtitle != null && !subtitle.trim().isEmpty()) {
                builder.setSubtitle(subtitle);
            }
            prompt.authenticate(builder.build());
        } catch (Exception e) {
            call.resolve(new JSObject()
                    .put("ok", false)
                    .put("code", -3)
                    .put("message", e.getMessage() != null ? e.getMessage() : "prompt-failed"));
        }
    }
}
