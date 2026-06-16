/**
 * Supabase Auth OAuth — authorize URL открывается в отдельном popup-окне с фокусом.
 * В Supabase Dashboard → Authentication → URL configuration добавьте redirect:
 *   chrome-extension://<EXTENSION_ID>/oauth-callback.html
 * См. SUPABASE_OAUTH_SETUP.md в папке расширения.
 */

function normalizeAuthPath(raw) {
  let p = String(raw || '/bb-supabase').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  return p || '/bb-supabase';
}

function getSupabaseAuthBase(apiBaseRaw, authPathRaw) {
  const fallback =
    typeof BB_EXTENSION !== 'undefined' ? BB_EXTENSION.apiBaseDefault : 'https://swoop.autoro.tech';
  const b = String(apiBaseRaw || fallback).trim().replace(/\/$/, '');
  const authPath = normalizeAuthPath(authPathRaw);
  if (b.includes('/supabase') || b.includes('/bb-supabase')) return b;
  return `${b}${authPath}`;
}

async function getSupabaseAuthBaseFromStorage() {
  const { apiBase, supabaseAuthPath } = await chrome.storage.local.get(['apiBase', 'supabaseAuthPath']);
  return getSupabaseAuthBase(apiBase, supabaseAuthPath || '/bb-supabase');
}

/**
 * @param {'google'|'azure'} provider — в Supabase провайдер Microsoft = azure
 */
async function startSupabaseOAuth(provider) {
  const base = await getSupabaseAuthBaseFromStorage();
  const redirectTo = chrome.runtime.getURL('oauth-callback.html');
  const url = `${base}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`;
  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.floor(((screen.availWidth || width) - width) / 2));
  const top = Math.max(0, Math.floor(((screen.availHeight || height) - height) / 2));
  await new Promise((resolve, reject) => {
    chrome.windows.create(
      {
        url,
        type: 'popup',
        width,
        height,
        left,
        top,
        focused: true,
      },
      (win) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (win?.id) {
          chrome.windows.update(win.id, { focused: true }, () => resolve(win));
          return;
        }
        resolve(win);
      },
    );
  });
}
