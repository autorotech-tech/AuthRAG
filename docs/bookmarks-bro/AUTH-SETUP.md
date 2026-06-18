# Bookmarks Bro: Authentication & OAuth Setup

This document describes how to configure the authentication layer (Supabase GoTrue) and social logins (Google/Microsoft OAuth) for Bookmarks Bro.

---

## 1. Supabase Stack (Variant A - Isolated BB Stack)

To keep bookmarks isolated from Swoop main metadata, it is recommended to run a separate Supabase stack:
1. Navigate to `ops/bookmarks-bro-supabase/` on the VPS.
2. Run `./bootstrap.sh` to initialize the project with `COMPOSE_PROJECT_NAME=supabase-bb` and offset ports.
3. If there are network/volume conflicts or compatibility issues with legacy compose, use the recovery script:
   ```bash
   export COMPOSE_DIR=/home/vladx/supabase-bookmarks-bro
   bash recover_bb_stack.sh
   ```
4. Apply the schema and database isolation script to the postgres container:
   ```bash
   cat sql/001_bookmarks_bro_isolation.sql | docker exec -i supabase-db-bb psql -U postgres -d postgres
   ```

---

## 2. Redirect URL Configuration (OAuth)

To support Google and Microsoft (Azure) OAuth flows in the Chrome extension, you must add redirect URIs to your Supabase project URL configuration:

### 2.1 Get Extension ID
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Locate the **Bookmarks Bro** extension and copy its **ID** (a 32-character string, e.g., `coafhjolmdcddkdbffkmnldpohicdphi`).

### 2.2 Configure Supabase Redirect URLs
1. Open the Supabase Dashboard for your project.
2. Go to **Authentication** -> **URL Configuration**.
3. Under **Redirect URLs**, add:
   ```
   chrome-extension://<EXTENSION_ID>/oauth-callback.html
   ```
   *(Replace `<EXTENSION_ID>` with your copied Chrome Extension ID).*

### 2.3 Configure Provider Credentials
1. Go to **Authentication** -> **Providers** -> **Google**.
2. Enable Google login.
3. Insert **Client ID** and **Client Secret** obtained from Google Cloud Console.
4. Copy the Supabase callback URL listed under Google settings (looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
5. Open your Google Cloud Console, go to your OAuth 2.0 Web Client, and add the copied callback URL to **Authorized redirect URIs**.

Repeat the same process for Azure (Microsoft Login) under **Authentication** -> **Providers** -> **Azure**.

---

## 3. Environment Variables

### Backend (`agent-api`)
Ensure these values are configured in your `.env` to connect to the separate bookmarks auth stack:
```env
BOOKMARKS_SUPABASE_URL=https://swoop.autoro.tech/bb-supabase
BOOKMARKS_SUPABASE_ANON_KEY=your_bb_supabase_anon_key
# Database variables (independent of Swoop main database)
BOOKMARKS_PGHOST=supabase-db-bb
BOOKMARKS_PGPORT=5432
BOOKMARKS_PGDATABASE=postgres
BOOKMARKS_PGUSER=postgres
BOOKMARKS_PGPASSWORD=your_bb_db_password
```

### Frontend (`website`)
Configure the variables in the root `.env` or during compilation:
```env
VITE_SUPABASE_URL=https://swoop.autoro.tech/bb-supabase
VITE_SUPABASE_ANON_KEY=your_bb_supabase_anon_key
```

### Extension Configuration
Verify the defaults are correct in `extensions/bookmarks-bro/extension-config.js`:
```javascript
const BB_EXTENSION = {
  apiBaseDefault: 'https://swoop.autoro.tech',
  supabaseAuthPathDefault: '/bb-supabase',
  webAppPath: '/bookmarks-bro',
  workspaceIdFallback: '1',
  build: '0.1.1-testing'
};
```
These can also be edited directly in the extension's **Settings** screen.
