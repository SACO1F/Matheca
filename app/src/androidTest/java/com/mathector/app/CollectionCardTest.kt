package com.mathector.app

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class CollectionCardTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private fun bounds(tag: String) = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    private fun views(view: View): List<WebView> = when(view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { views(view.getChildAt(it)) }
        else -> emptyList()
    }
    private fun mathReady(dark: Boolean): Boolean {
        val latch = CountDownLatch(1)
        var valid = true
        val color = if(dark) "rgb(232, 232, 232)" else "rgb(38, 38, 38)"
        compose.runOnUiThread {
            val mathViews = views(compose.activity.window.decorView).filter { it.isShown && (it.tag as? String)?.contains("已知等差数列") == true }
            if(mathViews.isEmpty()) { valid = false; latch.countDown() }
            else {
                val remaining = AtomicInteger(mathViews.size)
                mathViews.forEach { view -> view.evaluateJavascript("document.fonts.status==='loaded' && getComputedStyle(document.body).color==='$color' && document.querySelectorAll('.katex').length===2 && document.querySelectorAll('.katex-error').length===0") {
                    if(it != "true") valid = false
                    if(remaining.decrementAndGet() == 0) latch.countDown()
                } }
            }
        }
        return latch.await(2, TimeUnit.SECONDS) && valid
    }
    private fun snapshot(name: String, dark: Boolean = false) {
        compose.waitUntil(15_000) { mathReady(dark) }
        compose.mainClock.advanceTimeBy(5_000)
        compose.waitUntil(30_000) { compose.onAllNodes(hasText("已添加", substring = true)).fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }
    @Test fun matchingCardsRetainMathAndMetadataWithFixedFloatingAddAndWorkingActions() {
        val suffix = UUID.randomUUID().toString().take(6)
        val q = Question(id = "shared-card-$suffix", title = "等差数列综合练习-$suffix",
            body = "已知等差数列 \\(a_n=2n+1\\)。\n（1）求前 10 项和；\n（2）求满足 \\(S_n>100\\) 的最小正整数 n。",
            grade = "高二", knowledge = "等差数列、数列求和", difficulty = "进阶", reviewed = true)
        val collection = QuestionCollection(title = "卡片与悬浮按钮-$suffix")
        val extra = (1..8).map { n -> q.copy(id = "collection-extra-$n-$suffix", title = "数列练习 $n", knowledge = "数列求和", difficulty = if(n % 2 == 0) "挑战" else "基础") }
        val originalTheme = app.settings.state.value.theme
        runBlocking { dao.save(q); extra.forEach { dao.save(it) }; dao.save(collection) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithText("题集", useUnmergedTree = true).performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithTag("collection-add-floating").assertIsDisplayed().assertHeightIsEqualTo(52.dp).performClick()
            compose.onNodeWithTag("picker-search").performTextInput(suffix)
            androidx.test.espresso.Espresso.closeSoftKeyboard()
            compose.onNodeWithTag("picker-list").performScrollToNode(hasTestTag("picker-question-${q.id}"))
            compose.onNodeWithTag("picker-question-${q.id}").performClick()
            val pickerGrade = bounds("picker-grade-${q.id}")
            val pickerDifficulty = bounds("picker-difficulty-${q.id}")
            val pickerPoint = bounds("picker-knowledge-${q.id}-数列求和")
            assertEquals("Common metadata fits one row", pickerGrade.top, pickerDifficulty.top, 1f)
            assertEquals("Knowledge shares the compact metadata row", pickerGrade.top, pickerPoint.top, 1f)
            val pickerTagHeight = bounds("picker-tags-${q.id}").height
            assertTrue(bounds("picker-tags-${q.id}").bottom <= bounds("picker-math-${q.id}").top)
            compose.onNodeWithTag("picker-confirm").performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).size == 1 } }
            compose.onNodeWithTag("collection-grade-${q.id}", useUnmergedTree = true).assertTextEquals("高二")
            compose.onNodeWithTag("collection-difficulty-${q.id}", useUnmergedTree = true).assertTextEquals("进阶")
            compose.onNodeWithTag("collection-knowledge-${q.id}-等差数列", useUnmergedTree = true).assertTextEquals("等差数列")
            compose.onNodeWithTag("collection-knowledge-${q.id}-数列求和", useUnmergedTree = true).assertExists()
            assertEquals("Both views use the same compact tag height", pickerTagHeight, bounds("collection-tags-${q.id}").height, 1f)
            assertTrue(bounds("collection-tags-${q.id}").bottom <= bounds("collection-math-${q.id}").top)
            compose.onNodeWithTag("collection-math-${q.id}", useUnmergedTree = true).assertContentDescriptionEquals(MathContent.preview(q))
            compose.onNodeWithTag("collection-detail", useUnmergedTree = true).performScrollToNode(hasTestTag("collection-space-${q.id}"))
            compose.onNodeWithTag("collection-space-${q.id}", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("collection-newpage-${q.id}").assertIsOff().performClick()
            compose.waitUntil(5_000) { runBlocking { dao.orderedItems(collection.id).first { it.questionId == q.id }.newPage } }
            compose.onNodeWithTag("glide-select-space-${q.id}").performClick()
            compose.onNodeWithTag("glide-option-space-${q.id}-80").performScrollTo().performClick()
            compose.waitUntil(5_000) { runBlocking { dao.orderedItems(collection.id).first { it.questionId == q.id }.solutionSpace == 80 } }
            compose.onNodeWithTag("collection-detail", useUnmergedTree = true).performScrollToIndex(0)
            runBlocking { dao.addQuestions(collection.id, extra.map { it.id }) }
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).size == 9 } }
            snapshot("collection-cards-light-0.18.0.png")
            val floatingBefore = bounds("collection-add-floating")
            val screen = bounds("collection-screen")
            assertTrue("The add action belongs at the bottom right", floatingBefore.center.x > screen.center.x && floatingBefore.center.y > screen.center.y)
            compose.onNodeWithTag("collection-menu-${q.id}").performClick()
            compose.onNodeWithTag("collection-move-up-${q.id}").assertIsNotEnabled()
            compose.onNodeWithTag("collection-move-down-${q.id}").performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).first().questionId == extra.first().id } }
            compose.onNodeWithTag("collection-menu-${q.id}").performClick()
            compose.onNodeWithTag("collection-move-up-${q.id}").performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).first().questionId == q.id } }
            compose.onNodeWithTag("collection-menu-${extra.first().id}").performClick()
            compose.onNodeWithTag("collection-remove-${extra.first().id}").performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).size == 8 } }
            assertNotNull("Removing from a collection keeps the library question", runBlocking { dao.question(extra.first().id) })
            compose.onNodeWithTag("question-editor").assertDoesNotExist()
            compose.onNodeWithTag("collection-math-${q.id}", useUnmergedTree = true).performTouchInput { click() }
            compose.onNodeWithTag("question-editor").assertExists()
            compose.onNodeWithTag("question-editor").performScrollToNode(hasText("题干与子题"))
            compose.onNodeWithText("题干与子题").assert(hasText("a_n=2n+1", substring = true))
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithTag("collection-detail", useUnmergedTree = true).performScrollToNode(hasTestTag("export-word"))
            repeat(2) { compose.onNodeWithTag("collection-detail", useUnmergedTree = true).performTouchInput { swipeUp() } }
            compose.onNodeWithTag("collection-add-floating").assertHeightIsEqualTo(52.dp).assertIsDisplayed()
            val floatingAfter = bounds("collection-add-floating")
            assertEquals("Scrolling must not move the add action", floatingBefore.top, floatingAfter.top, 1f)
            assertEquals(floatingBefore.left, floatingAfter.left, 1f)
            compose.onNodeWithTag("export-word").assertIsDisplayed().assertIsEnabled()
            assertTrue("Bottom content has clearance above the floating action", bounds("export-word").bottom < floatingAfter.top)
            snapshot("collection-bottom-light-0.18.0.png")
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("question-picker").assertIsDisplayed()
            compose.onNodeWithContentDescription("关闭选题").performClick()
            compose.onNodeWithTag("collection-detail", useUnmergedTree = true).performScrollToIndex(0)
            compose.onNodeWithContentDescription("返回").assertIsDisplayed()
            app.settings.setTheme(ThemeMode.DARK)
            compose.waitUntil(5000) { app.settings.state.value.theme == ThemeMode.DARK }
            snapshot("collection-cards-dark-0.18.0.png", dark = true)
            compose.onNodeWithTag("collection-add-floating").assertIsDisplayed().performClick()
            compose.onNodeWithContentDescription("关闭选题").performClick()
        } finally {
            app.settings.setTheme(originalTheme)
            runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(q.id); extra.forEach { dao.deleteQuestion(it.id) } }
        }
    }
}
