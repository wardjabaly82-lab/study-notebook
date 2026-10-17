# Study Notebook online

Your own small server for Study Notebook, on Cloudflare's free plan. It lets Claude use your notebook in **any** chat (claude.ai on the web, the phone app, the desktop app) and keeps the Study Notebook app on your laptop in sync with it.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wardjabaly82-lab/study-notebook/tree/main/cloud)

## Set it up (about 3 minutes)
1. Press **Deploy to Cloudflare** above (or **Create it on Cloudflare** in the app: Settings → Use in any chat). Sign up or sign in; the free plan is enough.
2. When asked for **NOTEBOOK_PASSWORD**, choose a password (at least 10 characters). Keep it: you type it twice more.
3. When it's deployed, copy your address (it ends in `.workers.dev`).
4. In the Study Notebook app: **Settings → Use in any chat**, paste the address, enter the password, press **Connect**. Your notes are copied online.
5. In Claude: **Customize → Connectors → Add custom connector**, paste the address the app shows (it ends in `/mcp`), press **Add**, then **Connect** and enter the password.

From then on, any chat can save to your notebook; the app picks the changes up within a minute while it's open, or when you next open it.

## Privacy
Your notes are stored in your own Cloudflare account (a D1 database). Claude can reach them only after you sign in with your password; the app uses the same password. Nobody else can read them without it.
