# MARO ULTRA MODULES BOT 🤖

Telegram bot for downloading and packing NPM libraries as ZIP files.

Supports: Arabic 🇪🇬 | English 🇬🇧 | Russian 🇷🇺

## Features
- 🔍 Search npm packages by name
- 📂 Upload `package.json` and get all dependencies zipped
- 📢 Admin broadcast and `/stats` command
- ✅ Force-subscribe to channels

---

## ☁️ Deploy Options (Best to Worst)

### 🥇 Railway (BEST — Free $5/month, no sleep)
1. Push this folder to GitHub as root
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables:
   - `BOT_TOKEN` = your bot token
   - `ADMIN_ID` = your Telegram ID
4. Deploy ✅

### 🥈 Koyeb (Free, no sleep)
1. Go to [koyeb.com](https://koyeb.com) → Create App
2. Connect GitHub repo
3. Add env vars: `BOT_TOKEN`, `ADMIN_ID`
4. Deploy ✅

### 🥉 Render (Free but sleeps after 15min ⚠️)
1. New Web Service → Connect GitHub
2. Build: `npm install` | Start: `node index.js`
3. Add env vars

### Replit (Uses credits)
- Already running if you're reading this on Replit

---

## ⚙️ Config

Edit `config.json` **OR** use environment variables:

```
BOT_TOKEN=your_token
ADMIN_ID=your_telegram_id
```

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "adminId": 123456789,
  "channels": [
    {"id": "@channel", "url": "https://t.me/channel", "name": "Channel Name"}
  ]
}
```

## 🛠 Admin Commands
- `/stats` — Show bot statistics
- `/broadcast <message>` — Send message to all users
