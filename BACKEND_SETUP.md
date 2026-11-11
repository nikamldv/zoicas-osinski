# راه‌اندازی بک‌اند و MySQL

## قابلیت‌ها

- `POST /api/contact` درخواست‌های تماس را در جدول `contact_submissions` ذخیره می‌کند.
- `POST /api/career` درخواست‌های کاریابی را در جدول `career_applications` ذخیره می‌کند.
- فورم‌ها پاسخ موفقیت یا خطا را همان‌جا در صفحه نشان می‌دهند.
- API داده‌ها را در سمت سرور اعتبارسنجی می‌کند، از queryهای پارامتری استفاده می‌کند، محدودیت سادهٔ ارسال دارد و یک فیلد ضد هرزنامه دارد.
- برای خواندن نام‌ها، ایمیل‌ها یا پیام‌های ذخیره‌شده API عمومی وجود ندارد.

## ۱. ساخت جدول‌ها

با MySQL وارد شوید و ساختار را اجرا کنید:

```powershell
Get-Content database/schema.sql | mysql -u root -p
```

برای برنامه یک کاربر جدا بسازید. این کاربر فقط اجازهٔ ثبت داده‌ها را می‌گیرد:

```sql
CREATE USER 'zoicas_app'@'127.0.0.1' IDENTIFIED BY 'یک_گذرواژه_طولانی_و_خصوصی';
GRANT INSERT ON zoicas_osinski.contact_submissions TO 'zoicas_app'@'127.0.0.1';
GRANT INSERT ON zoicas_osinski.career_applications TO 'zoicas_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

اگر MySQL روی سرور دیگری است، بخش `@'127.0.0.1'` و مقدار `MYSQL_HOST` را با تنظیم مناسب همان سرور عوض کنید.

## ۲. تنظیم اتصال خصوصی

فایل نمونه را کپی کنید و مقدارهای واقعی را فقط در فایل محلی `.env` بنویسید:

```powershell
Copy-Item .env.example .env
```

`.env` در `.gitignore` است و نباید منتشر یا در چت فرستاده شود. برای MySQL راه‌دور، `MYSQL_SSL=true` را تنظیم کنید؛ اگر شرکت میزبانی گواهی CA جداگانه داده، مسیر آن را در `MYSQL_SSL_CA` وارد کنید.

## ۳. نصب و اجرا

```powershell
npm install
npm start
```

سایت در `http://127.0.0.1:3000/` باز می‌شود. `GET /api/health` وضعیت اتصال MySQL را نشان می‌دهد.

## ۴. تنظیم داشبورد مدیریت

داشبورد خصوصی در مسیر `/admin.html` قرار دارد و پیام‌ها و درخواست‌های کاری را می‌خواند. برای ورود، یک نام مدیر و گذرواژهٔ قوی بسازید. گذرواژه در فایل تنظیمات به صورت hash ذخیره می‌شود، نه متن ساده:

```powershell
npm run admin:hash
```

گذرواژه را در ورودی مخفی وارد کنید و مقدار `ADMIN_PASSWORD_HASH=...` را در فایل `.env` بگذارید. سپس `ADMIN_USERNAME` را تنظیم کنید.

برای داشبورد یک حساب دیتابیس جدا بسازید. این حساب فقط مجوز خواندن درخواست‌ها را می‌گیرد:

```sql
CREATE USER 'zoicas_dashboard'@'127.0.0.1' IDENTIFIED BY 'یک_گذرواژه_جدا_و_طولانی';
GRANT SELECT ON zoicas_osinski.contact_submissions TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.career_applications TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
```

مقدارهای `MYSQL_ADMIN_USER` و `MYSQL_ADMIN_PASSWORD` را در `.env` وارد کنید. اگر MySQL روی میزبان دیگری است، host حساب را مطابق تنظیمات همان میزبان بسازید. حساب عمومی `zoicas_app` همچنان فقط مجوز ثبت فرم‌ها را دارد.

