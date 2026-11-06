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
