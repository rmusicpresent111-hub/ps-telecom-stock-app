# PS TELECOM — APK Signing Keystore

`ps-telecom.keystore` signs EVERY APK built from this repo (debug AND release
builds — see `scripts/build-apk.js` Step 5.8b, applied automatically).

Keeping the keystore IN the repo is intentional: any machine that clones the
repo produces APKs with the SAME signature, so every new version installs
cleanly OVER the previous one (Android blocks upgrades when signatures differ
— the user would be forced to uninstall and lose local data).

| Field         | Value                                          |
| ------------- | ---------------------------------------------- |
| File          | `android-signing/ps-telecom.keystore`          |
| Alias         | `ps-telecom`                                   |
| Store password| `PSTelecom22000`                               |
| Key password  | `PSTelecom22000`                               |
| DN            | CN=PS Telecom, OU=Mobile, O=PS Telecom, L=Kolkata, ST=West Bengal, C=IN |
| Validity      | 30 years (generated 2026-10-31, v2.20.0 era)   |

NOTE: the DN deliberately matches the owner's original release key identity.
The KEY differs from any keystore that lived only on the owner's machine, so
the FIRST install of a repo-built APK over an owner-machine-built APK needs a
one-time uninstall (cloud sync auto-restores products/bills/etc. after login).
After that one-time switch, all future repo builds upgrade in place.
