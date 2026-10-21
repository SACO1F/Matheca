package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class QuestionPickerTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private fun snapshot(name: String) {
        compose.waitForIdle()
        val bitmap = requireNotNull(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }
    private fun filter(id: String, value: String) {
        compose.onNodeWithTag("picker-filter-$id").performClick()
        compose.onNodeWithTag("picker-option-$id-$value").performScrollTo().performClick()
    }
    @Test fun combinedFiltersShowColoredMetadataAndRetainSelectionAcrossFilters() {
        val suffix = UUID.randomUUID().toString().take(6)
        val collection = QuestionCollection(title = "分类选题-$suffix")
        val basic = Question(id = "picker-basic-$suffix", title = "函数单调性练习", body = "已知函数 \\(f(x)=x^2\\)，求单调区间。", grade = "高一", difficulty = "基础", knowledge = "函数单调性", reviewed = true)
        val sequence = Question(id = "picker-sequence-$suffix", title = "等差数列综合练习", body = "已知数列 \\(a_n=2n+1\\)，求前 10 项和。", grade = "高二", difficulty = "进阶", knowledge = "等差数列、数列求和", reviewed = true)
        val challenge = Question(id = "picker-hard-$suffix", title = "数列求和挑战", body = "求数列的前 n 项和。", grade = "高二", difficulty = "挑战", knowledge = "数列求和", reviewed = true)
        val existing = basic.copy(id = "picker-existing-$suffix", title = "已经加入的题目")
        val questions = listOf(basic, sequence, challenge, existing)
        runBlocking { questions.forEach { dao.save(it) }; dao.save(collection); dao.addToCollection(collection.id, existing.id) }
        try {
            compose.onNodeWithText("题集", useUnmergedTree = true).performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithText("添加题目").performClick()
            compose.onNodeWithTag("picker-confirm").assertIsNotEnabled()
            compose.onNodeWithTag("picker-question-${existing.id}").assertDoesNotExist()
            filter("grade", "高二"); filter("knowledge", "数列求和"); filter("difficulty", "进阶")
            compose.onNodeWithTag("picker-results").assertTextEquals("1 道可选")
            compose.onNodeWithTag("picker-question-${basic.id}").assertDoesNotExist()
            compose.onNodeWithTag("picker-question-${challenge.id}").assertDoesNotExist()
            compose.onNodeWithTag("picker-grade-${sequence.id}", useUnmergedTree = true).assertTextEquals("高二")
            compose.onNodeWithTag("picker-difficulty-${sequence.id}", useUnmergedTree = true).assertTextEquals("进阶")
            compose.onNodeWithTag("picker-knowledge-${sequence.id}-等差数列", useUnmergedTree = true).assertTextEquals("等差数列")
            compose.onNodeWithTag("picker-knowledge-${sequence.id}-数列求和", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("picker-math-${sequence.id}", useUnmergedTree = true).performTouchInput { click() }
            compose.onNodeWithTag("picker-question-${sequence.id}").assertIsOn()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 1 道")
            val tags = compose.onNodeWithTag("picker-tags-${sequence.id}", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            val math = compose.onNodeWithTag("picker-math-${sequence.id}", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("Metadata must precede the stem", tags.bottom <= math.top)
            snapshot("question-picker-filtered-light-0.9.0.png")
            filter("difficulty", "挑战")
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 1 道")
            compose.onNodeWithTag("picker-question-${challenge.id}").performClick().assertIsOn()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 2 道")
            filter("grade", "高一")
            compose.onNodeWithText("没有符合筛选条件的题目").assertExists()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 2 道")
            compose.onNodeWithTag("picker-reset").performClick()
            compose.onNodeWithTag("picker-search").performTextInput("函数单调性练习")
            compose.onNodeWithTag("picker-results").assertTextEquals("1 道可选")
            compose.onNodeWithTag("picker-question-${basic.id}").performClick().assertIsOn()
            compose.onNodeWithTag("picker-search").performTextClearance()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 3 道")
            compose.onNodeWithTag("picker-confirm").performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).size == 4 } }
            assertEquals(listOf(existing.id, sequence.id, challenge.id, basic.id), runBlocking { dao.orderedItems(collection.id).map { it.questionId } })
            compose.onNodeWithTag("question-picker").assertDoesNotExist()
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("picker-search").performTextInput(suffix)
            compose.onNodeWithTag("picker-question-${sequence.id}").assertDoesNotExist()
            compose.onNodeWithContentDescription("关闭选题").performClick()
        } finally { runBlocking { dao.deleteCollection(collection.id); questions.forEach { dao.deleteQuestion(it.id) } } }
    }
    @Test fun pendingCategoriesCanBeFilteredAndCancelledWithoutSavingInDarkMode() {
        val suffix = UUID.randomUUID().toString().take(6)
        val q = Question(id = "picker-unset-$suffix", title = "未分类题目-$suffix", body = "求函数的最大值。", grade = "", knowledge = "", difficulty = "待评估")
        val known = Question(id = "picker-known-$suffix", title = "导数综合练习-$suffix", body = "已知函数 \\(f(x)=x^3-3x\\)，讨论函数的极值。", grade = "高三", knowledge = "导数与极值最值、函数单调性", difficulty = "挑战", reviewed = true, createdAt = q.createdAt - 1)
        val collection = QuestionCollection(title = "未分类选题-$suffix")
        val originalTheme = app.settings.state.value.theme
        runBlocking { dao.save(q); dao.save(known); dao.save(collection) }
        try {
            app.settings.setTheme(ThemeMode.DARK)
            compose.waitUntil(5000) { app.settings.state.value.theme == ThemeMode.DARK }
            compose.onNodeWithText("题集", useUnmergedTree = true).performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithText("添加题目").performClick()
            filter("grade", ""); filter("knowledge", ""); filter("difficulty", "待评估")
            compose.onNodeWithTag("picker-search").performTextInput(suffix)
            compose.onNodeWithTag("picker-results").assertTextEquals("1 道可选")
            compose.onNodeWithTag("picker-question-${q.id}").performClick().assertIsOn()
            compose.onNodeWithTag("picker-clear-selection").performClick()
            compose.onNodeWithTag("picker-question-${q.id}").assertIsOff()
            compose.onNodeWithTag("picker-confirm").assertIsNotEnabled()
            compose.onNodeWithTag("picker-question-${q.id}").performClick()
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            compose.waitForIdle()
            snapshot("question-picker-pending-dark-0.9.0.png")
            compose.onNodeWithTag("picker-reset").performClick()
            compose.onNodeWithTag("picker-list").performScrollToNode(hasTestTag("picker-question-${known.id}"))
            snapshot("question-picker-dark-0.9.0.png")
            compose.onNodeWithContentDescription("关闭选题").performClick()
            assertTrue(runBlocking { dao.orderedItems(collection.id).isEmpty() })
            compose.onNodeWithText("添加题目").performClick()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 0 道")
            compose.onNodeWithContentDescription("关闭选题").performClick()
        } finally { app.settings.setTheme(originalTheme); runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(q.id); dao.deleteQuestion(known.id) } }
    }
    @Test fun batchAdditionKeepsSelectionOrderAndSkipsExistingDeletedAndRepeatedIds(): Unit = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(app, MathectorDatabase::class.java).build()
        try {
            val dao = database.dao()
            val collection = QuestionCollection(title = "批量选题")
            val a = Question(); val b = Question(); val removed = Question()
            dao.save(collection); dao.save(a); dao.save(b); dao.save(removed)
            dao.addToCollection(collection.id, a.id); dao.deleteQuestion(removed.id)
            assertEquals(1, dao.addQuestions(collection.id, listOf(b.id, a.id, removed.id, b.id)))
            assertEquals(listOf(a.id, b.id), dao.orderedItems(collection.id).map { it.questionId })
            assertEquals(listOf(0, 1), dao.orderedItems(collection.id).map { it.position })
            assertEquals(0, dao.addQuestions(collection.id, listOf(a.id, b.id)))
        } finally { database.close() }
    }
}
