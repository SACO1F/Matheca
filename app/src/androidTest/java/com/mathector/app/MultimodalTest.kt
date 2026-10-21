package com.mathector.app

import android.graphics.*
import android.graphics.pdf.PdfDocument
import androidx.exifinterface.media.ExifInterface
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.*
import androidx.work.testing.TestListenableWorkerBuilder
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class MultimodalTest {
    private val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val endpoint = chatCompletionsEndpoint("https://vision.example/v1/")
    private val config = MultimodalConfig(endpoint, "vision-test-model", "test-key-only")

    private fun completion(): String {
        val draft = JSONObject().put("body", "1. 已知函数 y = x²，求 x = 3 时的值。\n（1）写出计算过程。")
            .put("latex", "y=x^2+\\frac{1}{2}").put("grade", "高一").put("kind", "解答题").put("difficulty", "基础").put("knowledgePoints", JSONArray().put("函数的概念与性质").put("函数单调性").put("勾股定理"))
        val content = JSONObject().put("questions", JSONArray().put(draft)).toString()
        return JSONObject().put("choices", JSONArray().put(JSONObject().put("finish_reason", "stop")
            .put("message", JSONObject().put("content", "```json\n$content\n```")))).toString()
    }

    private fun client(handler: (Request) -> Pair<Int, String>): OkHttpClient = MultimodalRecognitionEngine.httpClient().newBuilder().addInterceptor { chain ->
        val (code, body) = handler(chain.request())
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("Fixture")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }.build()

    private fun image(file: File, width: Int = 1200, height: Int = 800) {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        try {
            Canvas(bitmap).apply { drawColor(Color.WHITE); drawText("1. x + 2 = 5", 40f, 150f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 64f }) }
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        } finally { bitmap.recycle() }
    }

    @Test fun visionRequestIncludesImageAndPreservesFormulaAndClassification() = runBlocking {
        val file = File(app.cacheDir, "vision-${UUID.randomUUID()}.jpg")
        image(file, 2800, 1000)
        ExifInterface(file.absolutePath).apply { setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString()); saveAttributes() }
        var requests = 0
        try {
            val transport = client { request ->
                requests++
                assertEquals(endpoint, request.url)
                assertEquals("Bearer test-key-only", request.header("Authorization"))
                val buffer = Buffer(); request.body!!.writeTo(buffer)
                val payload = JSONObject(buffer.readUtf8())
                assertEquals("vision-test-model", payload.getString("model"))
                assertFalse(payload.getBoolean("stream"))
                val content = payload.getJSONArray("messages").getJSONObject(0).getJSONArray("content")
                assertEquals("text", content.getJSONObject(0).getString("type"))
                val url = content.getJSONObject(1).getJSONObject("image_url").getString("url")
                assertTrue(url.startsWith("data:image/jpeg;base64,"))
                val data = Base64.decode(url.substringAfter(','), Base64.DEFAULT)
                val decoded = BitmapFactory.decodeByteArray(data, 0, data.size)
                try {
                    assertTrue(maxOf(decoded.width, decoded.height) <= 2000)
                    assertTrue("EXIF rotation must be applied before upload", decoded.height > decoded.width)
                } finally { decoded.recycle() }
                200 to completion()
            }
            val result = MultimodalRecognitionEngine(config, transport).use { it.recognize(file) }
            assertEquals(1, requests)
            assertEquals("y=x^2+\\frac{1}{2}", result.questions.single().latex)
            assertEquals("高一", result.questions.single().grade)
            assertEquals(listOf("函数的概念与性质", "函数单调性"), KnowledgeCatalog.decode(result.questions.single().knowledge))
            assertEquals("基础", result.questions.single().difficulty)
            assertFalse(result.questions.single().body.contains("（1）"))
            assertTrue(result.questions.single().body.startsWith("已知"))
            assertTrue(result.questions.single().body.contains("\n写出计算过程。"))
        } finally { file.delete() }
    }

    @Test fun structuredSubquestionsRemainNumberedThroughRecognitionAndCache() {
        val draft = JSONObject().put("body", "9. 已知函数 \\(f(x)=x^2\\)。")
            .put("subquestions", JSONArray().put("（4）求 \\(f(3)\\)。").put("（7）证明函数的单调性。"))
        val input = JSONObject().put("questions", JSONArray().put(draft)).toString()
        val result = MultimodalRecognitionEngine.decodeDrafts(input)
        assertEquals("已知函数 \\(f(x)=x^2\\)。\n（1）求 \\(f(3)\\)。\n（2）证明函数的单调性。", result.questions.single().body)
        val restored = MultimodalRecognitionEngine.decodeDrafts(MultimodalRecognitionEngine.encodeDrafts(result))
        assertEquals(result, restored)
        draft.put("subquestions", JSONArray().put(""))
        try { MultimodalRecognitionEngine.decodeDrafts(JSONObject().put("questions", JSONArray().put(draft)).toString()); fail("Blank parts must fail") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun invalidTruncatedAndEmptyResultsCannotCreateInventedDrafts() {
        fun rejected(body: String) {
            try { MultimodalRecognitionEngine.decodeCompletion(body); fail("Expected invalid result to fail") }
            catch (_: IllegalStateException) { }
            catch (_: IllegalArgumentException) { }
        }
        rejected("not a response")
        rejected(JSONObject(completion()).apply { getJSONArray("choices").getJSONObject(0).put("finish_reason", "length") }.toString())
        rejected(JSONObject(completion()).apply { getJSONArray("choices").getJSONObject(0).getJSONObject("message").put("content", "{\"questions\":[]}") }.toString())
        rejected(JSONObject(completion()).apply { getJSONArray("choices").getJSONObject(0).getJSONObject("message").put("refusal", "cannot") }.toString())
        val normalized = MultimodalRecognitionEngine.decodeDrafts("{\"questions\":[{\"body\":\"x+1=2\",\"grade\":\"大学\",\"difficulty\":\"未知\"}]}")
        assertEquals("", normalized.questions.single().grade)
        assertEquals("待评估", normalized.questions.single().difficulty)
        assertEquals("https://vision.example/v1/chat/completions", chatCompletionsEndpoint("https://vision.example/").toString())
        assertEquals(endpoint, chatCompletionsEndpoint("https://vision.example/v1/chat/completions"))
        try { chatCompletionsEndpoint("http://vision.example/v1"); fail("Cleartext credentials must be rejected") } catch (_: IllegalArgumentException) { }
    }

    @Test fun httpFailuresAreActionableAndNeverEchoProviderSecrets() = runBlocking {
        val file = File(app.cacheDir, "vision-error-${UUID.randomUUID()}.jpg"); image(file)
        try {
            for (code in listOf(401, 404, 429, 503, 302)) {
                try {
                    MultimodalRecognitionEngine(config, client { code to "upstream echoed test-key-only" }).use { it.recognize(file) }
                    fail("HTTP $code must fail")
                } catch (error: IllegalStateException) {
                    assertTrue(error.message!!.contains("HTTP $code"))
                    assertFalse(error.message!!.contains(config.apiKey))
                }
            }
            try {
                MultimodalRecognitionEngine(config, client { 200 to "x".repeat(4 * 1024 * 1024 + 1) }).use { it.recognize(file) }
                fail("Oversized response must fail")
            } catch (error: IllegalStateException) { assertTrue(error.message!!.contains("响应过大")) }
        } finally { file.delete() }
    }

    @Test fun settingsPersistThemeAndEncryptKeyWithoutExposingItInState() {
        val name = "settings-test-${UUID.randomUUID()}"
        app.getSharedPreferences(name, 0).edit().putString("recognitionMode", "LOCAL").commit()
        val store = SettingsStore(app, name, name)
        val testKey = "test-isolated-secret-${UUID.randomUUID()}"
        try {
            assertFalse("A legacy offline preference must not bypass API configuration", store.state.value.recognitionReady)
            assertFalse(app.getSharedPreferences(name, 0).contains("recognitionMode"))
            assertFalse(store.state.value.autoSolveImports)
            store.setAutoSolveImports(true)
            store.setTheme(ThemeMode.DARK)
            store.saveApi("https://vision.example/v1", "vision-model", testKey)
            app.getSharedPreferences(name, 0).edit().putString("recognitionMode", "LOCAL").commit()
            val reloaded = SettingsStore(app, name, name)
            assertEquals(ThemeMode.DARK, reloaded.state.value.theme)
            assertTrue(reloaded.state.value.autoSolveImports)
            assertTrue(reloaded.state.value.recognitionReady)
            assertFalse(app.getSharedPreferences(name, 0).contains("recognitionMode"))
            assertEquals(testKey, reloaded.multimodalConfig().apiKey)
            assertFalse(reloaded.state.value.toString().contains(testKey))
            assertFalse(app.getSharedPreferences(name, 0).all.values.any { it.toString().contains(testKey) })
            reloaded.saveApi("https://vision.example/v1", "another-model", "")
            assertEquals(testKey, reloaded.multimodalConfig().apiKey)
            try { reloaded.saveApi("https://other.example/v1", "another-model", ""); fail("Changing host requires explicitly entering a key") } catch (_: IllegalArgumentException) { }
            reloaded.clearApiKey()
            assertFalse(reloaded.state.value.hasApiKey)
            assertFalse(reloaded.state.value.recognitionReady)
        } finally {
            app.getSharedPreferences(name, 0).edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(name) }
        }
    }

    @Test fun pdfAndImageUseVisionPipelineRetryOnlyFailedPagesAndPreserveEdits() = runBlocking {
        val id = "vision-worker-${UUID.randomUUID()}"
        val folder = File(app.filesDir, "sources/$id").apply { mkdirs() }
        val pdf = File(folder, "paper.pdf")
        val document = PdfDocument()
        try {
            repeat(2) { index ->
                val page = document.startPage(PdfDocument.PageInfo.Builder(600, 800, index + 1).create())
                page.canvas.drawText("${index + 1}. x + 2 = 5", 40f, 160f, Paint().apply { textSize = 38f })
                document.finishPage(page)
            }
            pdf.outputStream().use { document.writeTo(it) }
        } finally { document.close() }
        val jpg = File(folder, "photo.jpg"); image(jpg)
        val dao = app.database.dao()
        dao.save(ImportJob(id = id, paths = listOf(pdf, jpg).joinToString("\n") { it.absolutePath }))
        var calls = 0
        val transport = client { request ->
            calls++
            if(calls == 2) 429 to "temporary error" else {
                val buffer = Buffer(); request.body!!.writeTo(buffer)
                val prompt = JSONObject(buffer.readUtf8()).getJSONArray("messages").getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("text")
                val target = Regex("目标起始页：(\\d+)").find(prompt)?.groupValues?.get(1)?.toInt()
                if(target == null) 200 to completion() else {
                    val envelope = JSONObject(completion())
                    val message = envelope.getJSONArray("choices").getJSONObject(0).getJSONObject("message")
                    val content = JSONObject(message.getString("content").removePrefix("```json\n").removeSuffix("\n```"))
                    content.put("needMorePages", false).getJSONArray("questions").getJSONObject(0).put("startPage", target).put("endPage", target).put("complete", true)
                    message.put("content", content.toString()); 200 to envelope.toString()
                }
            }
        }
        val factory = object : WorkerFactory() {
            override fun createWorker(context: android.content.Context, workerClassName: String, params: WorkerParameters): ListenableWorker =
                ImportWorker(context, params) { MultimodalRecognitionEngine(config, transport) }
        }
        fun worker() = TestListenableWorkerBuilder<ImportWorker>(app).setWorkerFactory(factory)
            // A queued request from an older offline version still uses the sole vision engine.
            .setInputData(workDataOf("jobId" to id, "recognitionMode" to "LOCAL")).build()
        try {
            worker().doWork()
            assertEquals(3, calls)
            assertEquals("partial", dao.importJob(id)!!.status)
            assertNull(dao.question("$id-2-0"))
            val saved = dao.question("$id-1-0")!!
            assertEquals("高一", saved.grade); assertEquals("基础", saved.difficulty)
            assertTrue(saved.sourcePath.endsWith("paper-0.jpg"))
            assertEquals(jpg.absolutePath, dao.question("$id-3-0")!!.sourcePath)
            dao.save(saved.copy(body = "人工修改保留", reviewed = true))
            worker().doWork()
            assertEquals("Only the failed page should reach the provider again", 4, calls)
            assertEquals("complete", dao.importJob(id)!!.status)
            assertNotNull(dao.question("$id-2-0"))
            assertEquals("人工修改保留", dao.question(saved.id)!!.body)
            assertTrue(dao.question(saved.id)!!.reviewed)
        } finally {
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM questions WHERE id LIKE ?", arrayOf("$id%"))
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM imports WHERE id = ?", arrayOf(id))
            folder.listFiles()?.forEach { it.delete() }; folder.delete()
        }
    }
}
