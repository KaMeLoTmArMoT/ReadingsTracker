<div align="center">

# ⚡ ReadingsTracker

**A sleek, privacy-first, zero-cost dashboard for tracking utility consumption (Gas, Electricity, Water) with multi-year chart overlays & instant 1-click cloud sync.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-GitHub_Pages-brightgreen?style=for-the-badge&logo=github)](https://kamelotmarmot.github.io/ReadingsTracker/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Supabase](https://img.shields.io/badge/Cloud-Supabase-emerald?style=for-the-badge&logo=supabase)](SUPABASE_SETUP.md)

<br />

[**🚀 Try Live Demo**](https://kamelotmarmot.github.io/ReadingsTracker/) • [**📘 Supabase Setup Guide**](SUPABASE_SETUP.md) • [**🐛 Report Issue**](https://github.com/KaMeLoTmArMoT/ReadingsTracker/issues)

</div>

---

## 🌟 Why ReadingsTracker?

ReadingsTracker is built for anyone who wants a clean, ultra-fast visual tracker for utility meters without bloat, subscriptions, or complex setup. Works **100% offline out-of-the-box** and seamlessly syncs to the cloud across your devices with a single click.

<p align="center">
  <img src="assets/readings_example_multi_year.png" width="800" alt="ReadingsTracker Dashboard Overview">
</p>

---

## ✨ Key Features

- 📊 **Multi-Year Overlay Analytics:** Normalize readings across different years to compare consumption patterns side-by-side.
- 📅 **Monthly Totals Breakdown:** Automatic monthly sum calculation (months 01–12) with missing month zero-filling.
- 🔒 **Guest & Cloud Dual Mode:**
  - **Guest Mode:** 100% private, works completely offline using `localStorage`.
  - **Cloud Mode:** 1-click Google OAuth login with instant cloud synchronization via Supabase.
- 🛡️ **Zero-Cost Security Shield:** Built-in Postgres Row Level Security (RLS), 500 KB payload limits, and max 20 data blocks quota enforcement. **Zero credit card required.**
- 📤 **CSV Import & Export:** Full backward compatibility for legacy CSV formats (`category, date, value`).
- 📸 **High-Res PNG Export:** Download beautiful PNG snapshots of your multi-year line charts and monthly bar charts.
- 📱 **Mobile-Friendly:** Responsive design for desktop, tablet, and smartphone browsers.

---

## ⚡ Quick Start

### 1. Web / GitHub Pages (Recommended)
Launch directly in your browser without installing anything:
👉 **[Open Live App](https://kamelotmarmot.github.io/ReadingsTracker/)**

### 2. Local Development
Run locally in 3 simple commands (no Node.js build steps required):

```bash
git clone https://github.com/KaMeLoTmArMoT/ReadingsTracker.git
cd ReadingsTracker
python3 -m http.server 8000
```
Open `http://localhost:8000` in your browser.

---

## 📊 CSV Format Specification

### Standard Format (Recommended):
```csv
category,date,value,cost_per_unit,currency,unit
gas,2025-01-01,100,0.20,EUR,m3
gas,2025-02-01,120,0.20,EUR,m3
```

### Legacy Format (Supported for Import):
```csv
category,date,value
gas,2025-01-01,100
gas,2025-02-01,120
```

📁 **Sample CSV:** Download [examples/electricity_multi_year.csv](examples/electricity_multi_year.csv) to test imports.

---

## ☁️ Cloud Sync & Database Setup

Want to set up your own free Supabase cloud backend and Google OAuth login? Follow our comprehensive step-by-step guide:

👉 **[Read SUPABASE_SETUP.md](SUPABASE_SETUP.md)**

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
