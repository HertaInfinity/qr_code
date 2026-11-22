import { createClient } from '@supabase/supabase-js';

// Public (anon/publishable) values: safe in the browser. Never put the service_role key here.
export const sb = createClient(
  'https://lhopljlhkrnooijhwuft.supabase.co',
  'sb_publishable_zP2DZArAHD0CnMASmijATg_rhu1k9Tp'
);

export async function api(path, opts = {}) {
  const { data } = await sb.auth.getSession();
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || '') }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
  return body;
}
export const post = (path, obj) => api(path, { method: 'POST', body: JSON.stringify(obj || {}) });

export function deviceId() {
  let id = localStorage.getItem('device_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('device_id', id); }
  return id;
}

const COLORS = ['#1967d2', '#188038', '#e37400', '#a142f4', '#d93025', '#12b5cb', '#e52592', '#5f6368'];
export const colorFor = (id = '') => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
