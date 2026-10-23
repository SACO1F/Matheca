package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LibraryQuestionDeleteTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = compose.activity.application as MathectorApplication
    private val dao get() = app.database.dao()

    private fun capture(name: String) {
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try {
            File(app.getExternalFilesDir(null), "question-delete").apply { mkdirs() }.resolve(name).outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } finally { bitmap.recycle() }
    }

    @Test fun lightMenuCancellationAndConfirmedDeletionPreserveOtherQuestions() = checkDeletion(ThemeMode.LIGHT)
    @Test fun darkMenuCancellationAndConfirmedDeletionPreserveOtherQuestions() = checkDeletion(ThemeMode.DARK)

    private fun checkDeletion(theme: ThemeMode) {
        val prefix = "delete-${UUID.randomUUID()}"
        val target = Question(id = "$prefix-target", title = "删除确认验证", body = "已知函数 f(x) = x²，求 f(2) 的值。", favorite = true)
        val other = Question(id = "$prefix-other", title = "保留题目", body = "求等差数列的前十项和。")
        val collection = QuestionCollection(id = "$prefix-collection", title = "删除关联验证题集")
        val originalTheme = app.settings.state.value.theme
        runBlocking {
            dao.save(target); dao.save(other); dao.save(collection)
            dao.add(CollectionItem(collection.id, target.id, 0)); dao.add(CollectionItem(collection.id, other.id, 1))
        }
        try {
            app.settings.setTheme(theme)
            val list = compose.onNodeWithTag("library-list")
            fun openDeletion() {
                list.performScrollToNode(hasTestTag("library-question-${target.id}"))
                compose.onNodeWithTag("library-menu-${target.id}").performClick()
                compose.onNodeWithTag("library-favorite-${target.id}").assertTextEquals("取消收藏")
                compose.onNodeWithTag("library-add-${target.id}").assertIsDisplayed()
                compose.onNodeWithTag("library-delete-${target.id}").assertIsDisplayed()
                capture("menu-${theme.name.lowercase()}.png")
                compose.onNodeWithTag("library-delete-${target.id}").performClick()
                compose.onNodeWithTag("library-action-menu-${target.id}").assertDoesNotExist()
                compose.onNodeWithTag("question-editor").assertDoesNotExist()
                compose.onNodeWithTag("question-delete-dialog").assertIsDisplayed()
                compose.onNodeWithText("删除这道题？").assertIsDisplayed()
                compose.onNodeWithText("题目会从题库和相关题集中移除，此操作无法撤销。").assertIsDisplayed()
            }
            openDeletion()
            capture("dialog-${theme.name.lowercase()}.png")
            compose.onNodeWithTag("question-delete-cancel").performClick()
            compose.onNodeWithTag("question-delete-dialog").assertDoesNotExist()
            assertNotNull(runBlocking { dao.question(target.id) })
            assertEquals(2, runBlocking { dao.backupItems().count { it.collectionId == collection.id } })
            openDeletion()
            Espresso.pressBack()
            compose.onNodeWithTag("question-delete-dialog").assertDoesNotExist()
            assertNotNull(runBlocking { dao.question(target.id) })
            openDeletion()
            compose.onNodeWithTag("question-delete-confirm").performClick()
            compose.waitUntil(10_000) { runBlocking { dao.question(target.id) == null } }
            compose.onNodeWithTag("question-delete-dialog").assertDoesNotExist()
            compose.onNodeWithTag("library-question-${target.id}").assertDoesNotExist()
            assertNotNull(runBlocking { dao.question(other.id) })
            assertTrue(runBlocking { dao.backupCollections().any { it.id == collection.id } })
            assertEquals(listOf(other.id), runBlocking { dao.backupItems().filter { it.collectionId == collection.id }.map { it.questionId } })
        } finally {
            app.settings.setTheme(originalTheme)
            runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(target.id); dao.deleteQuestion(other.id) }
        }
    }
}
