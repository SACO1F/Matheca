package com.mathector.app

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.*
import androidx.work.testing.TestListenableWorkerBuilder
import com.mathector.app.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SolutionTest {
    @Test fun upgradeFromV3PreservesAnswersAndCollectionsAndAddsPaperSettings(): Unit = runBlocking {
        val name = "migration-v3-${UUID.randomUUID()}.db"
        val old = Question(id = "old", title = "函数题", body = "已知函数 x²。\n求导。\n证明单调性。", solution = "已有答案", solutionLatex = "2x", sourcePath = "/original.jpg")
        val schema = InstrumentationRegistry.getInstrumentation().context.assets.open("schema-v3.json").use { JSONObject(it.bufferedReader().readText()).getJSONObject("database") }
        SQLiteDatabase.openOrCreateDatabase(app.getDatabasePath(name), null).use { legacy ->
            val entities = schema.getJSONArray("entities")
            repeat(entities.length()) { index ->
                val entity = entities.getJSONObject(index)
                legacy.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", entity.getString("tableName")))
                val indices = entity.optJSONArray("indices") ?: org.json.JSONArray()
                repeat(indices.length()) { n -> legacy.execSQL(indices.getJSONObject(n).getString("createSql").replace("\${TABLE_NAME}", entity.getString("tableName"))) }
            }
            legacy.execSQL("INSERT INTO questions (id,title,body,latex,grade,kind,difficulty,knowledge,sourcePath,sourceLabel,reviewed,favorite,example,createdAt,autoSolve,solution,solutionLatex,solutionFingerprint,solutionError) VALUES (?,?,?,'','高二','解答题','基础','',?,'手动录入',1,1,0,1,0,?,?,?,'')", arrayOf(old.id, old.title, old.body, old.sourcePath, old.solution, old.solutionLatex, old.contentFingerprint()))
            legacy.execSQL("INSERT INTO collections VALUES ('collection','旧题集',1)")
            legacy.execSQL("INSERT INTO collections VALUES ('long-collection',?,2)", arrayOf(" 标题".repeat(90)))
            legacy.execSQL("INSERT INTO collection_items VALUES ('collection','old',0)")
            legacy.version = 3
        }
        val migrated = Room.databaseBuilder(app, MathectorDatabase::class.java, name).addMigrations(MathectorDatabase.MIGRATION_3_4, MathectorDatabase.MIGRATION_4_5, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_6_9, MathectorDatabase.MIGRATION_7_9).build()
        try {
            val saved = migrated.dao().question(old.id)!!
            assertEquals("已知函数 x²。\n（1）求导。\n（2）证明单调性。", saved.body)
            assertEquals(old.solution, saved.solution); assertEquals(old.solutionLatex, saved.solutionLatex)
            assertEquals(saved.contentFingerprint(), saved.solutionFingerprint); assertEquals(old.sourcePath, saved.sourcePath)
            assertTrue(saved.favorite); assertTrue(saved.reviewed)
            val collections = migrated.dao().collections().first()
            val collection = collections.first { it.id == "collection" }
            assertEquals("旧题集", collection.paperTitle); assertEquals(PaperSettings(title = "旧题集"), collection.paperSettings())
            val longTitle = collections.first { it.id == "long-collection" }
            assertEquals(80, longTitle.paperTitle.length); longTitle.paperSettings().validated()
            assertEquals(old.id, migrated.dao().orderedItems(collection.id).single().questionId)
            migrated.dao().savePaperSettings(collection.id, "阶段测试", "请检查题号。", 120, 150)
            assertEquals(PaperSettings("阶段测试", "请检查题号。", 120, 150), migrated.dao().collections().first().first { it.id == collection.id }.paperSettings())
        } finally { migrated.close(); app.deleteDatabase(name) }
    }

    @Test fun numberingMigrationPreservesPreviouslyValidSolution(): Unit = runBlocking {
        val name = "migration-v2-${UUID.randomUUID()}.db"
        val old = Question(id = "old", title = "9. 导数题", body = "9. 已知函数 x²。\n（1）求导。", solution = "答案：2x")
        val schema = InstrumentationRegistry.getInstrumentation().context.assets.open("schema-v2.json").use { JSONObject(it.bufferedReader().readText()).getJSONObject("database") }
        SQLiteDatabase.openOrCreateDatabase(app.getDatabasePath(name), null).use { legacy ->
            val entities = schema.getJSONArray("entities")
            repeat(entities.length()) { index ->
                val entity = entities.getJSONObject(index)
                legacy.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", entity.getString("tableName")))
                val indices = entity.optJSONArray("indices") ?: org.json.JSONArray()
                repeat(indices.length()) { n -> legacy.execSQL(indices.getJSONObject(n).getString("createSql").replace("\${TABLE_NAME}", entity.getString("tableName"))) }
            }
            legacy.execSQL("INSERT INTO questions (id,title,body,latex,grade,kind,difficulty,knowledge,sourcePath,sourceLabel,reviewed,favorite,example,createdAt,autoSolve,solution,solutionLatex,solutionFingerprint,solutionError) VALUES (?,?,?,'','高二','解答题','基础','','','手动录入',1,1,0,1,0,?,'',?,'')", arrayOf(old.id, old.title, old.body, old.solution, old.contentFingerprint()))
            legacy.version = 2
        }
        val migrated = Room.databaseBuilder(app, MathectorDatabase::class.java, name).addMigrations(MathectorDatabase.MIGRATION_2_3, MathectorDatabase.MIGRATION_3_4, MathectorDatabase.MIGRATION_4_5, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_6_9, MathectorDatabase.MIGRATION_7_9).build()
        try {
            val saved = migrated.dao().question(old.id)!!
            assertEquals("导数题", saved.title); assertEquals("已知函数 x²。\n求导。", saved.body)
            assertEquals(old.solution, saved.solution); assertEquals(saved.contentFingerprint(), saved.solutionFingerprint)
            assertTrue(saved.favorite); assertTrue(saved.reviewed)
        } finally { migrated.close(); app.deleteDatabase(name) }
    }
    private val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val dao get() = app.database.dao()
    private fun question() = Question(id = "solution-test-${UUID.randomUUID()}", body = "求函数 f(x)=x² 在 x=3 处的导数。", latex = "f(x)=x^2", grade = "高二", knowledge = "导数概念与运算")
    private fun response() = """{"choices":[{"finish_reason":"stop","message":{"content":"{\"answer\":\"6\",\"steps\":[\"由幂函数求导法则得 f'(x)=2x。\",\"代入 x=3，得 f'(3)=6。\"],\"latex\":\"f'(3)=2\\\\times3=6\"}"}}]}"""
    private fun worker(q: Question, solver: QuestionSolver) = TestListenableWorkerBuilder<SolutionWorker>(app)
        .setInputData(workDataOf("questionId" to q.id, "fingerprint" to q.contentFingerprint()))
        .setWorkerFactory(object : WorkerFactory() {
            override fun createWorker(appContext: android.content.Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker = SolutionWorker(appContext, workerParameters) { solver }
        }).build()

    @Test fun solutionUsesConfiguredApiAndPersistsAnswerStepsAndFormula() = runBlocking {
        val q = question(); dao.save(q)
        try {
            var calls = 0
            val config = MultimodalConfig(chatCompletionsEndpoint("https://solution.example/v1"), "vision-solver", "isolated-test-key")
            val client = MultimodalRecognitionEngine.httpClient().newBuilder().addInterceptor { chain ->
                calls++
                val buffer = Buffer(); chain.request().body!!.writeTo(buffer)
                val payload = JSONObject(buffer.readUtf8())
                assertEquals("vision-solver", payload.getString("model"))
                assertEquals("Bearer isolated-test-key", chain.request().header("Authorization"))
                val prompt = payload.getJSONArray("messages").getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("text")
                assertTrue(prompt.contains(q.body)); assertTrue(prompt.contains("分步推导"))
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("Fixture").body(response().toResponseBody("application/json".toMediaType())).build()
            }.build()
            worker(q, MultimodalRecognitionEngine(config, client)).doWork()
            assertEquals(1, calls)
            val saved = dao.question(q.id)!!
            assertTrue(saved.solution.contains("答案：6")); assertTrue(saved.solution.contains("2. 代入"))
            assertEquals("f'(3)=2\\times3=6", saved.solutionLatex)
            assertEquals(q.contentFingerprint(), saved.solutionFingerprint)
            assertEquals("", saved.solutionError)
            assertFalse("AI answers never silently mark a question reviewed", saved.reviewed)
            try { MultimodalRecognitionEngine.decodeSolution("""{"choices":[{"message":{"content":"{\"answer\":\"6\",\"steps\":[]}"}}]}"""); fail("Empty reasoning must be rejected") } catch (_: IllegalArgumentException) { }
        } finally { dao.deleteQuestion(q.id) }
    }

    @Test fun lateSolutionCannotOverwriteAnEditedQuestionAndFailureCanRetry() = runBlocking {
        val q = question(); dao.save(q)
        try {
            worker(q, object : QuestionSolver { override suspend fun solve(question: Question): SolutionResult {
                dao.save(question.copy(body = "已校对的新题干", knowledge = "函数单调性"))
                return SolutionResult("旧答案", listOf("旧步骤"))
            } }).doWork()
            assertEquals("已校对的新题干", dao.question(q.id)!!.body)
            assertEquals("", dao.question(q.id)!!.solution)
            val changed = dao.question(q.id)!!
            worker(changed, object : QuestionSolver { override suspend fun solve(question: Question): SolutionResult = error("服务暂时不可用") }).doWork()
            assertEquals("服务暂时不可用", dao.question(q.id)!!.solutionError)
            worker(changed, object : QuestionSolver { override suspend fun solve(question: Question) = SolutionResult("新答案", listOf("新步骤")) }).doWork()
            assertTrue(dao.question(q.id)!!.solution.contains("新答案"))
            assertEquals("", dao.question(q.id)!!.solutionError)
        } finally { dao.deleteQuestion(q.id) }
    }

    @Test fun cancelledSolutionCannotWriteAnAnswer() = runBlocking {
        val q = question(); dao.save(q)
        val started = CompletableDeferred<Unit>(); val cancelled = CompletableDeferred<Unit>()
        try {
            val task = launch {
                worker(q, object : QuestionSolver { override suspend fun solve(question: Question): SolutionResult = suspendCancellableCoroutine { continuation ->
                    started.complete(Unit); continuation.invokeOnCancellation { cancelled.complete(Unit) }
                } }).doWork()
            }
            withTimeout(5000) { started.await() }
            task.cancelAndJoin()
            assertTrue(cancelled.isCompleted)
            assertEquals("", dao.question(q.id)!!.solution)
        } finally { dao.deleteQuestion(q.id) }
    }

    @Test fun upgradeFromV1PreservesQuestionAndCollectionWhileNormalizingClassifications(): Unit = runBlocking {
        val name = "migration-test-${UUID.randomUUID()}.db"
        val schema = InstrumentationRegistry.getInstrumentation().context.assets.open("schema-v1.json").use { JSONObject(it.bufferedReader().readText()).getJSONObject("database") }
        val legacy = SQLiteDatabase.openOrCreateDatabase(app.getDatabasePath(name), null)
        try {
            val entities = schema.getJSONArray("entities")
            repeat(entities.length()) { index ->
                val entity = entities.getJSONObject(index)
                legacy.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", entity.getString("tableName")))
                val indexes = entity.optJSONArray("indices") ?: org.json.JSONArray()
                repeat(indexes.length()) { n -> legacy.execSQL(indexes.getJSONObject(n).getString("createSql").replace("\${TABLE_NAME}", entity.getString("tableName"))) }
            }
            legacy.execSQL("INSERT INTO questions VALUES ('old', '12. 旧题保留', '12. 原始题干' || char(10) || '（1）求解。', '', '八年级', '解答题', '基础', '勾股定理、导数、集合的运算', '', '原图', 1, 1, 0, 1)")
            legacy.execSQL("INSERT INTO collections VALUES ('collection', '旧题集', 1)")
            legacy.execSQL("INSERT INTO collection_items VALUES ('collection', 'old', 0)")
            legacy.version = 1
        } finally { legacy.close() }
        val migrated = Room.databaseBuilder(app, MathectorDatabase::class.java, name).addMigrations(MathectorDatabase.MIGRATION_1_2, MathectorDatabase.MIGRATION_2_3, MathectorDatabase.MIGRATION_3_4, MathectorDatabase.MIGRATION_4_5, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_6_9, MathectorDatabase.MIGRATION_7_9).build()
        try {
            val q = migrated.dao().question("old")!!
            assertEquals("旧题保留", q.title); assertEquals("原始题干\n求解。", q.body); assertTrue(q.favorite); assertTrue(q.reviewed)
            assertEquals("", q.grade)
            assertEquals(listOf("导数概念与运算", "集合的运算"), KnowledgeCatalog.decode(q.knowledge))
            assertEquals("old", migrated.dao().orderedItems("collection").single().questionId)
            assertFalse(q.autoSolve); assertEquals("", q.solution)
        } finally { migrated.close(); app.deleteDatabase(name) }
    }
}
