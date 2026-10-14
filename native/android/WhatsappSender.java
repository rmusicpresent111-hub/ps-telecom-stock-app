package __PACKAGE_NAME__;

import android.content.ClipData;
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
 *   ClipData      = same URI (some WhatsApp builds read the attachment from
 *                   ClipData; it also carries the URI grant reliably),
 *   "jid" extra   = <phone>@s.whatsapp.net  → targets the exact chat,
 *   setPackage    = com.whatsapp (WhatsApp) or com.whatsapp.w4b (Business).
 *
 * Requires <queries> entries for com.whatsapp / com.whatsapp.w4b in
 * AndroidManifest.xml (Android 11+ package visibility) — build-apk.js
 * injects them automatically; without them this plugin would report
 * "no-whatsapp" even with WhatsApp installed.
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
        // digits only — "91 98765 43210" / "+91-98765-43210" must both work
        String digits = phone.replaceAll("\\D", "");

        String waPackage = whatsappPackage();
        if (waPackage == null) {
            call.resolve(new JSObject().put("sent", false).put("error", "no-whatsapp"));
            return;
        }

        // ---- attempt 1: exact chat (jid) with the PDF attached ----
        if (launchShare(waPackage, digits, fileUri, text, true)) {
            call.resolve(new JSObject().put("sent", true));
            return;
        }
        // ---- attempt 2: WhatsApp opens with the PDF attached; if the jid
        //      extra was the problem, dropping it still lands in WhatsApp's
        //      send sheet with the file ready (chat stays easy to pick) ----
        if (launchShare(waPackage, digits, fileUri, text, false)) {
            call.resolve(new JSObject().put("sent", true).put("picked", true));
            return;
        }
        call.resolve(new JSObject().put("sent", false).put("error", "failed"));
    }

    /** Builds and starts the WhatsApp share intent; true when the activity came up. */
    private boolean launchShare(String waPackage, String digits, String fileUri, String text, boolean withJid) {
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/pdf");
            if (fileUri != null && !fileUri.trim().isEmpty()) {
                Uri stream = Uri.parse(fileUri);
                intent.putExtra(Intent.EXTRA_STREAM, stream);
                // ClipData: some WhatsApp builds take the attachment from here,
                // and it propagates the content-URI read grant to WhatsApp.
                intent.setClipData(ClipData.newRawUri("bill", stream));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            if (text != null && !text.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, text);
            }
            if (withJid) {
                // WhatsApp's chat-targeting extra: <digits>@s.whatsapp.net
                intent.putExtra("jid", digits + "@s.whatsapp.net");
            }
            intent.setPackage(waPackage);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }
            return true;
        } catch (Exception e) {
            return false;
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
