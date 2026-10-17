# Study Notebook online

One shared site, on Cloudflare's free plan, where each student signs in with Google and keeps a private notebook:

- **The notebook on the web** at `/app/`, for phone and laptop.
- **Claude in any chat** (web, phone, desktop) through one custom connector: `https://<site>/mcp`. Each student connects once and signs in with Google.
- **The Windows app** links to the same account (Settings → Sign in with Google) and keeps both in sync. It also records lectures.

Every note is stored with its owner's account and every request is checked against it. The site keeps the student's name and email from Google, their notebook, and their sign-ins. Nothing else. See `/privacy`.

## Run it

1. Deploy this folder as a Cloudflare Worker (root directory `cloud`, the default build and deploy commands). It needs a D1 database bound as `DB` and a KV namespace bound as `OAUTH_KV`.
2. In Google Cloud, create an OAuth client (type: Web application) with the redirect URI `https://<site>/auth/google/callback`. Only the basic permissions (openid, email, profile) are used, so no Google review is needed; set the app to "In production".
3. In the Worker's settings → Variables and secrets, add two **secrets**: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## Test it on your computer

Put `DEV_FAKE_GOOGLE=1` in `cloud/.dev.vars` and run `npx wrangler dev`. A stand-in for Google then appears at http://127.0.0.1:8787. It works only on 127.0.0.1 or localhost and can never switch on at a real address.

## Moving from the password version

The first account to sign in is the site's owner. If the site still holds a notebook from the earlier password version, the owner's account page offers to move it into their account with that old password.
