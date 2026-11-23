# 🚀 KRUZENLAB — Vercel ZIP & HTML Uploader

Aplikasi web siap deploy ke Vercel (sekaligus dilengkapi script CLI Node.js) untuk mengunggah arsip `.zip` atau file `.html` langsung menjadi website live di Vercel.

## 📁 Struktur Project (Siap Deploy, Tanpa Nested Folder)
```
├── index.html               # Antarmuka Web Uploader (Mobile-Friendly)
├── api/
│   └── deploy.js            # Serverless Function Vercel REST API
├── deployhtmlziptovercel.js # Script CLI Node.js (opsional untuk Termux/PC)
├── package.json             # Konfigurasi & dependency jszip
├── vercel.json              # Routing Vercel
└── README.md                # Dokumentasi
```

## 🌐 Cara Deploy Web Uploader Ini ke Vercel
1. Ekstrak ZIP ini, lalu upload seluruh isinya ke repository GitHub baru (pastikan `index.html`, `package.json`, dan folder `api/` berada langsung di **root** repository).
2. Import repository tersebut di **Vercel Dashboard** lalu klik **Deploy**.
3. Setelah aktif, buka domain Vercel Anda, masukkan `VERCEL_TOKEN`, pilih file `.zip` / `.html` website yang ingin di-deploy, dan klik **Deploy Sekarang**.

## 💻 Cara Pakai via Terminal / Termux (CLI)
```bash
npm install
export VERCEL_TOKEN="YOUR_VERCEL_TOKEN"
node deployhtmlziptovercel.js ./website.zip nama-project --production
```
