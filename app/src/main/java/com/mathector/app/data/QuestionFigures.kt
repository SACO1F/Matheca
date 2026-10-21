package com.mathector.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import kotlin.math.roundToInt

/** 题目图片按内容寻址保存：文件名即 JPEG 内容的 SHA-256，重复的图片天然去重，备份也无需改写路径。 */
object QuestionFigures {
    const val MAX_FIGURES = 6
    private const val MAX_EDGE = 2000
    private const val QUALITY = 85
    private const val DIRECTORY = "question-images"
    private val namePattern = Regex("^[0-9a-f]{64}\\.(?:jpg|jpeg|png|webp)$")
    private val quoted = Regex("\"([^\"]*)\"")

    fun validName(name: String): Boolean = namePattern.matches(name)

    /** 解析 `["<hash>.jpg", …]`；空串或不合法条目一律丢弃，保证 JVM 单测无需 Android 依赖。 */
    fun decode(json: String): List<String> =
        if(json.isBlank()) emptyList()
        else quoted.findAll(json).map { it.groupValues[1] }.filter(::validName).distinct().take(MAX_FIGURES).toList()

    fun encode(names: List<String>): String {
        val valid = names.filter(::validName).distinct().take(MAX_FIGURES)
        return if(valid.isEmpty()) "" else valid.joinToString(",", "[", "]") { "\"$it\"" }
    }

    fun root(context: Context): File = File(context.filesDir, DIRECTORY)
    fun file(context: Context, name: String): File = File(root(context), name)
    fun delete(context: Context, names: List<String>) { names.forEach { file(context, it).delete() } }
    fun missing(context: Context, names: List<String>): List<String> = names.filter { !file(context, it).isFile }
    fun exists(context: Context, names: List<String>): List<File> = names.map { file(context, it) }.filter(File::isFile)

    /** 长边压到 ≤2000px、JPEG 85，按内容哈希落盘，返回可直接写入 `Question.figures` 的文件名。 */
    fun save(context: Context, bitmap: Bitmap): String {
        val scaled = scale(bitmap)
        val bytes = ByteArrayOutputStream().use { out -> scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, out); out.toByteArray() }
        if(scaled !== bitmap) scaled.recycle()
        val name = sha256(bytes) + ".jpg"
        val target = file(context, name)
        if(!target.isFile) { target.parentFile?.mkdirs(); target.writeBytes(bytes) }
        return name
    }

    /** 从相册／相机 Uri 解码一份 ≤2000px 且已按 Exif 校正方向的位图。 */
    fun read(context: Context, uri: Uri): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "无法读取所选图片" }
        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight) }
        val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: error("无法读取所选图片")
        val degrees = runCatching { context.contentResolver.openInputStream(uri)?.use { ExifInterface(it).rotationDegrees } }.getOrNull() ?: 0
        if(degrees == 0) return bitmap
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
        if(rotated !== bitmap) bitmap.recycle()
        return rotated
    }

    /** 只解码原图上被框选的区域（原图可能 4000px 以上），[rect] 使用 0..1 的归一化坐标。 */
    suspend fun crop(source: File, rect: RectF): Bitmap = withContext(Dispatchers.IO) {
        val decoder = BitmapRegionDecoder.newInstance(source.absolutePath, false) ?: error("无法读取原图")
        try {
            val width = decoder.width.toFloat(); val height = decoder.height.toFloat()
            val region = Rect(
                (rect.left * width).roundToInt().coerceIn(0, decoder.width), (rect.top * height).roundToInt().coerceIn(0, decoder.height),
                (rect.right * width).roundToInt().coerceIn(0, decoder.width), (rect.bottom * height).roundToInt().coerceIn(0, decoder.height))
            require(region.width() >= 8 && region.height() >= 8) { "选区太小，请重新框选" }
            val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(region.width(), region.height()) }
            decoder.decodeRegion(region, options) ?: error("无法裁剪所选区域")
        } finally { decoder.recycle() }
    }

    /** 原图的等比缩略图，不应用 Exif 旋转，保证截图界面与 [crop] 使用同一套坐标。 */
    suspend fun load(source: File, maxEdge: Int = 1400): Bitmap = withContext(Dispatchers.IO) {
        val decoder = BitmapRegionDecoder.newInstance(source.absolutePath, false) ?: error("无法读取原图")
        try {
            val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(decoder.width, decoder.height, maxEdge) }
            decoder.decodeRegion(Rect(0, 0, decoder.width, decoder.height), options) ?: error("无法读取原图")
        } finally { decoder.recycle() }
    }

    private fun scale(bitmap: Bitmap): Bitmap {
        val long = maxOf(bitmap.width, bitmap.height)
        if(long <= MAX_EDGE) return bitmap
        val ratio = MAX_EDGE.toFloat() / long
        return Bitmap.createScaledBitmap(bitmap, (bitmap.width * ratio).roundToInt().coerceAtLeast(1), (bitmap.height * ratio).roundToInt().coerceAtLeast(1), true)
    }

    private fun sampleSize(width: Int, height: Int, target: Int = MAX_EDGE): Int {
        var sample = 1
        while(maxOf(width, height) / (sample * 2) >= target) sample *= 2
        return sample
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

/** 选择题每个选项的配图，键为选项标签 A/B/C/D，值复用同一套内容寻址文件名。 */
object OptionFigures {
    const val MAX_PER_OPTION = 3
    const val COUNT = 4
    val LABELS = listOf("A", "B", "C", "D")
    private val entry = Regex("\"([A-D])\"\\s*:\\s*\\[([^\\]]*)\\]")
    private val quoted = Regex("\"([^\"]*)\"")

    /** 解析 `{"A":["<hash>.jpg"],"B":[…]}`；不合法或空条目一律丢弃，可在 JVM 单测中直接运行。 */
    fun decode(json: String): Map<String, List<String>> {
        if(json.isBlank()) return emptyMap()
        val result = linkedMapOf<String, List<String>>()
        entry.findAll(json).forEach { match ->
            val label = match.groupValues[1]
            val names = quoted.findAll(match.groupValues[2]).map { it.groupValues[1] }.filter(QuestionFigures::validName).distinct().take(MAX_PER_OPTION).toList()
            if(names.isNotEmpty()) result[label] = names
        }
        return result
    }

    fun encode(map: Map<String, List<String>>): String {
        val entries = map.entries.mapNotNull { (label, names) ->
            val key = label.uppercase().takeIf { it in LABELS } ?: return@mapNotNull null
            val valid = names.filter(QuestionFigures::validName).distinct().take(MAX_PER_OPTION)
            if(valid.isEmpty()) null else key to valid
        }.sortedBy { it.first }
        if(entries.isEmpty()) return ""
        return entries.joinToString(",", "{", "}") { (label, names) -> "\"$label\":[" + names.joinToString(",") { "\"$it\"" } + "]" }
    }

    /** 所有选项图片名，用于删除题目或替换图片时清理孤儿文件。 */
    fun names(json: String): List<String> = decode(json).values.flatten().distinct()
}
