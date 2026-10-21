package com.mathector.app.data

import org.json.JSONArray
import org.json.JSONObject
import com.mathector.app.BuildConfig

/** Portable records deliberately omit device paths, preferences, API credentials and work queues. */
internal object LibraryBackupCodec {
    fun encode(data: LibraryBackupData): ByteArray {
        BackupPolicy.validateReferences(data.questions, data.collections, data.items)
        require(data.customPoints.size <= BackupPolicy.MAX_CUSTOM_POINTS) { "自定义知识点超过 5,000 个，无法备份" }
        val manifest = JSONObject().put("format", BackupPolicy.FORMAT).put("version", BackupPolicy.VERSION)
            .put("createdAt", System.currentTimeMillis()).put("appVersion", BuildConfig.VERSION_NAME)
            .put("questions", JSONArray().apply { data.questions.forEach { q -> put(JSONObject()
                .put("id", q.id).put("title", q.title).put("body", q.body).put("latex", q.latex)
                .put("grade", q.grade).put("kind", q.kind).put("difficulty", q.difficulty).put("knowledge", q.knowledge)
                .put("sourceEntry", data.sources[q.id].orEmpty()).put("sourceLabel", q.sourceLabel)
                .put("reviewed", q.reviewed).put("favorite", q.favorite).put("example", q.example).put("createdAt", q.createdAt)
                .put("autoSolve", q.autoSolve).put("solution", q.solution).put("solutionLatex", q.solutionLatex)
                .put("solutionCurrent", q.id in data.currentSolutions).put("solutionError", q.solutionError)
                .put("figures", if(data.desktopFormat) JSONArray(q.figuresJson) else JSONArray().apply { data.figures[q.id].orEmpty().forEach { entry -> put(entry) } })
                .apply { if(data.desktopFormat) { put("figureWidths", JSONArray(q.figureWidthsJson)); put("figurePlacements", JSONArray(q.figurePlacementsJson)) } else { put("desktopFigures", JSONArray(q.figuresJson)); put("figureWidths", JSONArray(q.figureWidthsJson)); put("figurePlacements", JSONArray(q.figurePlacementsJson)); put("nativeBackup", true) } }
                .put("optionFigures", JSONObject().apply { data.optionFigures[q.id].orEmpty().forEach { (label, names) ->
                    put(label, JSONArray().apply { names.forEach { put(it) } }) } })
            ) } })
            .put("collections", JSONArray().apply { data.collections.forEach { c -> put(JSONObject()
                .put("id", c.id).put("title", c.title).put("createdAt", c.createdAt).put("paperTitle", c.paperTitle)
                .put("examInstructions", c.examInstructions).put("examMinutes", c.examMinutes).put("totalScore", c.totalScore).put("questionLayout", JSONObject(c.questionLayoutJson))
            ) } })
            .put("items", JSONArray().apply { data.items.forEach { i -> put(JSONObject()
                .put("collectionId", i.collectionId).put("questionId", i.questionId).put("position", i.position)
                .put("solutionSpace", i.solutionSpace).put("newPage", i.newPage)
            ) } })
            .put("customKnowledge", JSONArray().apply { data.customPoints.forEach { point -> put(JSONObject().put("group", point.group).put("name", point.name)) } })
            .put("missingSources", data.missingSources)
            .put("missingFigures", data.missingFigures)
        return manifest.toString().toByteArray(Charsets.UTF_8).also { require(it.size <= BackupPolicy.MAX_MANIFEST_BYTES) { "题库文字数据超过 32 MB" } }
    }

