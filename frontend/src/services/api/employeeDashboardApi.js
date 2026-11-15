import employeeApiClient from "./employeeApiClient.js";

// Short-lived, in-memory cache so returning to the Dashboard from another
// page feels instant, while still allowing fresh data on demand. This is
// deliberately just a module-level variable (reset on full page reload) -
// no React Query/Redux/etc., since a single small cached object is all this
// needs.
const CACHE_TTL_MS = 30 * 1000;

let cachedData = null;
let cachedAt = 0;
// Bumped for every request and on invalidation, so a slow response that was started earlier
// can never overwrite the cache with older data than a later request already stored.
let latestRequestId = 0;

function isCacheFresh() {
  return cachedData !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

export function getCachedDashboard() {
  return isCacheFresh() ? cachedData : null;
}

export async function getMyDashboard({ forceRefresh = false } = {}) {
  if (!forceRefresh && isCacheFresh()) {
    return cachedData;
  }

  const requestId = ++latestRequestId;
  const response = await employeeApiClient.get("/employee/dashboard");
  const data = response.data.data;

  if (requestId === latestRequestId) {
    cachedData = data;
    cachedAt = Date.now();
  }
  return data;
}

export function invalidateDashboardCache() {
  latestRequestId += 1; // anything still in flight must not repopulate the cache
  cachedData = null;
  cachedAt = 0;
}