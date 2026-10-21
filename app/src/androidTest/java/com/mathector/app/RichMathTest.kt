package com.mathector.app

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class RichMathTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun views(view: View): List<WebView> = when(view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { views(view.getChildAt(it)) }
        else -> emptyList()
    }
    private fun rendered(marker: String, count: Int): Boolean {
        val latch = CountDownLatch(1)
        var valid = false
        compose.runOnUiThread {
            val view = views(compose.activity.window.decorView).firstOrNull { (it.tag as? String)?.contains(marker) == true }
            if(view == null) latch.countDown() else view.evaluateJavascript("document.fonts.status==='loaded' && document.querySelectorAll('.katex').length === $count && document.querySelectorAll('.katex-error').length===0") {
                valid = it == "true"; latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        return valid
    }
    private fun snapshot(tag: String, filename: String) {
        val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
        val image = compose.onNodeWithTag(tag).captureToImage().asAndroidBitmap()
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, filename).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { image.recycle() }
    }
    @Test fun libraryPreviewAndAiSolutionRenderInlineAndDisplayMath() {
        val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
        val base = Question(id = "math-ui-${UUID.randomUUID()}", title = "公式渲染验证", body = "题干显示验证：已知 \\(f(x)=\\frac{x^2}{2}+\\sqrt{x}\\)，求 \\(f(4)\\)。\n\\[a_n=\\sum_{i=1}^{n} i\\]", latex = "z^2=999", grade = "高二", knowledge = "导数概念与运算", reviewed = true)
        val normalized = base.copy(title=QuestionText.titleFromBody(base.body))
        val q = normalized.copy(solution = "答案显示验证：\\(f(4)=10\\)。\n\n1. 代入函数表达式：\\[f(4)=\\frac{4^2}{2}+\\sqrt{4}=10\\]\n2. 数列求和：\\(a_n=\\frac{n(n+1)}{2}\\)。", solutionFingerprint = normalized.contentFingerprint())
        runBlocking { app.database.dao().save(q) }
        try {
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${q.id}"))
            compose.waitUntil(10_000) { rendered("题干显示验证", 3) }
            snapshot("library-list", "latex-library-0.20.0.png")
            // A tap over the WebView preview must open the card.
            compose.onNodeWithTag("library-math-${q.id}", useUnmergedTree = true).performTouchInput { click(center) }
            compose.onNodeWithTag("question-editor").assertExists()
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-preview"))
            compose.waitUntil(10_000) { rendered("题干显示验证", 3) }
            compose.onNodeWithTag("question-preview").assertContentDescriptionEquals(MathContent.preview(q))
            assertFalse("The exercise preview never includes the proofreading field", MathContent.preview(q).contains("z^2=999"))
            snapshot("question-editor", "preview-editor-0.20.0.png")
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("solution-result"))
            compose.waitUntil(10_000) { rendered("答案显示验证", 3) }
            snapshot("question-editor", "latex-solution-0.20.0.png")
            androidx.test.espresso.Espresso.pressBack()
        } finally { runBlocking { app.database.dao().deleteQuestion(q.id) } }
    }
}
