# Signing the desktop installers

The release workflow (`.github/workflows/desktop-release.yml`) builds unsigned installers until the secrets below exist in the repository (Settings > Secrets and variables > Actions). Add a secret and the next tag build uses it. Nothing else changes.

## macOS

You need:

- An Apple Developer Program membership (99 USD a year). Check the current price on Apple's site.
- A "Developer ID Application" certificate. Create it in the Apple Developer account, install it in Keychain Access, then export it as a `.p12` file with a password.

Secrets:

| Secret | What goes in it |
| --- | --- |
| `APPLE_CERTIFICATE` | The `.p12` as base64. On a Mac: `base64 -i cert.p12 \| pbcopy`, then paste |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The exact name, e.g. `Developer ID Application: Your Name (TEAMID)`. Keychain Access shows it |

For notarising (so Gatekeeper accepts the app without the right-click step):

| Secret | What goes in it |
| --- | --- |
| `APPLE_ID` | The Apple ID email for the developer account |
| `APPLE_PASSWORD` | An app-specific password, made at account.apple.com (not your Apple ID password) |
| `APPLE_TEAM_ID` | The 10-character Team ID from the membership page. Check where Apple shows it now |

If `APPLE_CERTIFICATE` is set but `APPLE_SIGNING_IDENTITY` is not, the macOS job fails on purpose. If the notarising secrets are missing, the app is signed but not notarised, and users still get a Gatekeeper prompt. The release notes say "unsigned" only when no certificate secret is set.

## Windows

Not signed yet. Since June 2023 code-signing keys must live on hardware or in a cloud HSM, so a plain `.pfx` file in a secret is no longer sold by the certificate authorities. The practical routes:

- Azure Trusted Signing (check its current name in the Azure portal). Needs an Azure subscription and identity validation. Secrets would be `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus the account and certificate profile names. Check the exact names when you set it up.
- A cloud-signing certificate from a certificate authority, which they hand you as a service. Check the CA's documentation for its signing tool.

When one of these is chosen, the signing command goes in `bundle.windows.signCommand` in `desktop/src-tauri/tauri.conf.json`, and the Windows build step in the workflow gains the signing secrets. The workflow also writes an `UNSIGNED-windows` marker to the release, which must stop being written once Windows is signed. Until then SmartScreen warns on first run.

## Linux

No signing needed. Each file has a `.sha256` checksum beside it in the release.

## What users see today

- macOS: Gatekeeper blocks the first launch. Right-click Rodeo.app and choose Open, or run `xattr -dr com.apple.quarantine /Applications/Rodeo.app`.
- Windows: SmartScreen says it protected your PC. Choose More info, then Run anyway.
- Linux: nothing to get past. For the AppImage, run `chmod +x` on it first.