    fun decode(text: String): LibraryBackupData {
        val root = JSONObject(text)
        require(root.string("format") in listOf(BackupPolicy.FORMAT, "MathectorLibraryBackup")) { "请选择 Matheca 导出的题库备份 ZIP 文件" }
        require(root.integer("version") == BackupPolicy.VERSION) { "此备份版本暂不支持，请更新 Matheca 后重试" }
        val sources = mutableMapOf<String, String>()
        val figures = mutableMapOf<String, List<String>>()
        val optionFigures = mutableMapOf<String, Map<String, List<String>>>()
        val solutions = mutableSetOf<String>()
        val questions = root.array("questions", BackupPolicy.MAX_QUESTIONS).map { q ->
            val id = q.string("id")
            val entry = q.string("sourceEntry")
            require(entry.isBlank() || BackupPolicy.sourceEntry(entry)) { "备份中的原图路径无效" }
            if(entry.isNotBlank()) sources[id] = entry
            val canonical = q.has("figureWidths") && !q.optBoolean("nativeBackup", false)
            val figureEntries = if(canonical) emptyList() else q.strings("figures", QuestionFigures.MAX_FIGURES)
            require(figureEntries.all(BackupPolicy::figureEntry)) { "备份中的题目图片路径无效" }
            if(figureEntries.isNotEmpty()) figures[id] = figureEntries
            val optionEntries = q.optionFigures("optionFigures")
            if(optionEntries.isNotEmpty()) optionFigures[id] = optionEntries
            if(q.boolean("solutionCurrent")) solutions += id
            val portable = if(canonical) q else JSONObject(q.toString()).put("figures", q.optJSONArray("desktopFigures") ?: JSONArray())
            Question(id = id, title = q.string("title"), body = q.string("body"), latex = q.string("latex"),
                grade = q.string("grade"), kind = q.string("kind"), difficulty = q.string("difficulty"), knowledge = q.string("knowledge"),
                sourceLabel = q.string("sourceLabel"), reviewed = q.boolean("reviewed"), favorite = q.boolean("favorite"), example = q.boolean("example"),
                createdAt = q.long("createdAt"), autoSolve = q.boolean("autoSolve"), solution = q.string("solution"), solutionLatex = q.string("solutionLatex"),
                solutionError = q.string("solutionError"), figuresJson = DesktopPortable.figures(portable).toString(),
                figureWidthsJson = DesktopPortable.widths(portable).toString(), figurePlacementsJson = DesktopPortable.placements(portable).toString())
        }
        val collections = root.array("collections", BackupPolicy.MAX_COLLECTIONS).map { c ->
            QuestionCollection(id = c.string("id"), title = c.string("title"), createdAt = c.long("createdAt"), paperTitle = c.string("paperTitle"),
                examInstructions = c.string("examInstructions"), examMinutes = c.integer("examMinutes"), totalScore = c.integer("totalScore"), questionLayoutJson = DesktopPortable.layout(c).toString())
        }
        val items = root.array("items", BackupPolicy.MAX_ITEMS).map { i -> CollectionItem(i.string("collectionId"), i.string("questionId"), i.integer("position"),
            i.optionalInt("solutionSpace", AUTO_SOLUTION_SPACE), i.optionalBoolean("newPage", false)) }
        val points = mutableListOf<CustomKnowledgePoint>()
        root.array("customKnowledge", BackupPolicy.MAX_CUSTOM_POINTS).forEach { p -> points += KnowledgeCatalog.validateCustomPoint(p.string("group"), p.string("name"), points) }
        val missingSources = root.integer("missingSources")
        require(missingSources in 0..questions.size) { "备份中的原图统计无效" }
        val missingFigures = if(root.has("missingFigures")) root.integer("missingFigures") else 0
        val figureEntries = figures.values.sumOf { it.size } + optionFigures.values.sumOf { group -> group.values.sumOf { it.size } }
        require(missingFigures in 0..figureEntries) { "备份中的题目图片统计无效" }
        collections.forEach { it.paperSettings().validated() }
        BackupPolicy.validateReferences(questions, collections, items)
        val nativeItems = items.map { NativeDesktopAdapter.item(it, collections.find { c -> c.id == it.collectionId }) }
        return LibraryBackupData(questions, collections, nativeItems, points, sources, solutions, missingSources, figures, missingFigures, optionFigures)
    }

    /** 旧版备份没有选项图片字段，缺失时回落为空。 */
    private fun JSONObject.optionFigures(key: String): Map<String, List<String>> {
        if(!has(key) || isNull(key)) return emptyMap()
        val value = get(key) as? JSONObject ?: error("备份字段 $key 无效")
        val result = linkedMapOf<String, List<String>>()
        value.keys().forEach { label ->
            require(label in OptionFigures.LABELS) { "备份字段 $key 无效" }
            val array = value.get(label) as? JSONArray ?: error("备份字段 $key 无效")
            require(array.length() <= OptionFigures.MAX_PER_OPTION) { "备份数据条目过多" }
            val names = List(array.length()) { index -> (array.get(index) as? String) ?: error("备份字段 $key 无效") }
            require(names.all(BackupPolicy::figureEntry)) { "备份中的选项图片路径无效" }
            if(names.isNotEmpty()) result[label] = names
        }
        return result
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
    /** 旧版备份没有图片字段，缺失时回落为空列表。 */
    private fun JSONObject.strings(key: String, max: Int): List<String> {
        if(!has(key) || isNull(key)) return emptyList()
        val value = get(key) as? JSONArray ?: error("备份字段 $key 无效")
        require(value.length() <= max) { "备份数据条目过多" }
        return List(value.length()) { index -> (value.get(index) as? String) ?: error("备份字段 $key 无效") }
    }
    /** 旧版备份没有每题排版字段，缺失时回落到"自动留白、不另起一页"。 */
    private fun JSONObject.optionalInt(key: String, fallback: Int): Int = if(!has(key) || isNull(key)) fallback else integer(key)
    private fun JSONObject.optionalBoolean(key: String, fallback: Boolean): Boolean = if(!has(key) || isNull(key)) fallback else boolean(key)
}
