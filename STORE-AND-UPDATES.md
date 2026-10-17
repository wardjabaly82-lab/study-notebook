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
