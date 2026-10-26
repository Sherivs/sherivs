# Sign-in security setup (Turnstile, password policy, password reset)

Owner checklist for PR #65. You can do every step from a phone. Do them **in this order**
so that sign-in keeps working the whole time.

> **Why the order matters:** The app only shows the Turnstile check when
> `VITE_TURNSTILE_SITE_KEY` is set, and it never blocks a sign-in by itself.
> Only Supabase rejects sign-ins without a captcha, and only after you turn on
> captcha there. If Supabase captcha is ON but the site key is missing from the
> live site, **every sign-in, sign-up and reset fails**. So the site key goes
> live first, and Supabase captcha is switched on last.

## Step 1: Create the Turnstile widget (Cloudflare)
1. On your phone, open **dash.cloudflare.com** and sign in. A free account is enough.
2. Tap the menu (☰), then **Turnstile**, then **Add widget**.
3. **Widget name:** `Sherivs sign-in`.
4. **Hostnames:** add `app.sherivs.com` and `sherivs.com`. Add `www.sherivs.com` too if
   you use it. To test previews, you can also add `localhost`.
5. **Widget mode:** **Managed** (recommended). Most people never see a puzzle.
6. Pre-clearance: **No**. Tap **Create**.
7. Copy both values into a password manager:
   - **Site key** (public, starts `0x4AAAA…`) is for Vercel.
   - **Secret key** (private) is for Supabase. Never put it in Vercel or in the code.

## Step 2: Add the site key to Vercel and redeploy
1. Open **vercel.com**, go to the Sherivs project, then **Settings**, then **Environment Variables**.
2. **Add new**:
   - Key: `VITE_TURNSTILE_SITE_KEY`
   - Value: the **Site key** from Step 1
   - Environments: tick **Production**. Also tick Preview if `localhost`/preview hosts are on the widget.
3. Tap **Save**.
4. Go to **Deployments**, open the latest Production deployment, tap **⋯**, then **Redeploy**.
   `VITE_` values are built into the app, so you must redeploy.
5. Check: open `https://app.sherivs.com/auth` in a private tab. You should see the Cloudflare
   check box above **Sign in**. Sign in once. It still works because Supabase is not enforcing yet.

## Step 3: Turn on captcha in Supabase (last)
1. Open **supabase.com/dashboard**, then project **nwrflbpbhyiqdptmlccm**, then **Authentication**.
2. Go to **Attack Protection** (on some dashboards: Settings, then *Bot and Abuse Protection*).
3. Switch on **Enable Captcha protection**. Provider: **Cloudflare Turnstile**.
4. Paste the **Secret key** from Step 1. Tap **Save**.
5. Check in a private tab: sign in at `app.sherivs.com/auth`, then open **Forgotten password?**
   and request a link. Both should work.

**If sign-in breaks:** switch Supabase captcha **OFF** first (Step 3.3). That fixes it right away.
Then check the Vercel variable and the widget's hostnames.

**To remove Turnstile later:** reverse the order. Turn Supabase captcha OFF, then delete the
Vercel variable and redeploy.

## Step 4: Password policy (Supabase)
Go to **Authentication**, then **Providers**, then **Email** (on some dashboards: *Sign In / Providers*, then Email):
- **Minimum password length:** `10`
- **Password requirements:** *Lowercase, uppercase letters and digits*
- **Prevent use of leaked passwords:** ON, if your plan offers it (Pro and above). The app already
  shows a clear "appeared in a data breach" message when Supabase rejects one.
- **Secure password change:** ON. **Require current password when updating:** ON, if shown.

Existing users whose passwords are shorter can still sign in. The rules apply only when
someone sets a new password.

## Step 5: Password-reset links (Supabase)
1. Go to **Authentication**, then **URL Configuration**:
   - **Site URL:** `https://app.sherivs.com`
   - **Redirect URLs**, add:
     - `https://app.sherivs.com/reset-password`
     - `https://app.sherivs.com/auth`
     - `https://sherivs.com/reset-password` (only if people sign in on sherivs.com)
     - optional for previews: `https://*-vibeoraai-bit.vercel.app/**`
2. Go to **Authentication**, then **Emails**, then **Reset Password** template. Keep the link as
   `{{ .ConfirmationURL }}`, which honours the `redirectTo` the app sends. Suggested text:
   *"Someone asked to reset the password for your Sherivs account. If this was you, open the link
   below within 1 hour. If not, you can ignore this email."*
3. Go to **Authentication**, then **Rate Limits**. The defaults are fine. "Emails sent" is the
   cap on reset emails. On the built-in mailer it is very low, so raise it after setting up SMTP.

## Step 6: Email delivery (required for real users)
Supabase's built-in mailer **only delivers to members of your Supabase organization** and is
heavily rate-limited. Real users will not get reset or confirmation emails until custom SMTP is
set up:
1. In **Resend** (resend.com), add and verify the domain `sherivs.com` (DNS records in Cloudflare),
   then create an API key.
2. In Supabase, go to **Authentication**, then **Emails**, then **SMTP Settings**, and turn on **Enable custom SMTP**:
   - Host `smtp.resend.com`, Port `465`, Username `resend`, Password: the Resend API key
   - Sender email `no-reply@sherivs.com`, Sender name `Sherivs`
3. Raise **Rate Limits**, then **Emails sent per hour**, to something like 100.
4. Send yourself a reset from a phone that is not signed in to Supabase, to confirm delivery.

## Step 7: Google sign-in (invited accounts only)
The login card offers **Sign in with Google**. That button opens Google's account picker.
It must **not** become a public sign-up path.

1. In Google Cloud Console, create an OAuth client (Web application) for the Sherivs project.
   Authorized JavaScript origins: `https://app.sherivs.com` (and `http://localhost:3000` for local).
   Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase, **Authentication** → **Providers** → **Google**: enable it and paste the client ID and secret.
3. **Authentication** → **URL Configuration** → **Redirect URLs**, add:
   - `https://app.sherivs.com/`
   - `https://app.sherivs.com/?panel=signin`
   - `https://app.sherivs.com/auth`
4. Keep **Allow new users to sign up** off if the dashboard shows it. Invited users already exist
   (admin `inviteUserByEmail` / `createUser`). A Google account with no membership is signed out
   by the app with an invitation message.
5. Check: on `app.sherivs.com` tap **Sign in**, then **Sign in with Google**. Google should list
   accounts. An invited Gmail address signs in. An unknown Google account does not stay signed in.
