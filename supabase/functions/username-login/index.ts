import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } });
  try {
    const { username, password } = await req.json();
    const clean = String(username ?? '').trim();
    if (!/^[A-Za-z0-9._-]{4,64}$/.test(clean) || String(password ?? '').length < 1) {
      return new Response(JSON.stringify({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }), { status: 400, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } });
    }
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: lookupError } = await admin.from('profiles').select('id,email,account_status').ilike('username', clean).maybeSingle();
    if (lookupError || !profile?.id) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
    if (!['active', 'approved'].includes(String(profile.account_status))) throw new Error('الحساب لم تتم الموافقة عليه من الإدارة بعد.');
    let email = profile.email;
    if (!email) {
      const { data: authResult, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
      if (authLookupError || !authResult.user?.email) throw new Error('تعذر العثور على بريد الحساب. راجع ملف profiles.');
      email = authResult.user.email;
    }
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password: String(password) }),
    });
    const result = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة، أو البريد لم يتم تأكيده.' }), { status: 401, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'حدث خطأ أثناء تسجيل الدخول.';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } });
  }
});
