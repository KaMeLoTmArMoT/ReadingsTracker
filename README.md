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
- 📈 **Forecast Predictions & Same-Level Connector:** End-of-month forecast interpolation for active year and cross-year level comparisons.
- 📅 **Monthly Totals & Delta Arrows:** Automatic monthly sum calculation with percentage delta badges (`↑ +12%`, `↓ -5%`).
- 🔒 **Guest & Cloud Dual Mode:**
  - **Guest Mode:** 100% private, works completely offline using `localStorage`.
  - **Cloud Mode:** 1-click Google OAuth login with instant cloud synchronization via Supabase.
- 🛠️ **Modern Vite + TypeScript + Biome Stack:** Strict type safety, instant HMR, fast compilation, and clean code formatting.
- 📤 **CSV Import & Export:** Full backward compatibility for CSV format.
- 📸 **High-Res PNG Export:** Download PNG snapshots of line charts and monthly bar charts.
- 📱 **Responsive Glassmorphism UI:** Modern dark theme styling designed for mobile, tablet, and desktop.

---

## ⚡ Local Development

```bash
# 1. Clone repository
git clone https://github.com/KaMeLoTmArMoT/ReadingsTracker.git
cd ReadingsTracker

# 2. Install dependencies
npm install

# 3. Start local development server
npm run dev

# 4. Lint & format code with Biome
npm run lint
npm run format

# 5. Build for production
npm run build
```

---

## 📊 CSV Format Specification

### Standard Format:
```csv
category,date,value
gas,2025-01-01,100
gas,2025-02-01,120
```

📁 **Sample CSV:** Download [examples/Electricity_Multi_Year.csv](examples/Electricity_Multi_Year.csv) to test imports.

---

## ☁️ Cloud Sync & Database Setup

Want to set up your own free Supabase cloud backend and Google OAuth login? Follow our comprehensive step-by-step guide:

👉 **[Read SUPABASE_SETUP.md](SUPABASE_SETUP.md)**

---

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