در IONOS مقدار `COOKIE_SECURE=true` را برای HTTPS تنظیم کنید. پس از راه‌اندازی مجدد سرور، داشبورد را از `https://your-domain/admin.html` باز کنید. نشست مدیر پس از مدت تنظیم‌شده منقضی می‌شود و با restart سرور باطل می‌شود.

GitHub Pages فقط فایل‌های ایستا را اجرا می‌کند و API سرور Node.js یا MySQL را اجرا نمی‌کند. به همین دلیل فایل داشبورد از خروجی GitHub Pages کنار گذاشته شده است؛ صفحهٔ مدیریت باید روی میزبانی‌ای باز شود که `server.js` و MySQL را اجرا می‌کند.

## ۵. درخواست آنلاینِ پیشنهاد قیمت (Phase 3)

ابتدا migration افزایشی را با حساب مدیریتی MySQL اجرا کنید. این migration هیچ جدول یا دادهٔ قبلی را حذف نمی‌کند:

```powershell
Get-Content database/migrations/001_quote_requests.sql | mysql -u root -p
```

سپس مجوزها را با حساب مدیریتی اجرا کنید (دستورها در انتهای migration نیز آمده‌اند):

```sql
GRANT INSERT ON zoicas_osinski.quote_requests TO 'zoicas_app'@'127.0.0.1';
GRANT INSERT ON zoicas_osinski.quote_request_files TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, UPDATE ON zoicas_osinski.quote_requests TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.quote_request_files TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
```

فرم عمومی در `/public/angebot.html` داده‌ها را با `POST /api/quotes` ارسال می‌کند. فایل‌ها فقط JPG، PNG یا PDF هستند، حداکثر ۵ فایل و هر فایل حداکثر ۵ MB. آن‌ها خارج از مسیر عمومی سایت در `storage/quote-uploads` ذخیره می‌شوند، نام تصادفی دارند و فقط مدیر واردشده از طریق API خصوصی می‌تواند آن‌ها را دریافت کند.

APIهای مدیر:

- `GET /api/admin/quotes`
- `GET /api/admin/quotes/:id`
- `PATCH /api/admin/quotes/:id`
- `GET /api/admin/quotes/:id/files/:fileId`

## ۶. رزرو آنلاین (Phase 4)

پیش از اجرا backup جدید در `database/schema-backups/pre-appointments-migration.sql` ساخته شده است. سپس migration افزایشی زیر را با حساب مدیر MySQL اجرا کنید:

```powershell
Get-Content database/migrations/002_appointments.sql | mysql -u root -p
```

برای ساعت‌های رزرو، ساعت فرضی منتشر نکنید. فقط پس از تأیید ساعت‌های کاری شرکت، در `.env` وارد کنید:

```env
BOOKING_SLOT_TIMES=09:00,10:00,11:00
BOOKING_SLOT_DURATION_MINUTES=60
```

وقتی این مقادیر خالی باشند، صفحهٔ رزرو به‌درستی هیچ زمان آزادی نمایش نمی‌دهد. APIهای آن `/api/appointments/availability`، `/api/appointments` و endpointهای خصوصی `/api/admin/appointments` هستند.

متغیرهای SMTP در `.env.example` فقط برای آماده‌سازی آینده هستند. تا زمانی که یک سرویس ایمیل جداگانه پیکربندی نشود، هیچ ایمیلی ارسال نمی‌شود.

## دیدن درخواست‌های ذخیره‌شده

با حساب مدیریتی MySQL این پرس‌وجوها را اجرا کنید:

```sql
SELECT id, full_name, email, requested_service, status, created_at
FROM zoicas_osinski.contact_submissions
ORDER BY created_at DESC;

SELECT id, full_name, email, phone, area, status, created_at
FROM zoicas_osinski.career_applications
ORDER BY created_at DESC;
```

دسترسی داخلی به فورم کاریابی را محدود نگه دارید و برای حذف داده‌های شخصی، مدت نگهداری مشخص کنید.
