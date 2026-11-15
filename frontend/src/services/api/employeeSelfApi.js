import employeeApiClient from "./employeeApiClient.js";

export async function login(email, password) {
  const response = await employeeApiClient.post("/employee/login", { email, password });
  return response.data;
}

export async function employeeGoogleLogin(code, codeVerifier, nonce) {
  const response = await employeeApiClient.post("/employee/google/callback", {
    code,
    code_verifier: codeVerifier,
    nonce,
  });
  return response.data;
}

export async function linkEmployeeGoogleAccount(code, codeVerifier, nonce) {
  const response = await employeeApiClient.post("/employee/settings/google/link", {
    code,
    code_verifier: codeVerifier,
    nonce,
  });
  return response.data;
}

export async function verifyMfa(pendingToken, code) {
  const response = await employeeApiClient.post("/employee/mfa/verify", { pending_token: pendingToken, code });
  return response.data;
}

export async function verifyMfaRecovery(pendingToken, recoveryCode) {
  const response = await employeeApiClient.post("/employee/mfa/verify-recovery", {
    pending_token: pendingToken,
    recovery_code: recoveryCode,
  });
  return response.data;
}

export async function getSecurityStatus() {
  const response = await employeeApiClient.get("/employee/settings/security");
  return response.data.data;
}

export async function startMfaSetup() {
  const response = await employeeApiClient.post("/employee/settings/mfa/setup/start");
  return response.data.data;
}

export async function confirmMfaSetup(secret, code) {
  const response = await employeeApiClient.post("/employee/settings/mfa/setup/confirm", { secret, code });
  return response.data.data;
}

export async function disableMfa(payload) {
  const response = await employeeApiClient.post("/employee/settings/mfa/disable", payload);
  return response.data;
}

export async function changePassword(currentPassword, newPassword) {
  const response = await employeeApiClient.put("/employee/settings/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
  return response.data;
}

export async function validateToken(token) {
  const response = await employeeApiClient.get("/employee/validate-token", { params: { token } });
  return response.data;
}

export async function setPassword(token, newPassword) {
  const response = await employeeApiClient.post("/employee/set-password", { token, new_password: newPassword });
  return response.data;
}

export async function forgotPassword(email) {
  const response = await employeeApiClient.post("/employee/forgot-password", { email });
  return response.data;
}

export async function getMyProfile() {
  const response = await employeeApiClient.get("/employee/me");
  return response.data.data;
}

export async function updateMyProfile(phone, address) {
  const response = await employeeApiClient.put("/employee/me", { phone, address });
  return response.data.data;
}

export async function uploadMyPhoto(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await employeeApiClient.post("/employee/me/photo", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
}

export async function removeMyPhoto() {
  const response = await employeeApiClient.delete("/employee/me/photo");
  return response.data;
}

export async function fetchMyPhotoObjectUrl() {
  const response = await employeeApiClient.get("/employee/me/photo", { responseType: "blob" });
  return window.URL.createObjectURL(new Blob([response.data]));
}

export async function checkIn() {
  const response = await employeeApiClient.post("/employee/attendance/check-in");
  return response.data;
}

export async function checkOut() {
  const response = await employeeApiClient.post("/employee/attendance/check-out");
  return response.data;
}

export async function getMyAttendance(params) {
  const response = await employeeApiClient.get("/employee/attendance", { params });
  return response.data.data;
}

export async function getMyHolidayCalendar(year) {
  const response = await employeeApiClient.get("/employee/holidays", { params: { year } });
  return response.data.data;
}

export async function getMyTodayAttendance() {
  const response = await employeeApiClient.get("/employee/attendance/today");
  return response.data.data;
}

export async function getMyAttendanceSummary(params) {
  const response = await employeeApiClient.get("/employee/attendance/summary", { params });
  return response.data.data;
}

export async function submitLeaveRequest(data) {
  const response = await employeeApiClient.post("/employee/leave", data);
  return response.data.data;
}

export async function getMyLeaveRequests(params) {
  const response = await employeeApiClient.get("/employee/leave", { params });
  return response.data.data;
}

export async function getMyLeaveBalance() {
  const response = await employeeApiClient.get("/employee/leave/balance");
  return response.data.data;
}

export async function cancelLeaveRequest(id) {
  const response = await employeeApiClient.put(`/employee/leave/${id}/cancel`);
  return response.data.data;
}

export async function getMyAssets() {
  const response = await employeeApiClient.get("/employee/assets");
  return response.data.data;
}

export async function getMyPerformanceReviews(params) {
  const response = await employeeApiClient.get("/employee/performance-reviews", { params });
  return response.data.data;
}

// Same endpoint managerApi.js's getManagerReviewCycles calls - it only
// requires an authenticated employee, not a manager, and is reused here
// purely to populate the Cycle filter dropdown on My Performance.
export async function getReviewCycles() {
  const response = await employeeApiClient.get("/manager/review-cycles");
  return response.data.data;
}

export async function getMyTrainingRecords(params) {
  const response = await employeeApiClient.get("/employee/training-records", { params });
  return response.data.data;
}

export async function uploadMyTrainingCertificate(recordId, file) {
  const formData = new FormData();
  formData.append("file", file);

  // No explicit Content-Type here - the browser must generate it itself
  // (multipart/form-data; boundary=...). Setting it manually without a
  // boundary is what was actually breaking this upload: the backend's
  // request.files.get("file") came back empty because the request body
  // had no boundary to parse by, so the record's data/eligibility logic
  // was never reached at all.
  const response = await employeeApiClient.post(`/employee/training-records/${recordId}/certificate`, formData);
  return response.data.data;
}

export async function completeMyTrainingRecord(recordId, completionDate, file, completionComment) {
  const formData = new FormData();
  formData.append("completion_date", completionDate);
  if (completionComment) {
    formData.append("completion_comment", completionComment);
  }
  if (file) {
    formData.append("file", file);
  }

  // Same reasoning as uploadMyTrainingCertificate above: no manual
  // Content-Type here, so the browser generates the correct multipart
  // boundary itself.
  const response = await employeeApiClient.post(`/employee/training-records/${recordId}/complete`, formData);
  return response.data.data;
}

export async function getMyTodayRoster() {
  const response = await employeeApiClient.get("/employee/roster/today");
  return response.data.data;
}