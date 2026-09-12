export const apiRoot = import.meta.env.VITE_API_URL ?? '/api';

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
  });
  const text = response.status === 204 ? '' : await response.text();
  let data: { error?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string };
    } catch {
      data = { error: 'The server returned an unreadable response.' };
    }
  }
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
  return data as T;
}

export const jsonBody = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
