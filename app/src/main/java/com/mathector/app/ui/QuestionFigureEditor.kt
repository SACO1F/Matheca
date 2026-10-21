package com.mathector.app.ui

import android.graphics.Bitmap
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.mathector.app.data.QuestionFigures
import java.io.File

/** 题库卡片与题集里只读的图片缩略图行。 */
@Composable internal fun QuestionFigureThumbnails(names: List<String>, modifier: Modifier = Modifier, height: Dp = 120.dp) {
    val context = LocalContext.current
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        names.forEach { name ->
            AsyncImage(model = QuestionFigures.file(context, name), contentDescription = "题目图片", contentScale = ContentScale.Fit,
                modifier = Modifier.height(height).widthIn(max = 200.dp).clip(RoundedCornerShape(12.dp)).testTag("figure-thumb-$name"))
        }
    }
}

/** 编辑页的图片行：每张缩略图带移除按钮。 */
@Composable internal fun QuestionFigureStrip(names: List<String>, onRemove: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        names.forEach { name ->
            Box {
                AsyncImage(model = QuestionFigures.file(context, name), contentDescription = "题目图片", contentScale = ContentScale.Fit,
                    modifier = Modifier.height(104.dp).widthIn(max = 180.dp).clip(RoundedCornerShape(12.dp)).testTag("figure-strip-$name"))
                Surface(onClick = { onRemove(name) }, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(26.dp).testTag("figure-remove-$name"),
                    shape = CircleShape, color = MaterialTheme.colorScheme.surface.copy(alpha = .92f), contentColor = MaterialTheme.colorScheme.error) {
                    Icon(Icons.Rounded.Close, "移除图片", Modifier.padding(4.dp))
                }
            }
        }
    }
}

/** 选择题单个选项的配图行：选项标签 + 选项文字 + 缩略图 + 添加/移除按钮。 */
@Composable internal fun OptionFigureRow(label: String, hint: String, names: List<String>, enabled: Boolean, adding: Boolean,
    onRemove: (String) -> Unit, onAdd: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().testTag("option-figure-$label"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(28.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
                Text(label, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }
            Text(hint.ifBlank { "选项 $label" }, Modifier.weight(1f), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            OutlinedButton(onClick = onAdd, enabled = enabled && !adding, modifier = Modifier.heightIn(min = 40.dp).testTag("option-figure-add-$label"),
                shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)) {
                if(adding) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                else Icon(Icons.Rounded.AddPhotoAlternate, null, Modifier.size(16.dp))
                Spacer(Modifier.width(5.dp)); Text("图片", fontSize = 12.sp)
            }
        }
        if(names.isNotEmpty()) QuestionFigureStrip(names, onRemove, Modifier.testTag("option-figure-strip-$label"))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun AddFigureSheet(canCrop: Boolean, onCrop: () -> Unit, onCamera: () -> Unit, onDismiss: () -> Unit, title: String = "添加题目图片") {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("几何图形、函数图像或手写过程都可以拍下来放进题目", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            Spacer(Modifier.height(4.dp))
            FigureSheetAction(Icons.Rounded.Crop, "在原图上截图", if(canCrop) "框选原题中的图形区域" else "本题没有可用的原图",
                enabled = canCrop, tag = "figure-add-crop") { onCrop() }
            FigureSheetAction(Icons.Rounded.CameraAlt, "手机拍照", "直接拍摄图形或手写过程", tag = "figure-add-camera") { onCamera() }
        }
    }
}

@Composable private fun FigureSheetAction(icon: ImageVector, title: String, subtitle: String, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).then(
        if(enabled) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 14.dp, horizontal = 10.dp).testTag(tag).alpha(if(enabled) 1f else .45f),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(15.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
        }
        Column(Modifier.weight(1f).padding(start = 14.dp)) { Text(title, fontWeight = FontWeight.SemiBold); Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp) }
        if(enabled) Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable internal fun FigureCropScreen(source: File, onCancel: () -> Unit, onConfirm: (RectF) -> Unit) {
    val dark = MaterialTheme.colorScheme.background.luminance() < .5f
    val preview by produceState<Bitmap?>(null, source) { value = runCatching { QuestionFigures.load(source) }.getOrNull() }
    val current by rememberUpdatedState(preview)
    DisposableEffect(source) { onDispose { current?.recycle() } }
    var rect by remember(source) { mutableStateOf(RectF(.06f, .06f, .94f, .94f)) }
    androidx.activity.compose.BackHandler(onBack = onCancel)
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).testTag("figure-crop-screen")) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 8.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onCancel, modifier = Modifier.testTag("figure-crop-back")) { Icon(Icons.Rounded.Close, "取消截图") }
            Text("框选需要的图形区域", Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        Box(Modifier.weight(1f).fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            val bitmap = preview
            if(bitmap == null) CircularProgressIndicator(Modifier.testTag("figure-crop-loading"))
            else {
                val ratio = bitmap.width.toFloat() / bitmap.height
                Box(Modifier.aspectRatio(ratio, matchHeightConstraintsFirst = ratio < 1f), contentAlignment = Alignment.Center) {
                    Image(bitmap.asImageBitmap(), contentDescription = "待框选的原图", contentScale = ContentScale.FillBounds, modifier = Modifier.fillMaxSize())
                    CropOverlay(rect, { rect = it }, Modifier.fillMaxSize().testTag("figure-crop-canvas"))
                }
            }
        }
        Text("拖动方框内部可移动，拖动四角可缩放", Modifier.fillMaxWidth().padding(horizontal = 22.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        Row(Modifier.fillMaxWidth().padding(22.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onCancel, modifier = Modifier.weight(1f).height(48.dp).testTag("figure-crop-cancel"),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface.copy(alpha = .06f), contentColor = MaterialTheme.colorScheme.onSurface)) { Text("取消") }
            Button(onClick = { onConfirm(rect) }, enabled = preview != null, modifier = Modifier.weight(1f).height(48.dp).testTag("figure-crop-confirm")) { Text("截取", fontWeight = FontWeight.SemiBold) }
        }
    }
}

