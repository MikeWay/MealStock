# Meal Stock Control v2 — Setup Guide
Real-time stock control with PostgreSQL audit trail.
All tablets on the same Wi-Fi share live data instantly.
Every change is permanently recorded with timestamp and device IP.

---

## Files in this folder

| File | Purpose |
|------|---------|
| `START_SERVER.bat` | Double-click to start — handles everything automatically |
| `db-config.js` | **Edit this first** — your PostgreSQL connection details |
| `server.js` | Node.js server (WebSocket + HTTP + DB) |
| `client.html` | The app served to all tablets |
| `setup-db.js` | Creates database tables (runs automatically on first start) |
| `package.json` | Node.js dependencies |

---

## One-time setup (about 10 minutes)

### Step 1 — Install Node.js
1. Go to **https://nodejs.org** → download the **LTS** version
2. Run the installer, click Next through all defaults

### Step 2 — Install PostgreSQL
1. Go to **https://www.postgresql.org/download/windows/**
2. Download and run the installer
3. During install:
   - Leave port as **5432**
   - Set a **password** for the `postgres` user — remember this!
   - Leave everything else as default
4. When installation finishes, PostgreSQL starts automatically as a Windows Service

### Step 3 — Create the database
1. Open **pgAdmin 4** (installed with PostgreSQL) or the **SQL Shell (psql)**
2. In pgAdmin: right-click Databases → Create → Database → name it `mealstock` → Save
   In psql: type `CREATE DATABASE mealstock;` and press Enter
3. Close pgAdmin / psql

### Step 4 — Edit db-config.js
Open `db-config.js` in Notepad and change the password:
```
password: 'changeme',   ← replace with your PostgreSQL password
```
Save the file.

### Step 5 — Copy this folder to the PC
Place the whole folder somewhere permanent, e.g. `C:\MealStockControl\`

---

## Starting the server (every day)

1. Open the `MealStockControl` folder
2. Double-click **`START_SERVER.bat`**
3. First run: it installs packages and creates all database tables automatically
4. The black window shows:

```
╔══════════════════════════════════════════════════╗
║   Meal Stock Control Server (PostgreSQL)         ║
╠══════════════════════════════════════════════════╣
║  Local:   http://localhost:3000                  ║
║  Network: http://192.168.1.50:3000               ║
╠══════════════════════════════════════════════════╣
║  Audit log: http://localhost:3000/audit          ║
║  Share the Network URL with your tablets         ║
║  Press Ctrl+C to stop                            ║
╚══════════════════════════════════════════════════╝
```

5. **Share the Network URL** with all tablets (e.g. `http://192.168.1.50:3000`)
6. Keep this window open all day

---

## Connecting tablets

1. Tablet must be on the **same Wi-Fi** as the server PC
2. Open **Chrome** on the tablet
3. Go to the **Network URL** shown in the server window
4. Bookmark it, or on Android: ⋮ menu → Add to Home Screen

---

## Using the app

| Action | How |
|--------|-----|
| Record portions used | Enter a **negative number** in a session column (e.g. `-8`) |
| Record a delivery | Tap **Log Order**, pick dish, enter quantity |
| Add a new dish | Tap **＋ Dish** |
| Start a new week | Tap **📅 Week** — remaining stock carries forward |
| Correct a mistake | Use the **Corr.** column |
| View audit history | Tap **📋 Audit Log** |
| Export stock to Excel | Tap **Export CSV** (in stock view) |
| Export audit to Excel | Tap **Export CSV** (in audit log view) |
| Reset session entries | Tap **Reset Session** (keeps start stock and orders) |

### Traffic light colours
- 🟢 **Green** = good stock
- 🟡 **Amber** = 3 portions or fewer
- 🔴 **Red** = out of stock

### Sync indicator (top right)
- 🟢 **Live** = connected, all changes sync instantly
- 🔴 **Reconnecting** = brief dropout, reconnects automatically

---

## Audit Log

Every single change is saved to PostgreSQL with:
- Date and time
- Device IP address
- Which week / dish / field was changed
- Old value → New value

Access it inside the app (📋 Audit Log button) or export as CSV.
The raw data is also available at `http://<server-ip>:3000/audit`

---

## Database backup

Your data lives in PostgreSQL. To back it up:

**Quick method (pgAdmin):**
Right-click the `mealstock` database → Backup → choose a location → Backup

**Command line (run in Command Prompt):**
```
pg_dump -U postgres mealstock > C:\Backups\mealstock_backup.sql
```

**To restore:**
```
psql -U postgres mealstock < C:\Backups\mealstock_backup.sql
```

---

## Troubleshooting

**"Cannot connect to PostgreSQL" on startup**
- Open Windows Services (Win+R → `services.msc`) and check `postgresql-x64-XX` is Running
- Check `db-config.js` has the correct password

**Tablets can't reach the server**
- Confirm all devices are on the same Wi-Fi
- Add a Windows Firewall inbound rule for TCP port 3000:
  Control Panel → Windows Defender Firewall → Advanced Settings →
  Inbound Rules → New Rule → Port → TCP → 3000 → Allow

**IP address changes after router restart**
- Set a static IP for the server PC in your router's DHCP settings,
  or in Windows: Settings → Network → Ethernet → IP assignment → Manual

**Data looks wrong**
- Restore from your last `pg_dump` backup
- The audit log shows every change ever made — you can trace exactly what happened
