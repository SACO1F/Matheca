package com.mathector.app

import com.mathector.app.data.AUTO_SOLUTION_SPACE
import com.mathector.app.data.CollectionItem
import com.mathector.app.data.Question
import com.mathector.app.data.defaultSolutionSpace
import com.mathector.app.data.questionLayout
import com.mathector.app.data.resolvedSolutionSpace
import com.mathector.app.data.solutionSpaceOptions
import org.junit.Assert.*
import org.junit.Test

class SolutionSpaceTest {
    @Test fun writtenQuestionTypesGetRoomWhileObjectiveTypesGetNone() {
        listOf("解答题", "计算题", "证明题").forEach { assertEquals(50, defaultSolutionSpace(it)) }
        listOf("选择题", "填空题", "", "未知题型").forEach { assertEquals(0, defaultSolutionSpace(it)) }
    }
    @Test fun automaticSpaceFallsBackToTheQuestionTypeAndExplicitChoiceWins() {
        assertEquals(50, resolvedSolutionSpace(AUTO_SOLUTION_SPACE, "解答题"))
        assertEquals(0, resolvedSolutionSpace(AUTO_SOLUTION_SPACE, "选择题"))
        assertEquals(80, resolvedSolutionSpace(80, "选择题"))
        assertEquals(0, resolvedSolutionSpace(-5, "解答题"))
    }
    @Test fun everyOfferedOptionResolvesToANonNegativeMillimetreValue() {
        assertEquals(AUTO_SOLUTION_SPACE, solutionSpaceOptions.first())
        assertEquals(listOf(AUTO_SOLUTION_SPACE, 0, 20, 30, 40, 50, 60, 80, 100), solutionSpaceOptions)
        solutionSpaceOptions.forEach { option -> assertTrue(resolvedSolutionSpace(option, "解答题") >= 0) }
    }
    @Test fun collectionEntryResolvesThroughItsQuestionTypeAndKeepsThePageBreak() {
        val written = CollectionItem("c", "q", 0)
        assertEquals(50, written.questionLayout(Question(kind = "计算题")).solutionSpaceMm)
        assertFalse(written.questionLayout(Question(kind = "计算题")).newPage)
        val choice = CollectionItem("c", "q", 1, solutionSpace = 40, newPage = true)
        assertEquals(40, choice.questionLayout(Question(kind = "选择题")).solutionSpaceMm)
        assertTrue(choice.questionLayout(Question(kind = "选择题")).newPage)
        assertEquals(0, CollectionItem("c", "missing", 2).questionLayout(null).solutionSpaceMm)
    }
}
