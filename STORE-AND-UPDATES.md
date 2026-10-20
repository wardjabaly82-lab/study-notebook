# Publishing Study Notebook: automatic updates and the Microsoft Store

Two things need your own accounts, so they're prepared but switched off.

## 1. Automatic updates (GitHub) — switched on

Updates come from the Releases of https://github.com/wardjabaly82-lab/study-notebook.

- The app checks a few times a day, downloads new versions in the background (only the changed parts, using the `.blockmap`), and installs them when it closes. Settings → Updates shows the status.
- To publish a new version: raise `"version"` in `package.json` and push to `main`. `.github/workflows/release.yml` builds the installer and creates GitHub Release `vX.Y.Z` with the `.exe`, its `.blockmap` and `latest.yml`.
- Never publish the "with-my-notes" installer: it contains personal notes.

## 2. Microsoft Store (no more "Windows protected your PC" warning)

Store apps are signed by Microsoft, so students install them without any warning.

1. Open a developer account at https://partner.microsoft.com/dashboard (individual developers: the registration is currently free; check the current terms).
2. In Partner Center, reserve the app name **Study Notebook** (Apps and games → New product → MSIX or PWA app).
3. Go to Product management → Product identity. Copy these three values into the `appx` section of `package.json`:
   - Package/Identity/Name → `identityName`
   - Package/Identity/Publisher → `publisher` (starts with `CN=`)
   - Package/Properties/PublisherDisplayName → `publisherDisplayName`
4. On a Windows computer, in this project folder: `npm install`, then `npm run dist:store`. This makes `dist/Study Notebook x.y.z.appx`.
5. In Partner Center, create a submission: upload the `.appx`, add a description, screenshots (the app's screenshots work well), age rating, and a privacy policy link. A simple privacy policy is enough: the app stores notes only on the user's computer and sends nothing to the developer.
6. Submit. Microsoft's review usually takes a few days.

Note: the Store version updates through the Store, so leave `"publish"` updates for the regular installer.

## 3. Signed downloads (no warning on first launch)

The release workflow is ready: as soon as the secrets below exist in GitHub, every release is signed. Until then it builds exactly as before (unsigned on Windows, ad hoc on Mac). Prices change, so check them when you sign up.

Add each value in GitHub: **repository → Settings → Secrets and variables → Actions**. "Secret" values are hidden; "Variable" values aren't secret.

### Windows: Azure Trusted Signing (about $10 a month)

1. Create an Azure account at https://portal.azure.com and add a **Trusted Signing account** (search "Trusted Signing").
2. In it, do **Identity validation** (as an individual or a business). Microsoft checks your ID; this takes a few days.
3. Create a **Certificate profile** of type *Public Trust*.
4. Create an **App registration** (Microsoft Entra ID → App registrations → New), make a **client secret** for it, and give it the role **Trusted Signing Certificate Profile Signer** on the Trusted Signing account.
5. In GitHub add:
   - Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (from the app registration)
   - Variables: `AZURE_SIGN_ENDPOINT` (e.g. `https://weu.codesigning.azure.net`, the region of your account), `AZURE_SIGN_ACCOUNT` (account name), `AZURE_SIGN_PROFILE` (certificate profile name), `AZURE_SIGN_PUBLISHER` (the name on the certificate, exactly as Azure shows it)

The Microsoft Store (part 2) is the free alternative for Windows: Store installs never show the warning.

### Mac: Apple Developer ID and notarization ($99 a year)

1. Join the Apple Developer Program at https://developer.apple.com/programs/ (needs an Apple ID with two-factor sign-in).
2. On a Mac, in Xcode → Settings → Accounts → Manage Certificates, create a **Developer ID Application** certificate. Export it from Keychain Access as a `.p12` file with a password.
3. Turn the file into text: `base64 -i cert.p12 | pbcopy` (copies it).
4. Make an **app-specific password** at https://account.apple.com → Sign-In and Security.
5. In GitHub add secrets: `MAC_CERT_P12_BASE64` (the copied text), `MAC_CERT_PASSWORD`, `APPLE_ID` (your Apple ID email), `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (10 characters, on developer.apple.com → Membership).

### After the first signed release

- Check the run in GitHub Actions: the Windows log mentions signing with Trusted Signing, and the Mac log says it notarized. If the Mac step can't find the certificate by team ID, set `mac.identity` to the certificate's full name ("Developer ID Application: Your Name (TEAMID)") in the workflow.
- Then remove the "may say it can't check the app" paragraph from the Mac part of the release notes in `.github/workflows/release.yml`, and the warning steps from `README.md`.
