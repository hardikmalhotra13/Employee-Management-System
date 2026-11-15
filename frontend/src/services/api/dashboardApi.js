import apiClient from "./apiClient.js";

export async function getDashboardSummary() {
  const response = await apiClient.get("/dashboard/summary");
  return response.data.data;
}

export async function getDashboardCharts() {
  const response = await apiClient.get("/dashboard/charts");
  return response.data.data;
}

export async function getDashboardUpcomingEvents() {
  const response = await apiClient.get("/dashboard/upcoming-events");
  return response.data.data;
}

export async function getDashboardLeaveSummary() {
  const response = await apiClient.get("/dashboard/leave-summary");
  return response.data.data;
}