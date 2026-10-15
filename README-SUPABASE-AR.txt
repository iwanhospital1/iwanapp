مستشفى إيوان — نسخة ربط GitHub Pages + Supabase (اختبار)
======================================================

ما تم تعديله
- الحفاظ على واجهة RTL الحالية والأقسام الموجودة.
- إعداد docs/supabase-config.js برابط المشروع ومفتاح publishable فقط.
- تحويل تسجيل الدخول ليستخدم Edge Function اسمها username-login، بحيث يدخل المستخدم باسم المستخدم وكلمة المرور دون كشف البريد الإلكتروني للمتصفح.
- تسجيل الحسابات عبر Supabase Auth مع بيانات username/role في metadata؛ إنشاء profiles يتم عبر trigger آمن في SQL.
- إضافة migration لتوسعة الجداول وتهيئة جداول جدول الطبيب والصيدلية والجلسات المرئية وسياسات RLS مبدئية.
- إضافة تعاملات أولية للأطباء والمواعيد والموافقات والصلاحيات والجدول الأسبوعي.

قبل الاستخدام
1) المفتاح sb_secret الذي تمت مشاركته في المحادثة يجب إلغاؤه/تدويره من Supabase فورًا. لا تضعه في أي ملف ولا ترسله مرة أخرى.
2) افتح Supabase SQL Editor في مشروع hgsyoenczihiketfsjsj، راجع الملف supabase/migrations/20261015_iwanapp_pages.sql ثم نفّذه على قاعدة اختبار.
3) تثبيت Supabase CLI محليًا ثم تسجيل الدخول وربط المشروع:
   supabase login
   supabase link --project-ref hgsyoenczihiketfsjsj
4) انشر وظيفة تسجيل الدخول:
   supabase functions deploy username-login
   الوظيفة تستخدم متغيرات البيئة الافتراضية في Supabase: SUPABASE_URL وSUPABASE_ANON_KEY وSUPABASE_SERVICE_ROLE_KEY. لا تنشئ نسخة منها داخل ملفات الواجهة.
5) راجع Authentication > URL Configuration:
   Site URL: https://iwanhospital1.github.io/iwanapp/
   Redirect URLs: https://iwanhospital1.github.io/iwanapp/** و http://localhost:3000/**
6) تأكد أن مستخدم الأدمن الحالي له صف في public.profiles مع username فريد، role='admin' و account_status='active'. وظيفة تسجيل الدخول تبحث بالـusername في profiles.
7) ارفع محتويات مجلد docs إلى مجلد docs في GitHub repo iwanapp، ثم انتظر اكتمال GitHub Pages وامسح Cache المتصفح إذا ظهرت نسخة قديمة.

ملفات النشر
- ارفع الملفات داخل docs كما هي: index.html, app.js, style.css, supabase-config.js, ewan-logo.png, app-icon.svg, manifest.webmanifest, sw.js.
- لا ترفع server.js أو data/db.json على GitHub Pages؛ Pages لا يشغّل Node.js.
- ملفات SQL ووظيفة Edge Function موجودة في supabase/ ويجب تطبيقها/نشرها من جهازك باستخدام Supabase CLI أو لوحة Supabase.

الوظائف وحدود النسخة الحالية
- تسجيل الدخول باسم المستخدم: يحتاج نشر username-login وتطبيق SQL أولًا.
- إنشاء حساب: يتطلب بريدًا إلكترونيًا صالحًا وتأكيد البريد إذا كان مفعّلًا، ثم موافقة الأدمن.
- ربط مبدئي: قراءة الأطباء والمواعيد، إنشاء الحجز، الموافقة على الحسابات، حفظ صلاحيات الواجهة، مخزون الصيدلية، جدول الطبيب، سجل طبي، وجلسة Jitsi تجريبية.
- غير مكتمل/مقصود تعطيله: تغيير كلمات مرور مستخدمين آخرين، النسخ الاحتياطي والاستعادة من المتصفح، رفع الملفات الطبية، الدفع الحقيقي، وبعض مسارات سير العمل التي تحتاج Backend/Edge Functions وسياسات إضافية. لا تستخدم بيانات مرضى حقيقية.
- روابط Jitsi تجريبية عامة وليست مناسبة لجلسات طبية سرية.
- SQL وسياسات RLS يجب مراجعتها مقابل سياسات المشروع الموجودة؛ سياسات PostgreSQL المتعددة تتجمع بمنطق OR، لذلك راجع أي سياسات قديمة قبل الاستخدام.

اختبارات محلية منفذة
- node --check على docs/app.js وpublic/app.js.
- فحص وجود ملفات النشر وملف الإعداد وSQL ووظيفة Edge Function.
- لم يتم إجراء اختبار اتصال حي بمشروع Supabase أو نشر فعلي على GitHub Pages من هذه البيئة؛ لا تعتبر النسخة جاهزة للإنتاج قبل إجراء اختبار تسجيل الدخول والحجز والصلاحيات على بيانات وهمية.
