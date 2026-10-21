package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class RoundedOverlayTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private fun snapshot(name: String) {
        compose.waitForIdle()
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }

    @Test fun gradePopupFiltersAndQuestionMenuDismissesWithoutOpeningEditor() {
        val suffix = UUID.randomUUID().toString().take(6)
        val first = Question(id = "round-grade-one-$suffix", title = "函数单调性-$suffix", body = "已知函数在定义域上递增，比较两个函数值的大小。", grade = "高一", knowledge = "函数单调性", difficulty = "基础", kind = "选择题", reviewed = true)
        val second = Question(id = "round-grade-two-$suffix", title = "数列求和-$suffix", body = "已知等差数列的首项与公差，求前十项和。", grade = "高二", knowledge = "等差数列、数列求和", difficulty = "进阶", reviewed = true)
        val original = app.settings.state.value.theme
        runBlocking { dao.save(first); dao.save(second) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNode(hasSetTextAction()).performTextInput(suffix)
            compose.onNodeWithTag("glide-select-grade").performClick()
            compose.onNodeWithTag("glide-option-grade-高三").assertExists()
            snapshot("grade-menu-light-0.19.0.png")
            compose.onNodeWithTag("glide-option-grade-高一").performClick()
            compose.onNodeWithTag("glide-menu-grade").assertDoesNotExist()
            compose.onNodeWithTag("library-question-${first.id}").assertExists()
            compose.onNodeWithTag("library-question-${second.id}").assertDoesNotExist()
            compose.onNodeWithTag("glide-select-grade").performClick()
            compose.onNodeWithTag("glide-option-grade-高一").assertIsSelected()
            Espresso.pressBack()
            compose.onNodeWithTag("library-filter-reset").performClick()
            compose.onNodeWithTag("library-question-${second.id}").assertExists()
            compose.onNodeWithTag("glide-select-kind").performClick()
            compose.onNodeWithTag("glide-option-kind-选择题").assertExists()
            compose.onNodeWithTag("glide-option-kind-选择题").performClick()
            compose.onNodeWithTag("glide-menu-kind").assertDoesNotExist()
            compose.onNodeWithTag("library-question-${first.id}").assertExists()
            compose.onNodeWithTag("library-question-${second.id}").assertDoesNotExist()
            compose.onNodeWithTag("library-filter-reset").performClick()
            compose.onNodeWithTag("library-question-${second.id}").assertExists()
            compose.onNodeWithTag("library-menu-${first.id}").performClick()
            snapshot("question-menu-light-0.19.0.png")
            Espresso.pressBack()
            compose.onNodeWithTag("library-action-menu-${first.id}").assertDoesNotExist()
            compose.onNodeWithTag("question-editor").assertDoesNotExist()
            compose.onNodeWithTag("library-menu-${first.id}").performClick()
            compose.onNodeWithTag("library-favorite-${first.id}").performClick()
            compose.waitUntil(5_000) { runBlocking { dao.question(first.id)?.favorite == true } }
            app.settings.setTheme(ThemeMode.DARK)
            compose.onNodeWithTag("glide-select-grade").performClick()
            compose.onNodeWithTag("glide-option-grade-高一").assertIsNotSelected()
            snapshot("grade-menu-dark-0.19.0.png")
            Espresso.pressBack()
            compose.onNodeWithTag("library-menu-${first.id}").performClick()
            compose.onNodeWithTag("library-favorite-${first.id}").assert(hasText("取消收藏"))
            snapshot("question-menu-dark-0.19.0.png")
            compose.onNodeWithTag("library-favorite-${first.id}").performClick()
            compose.waitUntil(5_000) { runBlocking { dao.question(first.id)?.favorite == false } }
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteQuestion(first.id); dao.deleteQuestion(second.id) } }
    }

    @Test fun createDialogRejectsBlankNamesSupportsKeyboardConfirmationAndCancellation() {
        val suffix = UUID.randomUUID().toString().take(6)
        val title = "函数与导数复习-$suffix"
        val original = app.settings.state.value.theme
        val before = runBlocking { dao.collections().first().size }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithContentDescription("创建题集").performClick()
            compose.onNodeWithTag("create-collection-confirm").assertIsNotEnabled()
            compose.onNodeWithTag("collection-name").performTextInput("   ")
            compose.onNodeWithTag("create-collection-confirm").assertIsNotEnabled()
            compose.onNodeWithTag("create-collection-cancel").performClick()
            compose.onNodeWithTag("create-collection-dialog").assertDoesNotExist()
            assertEquals(before, runBlocking { dao.collections().first().size })
            compose.onNodeWithContentDescription("创建题集").performClick()
            snapshot("create-dialog-light-0.19.0.png")
            compose.onNodeWithTag("collection-name").performClick().performTextInput("  $title  ")
            compose.onNodeWithTag("create-collection-confirm").assertIsEnabled().assertIsDisplayed()
            compose.onNodeWithTag("create-collection-cancel").assertIsDisplayed()
            snapshot("create-dialog-keyboard-0.19.0.png")
            compose.onNodeWithTag("collection-name").performImeAction()
            compose.onNodeWithTag("create-collection-dialog").assertDoesNotExist()
            compose.waitUntil(5_000) { runBlocking { dao.collections().first().count { it.title == title } == 1 } }
            compose.onNodeWithText(title).assertExists()
            app.settings.setTheme(ThemeMode.DARK)
            compose.onNodeWithContentDescription("创建题集").performClick()
            val titleLayouts = mutableListOf<TextLayoutResult>()
            compose.onNode(hasText("创建题集") and hasAnyAncestor(hasTestTag("create-collection-dialog")), useUnmergedTree = true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(titleLayouts) }
            assertTrue("Dark dialog title has a readable light text color", titleLayouts.single().layoutInput.style.color.luminance() > .6f)
            snapshot("create-dialog-dark-0.19.0.png")
            compose.onNodeWithTag("collection-name").performTextInput("取消验证-$suffix")
            compose.onNodeWithTag("create-collection-cancel").performClick()
            compose.onNodeWithTag("create-collection-dialog").assertDoesNotExist()
            assertEquals(before + 1, runBlocking { dao.collections().first().size })
            compose.onNodeWithContentDescription("创建题集").performClick()
            Espresso.pressBack()
            // Reopening during IME dismissal can leave the keyboard visible; native Back hides it first.
            if (compose.onAllNodesWithTag("create-collection-dialog").fetchSemanticsNodes().isNotEmpty()) Espresso.pressBack()
            compose.waitUntil(5_000) { compose.onAllNodesWithTag("create-collection-dialog").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("create-collection-dialog").assertDoesNotExist()
        } finally {
            app.settings.setTheme(original)
            runBlocking { dao.collections().first().filter { it.title == title || it.title == "取消验证-$suffix" }.forEach { dao.deleteCollection(it.id) } }
        }
    }

    @Test fun collectionMenuPreservesDisabledReorderingAndRemovalKeepsOriginal() {
        val suffix = UUID.randomUUID().toString().take(6)
        val first = Question(id = "round-move-one-$suffix", title = "函数综合练习-$suffix", body = "求函数的定义域与单调区间。", grade = "高一", knowledge = "函数定义域、函数单调性", difficulty = "进阶", reviewed = true)
        val second = Question(id = "round-move-two-$suffix", title = "导数综合练习-$suffix", body = "利用导数求函数的极值。", grade = "高三", knowledge = "导数与极值", difficulty = "挑战", reviewed = true)
        val collection = QuestionCollection(title = "圆角菜单验证-$suffix")
        val original = app.settings.state.value.theme
        runBlocking { dao.save(first); dao.save(second); dao.save(collection); dao.addQuestions(collection.id, listOf(first.id, second.id)) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithTag("collection-menu-${first.id}").performClick()
            compose.onNodeWithTag("collection-move-up-${first.id}").assertIsNotEnabled()
            compose.onNodeWithTag("collection-move-down-${first.id}").assertIsEnabled()
            snapshot("collection-menu-light-0.19.0.png")
            compose.onNodeWithTag("collection-move-down-${first.id}").performClick()
            compose.waitUntil(5_000) { runBlocking { dao.orderedItems(collection.id).map { it.questionId } == listOf(second.id, first.id) } }
            app.settings.setTheme(ThemeMode.DARK)
            compose.onNodeWithTag("collection-menu-${first.id}").performClick()
            compose.onNodeWithTag("collection-move-down-${first.id}").assertIsNotEnabled()
            compose.onNodeWithTag("collection-move-up-${first.id}").assertIsEnabled()
            snapshot("collection-menu-dark-0.19.0.png")
            compose.onNodeWithTag("collection-remove-${first.id}").performClick()
            compose.waitUntil(5_000) { runBlocking { dao.orderedItems(collection.id).size == 1 } }
            assertNotNull(runBlocking { dao.question(first.id) })
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(first.id); dao.deleteQuestion(second.id) } }
    }

    @Test fun deleteCollectionDialogCancelsAndConfirmsWithoutRemovingLibraryQuestionsInBothThemes() {
        val suffix = UUID.randomUUID().toString().take(6)
        val question = Question(title = "保留原题-$suffix", body = "求函数的定义域。", reviewed = true)
        val collections = listOf("白天", "黑夜").map { QuestionCollection(title = "$it：函数与导数阶段复习、错题整理和综合练习-$suffix") }
        val original = app.settings.state.value.theme
        runBlocking { dao.save(question); collections.forEach { dao.save(it); dao.addToCollection(it.id, question.id) } }
        try {
            compose.onNodeWithTag("nav-collections").performClick()
            for((index, theme) in listOf(ThemeMode.LIGHT, ThemeMode.DARK).withIndex()) {
                val collection = collections[index]
                app.settings.setTheme(theme)
                compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-delete-${collection.id}"))
                compose.onNodeWithTag("collection-delete-${collection.id}").performClick()
                compose.onNodeWithTag("collection-delete-dialog").assertIsDisplayed()
                compose.onNodeWithTag("collection-delete-name", useUnmergedTree = true).assertTextEquals(collection.title)
                compose.onNodeWithText("题库中的题目会保留。").assertIsDisplayed()
                compose.onNodeWithTag("collection-delete-cancel").assertHeightIsEqualTo(52.dp)
                compose.onNodeWithTag("collection-delete-confirm").assertHasClickAction()
                snapshot("collection-delete-dialog-${if(theme == ThemeMode.DARK) "dark" else "light"}-0.19.0.png")
                compose.onNodeWithTag("collection-delete-cancel").performClick()
                compose.onNodeWithTag("collection-delete-dialog").assertDoesNotExist()
                assertEquals(listOf(question.id), runBlocking { dao.orderedItems(collection.id).map { it.questionId } })
                compose.onNodeWithTag("collection-delete-${collection.id}").performClick()
                compose.onNodeWithTag("collection-delete-dialog").assertIsDisplayed()
                Espresso.pressBack()
                compose.waitUntil(5_000) { compose.onAllNodesWithTag("collection-delete-dialog").fetchSemanticsNodes().isEmpty() }
                assertTrue(runBlocking { dao.collections().first().any { it.id == collection.id } })
                compose.onNodeWithTag("nav-collections").assertIsSelected()
                compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-card-${collection.id}"))
                compose.onNodeWithTag("collection-card-${collection.id}").assertExists()
                compose.onNodeWithTag("collection-delete-${collection.id}").performClick()
                compose.onNodeWithTag("collection-delete-confirm").performClick()
                compose.waitUntil(5_000) { runBlocking { dao.collections().first().none { it.id == collection.id } } }
                assertTrue(runBlocking { dao.orderedItems(collection.id).isEmpty() })
                assertNotNull(runBlocking { dao.question(question.id) })
            }
        } finally { app.settings.setTheme(original); runBlocking { collections.forEach { dao.deleteCollection(it.id) }; dao.deleteQuestion(question.id) } }
    }

    @Test fun flatExportPopupKeepsFormatsAndDismissalInBothThemes() {
        val suffix = UUID.randomUUID().toString().take(6)
        val question = Question(title = "导出菜单原题-$suffix", body = "求函数的值。", reviewed = true)
        val collection = QuestionCollection(title = "导出格式选择-$suffix")
        val original = app.settings.state.value.theme
        runBlocking { dao.save(question); dao.save(collection); dao.addToCollection(collection.id, question.id) }
        try {
            compose.onNodeWithTag("nav-collections").performClick()
            for(theme in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-export-${collection.id}"))
                compose.onNodeWithTag("collection-export-${collection.id}").performClick()
                compose.onNodeWithTag("collection-export-menu-${collection.id}").assertIsDisplayed()
                compose.onNodeWithTag("collection-export-pdf-${collection.id}").assertIsEnabled()
                compose.onNodeWithTag("collection-export-word-${collection.id}").assertIsEnabled()
                snapshot("collection-export-popup-${if(theme == ThemeMode.DARK) "dark" else "light"}-0.19.0.png")
                assertTrue(InstrumentationRegistry.getInstrumentation().uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK))
                compose.waitUntil(5_000) { compose.onAllNodesWithTag("collection-export-menu-${collection.id}").fetchSemanticsNodes().isEmpty() }
                compose.onNodeWithTag("collection-card-${collection.id}").assertIsDisplayed()
                compose.onNodeWithTag("collection-screen").assertDoesNotExist()
                assertEquals(listOf(question.id), runBlocking { dao.orderedItems(collection.id).map { it.questionId } })
            }
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(question.id) } }
    }
}
