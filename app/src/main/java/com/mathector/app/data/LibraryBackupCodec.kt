package com.mathector.app.data

import org.json.JSONArray
import org.json.JSONObject

/** Portable records deliberately omit device paths, preferences, API credentials and work queues. */
internal object LibraryBackupCodec {
    fun encode(data: LibraryBackupData): ByteArray {
        BackupPolicy.validateReferences(data.questions, data.collections, data.items)
        require(data.customPoints.size <= BackupPolicy.MAX_CUSTOM_POINTS) { "自定义知识点超过 5,000 个，无法备份" }
        val manifest = JSONObject().put("format", BackupPolicy.FORMAT).put("version", BackupPolicy.VERSION)
            .put("createdAt", System.currentTimeMillis()).put("appVersion", "0.21.0")
            .put("questions", JSONArray().apply { data.questions.forEach { q -> put(JSONObject()
                .put("id", q.id).put("title", q.title).put("body", q.body).put("latex", q.latex)
                .put("grade", q.grade).put("kind", q.kind).put("difficulty", q.difficulty).put("knowledge", q.knowledge)
                .put("sourceEntry", data.sources[q.id].orEmpty()).put("sourceLabel", q.sourceLabel)
                .put("reviewed", q.reviewed).put("favorite", q.favorite).put("example", q.example).put("createdAt", q.createdAt)
                .put("autoSolve", q.autoSolve).put("solution", q.solution).put("solutionLatex", q.solutionLatex)
                .put("solutionCurrent", q.id in data.currentSolutions).put("solutionError", q.solutionError)
            ) } })
            .put("collections", JSONArray().apply { data.collections.forEach { c -> put(JSONObject()
                .put("id", c.id).put("title", c.title).put("createdAt", c.createdAt).put("paperTitle", c.paperTitle)
                .put("examInstructions", c.examInstructions).put("examMinutes", c.examMinutes).put("totalScore", c.totalScore)
            ) } })
            .put("items", JSONArray().apply { data.items.forEach { i -> put(JSONObject()
                .put("collectionId", i.collectionId).put("questionId", i.questionId).put("position", i.position)
            ) } })
            .put("customKnowledge", JSONArray().apply { data.customPoints.forEach { point -> put(JSONObject().put("group", point.group).put("name", point.name)) } })
            .put("missingSources", data.missingSources)
        return manifest.toString().toByteArray(Charsets.UTF_8).also { require(it.size <= BackupPolicy.MAX_MANIFEST_BYTES) { "题库文字数据超过 32 MB" } }
    }

    fun decode(text: String): LibraryBackupData {
        val root = JSONObject(text)
        require(root.string("format") in listOf(BackupPolicy.FORMAT, "MathectorLibraryBackup")) { "请选择 Matheca 导出的题库备份 ZIP 文件" }
        require(root.integer("version") == BackupPolicy.VERSION) { "此备份版本暂不支持，请更新 Matheca 后重试" }
        val sources = mutableMapOf<String, String>()
        val solutions = mutableSetOf<String>()
        val questions = root.array("questions", BackupPolicy.MAX_QUESTIONS).map { q ->
            val id = q.string("id")
            val entry = q.string("sourceEntry")
            require(entry.isBlank() || BackupPolicy.sourceEntry(entry)) { "备份中的原图路径无效" }
            if(entry.isNotBlank()) sources[id] = entry
            if(q.boolean("solutionCurrent")) solutions += id
            Question(id = id, title = q.string("title"), body = q.string("body"), latex = q.string("latex"),
                grade = q.string("grade"), kind = q.string("kind"), difficulty = q.string("difficulty"), knowledge = q.string("knowledge"),
                sourceLabel = q.string("sourceLabel"), reviewed = q.boolean("reviewed"), favorite = q.boolean("favorite"), example = q.boolean("example"),
                createdAt = q.long("createdAt"), autoSolve = q.boolean("autoSolve"), solution = q.string("solution"), solutionLatex = q.string("solutionLatex"),
                solutionError = q.string("solutionError"))
        }
        val collections = root.array("collections", BackupPolicy.MAX_COLLECTIONS).map { c ->
            QuestionCollection(id = c.string("id"), title = c.string("title"), createdAt = c.long("createdAt"), paperTitle = c.string("paperTitle"),
                examInstructions = c.string("examInstructions"), examMinutes = c.integer("examMinutes"), totalScore = c.integer("totalScore"))
        }
        val items = root.array("items", BackupPolicy.MAX_ITEMS).map { i -> CollectionItem(i.string("collectionId"), i.string("questionId"), i.integer("position")) }
        val points = mutableListOf<CustomKnowledgePoint>()
        root.array("customKnowledge", BackupPolicy.MAX_CUSTOM_POINTS).forEach { p -> points += KnowledgeCatalog.validateCustomPoint(p.string("group"), p.string("name"), points) }
        val missingSources = root.integer("missingSources")
        require(missingSources in 0..questions.size) { "备份中的原图统计无效" }
        BackupPolicy.validateReferences(questions, collections, items)
        return LibraryBackupData(questions, collections, items, points, sources, solutions, missingSources)
    }

    private fun JSONObject.string(key: String): String = (get(key) as? String) ?: error("备份字段 $key 无效")
    private fun JSONObject.boolean(key: String): Boolean = (get(key) as? Boolean) ?: error("备份字段 $key 无效")
    private fun JSONObject.long(key: String): Long {
        val value = get(key)
        require(value is Int || value is Long) { "备份字段 $key 无效" }
        return (value as Number).toLong()
    }
    private fun JSONObject.integer(key: String): Int = long(key).also { require(it in Int.MIN_VALUE..Int.MAX_VALUE) { "备份字段 $key 超出范围" } }.toInt()
    private fun JSONObject.array(key: String, max: Int): List<JSONObject> {
        val value = getJSONArray(key)
        require(value.length() <= max) { "备份数据条目过多" }
        return List(value.length()) { value.getJSONObject(it) }
    }
}
