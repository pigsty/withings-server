function errorWithStatus(message, status) {
  return new Error(`${message} (${status})`);
}

async function ensureOk(response, message) {
  if (!response.ok) {
    throw errorWithStatus(message, response.status);
  }
  return response;
}

export async function fetchUsers() {
  const response = await fetch("/api/ui/users");
  await ensureOk(response, "Failed to load users");
  return response.json();
}

export async function fetchUnlinkedMeasurements() {
  const response = await fetch("/api/ui/unlinked");
  await ensureOk(response, "Failed to load unlinked measurements");
  return response.json();
}

export async function fetchUserMeasurements(userId, window, granularity, signal) {
  const params = new URLSearchParams({
    start: String(window.startUnix),
    end: String(window.endUnix),
    granularity
  });

  const response = await fetch(
    `/api/ui/users/${userId}/measurements?${params.toString()}`,
    signal ? { signal } : undefined
  );
  await ensureOk(response, "Failed to load measurements");
  return response.json();
}

export async function updateUserProfile(userId, payload) {
  const response = await fetch(`/api/ui/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  await ensureOk(response, "Failed to save profile");
}

export async function createUser(payload) {
  const response = await fetch("/api/ui/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  await ensureOk(response, "Failed to create user");
  return response.json();
}

export async function unlinkMeasurement(measurementId) {
  const response = await fetch(`/api/ui/measurements/${measurementId}/unlink`, {
    method: "POST"
  });

  await ensureOk(response, "Failed to unlink measurement");
}