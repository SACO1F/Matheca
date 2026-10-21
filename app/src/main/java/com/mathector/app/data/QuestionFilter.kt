package com.mathector.app.data

/** null means all; an empty grade or knowledge value matches uncategorized questions. */
data class QuestionFilter(
    val query: String = "",
    val grade: String? = null,
    val knowledge: String? = null,
    val difficulty: String? = null,
    val kind: String? = null,
) {
    val active: Boolean get() = query.isNotBlank() || grade != null || knowledge != null || difficulty != null || kind != null
    fun matches(question: Question): Boolean {
        val points = KnowledgeCatalog.decode(question.knowledge)
        return (grade == null || KnowledgeCatalog.grade(question.grade) == grade) &&
            (knowledge == null || if(knowledge.isEmpty()) points.isEmpty() else knowledge in points) &&
            (kind == null || question.displayKind() == kind) &&
            (difficulty == null || difficulty == question.displayDifficulty()) &&
            (query.isBlank() || listOf(question.title, question.body, question.latex, points.joinToString(" "))
                .any { it.contains(query.trim(), ignoreCase = true) })
    }
}

fun Question.displayDifficulty() = difficulty.takeIf { it in KnowledgeCatalog.difficulties } ?: "待评估"
fun Question.displayKind() = kind.takeIf { it in KnowledgeCatalog.kinds } ?: "解答题"
