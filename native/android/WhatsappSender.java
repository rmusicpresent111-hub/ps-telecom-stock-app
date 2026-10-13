package __PACKAGE_NAME__;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * WhatsappSender — local Capacitor plugin (installed automatically by
 * scripts/build-apk.js into the android/ project, registered in MainActivity).
 *
 * Purpose: open THE CUSTOMER's WhatsApp chat with the bill PDF attached —
 * no contact picking, no share sheet. Uses WhatsApp's Android intent API:
 *
 *   Intent.ACTION_SEND, type application/pdf,
 *   EXTRA_STREAM  = content:// URI of the cached PDF (Capacitor FileProvider),
 *   "jid" extra   = <phone>@s.whatsapp.net  → targets the exact chat,
 *   setPackage    = com.whatsapp (WhatsApp) or com.whatsapp.w4b (Business).
 *
 * JS side (bill-pdf.ts) falls back to the normal share sheet / wa.me flow
 * when this plugin is missing or reports no-whatsapp.
 */
@CapacitorPlugin(name = "WhatsappSender")
public class WhatsappSender extends Plugin {

    @PluginMethod
    public void send(PluginCall call) {
        String phone = call.getString("phone", "");
        String fileUri = call.getString("fileUri", "");
        String text = call.getString("text", "");

        if (phone == null || phone.trim().isEmpty()) {
            call.resolve(new JSObject().put("sent", false).put("error", "no-phone"));
            return;
        }

        String waPackage = whatsappPackage();
        if (waPackage == null) {
            call.resolve(new JSObject().put("sent", false).put("error", "no-whatsapp"));
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/pdf");
            if (fileUri != null && !fileUri.trim().isEmpty()) {
                intent.putExtra(Intent.EXTRA_STREAM, Uri.parse(fileUri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            if (text != null && !text.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, text);
            }
            // WhatsApp's documented-ish extra: target ONE chat by jid.
            intent.putExtra("jid", phone.trim() + "@s.whatsapp.net");
            intent.setPackage(waPackage);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (getActivity() != null) {
                getActivity().startActivity(intent);
                call.resolve(new JSObject().put("sent", true));
            } else {
                getContext().startActivity(intent);
                call.resolve(new JSObject().put("sent", true));
            }
        } catch (android.content.ActivityNotFoundException e) {
            call.resolve(new JSObject().put("sent", false).put("error", "no-whatsapp"));
        } catch (Exception e) {
            call.resolve(new JSObject().put("sent", false).put("error", e.getMessage()));
        }
    }

    /** Returns the installed WhatsApp package, or null when neither app exists. */
    private String whatsappPackage() {
        PackageManager pm = getContext().getPackageManager();
        String[] candidates = { "com.whatsapp", "com.whatsapp.w4b" };
        for (String pkg : candidates) {
            try {
                pm.getPackageInfo(pkg, 0);
                return pkg;
            } catch (PackageManager.NameNotFoundException ignored) {
                // try the next candidate
            }
        }
        return null;
    }
}
