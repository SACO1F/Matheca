package com.mathector.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Bridges the user's editable native pictures/layouts and the desktop interchange contract. */
internal object NativeDesktopAdapter {
    fun question(context: Context, q: Question, forceNative: Boolean = false): Question {
        val native = QuestionFigures.decode(q.figures).map { it to "stem" } +
            OptionFigures.decode(q.optionFigures).flatMap { (label, names) -> names.map { it to label } }
        if(native.isEmpty() && !forceNative) return q
        require(native.size <= 6) { "桌面格式每题最多 6 张插图；此题的本机图片完整保留，请减少所选图片后发送" }
        val previous = JSONArray(q.figuresJson); val previousWidths = JSONArray(q.figureWidthsJson)
        val images = JSONArray(); val widths = JSONArray(); val placements = JSONArray()
        native.forEach { (name, placement) ->
            val file = QuestionFigures.file(context, name)
            require(file.isFile) { "题目插图已缺失，请在原 App 中补齐后发送" }
            val bytes = if(file.extension == "png") file.readBytes() else {
                val bitmap = BitmapFactory.decodeFile(file.path) ?: error("无法读取题目插图")
                try { ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() } } finally { bitmap.recycle() }
            }
            val uri = "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            val index = (0 until previous.length()).firstOrNull { previous.getString(it) == uri }
            images.put(uri); widths.put(index?.let { previousWidths.optDouble(it, 0.0) } ?: 0); placements.put(placement)
        }
        val manifest = JSONObject().put("figures", images).put("figureWidths", widths).put("figurePlacements", placements)
        DesktopPortable.figures(manifest); DesktopPortable.widths(manifest)
        return q.copy(figuresJson = images.toString(), figureWidthsJson = widths.toString(), figurePlacementsJson = placements.toString())
    }

    fun materialize(context: Context, q: Question, created: MutableList<java.io.File>): Question {
        val images = JSONArray(q.figuresJson); if(images.length() == 0) return q
        val placements = JSONArray(q.figurePlacementsJson)
        val stem = mutableListOf<String>(); val options = linkedMapOf<String, MutableList<String>>()
        repeat(images.length()) { index ->
            val bytes = Base64.decode(images.getString(index).substringAfter(','), Base64.DEFAULT)
            val name = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) } + ".png"
            val target = QuestionFigures.file(context, name)
            if(!target.exists()) { target.parentFile!!.mkdirs(); created += target; target.writeBytes(bytes) }
            val placement = placements.optString(index, "stem")
            if(placement == "stem") stem += name else options.getOrPut(placement) { mutableListOf() } += name
        }
        require(options.values.all { it.size <= OptionFigures.MAX_PER_OPTION }) { "手机每个选项最多 3 张图片，请在电脑调整后重试；未修改本机数据" }
        return q.copy(figures = QuestionFigures.encode(stem), optionFigures = OptionFigures.encode(options))
    }

    fun collection(c: QuestionCollection, items: List<CollectionItem>): QuestionCollection {
        val layout = JSONObject(c.questionLayoutJson)
        items.filter { it.collectionId == c.id }.forEach { item ->
            val value = layout.optJSONObject(item.questionId) ?: JSONObject()
            // Native controls are authoritative after materialization or a local edit.
            if(item.solutionSpace >= 0) value.put("answerSpaceMm", item.solutionSpace)
            if(item.newPage) value.put("pageBreakBefore", true)
            if(value.length() > 0) layout.put(item.questionId, value) else layout.remove(item.questionId)
        }
        return c.copy(questionLayoutJson = layout.toString())
    }

    fun item(i: CollectionItem, c: QuestionCollection?): CollectionItem {
        val layout = c?.let { JSONObject(it.questionLayoutJson).optJSONObject(i.questionId) } ?: return i
        return i.copy(solutionSpace = layout.optInt("answerSpaceMm", AUTO_SOLUTION_SPACE), newPage = layout.optBoolean("pageBreakBefore", false))
    }
}
