package com.mathector.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
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
import java.util.zip.ZipFile

@RunWith(AndroidJUnit4::class)
class CompactWorkspaceTest {
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
    private fun exportFromList(collection: QuestionCollection, word: Boolean): File {
        compose.onNodeWithTag("collection-export-${collection.id}").performClick()
        compose.onNodeWithTag("collection-export-${if(word) "word" else "pdf"}-${collection.id}").performClick()
        compose.onNodeWithText("还有 1 道题待校对").assertExists()
        compose.onNodeWithTag("export-continue").performClick()
        val extension = if(word) "docx" else "pdf"
        var file: File? = null
        compose.waitUntil(60_000) {
            file = File(app.cacheDir, "exports").listFiles()?.filter { it.name.startsWith("${collection.title}-") && it.extension == extension }?.maxByOrNull { it.lastModified() }
            file != null && compose.onAllNodesWithText("文档已生成").fetchSemanticsNodes().isNotEmpty()
        }
        return requireNotNull(file)
    }

    @Test fun collectionListExportsBothFormatsUsingSavedPaperAndQuestionOrder() {
        val suffix = UUID.randomUUID().toString().take(6)
        val first = Question(id = "list-export-first-$suffix", title = "PRIVATE_TITLE_FIRST", body = "已知函数 \\(f(x)=x^2-4x+3\\)。\n（1）求单调区间；\n（2）求 \\(f(3)\\) 的值。",
            grade = "高一", knowledge = "函数单调性", difficulty = "基础", reviewed = false, createdAt = 1)
        val second = Question(id = "list-export-second-$suffix", title = "PRIVATE_TITLE_SECOND", body = "函数 \\(g(x)=\\log_{0.5}(x^2-5x-6)\\) 的单调递增区间是（ ）\nA. \\((\\frac{5}{2},+\\infty)\\)  B. \\((-\\infty,\\frac{5}{2})\\)  C. \\((-\\infty,2)\\)  D. \\((-\\infty,-1)\\)",
            kind = "选择题", grade = "高三", knowledge = "对数函数", difficulty = "进阶", reviewed = true, createdAt = 2)
        val collection = QuestionCollection(title = "列表导出验证-$suffix", paperTitle = "数学阶段测试", examInstructions = "请将答案写在答题区域。\n选择题只有一个正确选项。", examMinutes = 90, totalScore = 100)
        val empty = QuestionCollection(title = "空题集-$suffix", createdAt = 1)
        val original = app.settings.state.value.theme
        runBlocking { dao.save(first); dao.save(second); dao.save(collection); dao.save(empty); dao.addQuestions(collection.id, listOf(first.id, second.id)) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithTag("collection-description-${collection.id}", useUnmergedTree = true).assertTextEquals("2 道题")
            compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-export-${empty.id}"))
            compose.onNodeWithTag("collection-export-${empty.id}").assertIsNotEnabled()
            compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-export-${collection.id}"))
            snapshot("collections-export-light-0.12.0.png")
            compose.onNodeWithTag("collection-export-${collection.id}").performClick()
            compose.onNodeWithTag("collection-export-menu-${collection.id}").assertExists()
            compose.onNodeWithTag("collection-screen").assertDoesNotExist()
            snapshot("collections-export-menu-0.12.0.png")
            compose.onNodeWithTag("collection-export-pdf-${collection.id}").performClick()
            compose.onNodeWithText("返回校对").performClick()
            compose.onNodeWithTag("collection-screen").assertExists()
            compose.onNodeWithContentDescription("返回").performClick()
            val pdf = exportFromList(collection, false)
            pdf.copyTo(File(validation, "collection-list-export-0.12.0.pdf"), overwrite = true)
            ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY).use { fd -> PdfRenderer(fd).use { renderer -> assertEquals(1, renderer.pageCount) } }
            compose.onNodeWithText("查看分页预览").performClick()
            compose.onNodeWithText("PDF 分页预览").assertExists()
            compose.onNodeWithContentDescription("返回题集").performClick()
            compose.onNodeWithTag("collections-list").assertExists()
            val word = exportFromList(collection, true)
            word.copyTo(File(validation, "collection-list-export-0.12.0.docx"), overwrite = true)
            ZipFile(word).use { zip ->
                val xml = zip.getInputStream(zip.getEntry("word/document.xml")).bufferedReader().use { it.readText() }
                assertTrue(xml.contains(collection.paperTitle))
                assertTrue(xml.contains("考试时间：90 分钟")); assertTrue(xml.contains("满分：100 分"))
                assertTrue(xml.contains("请将答案写在答题区域。"))
                assertTrue(xml.indexOf("已知函数") < xml.indexOf("单调递增区间"))
                assertTrue(xml.contains("（1）") && xml.contains("（2）"))
                assertFalse(xml.contains("PRIVATE_TITLE"))
                assertTrue(zip.entries().asSequence().count { it.name.startsWith("word/media/") } >= 2)
            }
            Espresso.pressBack()
            app.settings.setTheme(ThemeMode.DARK)
            compose.onNodeWithTag("collection-export-${collection.id}").assertIsEnabled()
            snapshot("collections-export-dark-0.12.0.png")
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteCollection(collection.id); dao.deleteCollection(empty.id); dao.deleteQuestion(first.id); dao.deleteQuestion(second.id) } }
    }

    @Test fun compactPaperSettingsPersistAndFloatingAddFollowsAppearance() {
        val suffix = UUID.randomUUID().toString().take(6)
        val question = Question(id = "compact-panel-$suffix", title = "函数练习-$suffix", body = "求函数的最大值。", reviewed = true)
        val collection = QuestionCollection(title = "紧凑设置-$suffix")
        val original = app.settings.state.value.theme
        runBlocking { dao.save(question); dao.save(collection); dao.addToCollection(collection.id, question.id) }
        try {
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithTag("collection-detail").performScrollToNode(hasTestTag("paper-settings"))
            val density = compose.activity.resources.displayMetrics.density
            assertTrue("The unexpanded paper panel stays compact", bounds("paper-settings").height < 400f * density)
            assertTrue("Normal fields have a small gap", bounds("paper-instructions").top - bounds("paper-title").bottom <= 12f * density)
            assertTrue(bounds("paper-minutes").top - bounds("paper-instructions").bottom <= 12f * density)
            snapshot("paper-compact-light-0.18.0.png")
            compose.onNodeWithTag("paper-instructions").performTextReplacement("请填写姓名。\n请写出计算过程。")
            compose.onNodeWithTag("paper-minutes").performTextReplacement("0")
            compose.onNodeWithTag("export-pdf").assertIsNotEnabled()
            compose.onNodeWithTag("paper-minutes").performTextReplacement("90")
            compose.onNodeWithTag("paper-score").performTextReplacement("100")
            compose.onNodeWithTag("export-pdf").assertIsEnabled()
            compose.waitUntil(5_000) { runBlocking { dao.collections().first().any { it.id == collection.id && it.examMinutes == 90 && it.totalScore == 100 && it.examInstructions.contains("计算过程") } } }
            Espresso.closeSoftKeyboard()
            compose.onNodeWithTag("collection-add-floating").assertHeightIsEqualTo(52.dp)
            for (theme in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                val pixels = compose.onNodeWithTag("collection-add-floating").captureToImage().toPixelMap()
                val color = pixels[pixels.width / 2, (pixels.height * .15f).toInt()]
                val expected = com.mathector.app.ui.mathecaPalette(app.settings.state.value.accent, theme == ThemeMode.DARK).scheme
                assertTrue("Glass follows the selected accent in $theme", kotlin.math.abs(color.red - expected.primary.red) < .06f && kotlin.math.abs(color.green - expected.primary.green) < .06f && kotlin.math.abs(color.blue - expected.primary.blue) < .06f)
                val layouts = mutableListOf<TextLayoutResult>()
                compose.onNode(hasText("添加题目") and hasAnyAncestor(hasTestTag("collection-add-floating")), useUnmergedTree = true)
                    .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                val text = layouts.single().layoutInput.style.color
                val contrast = (maxOf(color.luminance(), text.luminance()) + .05f) / (minOf(color.luminance(), text.luminance()) + .05f)
                assertTrue("The glass label stays readable in $theme", contrast >= 4.5f)
                assertEquals("Add label uses the contrasting theme foreground in $theme", expected.onPrimary, text)
            }
            snapshot("paper-compact-dark-0.18.0.png")
            compose.onNodeWithTag("collection-add-floating").performClick()
            compose.onNodeWithTag("question-picker").assertExists()
            compose.onNodeWithTag("picker-close").performClick()
            compose.onNodeWithContentDescription("返回").assertIsDisplayed()
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithText(collection.title).performClick()
            compose.onNodeWithTag("collection-detail").performScrollToNode(hasTestTag("paper-settings"))
            compose.onNodeWithTag("paper-instructions").assertTextContains("请填写姓名。\n请写出计算过程。")
            compose.onNodeWithTag("paper-minutes").assertTextContains("90")
        } finally { app.settings.setTheme(original); runBlocking { dao.deleteCollection(collection.id); dao.deleteQuestion(question.id) } }
    }

    @Test fun mergedRecognitionCardKeepsConfigurationSavingAndEncryptedKeyBehavior() {
        val prefs = app.getSharedPreferences("mathector-settings", Context.MODE_PRIVATE)
        val backup = prefs.all.toMap()
        val original = app.settings.state.value
        val suffix = UUID.randomUUID().toString().take(6)
        val key = "test-compact-$suffix"
        try {
            app.settings.clearApiKey()
            app.settings.setTheme(ThemeMode.LIGHT)
            compose.onNodeWithTag("nav-profile").performClick()
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("recognition-api-settings"))
            compose.onAllNodesWithTag("recognition-api-settings").assertCountEquals(1)
            compose.onNodeWithTag("recognition-multimodal").assert(hasAnyAncestor(hasTestTag("recognition-api-settings")))
            compose.onNodeWithTag("api-address").assert(hasAnyAncestor(hasTestTag("recognition-api-settings")))
            snapshot("settings-merged-light-0.12.0.png")
            compose.onNodeWithTag("api-address").performTextReplacement("https://vision.example.invalid/v1")
            compose.onNodeWithTag("api-model").performTextReplacement("vision-test-$suffix")
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("api-key"))
            compose.onNodeWithTag("api-key").performTextInput(key)
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("save-api"))
            compose.onNodeWithTag("test-api").assertIsNotEnabled()
            compose.onNodeWithTag("save-api").performClick()
            compose.waitUntil(5_000) { app.settings.state.value.hasApiKey && app.settings.state.value.model == "vision-test-$suffix" }
            assertEquals("", compose.onNodeWithTag("api-key").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
            assertNotEquals(key, prefs.getString("encryptedKey", null))
            assertEquals(key, app.settings.multimodalConfig().apiKey)
            compose.onNodeWithTag("test-api").assertIsEnabled()
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("api-model"))
            compose.onNodeWithTag("api-model").performTextReplacement("vision-edited-$suffix")
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("save-api"))
            compose.onNodeWithTag("save-api").performClick()
            compose.waitUntil(5_000) { app.settings.state.value.model == "vision-edited-$suffix" }
            assertEquals(key, app.settings.multimodalConfig().apiKey)
            Espresso.closeSoftKeyboard()
            app.settings.setTheme(ThemeMode.DARK)
            compose.mainClock.advanceTimeBy(5_000)
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("recognition-api-settings"))
            snapshot("settings-merged-dark-0.12.0.png")
        } finally {
            val editor = prefs.edit().clear()
            backup.forEach { (name, value) -> when(value) {
                is String -> editor.putString(name, value)
                is Boolean -> editor.putBoolean(name, value)
                is Int -> editor.putInt(name, value)
                is Long -> editor.putLong(name, value)
                is Float -> editor.putFloat(name, value)
            } }
            check(editor.commit())
            app.settings.setTheme(original.theme)
        }
    }
}
