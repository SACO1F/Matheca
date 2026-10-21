package com.mathector.app.ui

import androidx.activity.compose.BackHandler
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable internal fun DesktopQrScanner(onClose: () -> Unit, onResult: (String) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val view = remember { PreviewView(context) }
    val future = remember { ProcessCameraProvider.getInstance(context) }
    BackHandler(onBack = onClose)
    DisposableEffect(lifecycle) {
        val executor = Executors.newSingleThreadExecutor()
        val found = AtomicBoolean(false)
        var disposed = false
        future.addListener({ if(!disposed) try {
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(executor) { image ->
                try {
                    if(!found.get()) {
                        val plane = image.planes[0]; val buffer = plane.buffer
                        val bytes = ByteArray(buffer.remaining()); buffer.get(bytes)
                        val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
                        val result = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(source)), mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true))
                        com.mathector.app.data.DesktopConnection.parse(result.text)
                        if(found.compareAndSet(false, true)) ContextCompat.getMainExecutor(context).execute { if(!disposed) onResult(result.text) }
                    }
                } catch(_: Exception) { /* Keep scanning until a valid LAN pairing QR is in frame. */ } finally { image.close() }
            }
            provider.unbindAll(); provider.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        } catch(_: Exception) { onError("相机不可用，请粘贴电脑连接地址"); onClose() } }, ContextCompat.getMainExecutor(context))
        onDispose { disposed = true; executor.shutdown(); if(future.isDone) runCatching { future.get().unbindAll() } }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(16.dp)) { Text("扫描电脑“手机联动”二维码", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); TextButton(onClose) { Text("取消") } }
        AndroidView(factory = { view }, modifier = Modifier.weight(1f).fillMaxWidth())
        Text("手机与电脑需在同一局域网。扫码后还需在电脑核对并允许连接。", Modifier.padding(20.dp), style = MaterialTheme.typography.bodyMedium)
    }
}
