package com.mathector.app

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

@RunWith(AndroidJUnit4::class)
class ReviewEditorTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private val validation get() = File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }
    private fun bounds(tag: String) = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    private fun snapshot(name: String) {
        compose.waitForIdle()
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(validation, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }
    private fun open(question: Question) {
        compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${question.id}"))
        // Keep the tap above the app's floating bottom navigation when a full card reaches the viewport edge.
        compose.onNodeWithTag("library-question-${question.id}").performTouchInput { click(androidx.compose.ui.geometry.Offset(center.x,24f)) }
        compose.waitUntil(10_000) { runCatching { compose.onNodeWithTag("question-editor-header").assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithTag("question-editor-header").assertIsDisplayed()
    }
    private fun filter(label: String) {
        compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-filter-list"))
        compose.onNodeWithTag("library-filter-list").performScrollToNode(hasTestTag("library-filter-$label"))
        compose.onNodeWithTag("library-filter-$label").performClick().assertIsSelected()
    }
    private fun webViews(view: View): List<WebView> = when(view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { webViews(view.getChildAt(it)) }
        else -> emptyList()
    }
    private fun rendered(marker: String, error: Boolean = false): Boolean {
        val latch = CountDownLatch(1)
        var ready = false
        compose.runOnUiThread {
            val view = webViews(compose.activity.window.decorView).firstOrNull { (it.tag as? String)?.contains(marker) == true }
            if(view == null) latch.countDown() else view.evaluateJavascript(
                "document.fonts.status==='loaded' && document.querySelectorAll('.${if(error) "katex-error" else "katex"}').length===1 && " +
                    if(error) "document.body.textContent.includes('公式需校对')" else "document.querySelectorAll('.katex-error').length===0"
            ) { ready = it == "true"; latch.countDown() }
        }
        return latch.await(2, TimeUnit.SECONDS) && ready
    }

    @Test fun editorHeaderStatusAndConfirmationRemainFixedInBothThemes() {
        val body = "已知函数 \\(f(x)=x^2-4x+3\\)。\n（1）求单调区间；\n（2）求最小值。"
        val questions = listOf(false, true).map { reviewed -> Question(title = QuestionText.titleFromBody(body),
            body = body, grade = "高一", knowledge = "函数单调性", difficulty = "基础", reviewed = reviewed) }
        val original = app.settings.state.value.theme
        runBlocking { questions.forEach { dao.save(it) } }
        try {
            for(theme in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                val mode = if(theme == ThemeMode.DARK) "dark" else "light"
                for(question in questions) {
                    open(question)
                    val header = bounds("question-editor-header")
                    val title = bounds("question-editor-title")
                    val confirm = bounds("question-editor-confirm")
                    val review = bounds("question-editor-review")
                    val status = if(question.reviewed) "已校对" else "待校对"
                    compose.onNodeWithTag("question-editor-review").assertContentDescriptionEquals("校对状态：$status")
                    assertEquals(bounds("question-editor-screen").top, header.top, 1f)
                    assertTrue(bounds("question-editor").top >= header.bottom)
                    compose.onNodeWithTag("question-editor-confirm").assertIsEnabled().assertHeightIsAtLeast(48.dp)
                    snapshot("editor-header-start-$status-$mode-0.20.0.png")
                    compose.onNodeWithTag("question-editor").performScrollToNode(hasText("删除题目"))
                    repeat(2) { compose.onNodeWithTag("question-editor").performTouchInput { swipeUp() } }
                    assertEquals(header, bounds("question-editor-header"))
                    assertEquals(title, bounds("question-editor-title"))
                    assertEquals(confirm, bounds("question-editor-confirm"))
                    assertEquals(review, bounds("question-editor-review"))
                    compose.onNodeWithContentDescription("返回").assertIsDisplayed()
                    compose.onNodeWithTag("question-editor-confirm").assertIsDisplayed()
                    snapshot("editor-header-bottom-$status-$mode-0.20.0.png")
                    compose.onNodeWithContentDescription("返回").performClick()
                }
            }
        } finally { app.settings.setTheme(original); runBlocking { questions.forEach { dao.deleteQuestion(it.id) } } }
    }

    @Test fun reviewBadgesAndFiltersFollowEditsAndExplicitConfirmation() {
        val pending = Question(title = "待校对的数列练习", body = "求等差数列的前十项和。", grade = "高二", knowledge = "数列求和", difficulty = "基础")
        val reviewed = Question(title = "已校对的函数练习", body = "求函数的定义域。", grade = "高一", knowledge = "函数定义域", difficulty = "基础", reviewed = true)
        val collection = QuestionCollection(title = "校对状态验证")
        runBlocking { dao.save(pending); dao.save(reviewed); dao.save(collection); dao.addQuestions(collection.id, listOf(pending.id, reviewed.id)) }
        try {
            for(question in listOf(pending, reviewed)) {
                compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${question.id}"))
                compose.onNodeWithTag("library-review-${question.id}", useUnmergedTree = true).assertTextEquals(if(question.reviewed) "已校对" else "待校对")
            }
            filter("待校对")
            compose.onNodeWithTag("library-question-${pending.id}").assertExists()
            compose.onNodeWithTag("library-question-${reviewed.id}").assertDoesNotExist()
            filter("已校对")
            compose.onNodeWithTag("library-question-${pending.id}").assertDoesNotExist()
            open(reviewed)
            compose.onNodeWithTag("question-body-input").performTextReplacement("修改后的题干：求函数的最小值。")
            compose.onNodeWithTag("question-editor-review").assertContentDescriptionEquals("校对状态：待校对")
            Espresso.closeSoftKeyboard()
            compose.waitUntil(5_000) { runBlocking { dao.question(reviewed.id)?.reviewed == false } }
            compose.onNodeWithContentDescription("返回").performClick()
            filter("待校对")
            open(reviewed)
            compose.onNodeWithTag("question-editor-confirm").performClick()
            compose.waitUntil(5_000) { runBlocking { dao.question(reviewed.id)?.reviewed == true } }
            compose.onNodeWithTag("question-editor-screen").assertDoesNotExist()
            filter("已校对")
            compose.onNodeWithTag("library-question-${pending.id}").assertDoesNotExist()
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${reviewed.id}"))
            compose.onNodeWithTag("library-review-${reviewed.id}", useUnmergedTree = true).assertTextEquals("已校对")
            snapshot("library-reviewed-badge-0.20.0.png")
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-card-${collection.id}"))
            compose.onNodeWithTag("collection-card-${collection.id}").performClick()
            for(question in listOf(pending, reviewed)) {
                compose.onNodeWithTag("collection-detail").performScrollToNode(hasTestTag("collection-question-${question.id}"))
                compose.onNodeWithTag("collection-review-${question.id}", useUnmergedTree = true).assertTextEquals(if(question.id == reviewed.id) "已校对" else "待校对")
            }
            snapshot("collection-review-badges-0.20.0.png")
            runBlocking { dao.remove(collection.id, pending.id); dao.remove(collection.id, reviewed.id) }
            compose.waitUntil(5_000) { compose.onAllNodesWithTag("collection-question-${reviewed.id}").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("collection-add-floating").performClick()
            for(question in listOf(pending, reviewed)) {
                compose.onNodeWithTag("picker-list").performScrollToNode(hasTestTag("picker-question-${question.id}"))
                compose.onNodeWithTag("picker-review-${question.id}", useUnmergedTree = true).assertTextEquals(if(question.id == reviewed.id) "已校对" else "待校对")
            }
        } finally { runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(pending.id); dao.deleteQuestion(reviewed.id) } }
    }

    @Test fun choiceEditorOffersOneImageButtonPerDetectedOption() {
        val question = Question(title = "选项配图", kind = "选择题", reviewed = true,
            body = "下列图形是（ ）\nA. 三角形\nB. 圆形\nC. 正方形\nD. 菱形")
        runBlocking { dao.save(question) }
        try {
            open(question)
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-option-figures"))
            compose.onNodeWithTag("question-option-figures").assertIsDisplayed()
            listOf("A", "B", "C", "D").forEach { label ->
                compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("option-figure-add-$label"))
                compose.onNodeWithTag("option-figure-add-$label").assertIsDisplayed().assertHasClickAction()
            }
            compose.onNodeWithTag("option-figure-add-A").performClick()
            compose.onNodeWithText("添加选项 A 的图片").assertIsDisplayed()
            Espresso.pressBack()
            compose.onNodeWithTag("question-editor-header").assertIsDisplayed()
            snapshot("choice-option-figures-0.22.0.png")
        } finally { runBlocking { dao.deleteQuestion(question.id) } }
    }

    @Test fun proofreadingFormulaHasLiveLatexPreviewAndKeepsReviewedExerciseUnchanged() {
        val question = Question(title = QuestionText.titleFromBody("求函数的零点。"), body = "求函数的零点。", latex = "z^2=999", grade = "高一", knowledge = "函数零点", difficulty = "基础", reviewed = true)
        val original = app.settings.state.value.theme
        runBlocking { dao.save(question) }
        try {
            open(question)
            for(theme in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("proofreading-formula-preview"))
                compose.waitUntil(10_000) { rendered("z^2=999") }
                compose.onNodeWithTag("proofreading-formula-preview").assertContentDescriptionEquals("\\[z^2=999\\]")
                snapshot("proofreading-formula-${if(theme == ThemeMode.DARK) "dark" else "light"}-0.20.0.png")
            }
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-formula-input"))
            compose.onNodeWithTag("question-formula-input").performTextReplacement("\\invalidProofreadingCommand{x}")
            Espresso.closeSoftKeyboard()
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("proofreading-formula-preview"))
            compose.waitUntil(10_000) { rendered("invalidProofreadingCommand", error = true) }
            compose.onNodeWithTag("question-editor-review").assertContentDescriptionEquals("校对状态：已校对")
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-formula-input"))
            compose.onNodeWithTag("question-formula-input").performTextReplacement("\\[\\frac{7}{9}+z^2\\]")
            Espresso.closeSoftKeyboard()
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("proofreading-formula-preview"))
            compose.waitUntil(10_000) { rendered("frac{7}{9}") }
            compose.waitUntil(5_000) { runBlocking { dao.question(question.id)?.latex == "\\[\\frac{7}{9}+z^2\\]" } }
            assertTrue(runBlocking { dao.question(question.id)!!.reviewed })
            assertEquals(question.body, runBlocking { dao.question(question.id)!!.body })
            compose.onNodeWithContentDescription("返回").performClick()
            open(question)
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-preview"))
            compose.onNodeWithTag("question-preview").assertContentDescriptionEquals(question.body)
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("proofreading-formula-preview"))
            compose.waitUntil(10_000) { rendered("frac{7}{9}") }
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteQuestion(question.id) } }
    }

    @Test fun manualEntryRequiresAStemAndKeepsHeaderVisibleWithKeyboard() {
        val marker = "求方程 \\(x^2=3\\) 的解。"
        try {
            compose.onNodeWithTag("main-add-floating").performClick()
            compose.onNodeWithText("手动录入").performClick()
            compose.onNodeWithTag("question-editor-confirm").assertIsNotEnabled()
            val header = bounds("question-editor-header")
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-formula-input"))
            compose.onNodeWithTag("question-formula-input").performTextReplacement("x^2=3")
            assertEquals(header, bounds("question-editor-header"))
            compose.onNodeWithContentDescription("返回").assertIsDisplayed()
            snapshot("manual-entry-keyboard-0.20.0.png")
            Espresso.closeSoftKeyboard()
            compose.onNodeWithTag("question-editor-confirm").assertIsNotEnabled()
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-preview-card"))
            compose.onNodeWithTag("question-preview").assertContentDescriptionEquals("题干待补充")
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("proofreading-formula-preview"))
            compose.waitUntil(10_000) { rendered("x^2=3") }
            assertEquals(header, bounds("question-editor-header"))
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-body-input"))
            compose.onNodeWithTag("question-body-input").performTextReplacement(marker)
            compose.onNodeWithTag("question-editor-confirm").assertIsDisplayed().assertIsEnabled().performClick()
            compose.waitUntil(5_000) { runBlocking { dao.questions().first().any { it.title == QuestionText.titleFromBody(marker) && it.reviewed } } }
        } finally { runBlocking { dao.questions().first().filter { it.title == QuestionText.titleFromBody(marker) }.forEach { dao.deleteQuestion(it.id) } } }
    }

    @Test fun independentFormulasNeverEnterDocumentsAndEmptyStemsAreRejected() = runBlocking {
        val base = Question(title = "标题不导出", body = "仅导出这一段题干。", reviewed = true)
        val source = base.copy(latex = "\\invalidProofreadingCommand{DO_NOT_EXPORT}")
        val word = DocumentExporter.export(compose.activity, "公式校对验证", listOf(source), true)
        ZipFile(word).use { zip ->
            val xml = zip.getInputStream(zip.getEntry("word/document.xml")).bufferedReader().use { it.readText() }
            assertTrue(xml.contains(base.body)); assertFalse(xml.contains("DO_NOT_EXPORT"))
            assertFalse(zip.entries().asSequence().any { it.name.startsWith("word/media/") })
        }
        val pdf = DocumentExporter.export(compose.activity, "公式校对验证", listOf(source), false)
        val control = DocumentExporter.export(compose.activity, "公式校对验证基准", listOf(base), false)
        fun pixels(file: File): IntArray = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { renderer ->
                assertEquals(1, renderer.pageCount)
                renderer.openPage(0).use { page ->
                    val bitmap = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
                    try { page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        IntArray(bitmap.width * bitmap.height).also { bitmap.getPixels(it, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height) }
                    } finally { bitmap.recycle() }
                }
            }
        }
        assertArrayEquals("The independent formula produces no extra PDF ink or spacing", pixels(control), pixels(pdf))
        pdf.copyTo(File(validation, "proofreading-excluded-0.20.0.pdf"), overwrite = true)
        word.copyTo(File(validation, "proofreading-excluded-0.20.0.docx"), overwrite = true)
        val bodyMath = source.copy(body = "求方程 \\(x^2+\\frac{1}{2}=3\\) 的解。")
        val formulaWord = DocumentExporter.export(compose.activity, "题干公式保留验证", listOf(bodyMath), true)
        ZipFile(formulaWord).use { zip -> assertEquals(1, zip.entries().asSequence().count { it.name.startsWith("word/media/") }) }
        DocumentExporter.export(compose.activity, "题干公式保留验证", listOf(bodyMath), false).copyTo(File(validation, "body-math-retained-0.20.0.pdf"), overwrite = true)
        for(wordFormat in listOf(false, true)) {
            try { DocumentExporter.export(compose.activity, "无题干拒绝导出", listOf(source.copy(body = "")), wordFormat); fail("An empty stem cannot export its scratch formula") }
            catch(error: IllegalArgumentException) { assertTrue(error.message.orEmpty().contains("独立公式仅用于校对")) }
        }
    }
}
