package com.mathector.app

import android.content.Context
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
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
class KnowledgeCustomizationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private val preferences get() = app.getSharedPreferences("mathector-knowledge", Context.MODE_PRIVATE)
    private fun restore(saved: String?) {
        preferences.edit().apply { if(saved == null) remove("custom-points") else putString("custom-points", saved) }.commit()
        app.knowledge.reload()
    }
    private fun bounds(tag: String) = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    private fun webViews(view: View): List<WebView> = when(view) {
        is WebView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { webViews(view.getChildAt(it)) }
        else -> emptyList()
    }
    private fun questionPreviewReady(dark: Boolean): Boolean {
        val latch = CountDownLatch(1)
        var valid = true
        val color = if(dark) "rgb(237, 241, 248)" else "rgb(24, 37, 57)"
        compose.runOnUiThread {
            val views = webViews(compose.activity.window.decorView).filter { it.isShown && (it.tag as? String)?.contains("求函数的值。") == true }
            if(views.isEmpty()) { valid = false; latch.countDown() }
            else {
                val remaining = AtomicInteger(views.size)
                views.forEach { view -> view.evaluateJavascript("document.fonts.status==='loaded' && getComputedStyle(document.body).color==='$color'") {
                    if(it != "true") valid = false
                    if(remaining.decrementAndGet() == 0) latch.countDown()
                } }
            }
        }
        return latch.await(2, TimeUnit.SECONDS) && valid
    }
    private fun snapshot(name: String) {
        compose.waitForIdle()
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }

    @Test fun collectionActionsMatchAndCompactKindsPreserveSelectionAndDeletionConfirmation() {
        val suffix = UUID.randomUUID().toString().take(6)
        val q = Question(title = "界面验证 $suffix", body = "求函数的值。", kind = "选择题", grade = "高一", knowledge = "对数函数", difficulty = "基础", reviewed = true)
        val collection = QuestionCollection(title = "按钮验证 $suffix")
        val original = app.settings.state.value.theme
        runBlocking { dao.save(q); dao.save(collection); dao.addToCollection(collection.id, q.id) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-card-${collection.id}"))
            val export = bounds("collection-export-${collection.id}")
            val delete = bounds("collection-delete-${collection.id}")
            assertEquals(export.width, delete.width, 1f); assertEquals(export.height, delete.height, 1f)
            val exportPixels = compose.onNodeWithTag("collection-export-${collection.id}").captureToImage().toPixelMap()
            val deletePixels = compose.onNodeWithTag("collection-delete-${collection.id}").captureToImage().toPixelMap()
            assertEquals(exportPixels[exportPixels.width / 2, 5], deletePixels[deletePixels.width / 2, 5])
            snapshot("collection-actions-light-0.13.0.png")
            app.settings.setTheme(ThemeMode.DARK)
            snapshot("collection-actions-dark-0.13.0.png")
            compose.onNodeWithTag("collection-delete-${collection.id}").performClick()
            compose.onNodeWithText("删除这个题集？").assertExists()
            compose.onNodeWithText("取消").performClick()
            compose.onNodeWithTag("collection-card-${collection.id}").assertExists().performClick()
            compose.onNodeWithTag("collection-add-floating").assertIsDisplayed()
            compose.waitUntil(15_000) { questionPreviewReady(true) }
            snapshot("floating-add-dark-0.13.0.png")
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.waitUntil(15_000) { questionPreviewReady(false) }
            snapshot("floating-add-light-0.13.0.png")
            compose.onNodeWithTag("collection-question-${q.id}").performClick()
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("classification-题型"))
            val choice = compose.onNodeWithTag("choice-题型-选择题").assertIsSelected()
            val before = bounds("choice-题型-选择题").width
            val label = compose.onNode(hasText("选择题") and hasAnyAncestor(hasTestTag("choice-题型-选择题")), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertEquals("Only text padding remains", 26f * app.resources.displayMetrics.density, before - label.width, 2f)
            compose.onNodeWithTag("choice-题型-填空题").performClick().assertIsSelected()
            choice.assertIsNotSelected()
            assertEquals("Selection does not reflow the choice", before, bounds("choice-题型-选择题").width, 1f)
            snapshot("compact-question-kinds-0.13.0.png")
            compose.onNodeWithTag("question-editor").performScrollToNode(hasText("确认并保存题目"))
            compose.onNodeWithText("确认并保存题目").performClick()
            compose.waitUntil(5000) { runBlocking { dao.question(q.id)?.kind == "填空题" } }
            compose.waitUntil(5000) { compose.onAllNodesWithTag("question-editor").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithTag("collection-delete-${collection.id}").performClick()
            compose.onNode(hasText("删除") and hasAnyAncestor(isDialog())).performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithTag("collection-card-${collection.id}").fetchSemanticsNodes().isEmpty() }
            assertNotNull("Deleting a collection preserves its question", runBlocking { dao.question(q.id) })
            assertTrue(runBlocking { dao.orderedItems(collection.id).isEmpty() })
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(q.id) } }
    }

    @Test fun customKnowledgeCanBeCreatedReloadedAndUsedInLibraryAndPicker() {
        val saved = preferences.getString("custom-points", null)
        val theme = app.settings.state.value.theme
        val suffix = UUID.randomUUID().toString().take(6)
        val name = "三角函数辅助角 $suffix"
        val q = Question(title = "知识点验证 $suffix", body = "求函数平移后的图像。", grade = "高二", difficulty = "进阶")
        val collection = QuestionCollection(title = "自定义分类 $suffix")
        runBlocking { dao.save(q); dao.save(collection) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${q.id}"))
            compose.onNodeWithTag("library-question-${q.id}").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) {it()}
            compose.waitUntil(10000) {compose.onAllNodesWithTag("question-editor-header").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("knowledge-tags"))
            compose.onNodeWithTag("add-knowledge").performClick()
            compose.onNodeWithTag("new-knowledge").performClick()
            compose.onNodeWithTag("custom-knowledge-save").assertIsNotEnabled()
            compose.onNodeWithTag("custom-knowledge-name").performTextInput("对数函数")
            compose.onNodeWithTag("custom-knowledge-save").performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithText("这个知识点已存在，请直接在知识库中选择").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("custom-knowledge-name").performTextReplacement(name)
            compose.onNodeWithTag("custom-knowledge-group").performClick()
            compose.onNodeWithTag("custom-knowledge-group-三角").performScrollTo().performClick()
            snapshot("custom-knowledge-dialog-light-0.13.0.png")
            app.settings.setTheme(ThemeMode.DARK)
            snapshot("custom-knowledge-dialog-dark-0.13.0.png")
            compose.onNodeWithTag("custom-knowledge-save").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) {it()}
            compose.waitUntil(5000) { compose.onAllNodesWithTag("custom-knowledge-dialog").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("knowledge-$name").assertIsSelected()
            assertTrue(KnowledgeCatalog.groups.getValue("三角").contains(name))
            snapshot("custom-knowledge-sheet-dark-0.13.0.png")
            app.settings.setTheme(ThemeMode.LIGHT)
            snapshot("custom-knowledge-sheet-light-0.13.0.png")
            compose.onNodeWithText("完成").performClick()
            compose.onNodeWithTag("remove-knowledge-$name").assertExists()
            compose.onNodeWithTag("question-editor-confirm").performClick()
            compose.waitUntil(5000) { runBlocking { dao.question(q.id)?.knowledge == name } }
            // Empty the in-memory registry to exercise loading from disk, as on a new process.
            KnowledgeCatalog.installCustomPoints(emptyList())
            CustomKnowledgeStore(app).reload()
            assertTrue(KnowledgeCatalog.points.contains(name))
            assertEquals(listOf(name), KnowledgeCatalog.decode(runBlocking { dao.question(q.id)!! }.knowledge))
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("glide-select-knowledge"))
            compose.onNodeWithTag("glide-select-knowledge").performClick()
            compose.onNodeWithTag("glide-option-knowledge-$name").performClick()
            compose.onNodeWithTag("glide-select-knowledge").assertTextContains(name, substring = true)
            compose.onNodeWithTag("library-knowledge-${q.id}-$name", useUnmergedTree = true).assertTextEquals(name)
            compose.onNodeWithTag("library-question-${q.id}").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) {it()}
            compose.waitUntil(10000) {compose.onAllNodesWithTag("question-editor-header").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("knowledge-tags"))
            compose.onNodeWithTag("remove-knowledge-$name").assertExists()
            compose.mainClock.advanceTimeBy(5000)
            compose.waitUntil(10_000) { compose.onAllNodesWithText("题目已确认保存").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("question-editor-confirm").performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithTag("question-editor").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithTag("collection-card-${collection.id}").performClick()
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("picker-filter-knowledge").performClick()
            compose.onNodeWithTag("picker-option-knowledge-$name").performScrollTo().performClick()
            compose.onNodeWithTag("picker-results").assertTextEquals("1 道可选")
            compose.onNodeWithTag("picker-knowledge-${q.id}-$name", useUnmergedTree = true).assertTextEquals(name)
            compose.onNodeWithTag("picker-question-${q.id}").performClick()
            snapshot("custom-knowledge-picker-0.13.0.png")
            compose.onNodeWithTag("picker-confirm").performClick()
            compose.waitUntil(5000) { runBlocking { dao.orderedItems(collection.id).size == 1 } }
            compose.onNodeWithTag("collection-knowledge-${q.id}-$name", useUnmergedTree = true).assertTextEquals(name)
        } catch (failure: Throwable) { snapshot("custom-knowledge-failure-0.13.0.png"); throw failure }
        finally { runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(q.id) }; restore(saved); app.settings.setTheme(theme) }
    }

    @Test fun visionPromptRefreshesWhenCustomKnowledgeIsAddedAndResponseKeepsTheLabel() = runBlocking {
        val saved = preferences.getString("custom-points", null)
        val name = "函数变换 ${UUID.randomUUID().toString().take(6)}"
        val file = File(app.cacheDir, "custom-vision-${UUID.randomUUID()}.jpg")
        val bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        try { file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) } } finally { bitmap.recycle() }
        var requests = 0
        val client = MultimodalRecognitionEngine.httpClient().newBuilder().addInterceptor { chain ->
            val buffer = Buffer(); chain.request().body!!.writeTo(buffer)
            val prompt = JSONObject(buffer.readUtf8()).getJSONArray("messages").getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("text")
            assertEquals(requests++ > 0, prompt.contains(name))
            val content = JSONObject().put("questions", JSONArray().put(JSONObject().put("body", "求函数的图像。").put("knowledgePoints", JSONArray().put(name)))).toString()
            val response = JSONObject().put("choices", JSONArray().put(JSONObject().put("finish_reason", "stop").put("message", JSONObject().put("content", content)))).toString()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("Fixture")
                .body(response.toResponseBody("application/json".toMediaType())).build()
        }.build()
        try {
            MultimodalRecognitionEngine(MultimodalConfig(chatCompletionsEndpoint("https://vision.example/v1"), "test-model", "test-key-only"), client).use { engine ->
                assertEquals("", engine.recognize(file).questions.single().knowledge)
                app.knowledge.add("函数", name)
                assertEquals(name, engine.recognize(file).questions.single().knowledge)
            }
            assertEquals(2, requests)
        } finally { restore(saved); file.delete() }
    }
}
