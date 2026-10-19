package com.mathector.app.ui

import android.content.Context
import android.content.ContextWrapper
import android.app.Activity
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.webkit.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.mathector.app.data.MathContent
import com.mathector.app.data.MathPart
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.*
import kotlin.coroutines.resume

private const val ASSET_ORIGIN = "https://appassets.androidplatform.net/assets/"

fun richMathHtml(text: String, dark: Boolean = false, fontSize: Float = 14f, preview: Boolean = false): String {
    val body = MathContent.parse(text).joinToString("") { part -> when(part) {
        is MathPart.Text -> TextUtils.htmlEncode(part.value)
        is MathPart.Formula -> "<span class=\"formula ${if(part.display) "display" else ""}\" data-display=\"${part.display}\">${TextUtils.htmlEncode(part.latex)}</span>"
    } }
    return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="${ASSET_ORIGIN}katex/katex.min.css"><script src="${ASSET_ORIGIN}katex/katex.min.js"></script>
        <style>html,body{margin:0;padding:0;background:transparent;color:${if(dark) "#e8e8e8" else "#262626"};font-family:sans-serif;font-size:${fontSize}px}
        #content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;padding:3px 0;${if(preview) "max-height:98px;overflow:hidden;" else ""}}
        .formula{white-space:normal}.display{display:block;margin:8px 0;overflow-x:auto}.katex{font-size:1.05em}.katex-display{margin:0} .katex-error{color:${if(dark) "#f3a7b6" else "#a23245"}}
        </style></head><body><div id="content">$body</div><script>
        document.querySelectorAll('.formula').forEach(function(node){var source=node.textContent;try{katex.render(source,node,{displayMode:node.dataset.display==='true',throwOnError:true,trust:false,maxExpand:300,maxSize:12});}catch(e){node.textContent='[公式需校对] '+source;node.classList.add('katex-error');}});
        var last=0;function measure(){var h=Math.ceil(document.getElementById('content').getBoundingClientRect().height);if(h!==last){last=h;if(window.ContentHeight)window.ContentHeight.ready(h);}}
        document.fonts.ready.then(function(){measure();new ResizeObserver(measure).observe(document.getElementById('content'));});
        </script></body></html>
    """.trimIndent()
}

/** The parent list owns touch/scroll, so an inline preview cannot trap a card tap or vertical drag. */
private class ReadOnlyMathWebView(context: Context) : WebView(context) {
    @SuppressLint("ClickableViewAccessibility") // The Compose parent handles taps and accessibility clicks.
    override fun onTouchEvent(event: android.view.MotionEvent) = false
    override fun performClick(): Boolean = super.performClick()
}

@Composable
fun RichMathText(text: String, modifier: Modifier = Modifier, dark: Boolean = false, preview: Boolean = false, fontSize: Float = 14f) {
    val density = LocalDensity.current
    val html = remember(text, dark, preview, fontSize, density.fontScale) { richMathHtml(text, dark, fontSize * density.fontScale, preview) }
    var cssHeight by remember(html) { mutableIntStateOf(if(preview) 76 else 32) }
    AndroidView(modifier = modifier.height(cssHeight.dp).semantics { contentDescription = text }, factory = { context ->
        configureMathWebView(ReadOnlyMathWebView(context)).apply {
            isVerticalScrollBarEnabled = false; isHorizontalScrollBarEnabled = false
        }
    }, update = { view ->
        if (view.tag != html) {
            view.tag = html
            view.removeJavascriptInterface("ContentHeight")
            view.addJavascriptInterface(SnapshotBridge { height ->
                if (view.tag == html) cssHeight = height.coerceAtLeast(24)
            }, "ContentHeight")
            view.loadDataWithBaseURL(ASSET_ORIGIN, html, "text/html", "utf-8", null)
        }
    }, onRelease = { it.removeJavascriptInterface("ContentHeight"); it.destroy() })
}

fun mathHtml(latex: String, dark: Boolean = false): String = """
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${ASSET_ORIGIN}katex/katex.min.css">
<script src="${ASSET_ORIGIN}katex/katex.min.js"></script>
<style>body{margin:0;padding:18px 12px;background:transparent;color:${if(dark) "#e8e8e8" else "#262626"};font-size:21px}#math{overflow-x:auto;padding:4px 0}.katex-display{margin:0}</style></head>
<body><textarea id="source" style="display:none">${TextUtils.htmlEncode(latex)}</textarea><div id="math"></div>
<script>var valid=true;try{katex.render(document.getElementById('source').value,document.getElementById('math'),{displayMode:true,throwOnError:true,trust:false,maxExpand:300,maxSize:12});}catch(e){valid=false;document.getElementById('math').textContent='公式格式需校对：'+document.getElementById('source').value;}
document.fonts.ready.then(function(){var node=document.getElementById('math');if(window.Snapshot)window.Snapshot.ready(valid && node.scrollWidth <= node.clientWidth+2 ? Math.ceil(document.body.scrollHeight) : -1);});</script></body></html>
""".trimIndent()

// JavaScript is required by bundled KaTeX; remote loads and navigation are blocked.
@SuppressLint("SetJavaScriptEnabled")
fun createMathWebView(context: Context): WebView = configureMathWebView(WebView(context))

@SuppressLint("SetJavaScriptEnabled")
private fun configureMathWebView(view: WebView): WebView = view.apply {
    setBackgroundColor(android.graphics.Color.TRANSPARENT)
    isVerticalScrollBarEnabled = false
    isHorizontalScrollBarEnabled = false
    overScrollMode = View.OVER_SCROLL_NEVER
    settings.javaScriptEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.blockNetworkLoads = true
    val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
    webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            loader.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
    }
}

@Composable
fun MathFormula(latex: String, modifier: Modifier = Modifier, dark: Boolean = false) {
    AndroidView(modifier = modifier, factory = { createMathWebView(it) }, update = { view ->
        val key = "$dark:$latex"
        if (view.tag != key) { view.tag = key; view.loadDataWithBaseURL(ASSET_ORIGIN, mathHtml(latex, dark), "text/html", "utf-8", null) }
    }, onRelease = { it.destroy() })
}

private class SnapshotBridge(private val callback: (Int) -> Unit) {
    @JavascriptInterface fun ready(height: Int) { Handler(Looper.getMainLooper()).post { callback(height) } }
}

suspend fun formulaBitmap(context: Context, latex: String): Bitmap = withContext(Dispatchers.Main) {
    withTimeout(12_000) {
        suspendCancellableCoroutine { continuation ->
            val view = createMathWebView(context)
            var owner: Context? = context
            while (owner is ContextWrapper && owner !is Activity) owner = owner.baseContext
            val activity = owner as? Activity ?: error("公式导出需要在应用界面中进行")
            val root = activity.window.decorView as ViewGroup
            val width = 2600
            view.settings.offscreenPreRaster = true
            view.isFocusable = false
            view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            root.addView(view, 0, FrameLayout.LayoutParams(width, 300))
            var released = false
            fun release() { if (!released) { released = true; root.removeView(view); view.destroy() } }
            view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY))
            view.layout(0, 0, width, 300)
            view.addJavascriptInterface(SnapshotBridge { cssHeight ->
                if (continuation.isActive) {
                    try {
                        require(cssHeight > 0) { "公式格式有误或过宽，请校对 LaTeX 或分行后导出" }
                        val height = (cssHeight * context.resources.displayMetrics.density).toInt().coerceAtLeast(120)
                        require(height <= 3000) { "单个公式过长，请分成多个公式后导出" }
                        view.layoutParams = view.layoutParams.apply { this.height = height }
                        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                        view.layout(0, 0, width, height)
                        view.postVisualStateCallback(1, object : WebView.VisualStateCallback() {
                            override fun onComplete(requestId: Long) {
                                if (!continuation.isActive) return
                                try {
                                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                                    val canvas = android.graphics.Canvas(bitmap)
                                    canvas.drawColor(android.graphics.Color.WHITE); view.draw(canvas)
                                    val cropped = cropFormula(bitmap)
                                    cropped.density = context.resources.displayMetrics.densityDpi
                                    continuation.resume(cropped)
                                } catch (error: Exception) { continuation.cancel(error) }
                                finally { release() }
                            }
                        })
                    } catch (error: Exception) { continuation.cancel(error) }
                }
            }, "Snapshot")
            continuation.invokeOnCancellation { Handler(Looper.getMainLooper()).post { release() } }
            view.loadDataWithBaseURL(ASSET_ORIGIN, mathHtml(latex), "text/html", "utf-8", null)
        }
    }
}

private fun cropFormula(bitmap: Bitmap): Bitmap {
    var left = bitmap.width; var top = bitmap.height; var right = -1; var bottom = -1
    val row = IntArray(bitmap.width)
    for (y in 0 until bitmap.height) {
        bitmap.getPixels(row, 0, bitmap.width, 0, y, bitmap.width, 1)
        for (x in row.indices) if ((row[x] and 0x00FFFFFF) < 0x00E0E0E0) {
            left = minOf(left, x); right = maxOf(right, x); top = minOf(top, y); bottom = maxOf(bottom, y)
        }
    }
    if (right < left) { bitmap.recycle(); error("公式未完成渲染，请重试导出") }
    left = (left - 12).coerceAtLeast(0); top = (top - 12).coerceAtLeast(0)
    right = (right + 12).coerceAtMost(bitmap.width - 1); bottom = (bottom + 12).coerceAtMost(bitmap.height - 1)
    val cropped = Bitmap.createBitmap(bitmap, left, top, right - left + 1, bottom - top + 1)
    if (cropped !== bitmap) bitmap.recycle()
    return cropped
}
