import axios from "axios";

const employeeApiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000/api/v1",
});

employeeApiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("employee_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default employeeApiClient;