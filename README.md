# BNAPP V3.5.1 (PWA + APK)

## 1) פריסה ל-GitHub Pages (כמו אצלך /ZZZZ/)
1. העלה את כל הקבצים לתיקיית הריפו (למשל `ZZZZ/`).
2. Settings → Pages → Deploy from branch.
3. ודא שהקישור עובד:
   https://<user>.github.io/<repo>/

## 2) התקנה כ-App בטלפון (PWA)
- פתח ב-Chrome → תפריט ⋮ → "הוסף למסך הבית"

## 3) APK אמיתי עם Capacitor (מומלץ כי לא דורש assetlinks כמו TWA/Bubblewrap)
דרישות:
- Node.js LTS
- Android Studio (כולל Android SDK)
- Java 17

צעדים:
```bash
# מתוך תיקייה חדשה במחשב (לא בטלפון)
mkdir bnapp-cap && cd bnapp-cap
npm init -y
npm i @capacitor/core @capacitor/cli
npx cap init BNAPP com.bnapp.app --web-dir=www

# צור תיקיית www והעתק אליה את הקבצים:
mkdir www
# העתק לתוך www: index.html, app.js, styles.css, firebase-config.js, manifest.webmanifest, sw.js, icon-*.png

npm i @capacitor/android
npx cap add android
npx cap sync android
npx cap open android
```

ב-Android Studio:
- Build → Build Bundle(s)/APK(s) → Build APK

### למה Capacitor ולא Bubblewrap?
Bubblewrap/TWA דורש `/.well-known/assetlinks.json` בשורש הדומיין.
ב-GitHub Pages מסוג `/repo/` זה לא תמיד אפשרי בלי דומיין מותאם.
Capacitor לא דורש את זה.
