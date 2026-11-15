import apiClient from "./apiClient.js";

export async function listHolidays(year) {
  const response = await apiClient.get("/holidays", { params: { year } });
  return response.data.data;
}

export async function createHoliday(data) {
  const response = await apiClient.post("/holidays", data);
  return response.data.data;
}

export async function updateHoliday(id, data) {
  const response = await apiClient.put(`/holidays/${id}`, data);
  return response.data.data;
}

export async function deleteHoliday(id) {
  await apiClient.delete(`/holidays/${id}`);
}

// Weekends, holidays and working-day overrides in a date range, used to
// mark days in other admin screens (e.g. the roster grid).
export async function getCalendarDays(startDate, endDate) {
  const response = await apiClient.get("/calendar/days", {
    params: { start_date: startDate, end_date: endDate },
  });
  return response.data.data;
}