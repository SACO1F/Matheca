package com.mathector.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.*
import androidx.work.testing.TestListenableWorkerBuilder
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.json.JSONArray

@RunWith(AndroidJUnit4::class)
class CrossPageRecognitionTest {
    private val app = ApplicationProvider.getApplicationContext<MathectorApplication>()

    @Test fun incompleteDocumentNeverCreatesHalfQuestionsAndCanBeRetried() = runBlocking {
        val id="incomplete-${UUID.randomUUID()}"
        val folder=File(app.filesDir,"sources/$id").apply { mkdirs() }
        val pages=(1..2).map { File(folder,"$it.jpg").apply { writeBytes(byteArrayOf(1)) } }
        var repaired=false
        val engine=object: RecognitionEngine {
            override suspend fun recognize(source: File): RecognitionResult=error("Expected ordered pages")
            override suspend fun recognizePages(sources: List<File>,target: Int,first: Int)=
                if(!repaired) PagedRecognitionResult(true,emptyList()) else PagedRecognitionResult(false,if(target==1) listOf(PageQuestion(RecognizedQuestion("补充完整的题目"),1,1)) else emptyList())
            override fun close() { }
        }
        val factory=object: WorkerFactory() { override fun createWorker(context: Context,name: String,params: WorkerParameters): ListenableWorker=ImportWorker(context,params) {engine} }
        fun worker()=TestListenableWorkerBuilder<ImportWorker>(app).setWorkerFactory(factory).setInputData(workDataOf("jobId" to id)).build()
        val dao=app.database.dao()
        try {
            dao.save(ImportJob(id=id,paths=pages.joinToString("\n") {it.absolutePath}))
            assertEquals(ListenableWorker.Result.failure(),worker().doWork())
            assertNull(dao.question("$id-1-0")); assertNull(dao.question("$id-2-0"))
            assertTrue(dao.importJob(id)!!.message.contains("未录入半道题"))
            repaired=true
            assertEquals(ListenableWorker.Result.success(),worker().doWork())
            assertEquals("补充完整的题目",dao.question("$id-1-0")!!.body)
            assertNull(dao.question("$id-2-0"))
        } finally {
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM questions WHERE id LIKE ?",arrayOf("$id%"))
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM imports WHERE id = ?",arrayOf(id))
            folder.listFiles()?.forEach {it.delete()}; folder.delete()
        }
    }

    @Test fun strictPageValidationAllowsContinuationOnlyPagesAndRejectsIncompleteOrInvalidRanges() {
        assertTrue(MultimodalRecognitionEngine.decodePagedDrafts("""{"questions":[],"needMorePages":false}""",2,1,3).questions.isEmpty())
        assertTrue(MultimodalRecognitionEngine.decodePagedDrafts("""{"questions":[],"needMorePages":true}""",1,1,2).needMorePages)
        for(value in listOf(
            """{"questions":[]}""",
            """{"questions":[{"body":"题干","startPage":1,"endPage":4,"complete":true}],"needMorePages":false}""",
            """{"questions":[{"body":"题干","startPage":1.5,"endPage":2,"complete":true}],"needMorePages":false}""",
            """{"questions":[{"body":"题干","startPage":1,"endPage":2,"complete":false}],"needMorePages":false}"""
        )) {
            try { MultimodalRecognitionEngine.decodePagedDrafts(value,1,1,3); fail("Invalid range/completeness must fail") } catch(_: Exception) { }
        }
    }

    @Test fun workerExpandsContextPreservesCombinedOriginalAndCachesWithoutOverwritingEdits() = runBlocking {
        val id = "cross-${UUID.randomUUID()}"
        val folder = File(app.filesDir,"sources/$id").apply { mkdirs() }
        val pages = (1..3).map { number -> File(folder,"$number.jpg").also { file ->
            val bitmap = Bitmap.createBitmap(300,400,Bitmap.Config.ARGB_8888)
            try { file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG,90,it) } } finally { bitmap.recycle() }
        } }
        val calls = mutableListOf<Triple<Int,Int,Int>>()
        val client = MultimodalRecognitionEngine.httpClient().newBuilder().addInterceptor { chain ->
                val buffer=Buffer(); chain.request().body!!.writeTo(buffer)
                val content=JSONObject(buffer.readUtf8()).getJSONArray("messages").getJSONObject(0).getJSONArray("content")
                val prompt=content.getJSONObject(0).getString("text")
                val target=Regex("目标起始页：(\\d+)").find(prompt)!!.groupValues[1].toInt()
                val first=Regex("按顺序对应第 (\\d+)").find(prompt)!!.groupValues[1].toInt()
                val count=content.length()-1
                assertTrue(content.getJSONObject(1).getJSONObject("image_url").getString("url").startsWith("data:image/jpeg;base64,"))
                calls += Triple(target,first,count)
                val result=when(target) {
                    1 -> if(count == 2) PagedRecognitionResult(true, emptyList()) else PagedRecognitionResult(false,listOf(PageQuestion(RecognizedQuestion("已知函数，第一小题，第二小题，完整末尾条件。"),1,3)))
                    2 -> PagedRecognitionResult(false,emptyList())
                    else -> PagedRecognitionResult(false,listOf(PageQuestion(RecognizedQuestion("独立的下一题。"),3,3)))
                }
                val body=JSONObject().put("choices",JSONArray().put(JSONObject().put("finish_reason","stop").put("message",JSONObject().put("content",MultimodalRecognitionEngine.encodePagedDrafts(result))))).toString()
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("Fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val engine=MultimodalRecognitionEngine(MultimodalConfig(chatCompletionsEndpoint("https://vision.example/v1"),"test-model","test-key"),client)
        val factory = object: WorkerFactory() {
            override fun createWorker(context: Context, name: String, params: WorkerParameters): ListenableWorker = ImportWorker(context,params) { engine }
        }
        fun worker() = TestListenableWorkerBuilder<ImportWorker>(app).setWorkerFactory(factory).setInputData(workDataOf("jobId" to id)).build()
        val dao = app.database.dao()
        try {
            dao.save(ImportJob(id=id,paths=pages.joinToString("\n") { it.absolutePath }))
            assertEquals(ListenableWorker.Result.success(),worker().doWork())
            assertEquals(listOf(Triple(1,1,2),Triple(1,1,3),Triple(2,1,3),Triple(3,2,2)),calls)
            assertEquals("complete",dao.importJob(id)!!.status)
            assertNull(dao.question("$id-2-0"))
            val combined = dao.question("$id-1-0")!!
            assertTrue(combined.body.contains("完整末尾条件"))
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds=true }
            BitmapFactory.decodeFile(combined.sourcePath,bounds)
            assertEquals(1200,bounds.outHeight)
            assertNotNull(dao.question("$id-3-0"))
            dao.save(combined.copy(body="人工校对",reviewed=true))
            worker().doWork()
            assertEquals(4,calls.size)
            assertEquals("人工校对",dao.question(combined.id)!!.body)
        } finally {
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM questions WHERE id LIKE ?",arrayOf("$id%"))
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM imports WHERE id = ?",arrayOf(id))
            folder.listFiles()?.forEach { it.delete() }; folder.delete()
        }
    }
}
