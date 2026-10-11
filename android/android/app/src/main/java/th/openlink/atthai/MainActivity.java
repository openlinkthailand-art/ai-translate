package th.openlink.atthai;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * รับข้อความจากเมนู "แชร์" และเมนู "เลือกข้อความ" ของระบบ แล้วส่งเข้าหน้าแปลของเว็บแอป
 * (หน้า index.html อ่านพารามิเตอร์ ?text= อยู่แล้ว — ดู web/src/app/app.js handleIncomingShare)
 */
public class MainActivity extends BridgeActivity {
    /** กันข้อความยาวผิดปกติทำให้ URL ล้น */
    private static final int MAX_TEXT = 5000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openSharedText(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openSharedText(intent);
    }

    private void openSharedText(Intent intent) {
        String text = extractText(intent);
        if (text == null || bridge == null) return;
        WebView webView = bridge.getWebView();
        String url = bridge.getLocalUrl() + "/index.html?text=" + Uri.encode(text);
        webView.post(() -> webView.loadUrl(url));
    }

    private static String extractText(Intent intent) {
        if (intent == null) return null;
        CharSequence raw = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            raw = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            raw = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        }
        if (raw == null) return null;
        String text = raw.toString().trim();
        if (text.isEmpty()) return null;
        return text.length() > MAX_TEXT ? text.substring(0, MAX_TEXT) : text;
    }
}
