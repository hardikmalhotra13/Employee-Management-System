const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function codeChallengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

// purpose: "login" / "link" for admins (login page / Settings), and
// "employee-login" / "employee-link" for the Employee Portal - read back
// by GoogleCallbackPage to decide which backend endpoint to call once
// Google redirects back. All four share the same Google client and
// redirect URI.
export async function startGoogleOAuth(purpose) {
  const state = randomString(16);
  const nonce = randomString(16);
  const codeVerifier = randomString(32);
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier);

  sessionStorage.setItem("google_oauth_state", state);
  sessionStorage.setItem("google_oauth_nonce", nonce);
  sessionStorage.setItem("google_oauth_code_verifier", codeVerifier);
  sessionStorage.setItem("google_oauth_purpose", purpose);

  const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI;
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  window.location.href = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// Reads the stored purpose WITHOUT clearing anything, so the callback page
// can pick the right theme / fallback route even for failures that happen
// before the session is verified. Verification itself still only happens
// in consumeGoogleOAuthSession below.
export function peekGoogleOAuthPurpose() {
  return sessionStorage.getItem("google_oauth_purpose");
}

// Reads and clears the stored PKCE/state/nonce values. Returns null if
// the state stored before redirecting doesn't match what Google sent
// back (or nothing was stored at all) - callers must treat that as a
// failed attempt, not proceed with the exchange.
export function consumeGoogleOAuthSession(returnedState) {
  const state = sessionStorage.getItem("google_oauth_state");
  const nonce = sessionStorage.getItem("google_oauth_nonce");
  const codeVerifier = sessionStorage.getItem("google_oauth_code_verifier");
  const purpose = sessionStorage.getItem("google_oauth_purpose");

  sessionStorage.removeItem("google_oauth_state");
  sessionStorage.removeItem("google_oauth_nonce");
  sessionStorage.removeItem("google_oauth_code_verifier");
  sessionStorage.removeItem("google_oauth_purpose");

  if (!state || !nonce || !codeVerifier || state !== returnedState) {
    return null;
  }

  return { codeVerifier, nonce, purpose };
}