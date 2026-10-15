import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Self-contained CORS: no ../_shared/cors.ts import is required when using the Dashboard Editor.
const allowedOrigins = new Set([
  'https://iwanhospital1.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://iwanhospital1.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Method not allowed' });

  try {
    let input: Record<string, unknown>;
    try { input = await req.json(); } catch { return json(req, 400, { error: 'بيانات الطلب غير صالحة.' }); }

    const username = String(input.username ?? '').trim();
    const password = String(input.password ?? '');
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || password.length < 1 || password.length > 256) {
      return json(req, 400, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    if (!url || !serviceKey || !publicKey) {
      console.error('Missing required Supabase function secrets');
      return json(req, 500, { error: 'إعدادات وظيفة تسجيل الدخول غير مكتملة في Supabase.' });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: lookupError } = await admin
      .from('profiles')
      .select('id,email,account_status,username')
      .ilike('username', username)
      .maybeSingle();

    // Use the same generic message for missing user and wrong password.
    if (lookupError || !profile?.id) return json(req, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    if (!['active', 'approved'].includes(String(profile.account_status))) {
      return json(req, 403, { error: 'الحساب لم تتم الموافقة عليه من الإدارة بعد.' });
    }

    let email = profile.email as string | null;
    if (!email) {
      const { data: authResult, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
      if (authLookupError || !authResult.user?.email) return json(req, 500, { error: 'تعذر العثور على بريد الحساب المرتبط به.' });
      email = authResult.user.email;
    }

    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publicKey },
      body: JSON.stringify({ email, password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json(req, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة، أو البريد الإلكتروني لم يتم تأكيده.' });
    return json(req, 200, result as Record<string, unknown>);
  } catch (error) {
    console.error('username-login error:', error);
    return json(req, 500, { error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول.' });
  }
});
