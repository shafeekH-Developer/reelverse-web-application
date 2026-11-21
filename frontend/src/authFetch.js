// =====================================================
// AUTO TOKEN RENEWAL
// =====================================================
//
// The login gives a short-lived access token and a long-lived refresh
// token. This file wraps fetch() so that:
//
//   1. Before a request that needs login, an access token that is about
//      to expire is renewed first (so even a huge upload starts with a
//      valid token).
//   2. If the server still says "Token has expired", the token is renewed
//      and the request is sent again once.
//   3. If the refresh token is also finished, the user is sent to login.
//
// No other file needs to change. It is loaded once from main.jsx.

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";
const USER_KEY = "user";

// When the website is hosted, the backend lives at another address.
// Set VITE_API_URL (for example https://reelverse-api.onrender.com) and every
// "/api/..." request is sent there. Left empty, nothing changes and the
// local Vite proxy keeps working.
const API_BASE = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const LOGIN_URL = "/api/login";
const REFRESH_URL = "/api/refresh";

// Renew when the token has less than this many seconds left.
const RENEW_BEFORE_SECONDS = 90;

// Keep the real fetch, even if this file is reloaded during development.
const originalFetch =
  window.__reelverseOriginalFetch || window.fetch.bind(window);

window.__reelverseOriginalFetch = originalFetch;

let renewing = null;


// Sends the request, pointing "/api/..." at the hosted backend if set.
function send(input, init) {
  if (API_BASE) {
    if (typeof input === "string" && input.startsWith("/api/")) {
      return originalFetch(API_BASE + input.slice(4), init);
    }

    if (input instanceof URL && input.pathname.startsWith("/api/")) {
      return originalFetch(
        API_BASE + input.pathname.slice(4) + input.search,
        init
      );
    }
  }

  return originalFetch(input, init);
}


function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}


function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked. The app then behaves as before.
  }
}


function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}


// Seconds left before the token expires (0 if it cannot be read).
function secondsLeft(token) {
  try {
    const payload = token.split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const expiry = JSON.parse(atob(payload)).exp;

    return typeof expiry === "number"
      ? expiry - Date.now() / 1000
      : Infinity;
  } catch {
    return 0;
  }
}


function endSession() {
  removeStorage(ACCESS_KEY);
  removeStorage(REFRESH_KEY);
  removeStorage(USER_KEY);

  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}


// Gets a new access token. Many requests at once share one renewal.
function renewAccessToken() {
  if (renewing) {
    return renewing;
  }

  const refreshToken = readStorage(REFRESH_KEY);

  if (!refreshToken) {
    return Promise.resolve(false);
  }

  renewing = (async () => {
    try {
      const response = await send(REFRESH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();

        if (data.access_token) {
          writeStorage(ACCESS_KEY, data.access_token);
          return true;
        }

        return false;
      }

      if (response.status === 401 || response.status === 422) {
        // The refresh token is finished or not valid: login again.
        endSession();
      }

      return false;
    } catch {
      // Network problem: keep the login and try again next time.
      return false;
    }
  })().finally(() => {
    renewing = null;
  });

  return renewing;
}


function getUrl(input) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.pathname + input.search;
  }

  return null;
}


function isApiUrl(url) {
  return url.startsWith("/api/");
}


function canSendAgain(init) {
  const body = init && init.body;

  return !(
    typeof ReadableStream !== "undefined" &&
    body instanceof ReadableStream
  );
}


async function sayTokenExpired(response) {
  try {
    const data = await response.clone().json();

    return /expired/i.test(String(data.msg || data.message || ""));
  } catch {
    return false;
  }
}


async function sayBanned(response) {
  try {
    const data = await response.clone().json();

    return data.banned === true;
  } catch {
    return false;
  }
}


async function authFetch(input, init) {
  const url = getUrl(input);

  // Not an API call (or a Request object): leave it alone.
  if (!url || !isApiUrl(url)) {
    return send(input, init);
  }

  // Login: remember the refresh token that comes with it.
  if (url === LOGIN_URL) {
    const response = await send(input, init);

    if (response.ok) {
      try {
        const data = await response.clone().json();

        if (data.refresh_token) {
          writeStorage(REFRESH_KEY, data.refresh_token);
        }
      } catch {
        // Not JSON: nothing to remember.
      }
    }

    return response;
  }

  const headers = new Headers((init && init.headers) || undefined);

  // Requests without a login token are left alone.
  if (!headers.has("Authorization")) {
    return send(input, init);
  }

  let token = readStorage(ACCESS_KEY);

  // Logged out: nothing to renew, and the old refresh token must go.
  if (!token) {
    removeStorage(REFRESH_KEY);
    return send(input, init);
  }

  // Renew before sending when the token is expired or nearly expired.
  if (secondsLeft(token) < RENEW_BEFORE_SECONDS) {
    if (!readStorage(REFRESH_KEY)) {
      // Old login from before refresh tokens existed: login again.
      if (secondsLeft(token) <= 0) {
        endSession();
      }
    } else {
      await renewAccessToken();
      token = readStorage(ACCESS_KEY);

      if (!token) {
        // The session ended while renewing.
        return send(input, init);
      }
    }
  }

  headers.set("Authorization", `Bearer ${token}`);

  const response = await send(input, { ...init, headers });

  // The account was banned while logged in: end the session at once.
  if (response.status === 403 && (await sayBanned(response))) {
    endSession();

    return response;
  }

  // The server still says the token expired: renew once and send again.
  if (
    response.status === 401 &&
    readStorage(REFRESH_KEY) &&
    canSendAgain(init) &&
    (await sayTokenExpired(response))
  ) {
    if (await renewAccessToken()) {
      headers.set(
        "Authorization",
        `Bearer ${readStorage(ACCESS_KEY)}`
      );

      return send(input, { ...init, headers });
    }
  }

  return response;
}


// Lets other code (like the upload progress bar) get a fresh login token.
window.__reelverseFreshToken = async () => {
  let token = readStorage(ACCESS_KEY);

  if (
    token &&
    secondsLeft(token) < RENEW_BEFORE_SECONDS &&
    readStorage(REFRESH_KEY)
  ) {
    await renewAccessToken();
    token = readStorage(ACCESS_KEY);
  }

  return token;
};


window.fetch = authFetch;