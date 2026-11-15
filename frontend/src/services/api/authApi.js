import apiClient from "./apiClient.js";

export async function login(email, password) {
  const response = await apiClient.post("/login", { email, password });
  return response.data;
}

export async function verifyMfaSetup(setupToken, code) {
  const response = await apiClient.post("/mfa/setup/verify", { setup_token: setupToken, code });
  return response.data;
}

export async function verifyMfa(pendingToken, code) {
  const response = await apiClient.post("/mfa/verify", { pending_token: pendingToken, code });
  return response.data;
}

export async function verifyMfaRecovery(pendingToken, recoveryCode) {
  const response = await apiClient.post("/mfa/verify-recovery", {
    pending_token: pendingToken, recovery_code: recoveryCode,
  });
  return response.data;
}

export async function googleLogin(code, codeVerifier, nonce) {
  const response = await apiClient.post("/auth/google/callback", {
    code, code_verifier: codeVerifier, nonce,
  });
  return response.data;
}

export async function validateToken(token) {
  const response = await apiClient.get("/validate-token", { params: { token } });
  return response.data;
}

export async function setPassword(token, newPassword) {
  const response = await apiClient.post("/set-password", { token, new_password: newPassword });
  return response.data;
}

export async function forgotPassword(email) {
  const response = await apiClient.post("/forgot-password", { email });
  return response.data;
}