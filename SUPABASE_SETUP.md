# Supabase + Google OAuth Setup & Security Guide

This guide details the exact steps to configure Google OAuth, Supabase database sync, automated GitHub Actions migrations, and zero-cost security rules for **ReadingsTracker**.

---

## 1. Zero-Cost & Cost Safety Guarantees

* **Google Cloud Platform (OAuth 2.0):** Standard Web OAuth 2.0 is **100% free** with no usage caps. Never attach a payment method to GCP for this setup.
* **Supabase Free Tier:** Includes 500 MB PostgreSQL, 50,000 MAUs, and 1 GB storage **free forever**.
* **Billing Shield:** Do **NOT** add a credit card in Supabase or GCP billing settings. Without a card, overages cannot trigger charges—Supabase simply switches to Read-Only mode if limits are reached.

---

## 2. Integration Steps

### Step 1: Copy Callback URL from Supabase
1. Log in to [Supabase Dashboard](https://supabase.com/dashboard) and open your project.
2. Go to **Authentication** → **Providers** → **Google**.
3. Copy the **Callback URL (Redirect URL)** (format: `https://<project-ref>.supabase.co/auth/v1/callback`).

### Step 2: Create Credentials in Google Cloud Console
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `readings-tracker-auth`).
3. Navigate to **APIs & Services** → **OAuth consent screen**:
   - Select **External** → Click **Create**.
   - App name: `ReadingsTracker`
   - Fill support/contact emails → Click **Save and Continue**.
4. Navigate to **APIs & Services** → **Credentials**:
   - Click **+ CREATE CREDENTIALS** → **OAuth client ID** → **Web application**.
   - **Authorized JavaScript origins**: `https://kamelotmarmot.github.io`
   - **Authorized redirect URIs**: Paste the Supabase Callback URL from Step 1.
   - Click **CREATE**.
5. Copy the generated **Client ID** and **Client Secret**.

### Step 3: Finalize Supabase Configuration
1. Return to **Supabase Dashboard** → **Authentication** → **Providers** → **Google**.
2. Paste **Client ID** and **Client Secret**, toggle **Enable Google provider** ON, and click **Save**.
3. Go to **Authentication** → **URL Configuration**:
   - **Site URL**: `https://kamelotmarmot.github.io/ReadingsTracker/`
   - **Redirect URLs**: `https://kamelotmarmot.github.io/ReadingsTracker/*`
4. Click **Save**.
5. Copy your **Publishable API Key** (`anon public`) from **Project Settings** → **API Keys** and ensure it is assigned to `DEFAULT_SUPABASE_ANON_KEY` in `src/state.ts`.

---

## 3. Automated Database Migrations (GitHub Actions)

Migrations run automatically via GitHub Actions (`.github/workflows/supabase-migrations.yml`) whenever SQL files are pushed to `supabase/migrations/`.

### Initial Setup for GitHub Secrets:
1. Open your project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Database** → **Transaction pooler** → **URI**.
3. Copy the Connection string (replace `[YOUR-PASSWORD]` with your database password):
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`
4. In your GitHub Repository, go to **Settings** → **Secrets and variables** → **Actions**.
5. Click **New repository secret**:
   - **Name**: `SUPABASE_DB_URL`
   - **Secret**: Paste the Connection URI.

---

## 4. Security Architecture & RLS Rules

```text
[ User / Bot ] ──► [ GitHub Pages ] ──► [ Google OAuth 2.0 ] ──► [ Supabase Postgres ]
                                                                        │ (RLS + Quotas)
```

| Security Layer | Technical Mechanism | Enforcement Location |
|---|---|---|
| **OAuth 2.0 Barrier** | Registration requires a valid Google account (prevents spam bots) | Google Cloud / Supabase Auth |
| **Row Level Security (RLS)** | `auth.uid() = user_id` limits user operations strictly to their own rows | `supabase/migrations/` |
| **Payload Size Constraint** | `pg_column_size(payload) <= 524288` (Max 500 KB per entry) | Postgres Check Constraint |
| **Account Quota Limit** | `check_user_readings_limit` trigger caps records at 20 per account | Postgres Function Trigger |
| **Rate Limiting** | Built-in IP rate limits (30 sign-ins / 5 min) | Supabase API Gateway |

### Dashboard Settings Reference:
* **Redirect URLs:** `https://kamelotmarmot.github.io/ReadingsTracker/*` (**Required**).
* **hCaptcha / Password Checks:** Keep **Disabled** (Redundant for OAuth-only setups).
* **IP Address Forwarding:** Keep **Disabled** (Not needed for client-side web apps).
