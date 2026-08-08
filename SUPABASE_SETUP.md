# Supabase + Google OAuth Setup & Security Guide

This document provides a step-by-step guide to setting up Google OAuth authentication and Supabase database synchronization with strict security constraints and zero-cost guarantees for **ReadingsTracker**.

---

## 1. Zero-Cost & Cost Safety Principles

- **Google Cloud Platform (OAuth 2.0):** Standard Web OAuth 2.0 sign-in is **100% free** with no limits. Never enable billing on GCP for this setup.
- **Supabase:** The Free Tier includes 500 MB PostgreSQL, 50,000 Monthly Active Users (MAUs), and 1 GB storage **free forever**.
- **Billing Shield:** Do **NOT** attach a credit card in GCP or Supabase Billing settings. Without a payment method, charges cannot occur; Supabase will simply restrict access if limits are reached rather than billing.

---

## 2. Step-by-Step Google & Supabase Integration

To avoid "chicken-and-egg" confusion between Google Cloud and Supabase, follow this exact sequence:

### Step 1: Copy Callback URL from Supabase
1. Log in to [Supabase Dashboard](https://supabase.com/dashboard) and open your project.
2. Navigate to **Authentication** -> **Providers** -> **Google**.
3. Copy the **Callback URL (Redirect URL)** shown there (it looks like `https://<your-project-ref>.supabase.co/auth/v1/callback`).
   *(Leave this tab open)*.

### Step 2: Create Credentials in Google Cloud Console
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `readings-tracker-auth`).
3. Navigate to **APIs & Services** -> **OAuth consent screen**:
   - Choose **External** -> Click **Create**.
   - App name: `ReadingsTracker`
   - User support email: your email
   - Developer contact information: your email
   - Click **Save and Continue** through the remaining steps.
4. Navigate to **APIs & Services** -> **Credentials**:
   - Click **+ CREATE CREDENTIALS** -> **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `ReadingsTracker Web Client`.
   - **Authorized JavaScript origins**:
     - `https://kamelotmarmot.github.io`
   - **Authorized redirect URIs**:
     - **Paste** the Callback URL copied from Supabase in Step 1.
   - Click **CREATE**.
5. Copy the generated **Client ID** and **Client Secret**.

### Step 3: Finish Configuration in Supabase
1. Return to your **Supabase Dashboard** tab (**Authentication** -> **Providers** -> **Google**).
2. **Paste** the **Client ID** and **Client Secret** from Google (Step 2).
3. Toggle **Enable Google provider** ON and click **Save**.
4. Navigate to **Authentication** -> **URL Configuration**:
   - **Site URL**: `https://kamelotmarmot.github.io/ReadingsTracker/`
   - **Redirect URLs**: `https://kamelotmarmot.github.io/ReadingsTracker/*`
5. Click **Save**.

---

## 4. Automatic Database Migrations (GitHub Actions)

Migrations are automated via GitHub Actions (`.github/workflows/supabase-migrations.yml`). Every time a new SQL migration file is added to `supabase/migrations/` and pushed to GitHub, it will automatically execute in your Supabase database.

### One-Time Setup for GitHub Secrets:
1. Open your project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Click the **Connect** button at the very top of the page (next to your project name) **OR** go to **Database** (cylinder icon in the main left sidebar).
3. Select **Transaction pooler** (recommended for GitHub Actions / IPv4 compatibility) -> **URI**.
4. Copy the **Connection string** (replace `[YOUR-PASSWORD]` with your real Supabase DB password). It looks like:
   `postgresql://postgres.gxbpsbqpuaudtlfliezs:[YOUR-PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`
4. Open your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
5. Click **New repository secret**:
   - **Name**: `SUPABASE_DB_URL`
   - **Secret**: Paste the Postgres connection URI from Step 3.
6. Click **Add secret**.

From now on, whenever you or any script add a `.sql` file to `supabase/migrations/` and push to GitHub, the database schema updates automatically!

### Manual Fallback (Supabase SQL Editor)
If you ever want to run SQL manually instead of GitHub Actions, open **Supabase SQL Editor** and run the contents of [`supabase/migrations/20260808000000_schema_and_security.sql`](file:///g:/programming/Plugins/Tracker/supabase/migrations/20260808000000_schema_and_security.sql).

---

## 5. Security & Spam Protection Summary

1. **OAuth Barrier:** Registration requires a valid Google account, stopping automated email spam bots.
2. **Postgres RLS:** Prevents unauthorized reads/writes across user boundaries.
3. **Trigger Quotas:** Prevents single account DB spam (max 20 records per user, max 500 KB per payload).
4. **Cloudflare Proxy (Optional):** Wrap custom domain with Cloudflare WAF/DDoS rules for domain protection.
