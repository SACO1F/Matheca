package com.mathector.app.data

object BackupPolicy {
    const val FORMAT = "MathecaLibraryBackup"
    const val VERSION = 1
    const val MAX_ARCHIVE_BYTES = 512L * 1024 * 1024
    const val MAX_MANIFEST_BYTES = 32L * 1024 * 1024
    const val MAX_SOURCE_BYTES = 50L * 1024 * 1024
    const val MAX_QUESTIONS = 20_000
    const val MAX_COLLECTIONS = 5_000
    const val MAX_ITEMS = 100_000
    const val MAX_CUSTOM_POINTS = 5_000
    /** 每题至多一份原图、[QuestionFigures.MAX_FIGURES] 张题目图片，再加每个选项 [OptionFigures.MAX_PER_OPTION] 张，再加 manifest。 */
    const val MAX_ENTRIES = MAX_QUESTIONS * (1 + QuestionFigures.MAX_FIGURES + OptionFigures.COUNT * OptionFigures.MAX_PER_OPTION) + 1
    private val source = Regex("sources/[0-9a-f]{64}\\.(?:jpg|jpeg|png|webp|heic|heif|img)")
    private val figure = Regex("figures/[0-9a-f]{64}\\.(?:jpg|jpeg|png|webp)")
    fun sourceEntry(value: String): Boolean = source.matches(value)
    fun figureEntry(value: String): Boolean = figure.matches(value)
    fun allowedEntry(value: String): Boolean = value == "manifest.json" || sourceEntry(value) || figureEntry(value)
    fun validateReferences(questions: List<Question>, collections: List<QuestionCollection>, items: List<CollectionItem>) {
        require(questions.size <= MAX_QUESTIONS && collections.size <= MAX_COLLECTIONS && items.size <= MAX_ITEMS) { "题库备份的数据条目过多" }
        val questionIds = questions.map { it.id }.toSet()
        val collectionIds = collections.map { it.id }.toSet()
        require(questionIds.size == questions.size && collectionIds.size == collections.size) { "题库备份中有重复编号" }
        require((questionIds + collectionIds).all { it.isNotBlank() && it.length <= 128 && it.none(Char::isISOControl) }) { "题库备份中的编号无效" }
        require(items.all { it.questionId in questionIds && it.collectionId in collectionIds && it.position >= 0 }) { "题集关联数据不完整" }
        require(items.map { it.collectionId to it.questionId }.distinct().size == items.size) { "题集包含重复题目" }
        require(items.map { it.collectionId to it.position }.distinct().size == items.size) { "题集排序数据无效" }
    }
}

data class LibraryBackupData(val questions: List<Question>, val collections: List<QuestionCollection>, val items: List<CollectionItem>,
    val customPoints: List<CustomKnowledgePoint>, val sources: Map<String, String>, val currentSolutions: Set<String>, val missingSources: Int,
    val figures: Map<String, List<String>> = emptyMap(), val missingFigures: Int = 0,
    val optionFigures: Map<String, Map<String, List<String>>> = emptyMap(), val desktopFormat: Boolean = false)

data class BackupSummary(val questions: Int, val collections: Int, val images: Int, val knowledgePoints: Int, val missingImages: Int,
    val figures: Int, val missingFigures: Int)
data class RestoreResult(val questions: Int, val collections: Int, val skippedQuestions: Int, val skippedCollections: Int, val knowledgePoints: Int)

data class LibraryRestorePlan(val questions: List<Question>, val collections: List<QuestionCollection>, val items: List<CollectionItem>,
    val skippedQuestions: Int, val skippedCollections: Int) {
    companion object {
        fun merge(data: LibraryBackupData, localQuestionIds: Set<String>, localCollectionIds: Set<String>): LibraryRestorePlan {
            val questions = data.questions.filter { it.id !in localQuestionIds }
            val collections = data.collections.filter { it.id !in localCollectionIds }
            val newCollections = collections.map { it.id }.toSet()
            val items = data.items.filter { it.collectionId in newCollections }.groupBy { it.collectionId }.values.flatMap { values ->
                values.sortedBy { it.position }.mapIndexed { index, item -> item.copy(position = index) }
            }
            return LibraryRestorePlan(questions, collections, items, data.questions.size - questions.size, data.collections.size - collections.size)
        }
    }
}


data class ExchangeDetail(val kind: String, val id: String, val title: String, val status: String)
data class ExchangeAssessment(val version: String, val details: List<ExchangeDetail>) {
    val added get() = details.count { it.status == "new" }
    val repeated get() = details.count { it.status == "same" }
    val conflicts get() = details.count { it.status == "conflict" }
}
