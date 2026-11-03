package __PACKAGE_NAME__;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * BluetoothPrinter — local Capacitor plugin (installed automatically by
 * scripts/build-apk.js into the android/ project, registered in MainActivity).
 *
 * Purpose: send an ESC/POS byte stream to a PAIRED Bluetooth thermal printer
 * (58mm/80mm receipt printers — the classic SPP "Bluetooth Printer" devices).
 *
 *   listPaired()                     → bonded devices [{name, address}]
 *   print({address, dataBase64})     → SPP connect → write bytes → close
 *
 * Notes:
 *  - The JS side (src/lib/thermal-print.ts) builds the full ESC/POS stream
 *    (init, alignment, big TOTAL, feed, partial cut). This plugin is a dumb
 *    reliable byte pipe — no formatting logic here.
 *  - Android 12+ needs the runtime BLUETOOTH_CONNECT permission; the plugin
 *    asks through Capacitor's permission alias only when actually required
 *    (Android ≤ 11 needs no runtime ask — BLUETOOTH was a normal permission).
 *  - connect() blocks, so the socket work runs on its own thread with a
 *    20s watchdog; results are always RESOLVED with {ok, error?} (structured
 *    error codes, never a rejected promise) so the JS side can translate.
 *  - Cheap printers often fail the standard SDP lookup, so three connect
 *    strategies are tried in order: SDP record → reflection channel 1 →
 *    insecure SDP.
 */
@CapacitorPlugin(name = "BluetoothPrinter", permissions = {
    @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bt")
})
public class BluetoothPrinter extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final long CONNECT_WATCHDOG_MS = 20_000;

    /** Which method asked for the permission (Capacitor re-dispatch helper). */
    private String pendingAfterPermission = null;

    // ------------------------------------------------------------------
    // Permission helpers
    // ------------------------------------------------------------------

    private boolean hasBtConnectPerm() {
        // Android ≤ 11: BLUETOOTH/BLUETOOTH_ADMIN are normal (install-time)
        // permissions — connecting to an ALREADY PAIRED device needs no ask.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void askThen(String method, PluginCall call) {
        synchronized (this) { pendingAfterPermission = method; }
        requestPermissionForAlias("bt", call, "btPermCallback");
    }

    @PermissionCallback
    private void btPermCallback(PluginCall call) {
        String next;
        synchronized (this) { next = pendingAfterPermission; pendingAfterPermission = null; }
        if (!hasBtConnectPerm()) {
            call.resolve(new JSObject().put("ok", false).put("error", "permission-denied")
                .put("devices", new JSArray()));
            return;
        }
        if ("print".equals(next)) {
            print(call);
        } else {
            listPaired(call);
        }
    }

    // ------------------------------------------------------------------
    // listPaired
    // ------------------------------------------------------------------

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (!hasBtConnectPerm()) {
            askThen("listPaired", call);
            return;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.resolve(new JSObject().put("enabled", false).put("devices", new JSArray()));
            return;
        }
        if (!adapter.isEnabled()) {
            call.resolve(new JSObject().put("enabled", false).put("devices", new JSArray()));
            return;
        }

        JSArray arr = new JSArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice d : bonded) {
                String name = d.getName();
                JSObject o = new JSObject();
                o.put("name", name != null && name.length() > 0 ? name : d.getAddress());
                o.put("address", d.getAddress());
                arr.put(o);
            }
        }
        JSObject res = new JSObject();
        res.put("enabled", true);
        res.put("devices", arr);
        call.resolve(res);
    }

    // ------------------------------------------------------------------
    // print
    // ------------------------------------------------------------------

    @PluginMethod
    public void print(PluginCall call) {
        String address = call.getString("address", "");
        String dataBase64 = call.getString("dataBase64", "");

        if (address == null || address.trim().isEmpty()) {
            call.resolve(new JSObject().put("ok", false).put("error", "no-address"));
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.resolve(new JSObject().put("ok", false).put("error", "no-data"));
            return;
        }
        if (!hasBtConnectPerm()) {
            askThen("print", call);
            return;
        }
        doPrint(call, address.trim(), dataBase64);
    }

    private void doPrint(final PluginCall call, final String address, final String dataBase64) {
        final BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.resolve(new JSObject().put("ok", false).put("error", "no-bluetooth"));
            return;
        }
        if (!adapter.isEnabled()) {
            call.resolve(new JSObject().put("ok", false).put("error", "bluetooth-off"));
            return;
        }

        final BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(address);
        } catch (Exception e) {
            call.resolve(new JSObject().put("ok", false).put("error", "bad-address"));
            return;
        }

        final byte[] payload;
        try {
            payload = Base64.decode(dataBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.resolve(new JSObject().put("ok", false).put("error", "bad-data"));
            return;
        }
        if (payload.length == 0) {
            call.resolve(new JSObject().put("ok", false).put("error", "bad-data"));
            return;
        }

        // connect() blocks — run on a dedicated thread with a hard watchdog.
        final AtomicBoolean done = new AtomicBoolean(false);
        final Thread worker = new Thread(() -> printWorker(call, adapter, device, payload, done));
        worker.setName("psa-bt-print");
        worker.start();

        final Thread watchdog = new Thread(() -> {
            try { Thread.sleep(CONNECT_WATCHDOG_MS); } catch (InterruptedException ignored) { return; }
            if (done.compareAndSet(false, true)) {
                call.resolve(new JSObject().put("ok", false).put("error", "timeout"));
            }
        });
        watchdog.setDaemon(true);
        watchdog.setName("psa-bt-watchdog");
        watchdog.start();
    }

    private void printWorker(PluginCall call, BluetoothAdapter adapter, BluetoothDevice device,
                             byte[] payload, AtomicBoolean done) {
        BluetoothSocket socket = null;
        try {
            try {
                if (adapter.isDiscovering()) adapter.cancelDiscovery();
            } catch (SecurityException ignored) { /* paired-device connect still allowed */ }

            // Strategy 1 — standard SDP record
            try {
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
            } catch (Exception first) {
                closeQuietly(socket);
                socket = null;
                // Strategy 2 — reflection channel 1 (most cheap ESC/POS printers)
                try {
                    Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                    socket = (BluetoothSocket) m.invoke(device, 1);
                    socket.connect();
                } catch (Exception second) {
                    closeQuietly(socket);
                    socket = null;
                    // Strategy 3 — insecure SDP
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                }
            }

            OutputStream os = socket.getOutputStream();
            os.write(payload);
            os.flush();
            // give the printer a beat to drain the buffer before we close
            try { Thread.sleep(250); } catch (InterruptedException ignored) { }
            os.flush();
            closeQuietly(socket);

            if (done.compareAndSet(false, true)) {
                call.resolve(new JSObject().put("ok", true));
            }
        } catch (SecurityException se) {
            closeQuietly(socket);
            if (done.compareAndSet(false, true)) {
                call.resolve(new JSObject().put("ok", false).put("error", "permission-denied"));
            }
        } catch (Exception e) {
            closeQuietly(socket);
            if (done.compareAndSet(false, true)) {
                String msg = e.getMessage() == null ? "connect-failed" : e.getMessage();
                if (msg.length() > 120) msg = msg.substring(0, 120);
                call.resolve(new JSObject().put("ok", false).put("error", msg));
            }
        }
    }

    private static void closeQuietly(BluetoothSocket s) {
        if (s == null) return;
        try { s.close(); } catch (Exception ignored) { }
    }
}
