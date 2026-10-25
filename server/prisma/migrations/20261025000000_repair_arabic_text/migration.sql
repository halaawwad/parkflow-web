-- Notifications written before the Arabic titles were restored in the source
-- (4eb0e64) were saved as "???". Rebuild their Arabic from the English text
-- written alongside them. Only fields made entirely of "?", spaces and dots
-- change. Wallet transactions are an immutable ledger and are not touched here;
-- the API substitutes their Arabic title on read (wallet/arabicTitles.ts).

UPDATE "notifications" SET "titleAr" = CASE "title"
    WHEN 'Parking started' THEN 'بدأ الوقوف'
    WHEN 'Parking completed' THEN 'انتهى الوقوف'
    WHEN 'Parking ended with an unpaid balance' THEN 'انتهى الوقوف مع رصيد غير مدفوع'
    WHEN 'Wallet topped up' THEN 'تم شحن المحفظة'
    ELSE "title" END
WHERE "titleAr" ~ '^[?[:space:].]+$';

UPDATE "notifications" SET "bodyAr" = CASE "body"
    WHEN 'Your parking session has ended.' THEN 'انتهت جلسة الوقوف.'
    WHEN 'Your payment has been confirmed.' THEN 'تم تأكيد الدفع.'
    ELSE "body" END
WHERE "bodyAr" ~ '^[?[:space:].]+$';
