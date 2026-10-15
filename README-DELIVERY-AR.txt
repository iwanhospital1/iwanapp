مستشفى إيوان — حزمة موحدة لمراجعة الربط مع Supabase
====================================================

المجلدات الأساسية:
- docs/: واجهة GitHub Pages.
- supabase/functions/username-login/index.ts: وظيفة تسجيل الدخول باسم المستخدم، مكتوبة بشكل مستقل ولا تستورد cors.ts خارجيًا.
- supabase/config.toml: إعداد verify_jwt=false لوظيفة username-login؛ لأنها تستقبل المفتاح العام من واجهة الموقع ثم تتحقق من بيانات الدخول داخليًا.
- supabase/migrations/20261015_iwanapp_pages.sql: مخطط/تحديثات قاعدة البيانات المقدمة مع المشروع.
- tests/: اختبارات smoke المحلية.

ما تم فحصه في هذه البيئة:
- node --check docs/app.js: ناجح.
- node --check public/app.js: ناجح.
- node tests/smoke-test.js: ناجح.
- تأكدنا أن وظيفة username-login لا تستورد ../_shared/cors.ts، لتجنب خطأ الاستيراد الذي ظهر في محرر Supabase.
- لم يتم إجراء اتصال حي إلى مشروع Supabase، ولم يتم نشر Edge Function أو تطبيق migration على المشروع البعيد من هذه البيئة. لذلك لا تعتبر الحزمة مثبتة الاتصال فعليًا حتى يتم نشر ملفات Supabase والتحقق من تسجيل الدخول على المشروع.

ملاحظات:
- docs/supabase-config.js يحتوي URL ومفتاح publishable فقط، ولا يحتوي مفتاح secret/service_role.
- GitHub Pages يستضيف ملفات docs فقط؛ لا يشغّل server.js.
- لا ترفع server.js كأنه backend على GitHub Pages. عمليات الواجهة التي لا يغطيها Supabase مباشرة قد تحتاج Edge Functions/Backend إضافي.
- ملف SQL يحتاج مراجعة مقابل سياسات قاعدة البيانات الموجودة قبل تشغيله على قاعدة حقيقية؛ تجنب تشغيل migrations عشوائيًا على بيانات مهمة.
- لا تستخدم بيانات مرضى حقيقية قبل مراجعة RLS واختبار كل الأدوار.
