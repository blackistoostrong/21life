/** Fail before provisioning anything when the selected staging gateway is unavailable. */
export async function assertStagingBackendReachable(baseUrl, serviceRoleKey, fetchImpl = fetch) {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  for (const [name, path] of [['Auth', '/auth/v1/health'], ['REST', '/rest/v1/groups?select=id&limit=0']]) {
    let status;
    try {
      const response = await fetchImpl(base + path, { headers, signal: AbortSignal.timeout(10_000) });
      status = response.status;
      const body = await response.json();
      const valid = name === 'Auth'
        ? body !== null && typeof body === 'object' && !Array.isArray(body)
        : Array.isArray(body);
      if (status !== 200 || !valid) throw new Error('Invalid backend response');
    } catch {
      throw new Error(`Staging ${name} preflight failed (${status === undefined ? 'unreachable' : `HTTP ${status}`}) before fixture provisioning.`);
    }
  }
}
