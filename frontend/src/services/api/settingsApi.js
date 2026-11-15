import apiClient from "./apiClient.js";

export async function updateProfile(data) {
  const response = await apiClient.put("/settings/profile", data);
  return response.data.data;
}

export async function changePassword(data) {
  const response = await apiClient.put("/settings/change-password", data);
  return response.data;
}

export async function listUsers() {
  const response = await apiClient.get("/settings/users");
  return response.data.data;
}

export async function createUser(data) {
  const response = await apiClient.post("/settings/users", data);
  return response.data;
}

export async function updateUser(id, data) {
  const response = await apiClient.put(`/settings/users/${id}`, data);
  return response.data.data;
}

export async function deleteUser(id) {
  await apiClient.delete(`/settings/users/${id}`);
}

export async function resetUserMfa(id) {
  const response = await apiClient.put(`/settings/users/${id}/mfa/reset`);
  return response.data;
}

export async function getSecurityStatus() {
  const response = await apiClient.get("/settings/security");
  return response.data.data;
}

export async function startMfaSetup() {
  const response = await apiClient.post("/settings/mfa/setup/start");
  return response.data.data;
}

export async function confirmMfaSetup(secret, code) {
  const response = await apiClient.post("/settings/mfa/setup/confirm", { secret, code });
  return response.data;
}

export async function setupRecoveryCodes(code) {
  const response = await apiClient.post("/settings/mfa/recovery-codes/setup", { code });
  return response.data;
}

export async function startMfaReenroll({ recoveryCode, recoveryGrantToken } = {}) {
  const response = await apiClient.post("/settings/mfa/reenroll/start", {
    recovery_code: recoveryCode, recovery_grant_token: recoveryGrantToken,
  });
  return response.data.data;
}

export async function confirmMfaReenroll({ recoveryCode, recoveryGrantToken, secret, code }) {
  const response = await apiClient.post("/settings/mfa/reenroll/confirm", {
    recovery_code: recoveryCode, recovery_grant_token: recoveryGrantToken, secret, code,
  });
  return response.data;
}

export async function disableMfa(payload) {
  const response = await apiClient.post("/settings/mfa/disable", payload);
  return response.data;
}

export async function linkGoogleAccount(code, codeVerifier, nonce) {
  const response = await apiClient.post("/settings/google/link", {
    code, code_verifier: codeVerifier, nonce,
  });
  return response.data;
}