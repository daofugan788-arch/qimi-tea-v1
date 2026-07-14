package com.nicron.webview;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;

public final class MainActivity extends Activity {
  private static final String ASSET_HOST = "appassets.androidplatform.net";
  private static final String START_URL = "https://appassets.androidplatform.net/assets/index.html#home";
  private static final int AUDIO_PERMISSION_REQUEST = 2001;

  private WebView webView;
  private PermissionRequest pendingAudioRequest;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    requestWindowFeature(Window.FEATURE_NO_TITLE);

    webView = new WebView(this);
    configureWebView(webView);
    setContentView(webView);
    webView.loadUrl(START_URL);
  }

  private void configureWebView(WebView target) {
    WebSettings settings = target.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(true);
    settings.setSupportMultipleWindows(true);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    }

    target.setWebViewClient(new LocalAssetClient());
    target.setWebChromeClient(new AppChromeClient());
  }

  private final class LocalAssetClient extends WebViewClient {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      return localAssetResponse(request.getUrl());
    }

    @SuppressWarnings("deprecation")
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
      return localAssetResponse(Uri.parse(url));
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      return openExternalIfNeeded(request.getUrl());
    }

    @SuppressWarnings("deprecation")
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
      return openExternalIfNeeded(Uri.parse(url));
    }
  }

  private final class AppChromeClient extends WebChromeClient {
    @Override
    public void onPermissionRequest(final PermissionRequest request) {
      runOnUiThread(() -> handlePermissionRequest(request));
    }

    @Override
    public void onPermissionRequestCanceled(PermissionRequest request) {
      if (pendingAudioRequest == request) pendingAudioRequest = null;
    }

    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
      WebView popup = new WebView(MainActivity.this);
      popup.setWebViewClient(new WebViewClient() {
        @Override
        public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
          openExternal(request.getUrl());
          child.destroy();
          return true;
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView child, String url) {
          openExternal(Uri.parse(url));
          child.destroy();
          return true;
        }
      });
      WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
      transport.setWebView(popup);
      resultMsg.sendToTarget();
      return true;
    }
  }

  private WebResourceResponse localAssetResponse(Uri uri) {
    if (uri == null || !ASSET_HOST.equalsIgnoreCase(uri.getHost())) return null;
    String path = uri.getPath();
    if (path == null || !path.startsWith("/assets/")) return null;
    String assetPath = path.substring("/assets/".length());
    if (assetPath.isEmpty()) assetPath = "index.html";
    if (assetPath.contains("..")) return null;

    try {
      InputStream stream = getAssets().open(assetPath);
      String mime = mimeType(assetPath);
      String encoding = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript")
          ? "UTF-8"
          : null;
      return new WebResourceResponse(mime, encoding, stream);
    } catch (IOException ignored) {
      return null;
    }
  }

  private String mimeType(String path) {
    String lower = path.toLowerCase();
    if (lower.endsWith(".html")) return "text/html";
    if (lower.endsWith(".css")) return "text/css";
    if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".webmanifest")) return "application/manifest+json";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".png")) return "image/png";
    return "application/octet-stream";
  }

  private void handlePermissionRequest(PermissionRequest request) {
    boolean asksForAudio = false;
    for (String resource : request.getResources()) {
      if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
        asksForAudio = true;
        break;
      }
    }
    if (!asksForAudio) {
      request.deny();
      return;
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
        || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
      return;
    }

    if (pendingAudioRequest != null) pendingAudioRequest.deny();
    pendingAudioRequest = request;
    requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, AUDIO_PERMISSION_REQUEST);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != AUDIO_PERMISSION_REQUEST || pendingAudioRequest == null) return;
    PermissionRequest request = pendingAudioRequest;
    pendingAudioRequest = null;
    if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
      request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
    } else {
      request.deny();
    }
  }

  private boolean openExternalIfNeeded(Uri uri) {
    if (uri != null && ASSET_HOST.equalsIgnoreCase(uri.getHost())) return false;
    return openExternal(uri);
  }

  private boolean openExternal(Uri uri) {
    if (uri == null) return false;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, uri));
      return true;
    } catch (RuntimeException ignored) {
      return false;
    }
  }

  @Override
  public void onBackPressed() {
    if (webView != null && webView.canGoBack()) {
      webView.goBack();
    } else {
      super.onBackPressed();
    }
  }

  @Override
  protected void onDestroy() {
    if (pendingAudioRequest != null) {
      pendingAudioRequest.deny();
      pendingAudioRequest = null;
    }
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
