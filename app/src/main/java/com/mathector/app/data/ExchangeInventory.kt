package com.mathector.app.data

import org.json.JSONArray
import org.json.JSONObject

/** Version 1 hashes portable content, never clocks, device paths, or transport receipts. */
internal object ExchangeInventory {
    private val fields = "id title body latex grade kind difficulty knowledge sourceLabel reviewed favorite example autoSolve solution solutionLatex solutionError".split(" ")
    private fun framed(v: Any?): String = when(v) {
        null, JSONObject.NULL -> "n"
        is String -> "s${v.toByteArray(Charsets.UTF_8).size}:$v"
        is Boolean -> if(v) "t" else "f"
        is Number -> "d${java.math.BigDecimal(v.toString()).stripTrailingZeros().toPlainString()};"
        is JSONArray -> (0 until v.length()).joinToString("", "[", "]") { framed(v.get(it)) }
        is JSONObject -> v.keys().asSequence().toList().sorted().joinToString("", "{", "}") { framed(it) + framed(v.get(it)) }
        else -> error("摘要包含不支持的内容")
    }
    fun fromManifest(root: JSONObject): JSONObject {
        val points = root.getJSONArray("customKnowledge").let { a -> JSONArray((0 until a.length()).map { a.getJSONObject(it) }.sortedWith(compareBy({ it.getString("group") }, { it.getString("name") }))) }
        val questions = JSONObject(); val qs = root.getJSONArray("questions")
        repeat(qs.length()) { n -> val q=qs.getJSONObject(n); val o=JSONObject()
            fields.forEach { o.put(it,q.get(it)) }
            o.put("createdAt",q.get("createdAt").toString()).put("sourceHash",q.getString("sourceEntry").substringAfterLast('/').substringBefore('.'))
                .put("solutionCurrent",q.getBoolean("solutionCurrent")).put("figures",q.getJSONArray("figures")).put("figureWidths",q.getJSONArray("figureWidths")).put("figurePlacements",q.getJSONArray("figurePlacements")).put("points",points)
            questions.put(q.getString("id"),DesktopPortable.hash(framed(o)))
        }
        val collections=JSONObject(); val cs=root.getJSONArray("collections"); val items=root.getJSONArray("items")
        repeat(cs.length()) { n -> val c=JSONObject(cs.getJSONObject(n).toString()); val id=c.getString("id")
            val order=(0 until items.length()).map { items.getJSONObject(it) }.filter { it.getString("collectionId")==id }.sortedBy { it.getInt("position") }.map { it.getString("questionId") }
            c.put("createdAt",c.get("createdAt").toString()).put("order",JSONArray(order)).put("points",points)
            collections.put(id,DesktopPortable.hash(framed(c)))
        }
        return JSONObject().put("version",1).put("questions",questions).put("collections",collections)
    }
    fun validate(o: JSONObject): JSONObject {
        require(o.getInt("version")==1) { "请更新手机与电脑后使用增量交换" }
        listOf("questions" to 20000, "collections" to 5000).forEach { (key,max) -> val map=o.getJSONObject(key); require(map.length()<=max); map.keys().forEach { require(it.isNotEmpty() && it.length<=200 && Regex("[a-f0-9]{64}").matches(map.getString(it))) { "资料摘要无效" } } }
        return o
    }
}
