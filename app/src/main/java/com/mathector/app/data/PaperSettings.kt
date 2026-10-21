package com.mathector.app.data

data class PaperSettings(
    val title: String = "",
    val instructions: String = "",
    val minutes: Int = 0,
    val totalScore: Int = 0,
) {
    fun validated(): PaperSettings {
        val normalized = copy(title = title.trim(), instructions = instructions.trim())
        require(normalized.title.length <= 80) { "试卷主标题最多 80 字" }
        require(normalized.instructions.length <= 600) { "考试说明最多 600 字" }
        require(minutes in 0..999) { "考试时间应为 1–999 分钟，留空不显示" }
        require(totalScore in 0..9999) { "满分应为 1–9999 分，留空不显示" }
        return normalized
    }
    val summary: String get() = listOfNotNull(
        minutes.takeIf { it > 0 }?.let { "考试时间：$it 分钟" },
        totalScore.takeIf { it > 0 }?.let { "满分：$it 分" },
    ).joinToString("    ")
}

fun QuestionCollection.paperSettings() = PaperSettings(paperTitle, examInstructions, examMinutes, totalScore)

/** [AUTO_SOLUTION_SPACE] keeps the blank space derived from the question type. */
const val AUTO_SOLUTION_SPACE = -1
val solutionSpaceOptions = listOf(AUTO_SOLUTION_SPACE, 0, 20, 30, 40, 50, 60, 80, 100)

/** Scratch space (mm) a question type needs by default: written answers get room, objective answers get none. */
fun defaultSolutionSpace(kind: String): Int = if(kind in setOf("解答题", "计算题", "证明题")) 50 else 0

/** Turns a stored per-question choice into the millimetres the exporter should leave blank. */
fun resolvedSolutionSpace(space: Int, kind: String): Int = if(space == AUTO_SOLUTION_SPACE) defaultSolutionSpace(kind) else space.coerceAtLeast(0)

/** Per-question print layout resolved for one collection entry. */
data class QuestionLayout(val solutionSpaceMm: Int, val newPage: Boolean)

fun CollectionItem.questionLayout(question: Question?): QuestionLayout =
    QuestionLayout(resolvedSolutionSpace(solutionSpace, question?.kind.orEmpty()), newPage)
