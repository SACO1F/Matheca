package com.mathector.app

import com.mathector.app.data.*
import org.junit.Assert.*
import org.junit.Test

class QuestionFilterTest {
    private val questions = listOf(
        Question(id = "function", title = "函数题", grade = "高一", difficulty = "基础", knowledge = "函数单调性"),
        Question(id = "sequence", title = "数列题", body = "求前十项和 \\(S_{10}\\)", grade = "高二", difficulty = "进阶", knowledge = "等差数列、数列求和"),
        Question(id = "hard-sequence", grade = "高二", difficulty = "挑战", knowledge = "数列求和"),
        Question(id = "unset", grade = "", difficulty = "待评估", knowledge = ""),
    )
    private fun matches(filter: QuestionFilter) = questions.filter(filter::matches).map { it.id }
    @Test fun combinedCategoriesRequireAllDimensionsAndMatchAnyTagOnTheQuestion() {
        assertEquals(listOf("sequence"), matches(QuestionFilter(grade = "高二", knowledge = "数列求和", difficulty = "进阶")))
        assertEquals(listOf("sequence", "hard-sequence"), matches(QuestionFilter(knowledge = "数列求和")))
        assertEquals(emptyList<String>(), matches(QuestionFilter(grade = "高一", knowledge = "数列求和")))
    }
    @Test fun uncategorizedQuestionsRemainSelectableWithoutMatchingAll() {
        assertEquals(4, matches(QuestionFilter()).size)
        assertEquals(listOf("unset"), matches(QuestionFilter(grade = "")))
        assertEquals(listOf("unset"), matches(QuestionFilter(knowledge = "", difficulty = "待评估")))
        assertTrue(QuestionFilter(grade = "", knowledge = "").active)
        assertFalse(QuestionFilter().active)
    }
    @Test fun searchWorksTogetherWithCategoriesAndIncludesBodyAndEveryKnowledgeTag() {
        assertEquals(listOf("sequence"), matches(QuestionFilter(query = " s_ ", grade = "高二")))
        assertEquals(listOf("sequence"), matches(QuestionFilter(query = "等差数列", knowledge = "数列求和")))
        assertEquals(listOf("function"), matches(QuestionFilter(query = "函数题")))
        assertEquals(emptyList<String>(), matches(QuestionFilter(query = "函数", difficulty = "挑战")))
    }
    @Test fun legacyUnknownCategoriesUseUnassignedAndPendingLabels() {
        val legacy = Question(grade = "八年级", difficulty = "未知", knowledge = "勾股定理")
        assertTrue(QuestionFilter(grade = "", knowledge = "", difficulty = "待评估").matches(legacy))
        assertFalse(QuestionFilter(grade = "高一").matches(legacy))
        assertEquals("待评估", legacy.displayDifficulty())
    }
    @Test fun questionTypeFilterUsesTheNormalizedKindAndFallsBackToWrittenAnswers() {
        val kinds = listOf(
            Question(id = "choice", kind = "选择题"),
            Question(id = "blank", kind = "填空题"),
            Question(id = "proof", kind = "证明题"),
            Question(id = "legacy", kind = "八年级"),
        )
        val ids = { filter: QuestionFilter -> kinds.filter(filter::matches).map { it.id } }
        assertEquals(listOf("choice"), ids(QuestionFilter(kind = "选择题")))
        assertEquals(listOf("blank"), ids(QuestionFilter(kind = "填空题")))
        assertEquals(listOf("proof"), ids(QuestionFilter(kind = "证明题")))
        assertEquals("An unrecognized stored type behaves like 解答题", listOf("legacy"), ids(QuestionFilter(kind = "解答题")))
        assertTrue(QuestionFilter(kind = "选择题").active)
    }
}
