# Study Notebook online

Your own small server for Study Notebook, on Cloudflare's free plan. It lets Claude use your notebook in **any** chat (claude.ai on the web, the phone app, the desktop app) and keeps the Study Notebook app on your laptop in sync with it.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wardjabaly82-lab/study-notebook/tree/main/cloud)

## Set it up (about 3 minutes)
1. Press **Deploy to Cloudflare** above (or **Create it on Cloudflare** in the app: Settings → Use in any chat). Sign up or sign in; the free plan is enough.
2. Press **Create and deploy**. When it's deployed, copy your address (it ends in `.workers.dev`).
3. In the Study Notebook app: **Settings → Use in any chat**, paste the address, choose a password (at least 8 characters; the app asks for it twice the first time) and press **Connect**. The password is set on your online notebook and your notes are copied online.
4. In Claude: **Customize → Connectors → Add custom connector**, paste the address the app shows (it ends in `/mcp`), press **Add**, then **Connect** and enter the password.

From then on, any chat can save to your notebook; the app picks the changes up within a minute while it's open, or when you next open it.

## Privacy
Your notes are stored in your own Cloudflare account (a D1 database). Only a salted hash of your password is stored. Claude can reach your notes only after you sign in with the password; the app uses the same one. Nobody else can read them without it. (Alternatively you can set the password as a Cloudflare secret named `NOTEBOOK_PASSWORD`; that one then takes precedence.)
