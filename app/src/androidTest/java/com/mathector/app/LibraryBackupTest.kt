package com.mathector.app

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.semantics.SemanticsActions
import androidx.core.content.FileProvider
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class LibraryBackupTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<MathectorApplication>()
    private val validation get() = File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }
    private fun snapshot(tag: String, name: String) {
        val bitmap = compose.onNodeWithTag(tag, useUnmergedTree = true).captureToImage().asAndroidBitmap()
        try { File(validation, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
    }
    private fun fullSnapshot(name: String) {
        compose.waitForIdle()
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(validation, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
    }
    private fun database() = Room.inMemoryDatabaseBuilder(app, MathectorDatabase::class.java).build()

    private suspend fun fixture(source: MathectorDatabase, store: CustomKnowledgeStore, folder: File): Pair<Question, QuestionCollection> {
        folder.mkdirs()
        val image = File(folder, "original.png")
        val bitmap = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888)
        try { bitmap.eraseColor(android.graphics.Color.WHITE); image.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
        val point = store.add("函数", "备份校验-${UUID.randomUUID().toString().take(6)}")
        val base = Question(id = "backup-first", title = "函数练习", body = "已知 \\(f(x)=x^2\\)。\n（1）求值；\n（2）判断单调性。", latex = "x^2=999",
            grade = "高一", kind = "解答题", difficulty = "进阶", knowledge = "函数单调性、${point.name}", sourcePath = image.absolutePath, sourceLabel = "相册原图",
            reviewed = true, favorite = true, createdAt = 1, autoSolve = true, solution = "答案：\\(f(2)=4\\)", solutionLatex = "f(2)=4")
        val first = base.copy(solutionFingerprint = base.contentFingerprint())
        val second = first.copy(id = "backup-second", title = "未校对的题目", reviewed = false, favorite = false, createdAt = 2, solutionFingerprint = "stale")
        val collection = QuestionCollection(id = "backup-set", title = "阶段练习", paperTitle = "高中数学测试", examInstructions = "写出计算过程。", examMinutes = 90, totalScore = 100)
        source.dao().save(first); source.dao().save(second); source.dao().save(collection)
        source.dao().add(CollectionItem(collection.id, first.id, 4)); source.dao().add(CollectionItem(collection.id, second.id, 9))
        return first to collection
    }

    @Test fun portableBackupRestoresASeparateEmptyDatabaseWithOriginalsAnswersAndCollections() = runBlocking {
        val source = database(); val target = database()
        val suffix = UUID.randomUUID().toString()
        val sourceStore = CustomKnowledgeStore(app, "backup-source-$suffix")
        val targetStore = CustomKnowledgeStore(app, "backup-target-$suffix")
        val folder = File(app.cacheDir, "backup-fixture-$suffix")
        val beforeSettings = app.settings.state.value
        try {
            val (question, collection) = fixture(source, sourceStore, folder)
            val reader = LibraryBackupService(app, target, targetStore, File(folder, "restored"))
            LibraryBackupService(app, source, sourceStore).createArchive().use { archive ->
                assertEquals(BackupSummary(2, 1, 1, 1, 0, 0, 0), archive.summary)
                ZipFile(archive.file).use { zip ->
                    assertEquals(2, zip.size())
                    val manifest = zip.getInputStream(zip.getEntry("manifest.json")).bufferedReader().use { it.readText() }
                    assertFalse(manifest.contains(folder.absolutePath)); assertFalse(manifest.contains("encryptedKey")); assertFalse(manifest.contains("apiKey"))
                }
                reader.prepare(archive.file.inputStream()).use { prepared ->
                    assertEquals(archive.summary, prepared.summary)
                    val result = reader.restore(prepared)
                    assertEquals(RestoreResult(2, 1, 0, 0, 1), result)
                    val saved = requireNotNull(target.dao().question(question.id))
                    assertNotEquals(question.sourcePath, saved.sourcePath)
                    assertArrayEquals(File(question.sourcePath).readBytes(), File(saved.sourcePath).readBytes())
                    assertEquals(question.copy(sourcePath = saved.sourcePath, solutionFingerprint = saved.contentFingerprint()), saved)
                    assertEquals("", target.dao().question("backup-second")!!.solutionFingerprint)
                    assertEquals(collection, target.dao().backupCollections().single())
                    assertEquals(listOf(CollectionItem(collection.id, question.id, 0), CollectionItem(collection.id, "backup-second", 1)), target.dao().orderedItems(collection.id))
                    assertEquals(sourceStore.snapshot(), targetStore.snapshot())
                    assertTrue(KnowledgeCatalog.decode(saved.knowledge).contains(targetStore.snapshot().single().name))
                    assertEquals(beforeSettings, app.settings.state.value)
                }
            }
        } finally { source.close(); target.close(); folder.deleteRecursively(); app.deleteSharedPreferences("backup-source-$suffix"); app.deleteSharedPreferences("backup-target-$suffix"); app.knowledge.reload() }
    }

    @Test fun mergePreservesLocalEditsAndRepeatingTheBackupIsIdempotent() = runBlocking {
        val source = database(); val target = database()
        val suffix = UUID.randomUUID().toString()
        val sourceStore = CustomKnowledgeStore(app, "merge-source-$suffix")
        val targetStore = CustomKnowledgeStore(app, "merge-target-$suffix")
        val folder = File(app.cacheDir, "merge-fixture-$suffix")
        try {
            val (question, collection) = fixture(source, sourceStore, folder)
            val local = question.copy(body = "本机修改必须保留", sourcePath = "", favorite = false)
            val unrelated = Question(id = "local-only", title = "本机原题", body = "本机数据")
            target.dao().save(local); target.dao().save(unrelated)
            val reader = LibraryBackupService(app, target, targetStore, File(folder, "restored"))
            LibraryBackupService(app, source, sourceStore).createArchive().use { archive -> reader.prepare(archive.file.inputStream()).use { prepared ->
                assertEquals(RestoreResult(1, 1, 1, 0, 1), reader.restore(prepared))
                assertEquals(local, target.dao().question(local.id)); assertEquals(unrelated, target.dao().question(unrelated.id))
                assertEquals(listOf(local.id, "backup-second"), target.dao().orderedItems(collection.id).map { it.questionId })
                val edited = collection.copy(title = "本机题集名", examMinutes = 120)
                target.dao().save(edited)
                assertEquals(RestoreResult(0, 0, 2, 1, 0), reader.restore(prepared))
                assertEquals(3, target.dao().backupQuestions().size)
                assertEquals(edited, target.dao().backupCollections().single())
            } }
        } finally { source.close(); target.close(); folder.deleteRecursively(); app.deleteSharedPreferences("merge-source-$suffix"); app.deleteSharedPreferences("merge-target-$suffix"); app.knowledge.reload() }
    }

    @Test fun emptyLibrariesAndMissingOriginalsRemainRestorableWithoutLosingTheStems() = runBlocking {
        val source = database(); val target = database()
        val suffix = UUID.randomUUID().toString()
        val sourceStore = CustomKnowledgeStore(app, "missing-source-$suffix")
        val targetStore = CustomKnowledgeStore(app, "missing-target-$suffix")
        val folder = File(app.cacheDir, "missing-fixture-$suffix")
        try {
            val writer = LibraryBackupService(app, source, sourceStore)
            val reader = LibraryBackupService(app, target, targetStore, File(folder, "restored"))
            writer.createArchive().use { archive -> reader.prepare(archive.file.inputStream()).use { prepared ->
                assertEquals(BackupSummary(0, 0, 0, 0, 0, 0, 0), prepared.summary)
                assertEquals(RestoreResult(0, 0, 0, 0, 0), reader.restore(prepared))
            } }
            val (question, collection) = fixture(source, sourceStore, folder)
            assertTrue(File(question.sourcePath).delete())
            writer.createArchive().use { archive -> reader.prepare(archive.file.inputStream()).use { prepared ->
                assertEquals(BackupSummary(2, 1, 0, 1, 2, 0, 0), prepared.summary)
                assertEquals(RestoreResult(2, 1, 0, 0, 1), reader.restore(prepared))
                val restored = requireNotNull(target.dao().question(question.id))
                assertEquals(question.body, restored.body); assertEquals(question.latex, restored.latex)
                assertEquals(question.solution, restored.solution); assertEquals("", restored.sourcePath)
                assertEquals(restored.contentFingerprint(), restored.solutionFingerprint)
                assertEquals(collection, target.dao().backupCollections().single())
            } }
        } finally { source.close(); target.close(); folder.deleteRecursively(); app.deleteSharedPreferences("missing-source-$suffix"); app.deleteSharedPreferences("missing-target-$suffix"); app.knowledge.reload() }
    }

    @Test fun malformedArchivesAreRejectedBeforeAnyExistingLibraryDataChanges() = runBlocking {
        val source = database(); val target = database()
        val suffix = UUID.randomUUID().toString()
        val sourceStore = CustomKnowledgeStore(app, "invalid-source-$suffix")
        val targetStore = CustomKnowledgeStore(app, "invalid-target-$suffix")
        val folder = File(app.cacheDir, "invalid-fixture-$suffix")
        try {
            fixture(source, sourceStore, folder)
            val local = Question(title = "现有题目", body = "必须保持原样")
            target.dao().save(local)
            val reader = LibraryBackupService(app, target, targetStore, File(folder, "restored"))
            LibraryBackupService(app, source, sourceStore).createArchive().use { archive ->
                val entries = ZipFile(archive.file).use { zip -> zip.entries().asSequence().associate { it.name to zip.getInputStream(it).use { input -> input.readBytes() } } }
                fun packed(values: Map<String, ByteArray>): ByteArray = ByteArrayOutputStream().use { buffer ->
                    ZipOutputStream(buffer).use { zip -> values.forEach { (name, bytes) -> zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry() } }
                    buffer.toByteArray()
                }
                val manifest = JSONObject(String(entries.getValue("manifest.json"), Charsets.UTF_8))
                val imageName = entries.keys.first { it.startsWith("sources/") }
                val invalid = listOf(
                    "not a backup".toByteArray(),
                    packed(entries + ("../../escape.png" to byteArrayOf(1))),
                    packed(entries - imageName),
                    packed(entries + (imageName to byteArrayOf(1, 2, 3))),
                    packed(entries + ("manifest.json" to JSONObject(manifest.toString()).put("version", 999).toString().toByteArray())),
                    packed(entries + ("manifest.json" to JSONObject(manifest.toString()).put("format", "WrongApp").toString().toByteArray()))
                )
                for(bytes in invalid) {
                    try { reader.prepare(ByteArrayInputStream(bytes)).use { fail("Invalid archive must not reach import preview") } }
                    catch(error: Exception) { assertTrue(error.message.orEmpty().isNotBlank()) }
                    assertEquals(listOf(local), target.dao().backupQuestions())
                    assertTrue(target.dao().backupCollections().isEmpty()); assertTrue(targetStore.snapshot().isEmpty())
                    assertFalse(File(folder, "restored").exists())
                }
            }
        } finally { source.close(); target.close(); folder.deleteRecursively(); app.deleteSharedPreferences("invalid-source-$suffix"); app.deleteSharedPreferences("invalid-target-$suffix"); app.knowledge.reload() }
    }

    @Test fun databaseFailureRollsBackRecordsCustomKnowledgeAndCopiedImages() = runBlocking {
        val source = database(); val target = database()
        val suffix = UUID.randomUUID().toString()
        val sourceStore = CustomKnowledgeStore(app, "rollback-source-$suffix")
        val targetStore = CustomKnowledgeStore(app, "rollback-target-$suffix")
        val folder = File(app.cacheDir, "rollback-fixture-$suffix")
        try {
            val (question, _) = fixture(source, sourceStore, folder)
            val local = Question(title = "已有题目", body = "恢复失败时仍然保留")
            target.dao().save(local)
            target.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_backup BEFORE INSERT ON questions WHEN NEW.id = 'backup-first' BEGIN SELECT RAISE(ABORT, 'restore test failure'); END")
            val reader = LibraryBackupService(app, target, targetStore, File(folder, "restored"))
            LibraryBackupService(app, source, sourceStore).createArchive().use { archive -> reader.prepare(archive.file.inputStream()).use { prepared ->
                try { reader.restore(prepared); fail("Database failure must abort the restore") } catch(_: Exception) { }
                assertEquals(listOf(local), target.dao().backupQuestions()); assertTrue(target.dao().backupCollections().isEmpty())
                assertTrue(targetStore.snapshot().isEmpty())
                assertTrue(File(folder, "restored").listFiles().orEmpty().isEmpty())
                assertTrue(File(question.sourcePath).isFile)
            } }
        } finally { source.close(); target.close(); folder.deleteRecursively(); app.deleteSharedPreferences("rollback-source-$suffix"); app.deleteSharedPreferences("rollback-target-$suffix"); app.knowledge.reload() }
    }

    private fun monitor(action: String, code: Int, data: Intent?): Instrumentation.ActivityMonitor {
        val filter = IntentFilter(action).apply { addCategory(Intent.CATEGORY_OPENABLE); addDataType("*/*") }
        return InstrumentationRegistry.getInstrumentation().addMonitor(filter, Instrumentation.ActivityResult(code, data), true)
    }
    @Test fun systemDocumentContractsExportPreviewCancelAndRestoreTheMissingFixture() {
        val dao = app.database.dao()
        val suffix = UUID.randomUUID().toString().take(6)
        val q = Question(id = "document-backup-$suffix", title = "备份恢复验证", body = "求函数 \\(f(x)=x^2\\) 的值。", grade = "高一", knowledge = "函数单调性", difficulty = "基础", favorite = true, reviewed = true, autoSolve = true)
        val c = QuestionCollection(id = "document-collection-$suffix", title = "备份题集", paperTitle = "数学练习", examMinutes = 90, totalScore = 100)
        val backup = File(File(app.cacheDir, "exports").apply { mkdirs() }, "saf-backup-$suffix.zip")
        val uri = FileProvider.getUriForFile(app, "${app.packageName}.files", backup)
        val settingsBefore = app.settings.state.value
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        runBlocking { dao.save(q); dao.save(c); dao.addQuestions(c.id, listOf(q.id)) }
        try {
            compose.onNodeWithTag("library-backup-open").performClick()
            val exportMonitor = monitor(Intent.ACTION_CREATE_DOCUMENT, Activity.RESULT_OK, Intent().setData(uri))
            try {
                compose.onNodeWithTag("backup-dialog-export").performClick()
                compose.waitUntil(20_000) { backup.length() > 0 && compose.onAllNodesWithTag("backup-progress").fetchSemanticsNodes().isEmpty() }
                assertEquals(1, exportMonitor.hits)
            } finally { instrumentation.removeMonitor(exportMonitor) }
            runBlocking { dao.deleteCollection(c.id); dao.deleteQuestion(q.id) }
            fun pickBackup() {
                compose.onNodeWithTag("library-backup-open").performClick()
                val importMonitor = monitor(Intent.ACTION_OPEN_DOCUMENT, Activity.RESULT_OK, Intent().setData(uri))
                try {
                    compose.onNodeWithTag("backup-dialog-import").performClick()
                    compose.waitUntil(20_000) { compose.onAllNodesWithTag("backup-import-preview").fetchSemanticsNodes().isNotEmpty() }
                    assertEquals(1, importMonitor.hits)
                } finally { instrumentation.removeMonitor(importMonitor) }
            }
            pickBackup()
            fullSnapshot("backup-import-preview-0.21.0.png")
            compose.onNodeWithTag("backup-import-cancel").performClick()
            assertNull(runBlocking { dao.question(q.id) })
            pickBackup()
            compose.onNodeWithTag("backup-import-confirm").performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithTag("backup-progress").fetchSemanticsNodes().isEmpty() && runBlocking { dao.question(q.id) != null } }
            assertEquals(q, runBlocking { dao.question(q.id) })
            assertEquals(c, runBlocking { dao.backupCollections().first { it.id == c.id } })
            assertEquals(listOf(q.id), runBlocking { dao.orderedItems(c.id).map { it.questionId } })
            assertEquals(settingsBefore, app.settings.state.value)
            assertTrue(WorkManager.getInstance(app).getWorkInfosForUniqueWork(SolutionScheduler.name(q.id)).get().isEmpty())
            val count = runBlocking { dao.backupQuestions().size }
            pickBackup(); compose.onNodeWithTag("backup-import-confirm").performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithTag("backup-import-preview").fetchSemanticsNodes().isEmpty() && compose.onAllNodesWithTag("backup-progress").fetchSemanticsNodes().isEmpty() }
            assertEquals(count, runBlocking { dao.backupQuestions().size })
            compose.onNodeWithTag("nav-profile").performClick()
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("library-backup-settings"))
            // The floating navigation overlays the bottom of the scroll viewport; expose the action before tapping it.
            compose.onNodeWithTag("settings-list").performTouchInput { swipeUp(startY=height*.65f,endY=height*.35f) }
            val cancelMonitor = monitor(Intent.ACTION_OPEN_DOCUMENT, Activity.RESULT_CANCELED, null)
            try {
                compose.onNodeWithTag("backup-settings-import").performClick()
                compose.waitUntil(5_000) { cancelMonitor.hits == 1 }
                assertEquals(1, cancelMonitor.hits)
                compose.onNodeWithTag("backup-import-preview").assertDoesNotExist()
            } finally { instrumentation.removeMonitor(cancelMonitor) }
            snapshot("library-backup-settings", "backup-settings-0.21.0.png")
        } finally { runBlocking { dao.deleteCollection(c.id); dao.deleteQuestion(q.id) }; backup.delete() }
    }

    @Test fun compactStatisticsCenterNumbersAndLabelsInEqualColumnsInBothThemes() {
        val dao = app.database.dao()
        val original = app.settings.state.value.theme
        val fixtures = (1..3).map { Question(title = "高中数学函数练习 $it", body = "已知函数 \\(f(x)=x^2+$it\\)，求函数值。", grade = "高一", knowledge = "函数单调性", difficulty = "基础", reviewed = it > 1, favorite = it == 3) }
        runBlocking { fixtures.forEach { dao.save(it) } }
        try {
            val questions = runBlocking { dao.backupQuestions() }
            fun layout(tag: String): TextLayoutResult {
                val results = mutableListOf<TextLayoutResult>()
                compose.onNodeWithTag(tag, useUnmergedTree = true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
                return results.single()
            }
            for(theme in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                compose.onNodeWithTag("library-list").performScrollToIndex(0)
                val card = compose.onNodeWithTag("library-statistics").fetchSemanticsNode().boundsInRoot
                assertTrue("The statistics card is compact", card.height <= 74f * compose.activity.resources.displayMetrics.density)
                for(id in listOf("total", "pending", "favorite")) {
                    val number = layout("library-stat-$id-number")
                    val label = layout("library-stat-$id-label")
                    val numberBounds = compose.onNodeWithTag("library-stat-$id-number", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
                    val labelBounds = compose.onNodeWithTag("library-stat-$id-label", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
                    assertEquals(numberBounds.left + (number.getLineLeft(0) + number.getLineRight(0)) / 2f,
                        labelBounds.left + (label.getLineLeft(0) + label.getLineRight(0)) / 2f, 1.5f)
                    assertTrue(numberBounds.bottom <= labelBounds.top)
                    assertEquals(compose.onNodeWithTag("library-stat-total").fetchSemanticsNode().boundsInRoot.width,
                        compose.onNodeWithTag("library-stat-$id").fetchSemanticsNode().boundsInRoot.width, 1f)
                }
                compose.onNodeWithTag("library-stat-total-number").assertTextEquals(questions.size.toString())
                compose.onNodeWithTag("library-stat-pending-number").assertTextEquals(questions.count { !it.reviewed }.toString())
                compose.onNodeWithTag("library-stat-favorite-number").assertTextEquals(questions.count { it.favorite }.toString())
                val mode = if(theme == ThemeMode.DARK) "dark" else "light"
                fullSnapshot("library-compact-statistics-$mode-0.21.0.png")
                compose.onNodeWithTag("library-backup-open").performClick()
                snapshot("library-backup-dialog", "library-backup-dialog-$mode-0.21.0.png")
                compose.onNodeWithText("完成").performClick()
            }
        } finally { app.settings.setTheme(original); runBlocking { fixtures.forEach { dao.deleteQuestion(it.id) } } }
    }
}
