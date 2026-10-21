package com.mathector.app.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.mathector.app.data.Question
import org.json.JSONArray

@Composable internal fun DesktopFigures(question: Question) {
    val images = remember(question.figuresJson) { runCatching { val a = JSONArray(question.figuresJson); List(a.length()) { a.getString(it) } }.getOrDefault(emptyList()) }
    val placements = remember(question.figurePlacementsJson) { runCatching { val a = JSONArray(question.figurePlacementsJson); List(a.length()) { a.getString(it) } }.getOrDefault(emptyList()) }
    images.forEachIndexed { index, data ->
        val bitmap = remember(data) { runCatching { val bytes = Base64.decode(data.substringAfter(','), Base64.DEFAULT)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= 16_000_000) { "插图尺寸超出预览限制" }
            val options = BitmapFactory.Options().apply { inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 1200) }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap() }.getOrNull() }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val placement = placements.getOrNull(index) ?: "stem"
            Text(if(placement == "stem") "题干插图 ${index+1}" else "选项 $placement 插图", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if(bitmap != null) Image(bitmap, "题目插图", Modifier.fillMaxWidth().heightIn(max = 220.dp)) else Text("插图无法显示，原始数据已保留，可回传电脑查看", style = MaterialTheme.typography.bodySmall)
        }
    }
}
