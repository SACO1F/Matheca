package com.mathector.app.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** The desktop v1 manifest is the interchange contract; native-only paths never cross devices. */
internal object DesktopPortable {
    fun figures(q: JSONObject): JSONArray {
        val a = if(q.has("figures")) q.getJSONArray("figures") else JSONArray()
        require(a.length() <= 6) { "每题最多 6 张 PNG 插图" }
        var length = 0
        repeat(a.length()) { i -> val s = a.getString(i); length += s.length
            require(s.length <= 2_800_000 && Regex("data:image/png;base64,[A-Za-z0-9+/]+={0,2}").matches(s)) { "题目插图格式无效" }
        }
        require(length <= 8_000_000) { "题目插图超过限制" }; return a
    }
    fun widths(q: JSONObject): JSONArray {
        val count = figures(q).length()
        val a = if(q.has("figureWidths")) q.getJSONArray("figureWidths") else JSONArray(List(count) { 0 })
        require(a.length() == count) { "插图宽度数量无效" }
        repeat(count) { val n = a.get(it); require(n is Number && (n.toDouble() == 0.0 || n.toDouble() in 20.0..160.0)) { "插图宽度应为 20–160mm 或自动" } }; return a
    }
    fun placements(q: JSONObject): JSONArray {
        val count = figures(q).length()
        val a = if(q.has("figurePlacements")) q.getJSONArray("figurePlacements") else JSONArray(List(count) { "stem" })
        require(a.length() == count) { "插图位置数量无效" }
        repeat(count) { require(a.getString(it) in listOf("stem", "A", "B", "C", "D")) { "插图位置无效" } }; return a
    }
    fun layout(c: JSONObject): JSONObject {
        val o = if(c.has("questionLayout")) c.getJSONObject("questionLayout") else JSONObject()
        require(o.length() <= 100_000) { "题集排版设置过多" }
        o.keys().forEach { id ->
            require(id.isNotEmpty() && id.length <= 200) { "题目排版编号无效" }
            val layout = o.getJSONObject(id)
            if(layout.has("answerSpaceMm")) { val n = layout.get("answerSpaceMm"); require((n is Int || n is Long) && (n as Number).toLong() in 0..160) { "解答空间应为 0–160mm" } }
            if(layout.has("pageBreakBefore")) require(layout.get("pageBreakBefore") is Boolean) { "分页设置无效" }
        }
        return o
    }
    fun canonical(value: Any?): String = when(value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        null, JSONObject.NULL -> "null"
        is Number -> java.math.BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
        else -> value.toString()
    }
    fun hash(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
    fun sourceHash(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val bytes = ByteArray(16384); while(true) { val n = input.read(bytes); if(n < 0) break; digest.update(bytes, 0, n) } }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
    fun question(q: Question, source: String, current: Boolean): String {
        val data = LibraryBackupData(listOf(q), emptyList(), emptyList(), emptyList(), emptyMap(), if(current) setOf(q.id) else emptySet(), 0)
        val obj = JSONObject(String(LibraryBackupCodec.encode(data), Charsets.UTF_8)).getJSONArray("questions").getJSONObject(0)
        obj.put("sourceEntry", source.substringAfter('/').substringBefore('.'))
        return canonical(obj)
    }
    fun collection(c: QuestionCollection, items: List<CollectionItem>): String {
        val obj = JSONObject().put("id", c.id).put("title", c.title).put("createdAt", c.createdAt).put("paperTitle", c.paperTitle)
            .put("examInstructions", c.examInstructions).put("examMinutes", c.examMinutes).put("totalScore", c.totalScore)
            .put("questionLayout", JSONObject(c.questionLayoutJson)).put("order", JSONArray(items.filter { it.collectionId == c.id }.sortedBy { it.position }.map { it.questionId }))
        return canonical(obj)
    }
}
