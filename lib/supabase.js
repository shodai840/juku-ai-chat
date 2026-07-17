// SupabaseのREST(PostgREST)を直接fetchで叩く薄いラッパー。SDK依存を増やさないための実装
function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません');
  }
  return { url, serviceRoleKey };
}

async function supabaseRequest(path, options = {}) {
  const { url, serviceRoleKey } = supabaseConfig();
  return fetch(`${url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

export async function findStudentByNormalizedName(normalizedName) {
  const res = await supabaseRequest(`/students?normalized_name=eq.${encodeURIComponent(normalizedName)}&select=*`);
  if (!res.ok) throw new Error(`Supabase取得エラー: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

export async function findStudentById(id) {
  const res = await supabaseRequest(`/students?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!res.ok) throw new Error(`Supabase取得エラー: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

export async function insertStudent({ name, normalizedName, passwordHash, status = 'pending' }) {
  const res = await supabaseRequest('/students', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name,
      normalized_name: normalizedName,
      password_hash: passwordHash,
      status
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase登録エラー: ${res.status} ${text}`);
  }
  const rows = await res.json();
  return rows[0];
}

export async function listStudents() {
  const res = await supabaseRequest('/students?select=*&order=created_at.desc');
  if (!res.ok) throw new Error(`Supabase取得エラー: ${res.status}`);
  return res.json();
}

export async function updateStudentsStatus(ids, status) {
  const idList = ids.map(id => encodeURIComponent(id)).join(',');
  const res = await supabaseRequest(`/students?id=in.(${idList})`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase更新エラー: ${res.status} ${text}`);
  }
}

export async function deleteStudents(ids) {
  const idList = ids.map(id => encodeURIComponent(id)).join(',');
  const res = await supabaseRequest(`/students?id=in.(${idList})`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase削除エラー: ${res.status} ${text}`);
  }
}

// 設定（現状はLINE通知のオン/オフのみ）は1行だけの固定id=1レコードで管理する
export async function getSettings() {
  const res = await supabaseRequest('/settings?id=eq.1&select=*');
  if (!res.ok) throw new Error(`Supabase取得エラー: ${res.status}`);
  const rows = await res.json();
  return rows[0] || { id: 1, line_notify_enabled: true, auto_approve_enabled: false };
}

export async function updateSettings(patch) {
  const res = await supabaseRequest('/settings?id=eq.1', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase更新エラー: ${res.status} ${text}`);
  }
}