private enum class CropMode { None, Move, TopLeft, TopRight, BottomLeft, BottomRight }

@Composable private fun CropOverlay(rect: RectF, onChange: (RectF) -> Unit, modifier: Modifier) {
    var mode by remember { mutableStateOf(CropMode.None) }
    val latest by rememberUpdatedState(rect)
    Canvas(modifier.pointerInput(Unit) {
        val touch = 44.dp.toPx()
        detectDragGestures(
            onDragStart = { position ->
                val r = latest.toPxRect(size)
                mode = when {
                    (position - Offset(r.left, r.top)).getDistance() < touch -> CropMode.TopLeft
                    (position - Offset(r.right, r.top)).getDistance() < touch -> CropMode.TopRight
                    (position - Offset(r.left, r.bottom)).getDistance() < touch -> CropMode.BottomLeft
                    (position - Offset(r.right, r.bottom)).getDistance() < touch -> CropMode.BottomRight
                    r.contains(position) -> CropMode.Move
                    else -> CropMode.None
                }
            },
            onDragEnd = { mode = CropMode.None },
            onDragCancel = { mode = CropMode.None },
        ) { change, drag ->
            change.consume()
            if(mode != CropMode.None) onChange(applyDrag(latest, mode, drag, size))
        }
    }) {
        val r = latest.toPxRect(size)
        val shade = Color.Black.copy(alpha = .38f)
        drawRect(shade, topLeft = Offset.Zero, size = Size(size.width, r.top))
        drawRect(shade, topLeft = Offset(0f, r.bottom), size = Size(size.width, size.height - r.bottom))
        drawRect(shade, topLeft = Offset(0f, r.top), size = Size(r.left, r.height))
        drawRect(shade, topLeft = Offset(r.right, r.top), size = Size(size.width - r.right, r.height))
        drawRect(Color.White, topLeft = Offset(r.left, r.top), size = Size(r.width, r.height), style = Stroke(2.dp.toPx()))
        listOf(Offset(r.left, r.top), Offset(r.right, r.top), Offset(r.left, r.bottom), Offset(r.right, r.bottom)).forEach { corner ->
            drawCircle(Color.White, radius = 8.dp.toPx(), center = corner)
            drawCircle(Color(0xFF3B82F6), radius = 5.dp.toPx(), center = corner)
        }
    }
}

private fun RectF.toPxRect(size: IntSize) = androidx.compose.ui.geometry.Rect(left * size.width, top * size.height, right * size.width, bottom * size.height)
private fun RectF.toPxRect(size: Size) = androidx.compose.ui.geometry.Rect(left * size.width, top * size.height, right * size.width, bottom * size.height)

private fun applyDrag(rect: RectF, mode: CropMode, drag: Offset, size: IntSize): RectF {
    if(size.width <= 0 || size.height <= 0) return rect
    val dx = drag.x / size.width; val dy = drag.y / size.height
    val min = .08f
    val left = rect.left; val top = rect.top; val right = rect.right; val bottom = rect.bottom
    return when (mode) {
        CropMode.Move -> {
            val width = right - left; val height = bottom - top
            val movedLeft = (left + dx).coerceIn(0f, 1f - width); val movedTop = (top + dy).coerceIn(0f, 1f - height)
            RectF(movedLeft, movedTop, movedLeft + width, movedTop + height)
        }
        CropMode.TopLeft -> RectF((left + dx).coerceIn(0f, right - min), (top + dy).coerceIn(0f, bottom - min), right, bottom)
        CropMode.TopRight -> RectF(left, (top + dy).coerceIn(0f, bottom - min), (right + dx).coerceIn(left + min, 1f), bottom)
        CropMode.BottomLeft -> RectF((left + dx).coerceIn(0f, right - min), top, right, (bottom + dy).coerceIn(top + min, 1f))
        CropMode.BottomRight -> RectF(left, top, (right + dx).coerceIn(left + min, 1f), (bottom + dy).coerceIn(top + min, 1f))
        CropMode.None -> rect
    }
}
