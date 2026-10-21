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

@RunWith(AndroidJUnit4::class)
class UiMotionTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private fun bounds(tag: String) = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    private fun snapshot(name: String) {
        compose.waitForIdle()
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }
    private fun views(view: View): List<WebView> = when(view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { views(view.getChildAt(it)) }
        else -> emptyList()
    }
    private fun mathReady(dark: Boolean): Boolean {
        val latch = CountDownLatch(1)
        var valid = false
        val color = if(dark) "rgb(237, 241, 248)" else "rgb(24, 37, 57)"
        compose.runOnUiThread {
            val view = views(compose.activity.window.decorView).firstOrNull { (it.tag as? String)?.contains("紧凑卡片验证") == true }
            if(view == null) latch.countDown() else view.evaluateJavascript("document.fonts.status==='loaded' && getComputedStyle(document.body).color==='$color' && document.querySelectorAll('.katex').length===1 && document.querySelectorAll('.katex-error').length===0") {
                valid = it == "true"; latch.countDown()
            }
        }
        return latch.await(2, TimeUnit.SECONDS) && valid
    }

    @Test fun libraryUsesCollectionLayoutWithWorkingCompactMenuAndDarkMath() {
        val suffix = UUID.randomUUID().toString().take(6)
        val q = Question(id = "compact-library-$suffix", title = "等差数列练习-$suffix",
            body = "紧凑卡片验证：已知数列 \\(a_n=2n+1\\)，求前 10 项和。", grade = "高二", knowledge = "等差数列、数列求和", difficulty = "进阶", reviewed = true)
        val collection = QuestionCollection(title = "题库卡片验证-$suffix")
        val originalTheme = app.settings.state.value.theme
        runBlocking { dao.save(q); dao.save(collection) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${q.id}"))
            compose.waitUntil(10_000) { mathReady(false) }
            compose.waitForIdle()
            compose.onNodeWithTag("library-grade-${q.id}", useUnmergedTree = true).assertTextEquals("高二")
            compose.onNodeWithTag("library-difficulty-${q.id}", useUnmergedTree = true).assertTextEquals("进阶")
            compose.onNodeWithTag("library-knowledge-${q.id}-等差数列", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("library-knowledge-${q.id}-数列求和", useUnmergedTree = true).assertExists()
            assertTrue(bounds("library-tags-${q.id}").bottom <= bounds("library-math-${q.id}").top)
            val libraryHeight = bounds("library-question-${q.id}").height
            snapshot("library-compact-light-0.10.0.png")
            compose.onNodeWithTag("library-menu-${q.id}").performClick()
            compose.onNodeWithTag("library-favorite-${q.id}").performClick()
            compose.waitUntil(5000) { runBlocking { dao.question(q.id)?.favorite == true } }
            compose.onNodeWithTag("question-editor").assertDoesNotExist()
            compose.onNodeWithTag("library-menu-${q.id}").performClick()
            compose.onNodeWithTag("library-favorite-${q.id}").assert(hasText("取消收藏")).performClick()
            compose.waitUntil(5000) { runBlocking { dao.question(q.id)?.favorite == false } }
            compose.onNodeWithTag("library-menu-${q.id}").performClick()
            compose.onNodeWithTag("library-add-${q.id}").performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).size == 1 } }
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.waitUntil(10_000) { mathReady(false) }
            compose.waitForIdle()
            assertEquals("Library and collection cards share the same height", libraryHeight, bounds("collection-question-${q.id}").height, 1f)
            compose.onNodeWithTag("collection-math-${q.id}", useUnmergedTree = true).performTouchInput { click() }
            compose.onNodeWithTag("question-editor").assertExists()
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithTag("nav-library").performClick()
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${q.id}"))
            app.settings.setTheme(ThemeMode.DARK)
            compose.waitUntil(10_000) { mathReady(true) }
            compose.mainClock.advanceTimeBy(5_000)
            snapshot("library-compact-dark-0.10.0.png")
            compose.onNodeWithTag("library-math-${q.id}", useUnmergedTree = true).performTouchInput { click() }
            compose.onNodeWithTag("question-editor").assertExists()
        } finally {
            app.settings.setTheme(originalTheme)
            runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(q.id) }
        }
    }

    @Test fun navigationIndicatorSlidesBetweenTabsAndCanReverseWhileMoving() {
        compose.onNodeWithTag("floating-navigation").assertHeightIsEqualTo(52.dp)
        compose.onNodeWithTag("nav-library").assertIsSelected()
        val start = bounds("navigation-indicator").left
        val destination = bounds("nav-profile").left
        compose.mainClock.autoAdvance = false
        try {
            compose.onNodeWithTag("nav-profile").performClick()
            compose.mainClock.advanceTimeByFrame()
            compose.mainClock.advanceTimeBy(64)
            val middle = bounds("navigation-indicator").left
            assertTrue("Highlight moves through an intermediate position", middle > start + 1f && middle < destination - 1f)
            snapshot("navigation-sliding-0.10.0.png")
            compose.mainClock.advanceTimeBy(1_000)
            assertEquals(destination, bounds("navigation-indicator").left, 1f)
            compose.onNodeWithTag("nav-profile").assertIsSelected()
            compose.onNodeWithTag("nav-library").performClick()
            compose.mainClock.advanceTimeByFrame()
            compose.mainClock.advanceTimeBy(64)
            compose.onNodeWithTag("nav-collections").performClick()
            compose.mainClock.advanceTimeBy(1_000)
            compose.onNodeWithTag("nav-collections").assertIsSelected()
            compose.onNodeWithTag("nav-library").assertIsNotSelected()
            compose.onNodeWithTag("nav-profile").assertIsNotSelected()
            assertEquals(bounds("nav-collections").left, bounds("navigation-indicator").left, 1f)
        } finally { compose.mainClock.autoAdvance = true }
        compose.onNodeWithText("我的题集").assertExists()
        snapshot("navigation-settled-0.10.0.png")
    }

    @Test fun pickerCrossSlidesDownBeforeRemovalAndDropsUnconfirmedSelection() {
        val suffix = UUID.randomUUID().toString().take(6)
        val q = Question(id = "close-motion-$suffix", title = "收回选题验证-$suffix", body = "求函数的最大值。", grade = "高一", difficulty = "基础", knowledge = "函数最值", reviewed = true)
        val collection = QuestionCollection(title = "收回动效验证-$suffix")
        runBlocking { dao.save(q); dao.save(collection) }
        try {
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("picker-list").performScrollToNode(hasTestTag("picker-question-${q.id}"))
            compose.onNodeWithTag("picker-question-${q.id}").performClick()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 1 道")
            val before = bounds("question-picker").top
            snapshot("picker-close-open-0.10.0.png")
            compose.mainClock.autoAdvance = false
            try {
                compose.onNodeWithTag("picker-close").performClick()
                compose.mainClock.advanceTimeByFrame()
                compose.mainClock.advanceTimeBy(64)
                compose.onNodeWithTag("question-picker").assertExists()
                compose.onNodeWithTag("picker-close").assertIsNotEnabled()
                assertTrue("Sheet moves down while remaining composed", bounds("question-picker").top > before + 1f)
                snapshot("picker-close-sliding-0.10.0.png")
                compose.mainClock.advanceTimeBy(1_000)
            } finally { compose.mainClock.autoAdvance = true }
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("question-picker").fetchSemanticsNodes().isEmpty() }
            assertTrue(runBlocking { dao.orderedItems(collection.id).isEmpty() })
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("picker-selected-count").assertTextEquals("已选 0 道")
            androidx.test.espresso.Espresso.pressBack()
            compose.onNodeWithTag("question-picker").assertDoesNotExist()
            compose.onNodeWithTag("collection-screen").assertExists()
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("picker-search").performTextInput(suffix)
            compose.onNodeWithTag("picker-close").performClick()
            compose.onNodeWithTag("question-picker").assertDoesNotExist()
            compose.onNodeWithTag("collection-screen").assertExists()
        } finally { runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(q.id) } }
    }
}
