import apiClient from "./apiClient.js";

export async function listReviewCycles({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/review-cycles", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createReviewCycle(data) {
  const response = await apiClient.post("/review-cycles", data);
  return response.data.data;
}

export async function updateReviewCycle(id, data) {
  const response = await apiClient.put(`/review-cycles/${id}`, data);
  return response.data.data;
}

export async function archiveReviewCycle(id) {
  await apiClient.delete(`/review-cycles/${id}`);
}

export async function restoreReviewCycle(id) {
  const response = await apiClient.put(`/review-cycles/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteReviewCycle(id) {
  await apiClient.delete(`/review-cycles/${id}/permanent`);
}

export async function getEmployeePerformanceReviews(employeeId) {
  const response = await apiClient.get(`/employees/${employeeId}/performance-reviews`);
  return response.data.data;
}

export async function createEmployeePerformanceReview(employeeId, data) {
  const response = await apiClient.post(`/employees/${employeeId}/performance-reviews`, data);
  return response.data.data;
}

export async function updatePerformanceReview(reviewId, data) {
  const response = await apiClient.put(`/performance-reviews/${reviewId}`, data);
  return response.data.data;
}

export async function submitPerformanceReview(reviewId) {
  const response = await apiClient.put(`/performance-reviews/${reviewId}/submit`);
  return response.data.data;
}