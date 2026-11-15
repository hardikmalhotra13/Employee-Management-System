import employeeApiClient from "./employeeApiClient.js";

export async function getMyTeam() {
  const response = await employeeApiClient.get("/manager/team");
  return response.data.data;
}

export async function getTeamMember(id) {
  const response = await employeeApiClient.get(`/manager/team/${id}`);
  return response.data.data;
}

export async function getTeamAttendance(params) {
  const response = await employeeApiClient.get("/manager/team/attendance", { params });
  return response.data.data;
}

export async function getTeamAttendanceSummary(params) {
  const response = await employeeApiClient.get("/manager/team/attendance/summary", { params });
  return response.data.data;
}

export async function getTeamAttendanceExceptions() {
  const response = await employeeApiClient.get("/manager/team/attendance/exceptions");
  return response.data.data;
}

export async function getTeamShiftOptions() {
  const response = await employeeApiClient.get("/manager/team/shifts");
  return response.data.data;
}

export async function getTeamLeaveRequests(params) {
  const response = await employeeApiClient.get("/manager/team/leave", { params });
  return response.data.data;
}

export async function approveLeaveRequest(id) {
  const response = await employeeApiClient.put(`/manager/team/leave/${id}/approve`);
  return response.data.data;
}

export async function rejectLeaveRequest(id, reason) {
  const response = await employeeApiClient.put(`/manager/team/leave/${id}/reject`, { reason });
  return response.data.data;
}

export async function getManagerReviewCycles() {
  const response = await employeeApiClient.get("/manager/review-cycles");
  return response.data.data;
}

export async function getTeamPerformanceReviews(params) {
  const response = await employeeApiClient.get("/manager/team/performance-reviews", { params });
  return response.data.data;
}

export async function createTeamPerformanceReview(employeeId, data) {
  const response = await employeeApiClient.post(`/manager/team/employees/${employeeId}/performance-reviews`, data);
  return response.data.data;
}

export async function updateTeamPerformanceReview(reviewId, data) {
  const response = await employeeApiClient.put(`/manager/team/performance-reviews/${reviewId}`, data);
  return response.data.data;
}

export async function submitTeamPerformanceReview(reviewId) {
  const response = await employeeApiClient.put(`/manager/team/performance-reviews/${reviewId}/submit`);
  return response.data.data;
}

export async function deleteTeamPerformanceReview(reviewId) {
  await employeeApiClient.delete(`/manager/team/performance-reviews/${reviewId}`);
}

export async function getManagerTrainingPrograms() {
  const response = await employeeApiClient.get("/manager/training-programs");
  return response.data.data;
}

export async function getTeamTrainingRecords(params) {
  const response = await employeeApiClient.get("/manager/team/training-records", { params });
  return response.data.data;
}

export async function createTeamTrainingRecord(employeeId, data) {
  const response = await employeeApiClient.post(`/manager/team/employees/${employeeId}/training-records`, data);
  return response.data.data;
}

export async function completeTeamTrainingRecord(recordId, data) {
  const response = await employeeApiClient.put(`/manager/team/training-records/${recordId}/complete`, data);
  return response.data.data;
}

export async function downloadTeamMemberDocument(documentId, downloadName) {
  const response = await employeeApiClient.get(`/manager/team/documents/${documentId}/download`, {
    responseType: "blob",
  });

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", downloadName || "document");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}