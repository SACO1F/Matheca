package com.mathector.app

import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import com.mathector.app.ui.mathecaPalette
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
class MathecaAppearanceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private fun webViews(view: View): List<WebView> = when(view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { webViews(view.getChildAt(it)) }
        else -> emptyList()
    }
    private fun fixtureMathReady(): Boolean {
        var ready = false
        val latch = CountDownLatch(1)
        compose.runOnUiThread {
            val view = webViews(compose.activity.window.decorView).firstOrNull { (it.tag as? String)?.contains("求其单调区间") == true }
            val color = if(app.settings.state.value.theme == ThemeMode.DARK) "rgb(232, 232, 232)" else "rgb(38, 38, 38)"
            if(view == null) latch.countDown() else view.evaluateJavascript("document.fonts.status==='loaded' && document.querySelectorAll('.katex').length===1 && getComputedStyle(document.body).color==='$color'") {
                if(it != "true") latch.countDown() else {
                    view.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                        override fun onComplete(requestId: Long) {
                            view.postOnAnimation { view.postOnAnimation { ready = true; latch.countDown() } }
                        }
                    })
                    view.postInvalidateOnAnimation()
                }
            }
        }
        latch.await(1, TimeUnit.SECONDS)
        return ready
    }
    private fun snapshot(name: String) {
        if(name.startsWith("library-")) compose.waitUntil(10_000) { fixtureMathReady() }
        compose.waitForIdle()
        val image = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, "$name-0.22.0.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { image.recycle() }
    }
    private fun textColor(tag: String): androidx.compose.ui.graphics.Color {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithTag(tag, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        return layouts.single().layoutInput.style.color
    }
    private fun revealChoice(accent: AccentTheme) {
        val tag = "accent-${accent.name}"
        compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag(tag))
        val choice = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        val navigation = compose.onNodeWithTag("floating-navigation").fetchSemanticsNode().boundsInRoot
        if(choice.bottom > navigation.top) {
            compose.onNodeWithTag("settings-list").performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, choice.bottom - navigation.top + 24f) }
        }
        assertTrue("Choice clears the floating navigation", compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot.bottom <= navigation.top)
    }

    @Test fun accentsPersistIndependentlyOfDayNightAndExistingSettings() {
        val name = "appearance-${UUID.randomUUID()}"
        val prefs = app.getSharedPreferences(name, Context.MODE_PRIVATE)
        try {
            prefs.edit().putString("address", "https://example.invalid/v1").putString("model", "fixture").putBoolean("autoSolveImports", true).commit()
            val store = SettingsStore(app, name)
            assertEquals(AccentTheme.GRAPHITE, store.state.value.accent)
            for(accent in AccentTheme.entries) {
                store.setTheme(ThemeMode.DARK)
                store.setAccent(accent)
                val read = SettingsStore(app, name).state.value
                assertEquals(accent, read.accent)
                assertEquals(ThemeMode.DARK, read.theme)
                assertEquals("fixture", read.model)
                assertEquals("https://example.invalid/v1", read.address)
                assertTrue(read.autoSolveImports)
            }
            prefs.edit().putString("accent", "UNKNOWN_FUTURE_COLOR").commit()
            assertEquals(AccentTheme.GRAPHITE, SettingsStore(app, name).state.value.accent)
        } finally { prefs.edit().clear().commit() }
    }

    @Test fun unifiedBackupFormatAlsoAcceptsLegacyMathectorManifests() {
        val q = Question(title = "兼容性验证", body = "求函数的单调区间。", reviewed = true)
        val data = LibraryBackupData(listOf(q), emptyList(), emptyList(), emptyList(), emptyMap(), emptySet(), 0)
        val manifest = org.json.JSONObject(String(LibraryBackupCodec.encode(data), Charsets.UTF_8))
        assertEquals("MathecaLibraryBackup", manifest.getString("format"))
        assertEquals(q.body, LibraryBackupCodec.decode(manifest.toString()).questions.single().body)
        manifest.put("format", "MathectorLibraryBackup")
        val legacy = LibraryBackupCodec.decode(manifest.toString()).questions.single()
        assertEquals(q.id, legacy.id)
        assertEquals(q.body, legacy.body)
        assertTrue(legacy.reviewed)
    }

    @Test fun settingsAndLibraryRenderAllFourAccentsInBothModes() {
        val original = app.settings.state.value
        val q = Question(title = "函数与单调性", body = "已知函数 \\(f(x)=x^2-2x\\)，求其单调区间。", grade = "高一", difficulty = "基础", knowledge = "函数单调性", reviewed = true)
        runBlocking { app.database.dao().save(q) }
        try {
            for(mode in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(mode)
                for(accent in AccentTheme.entries) {
                    compose.onNodeWithTag("nav-profile").performClick()
                    compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("accent-${accent.name}"))
                    compose.onNodeWithTag("accent-${accent.name}").performClick()
                    compose.waitUntil(5000) { app.settings.state.value.accent == accent }
                    compose.onNodeWithTag("accent-${accent.name}").assertIsSelected()
                    assertTrue(compose.onNodeWithTag("accent-${accent.name}").fetchSemanticsNode().boundsInRoot.height >= 48f * compose.activity.resources.displayMetrics.density - 1)
                    if(accent == AccentTheme.GRAPHITE) snapshot("appearance-${mode.name.lowercase()}")
                    compose.onNodeWithTag("nav-library").performClick()
                    compose.onNodeWithTag("library-list").performScrollToIndex(0)
                    val expected = mathecaPalette(accent, mode == ThemeMode.DARK).scheme
                    assertEquals(expected.onSurface, textColor("library-stat-total-number"))
                    assertEquals(expected.onSurfaceVariant, textColor("library-stat-total-label"))
                    snapshot("library-${accent.name.lowercase()}-${mode.name.lowercase()}")
                }
            }
        } finally { app.settings.setTheme(original.theme); app.settings.setAccent(original.accent); runBlocking { app.database.dao().deleteQuestion(q.id) } }
    }

    @Test fun accentMenusAndCollectionActionsPreserveSelectionAndDismissal() {
        val original = app.settings.state.value
        val q = Question(title = "等差数列练习", body = "已知 \\(a_n=2n+1\\)，求前十项和。", grade = "高二", knowledge = "等差数列", difficulty = "进阶", reviewed = false)
        val c = QuestionCollection(title = "配色验证-${UUID.randomUUID().toString().take(4)}")
        runBlocking { app.database.dao().save(q); app.database.dao().save(c); app.database.dao().addToCollection(c.id, q.id) }
        try {
            for(mode in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(mode)
                app.settings.setAccent(if(mode == ThemeMode.LIGHT) AccentTheme.CLAY else AccentTheme.BLUE)
                compose.onNodeWithTag("nav-collections").performClick()
                compose.onNodeWithText(c.title).performClick()
                compose.onNodeWithTag("collection-add-floating").assertIsDisplayed().performClick()
                compose.onNodeWithTag("picker-filter-grade").performClick()
                snapshot("picker-menu-${mode.name.lowercase()}")
                compose.onNodeWithTag("picker-option-grade-高二").performClick()
                compose.onNodeWithTag("picker-menu-grade").assertDoesNotExist()
                compose.onNodeWithTag("picker-close").performClick()
                compose.waitUntil(5000) { compose.onAllNodesWithTag("question-picker").fetchSemanticsNodes().isEmpty() }
                compose.onNodeWithContentDescription("返回").performClick()
                compose.onNodeWithTag("nav-library").performClick()
            }
        } finally { app.settings.setTheme(original.theme); app.settings.setAccent(original.accent); runBlocking { app.database.dao().deleteCollection(c.id); app.database.dao().deleteQuestion(q.id) } }
    }

    @Test fun appearanceChoicesRemainReachableInLandscape() {
        val original = compose.activity.requestedOrientation
        try {
            compose.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            compose.waitUntil(10_000) { compose.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE }
            compose.onNodeWithTag("nav-profile").performClick()
            for(accent in AccentTheme.entries) {
                revealChoice(accent)
                compose.onNodeWithTag("accent-${accent.name}").assertIsDisplayed()
            }
            snapshot("appearance-landscape")
        } finally { compose.activity.requestedOrientation = original }
    }

    @Test fun appearanceChoicesFitTheViewportWithScaledText() {
        compose.onNodeWithTag("nav-profile").performClick()
        val width = compose.activity.resources.displayMetrics.widthPixels.toFloat()
        for(accent in AccentTheme.entries) {
            revealChoice(accent)
            val node = compose.onNodeWithTag("accent-${accent.name}").assertIsDisplayed().fetchSemanticsNode()
            assertTrue("Accent stays inside the viewport", node.boundsInRoot.left >= 0 && node.boundsInRoot.right <= width + 1)
            compose.onNode(hasText(accent.label) and hasAnyAncestor(hasTestTag("accent-${accent.name}")), useUnmergedTree = true).assertIsDisplayed()
        }
        snapshot("appearance-scaled-text")
    }
}
