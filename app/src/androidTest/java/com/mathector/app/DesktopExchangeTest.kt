package com.mathector.app

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.net.Uri
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.zip.ZipFile

@RunWith(AndroidJUnit4::class)
class DesktopExchangeTest {
    private val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
    @Test fun desktopNativeTransportOfflineQueueConflictAndRoundTrip() = runBlocking {
        val link = InstrumentationRegistry.getArguments().getString("desktopUrl") ?: error("desktopUrl argument is required; use the desktop cross-device validation script")
        val root = File(app.cacheDir, "exchange-test-${UUID.randomUUID()}").apply { mkdirs() }
        val prefs = "exchange-test-${UUID.randomUUID()}"
        val context = object : ContextWrapper(app) {
            override fun getFilesDir() = root
            override fun getCacheDir() = File(root, "cache").apply { mkdirs() }
            override fun getSharedPreferences(name: String, mode: Int) = app.getSharedPreferences(prefs + name, mode)
        }
        val source = Room.inMemoryDatabaseBuilder(app, MathectorDatabase::class.java).build()
        val target = Room.inMemoryDatabaseBuilder(app, MathectorDatabase::class.java).build()
        val knowledge = CustomKnowledgeStore(app, prefs)
        val service = LibraryBackupService(context, source, knowledge, File(root, "source-images"))
        val receiver = LibraryBackupService(context, target, knowledge, File(root, "target-images"))
        try {
            val native = Question(id = "native-only", title = "手机已有题目", body = "求 2+2。", reviewed = true, createdAt = 100L)
            source.dao().save(native)
            val bitmap = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888)
            val photo = File(root, "photo.png")
            try { bitmap.eraseColor(android.graphics.Color.WHITE); photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
            val first = DesktopLinkService(context)
            first.addPhotos(listOf(Uri.fromFile(photo)))
            service.createArchive(setOf(native.id), emptySet()).use { first.addLibrary(it.file, "手机题目.zip") }
            val restoredQueue = DesktopLinkService(context)
            assertEquals(2, restoredQueue.queue.value.size)
            assertTrue(restoredQueue.queue.value.all { it.status == "queued" })
            restoredQueue.connect(link)
            val deadline = System.currentTimeMillis() + 30000
            while(restoredQueue.state.value?.optBoolean("approved") != true && System.currentTimeMillis() < deadline) { delay(300); restoredQueue.poll() }
            assertTrue("desktop approval required", restoredQueue.state.value!!.getBoolean("approved"))
            restoredQueue.remember()
            val savedId=restoredQueue.savedDesktops.value.single().id
            restoredQueue.disconnect()
            val rememberedClient=DesktopLinkService(context)
            rememberedClient.reconnect(savedId)
            assertTrue(rememberedClient.state.value!!.getBoolean("approved"))
            rememberedClient.disconnect()
            restoredQueue.reconnect(savedId)
            restoredQueue.send()
            assertTrue(restoredQueue.queue.value.all { it.status == "sent" })
            // Recreating the client recovers stable queue IDs and sent state.
            assertTrue(DesktopLinkService(context).queue.value.all { it.status == "sent" })
            val transfers = restoredQueue.state.value!!.getJSONArray("transfers")
            val transfer = (0 until transfers.length()).map { transfers.getJSONObject(it) }.first { it.getString("name").endsWith(".zip") }
            val downloaded = restoredQueue.downloadLibrary(transfer.getString("id"), transfer.getLong("size"))
            receiver.prepare(downloaded.inputStream()).use { prepared ->
                val preview = receiver.assess(prepared)
                assertEquals(0, preview.conflicts)
                receiver.restore(prepared, "keep", preview.version)
                val q = target.dao().question("desktop-q")!!
                assertEquals("桌面标准格式", q.title)
                assertEquals(1, JSONArray(q.figuresJson).length())
                assertEquals("B", JSONArray(q.figurePlacementsJson).getString(0))
                assertEquals(80, JSONArray(q.figureWidthsJson).getInt(0))
                assertTrue(File(q.sourcePath).isFile)
                assertTrue(q.reviewed)
                assertEquals(q.contentFingerprint(), q.solutionFingerprint)
                val c = target.dao().backupCollections().single()
                assertEquals(60, JSONObject(c.questionLayoutJson).getJSONObject(q.id).getInt("answerSpaceMm"))
                assertTrue(JSONObject(c.questionLayoutJson).getJSONObject(q.id).getBoolean("pageBreakBefore"))
                assertEquals(listOf("desktop-q", "desktop-second"), target.dao().orderedItems(c.id).map { it.questionId })
                assertEquals(0, receiver.assess(prepared).conflicts)
                assertEquals(3, receiver.assess(prepared).repeated)
                val remote=restoredQueue.remoteInventory(); val local=receiver.exchangeInventory()
                assertEquals("portable question hashes must match across runtimes",remote.getJSONObject("questions").getString(q.id),local.getJSONObject("questions").getString(q.id))
                assertEquals("portable collection hashes must match across runtimes",remote.getJSONObject("collections").getString(c.id),local.getJSONObject("collections").getString(c.id))
                val unchanged=receiver.changedSelection(setOf(q.id),setOf(c.id),remote)
                assertTrue(unchanged.first.isEmpty()); assertTrue(unchanged.second.isEmpty())
                restoredQueue.inventoryProvider={receiver.exchangeInventory()}; restoredQueue.poll(true)
                // Export before conflict tests: desktop inspects the actual Android round-trip ZIP.
                val output = File(app.getExternalFilesDir(null), "phase2-roundtrip.zip")
                receiver.createArchive(setOf(q.id), setOf(c.id)).use { it.file.copyTo(output, overwrite = true) }
                target.dao().save(q.copy(body = "手机人工修改，必须保留"))
                val changed=receiver.changedSelection(emptySet(),setOf(c.id),remote)
                assertEquals(setOf(q.id),changed.first); assertTrue(changed.second.isEmpty())
                val conflict = receiver.assess(prepared)
                assertEquals(1, conflict.conflicts)
                receiver.restore(prepared, "copy", conflict.version)
                assertEquals("手机人工修改，必须保留", target.dao().question(q.id)!!.body)
                assertEquals(3, target.dao().backupQuestions().size)
                receiver.restore(prepared, "copy", receiver.assess(prepared).version)
                assertEquals(3, target.dao().backupQuestions().size)
                receiver.restore(prepared, "replace", receiver.assess(prepared).version)
                assertEquals(q.body, target.dao().question(q.id)!!.body)
            }
            downloaded.delete()
            restoredQueue.disconnect()
            val summary = JSONObject().put("offlineQueue", true).put("transport", true).put("desktopFields", true).put("conflicts", true).put("idempotentCopy", true).put("noRecognitionJobs", true)
            File(app.getExternalFilesDir(null), "phase2-result.txt").writeText(summary.toString())
        } finally { source.close(); target.close(); root.deleteRecursively() }
    }
}
