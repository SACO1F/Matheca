package com.mathector.app

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.zip.ZipFile

class NativeDesktopBridgeTest {
    @Test fun editableNativeImagesAndPaperLayoutSurviveDesktopRoundTripAndStillExport(): Unit = runBlocking {
        val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
        val sourceName = "bridge-source-${UUID.randomUUID()}.db"; val targetName = "bridge-target-${UUID.randomUUID()}.db"
        val source = Room.databaseBuilder(app, MathectorDatabase::class.java, sourceName).build()
        val target = Room.databaseBuilder(app, MathectorDatabase::class.java, targetName).build()
        val knowledge = CustomKnowledgeStore(app, "bridge-knowledge-${UUID.randomUUID()}")
        val bitmap = Bitmap.createBitmap(20, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.RED) }
        val image = try { QuestionFigures.save(app, bitmap) } finally { bitmap.recycle() }
        val q = Question(id = "bridge-q", reviewed = true, kind = "选择题", body = "选择正确图形\nA. 甲\nB. 乙\nC. 丙\nD. 丁", figures = QuestionFigures.encode(listOf(image)), optionFigures = OptionFigures.encode(mapOf("B" to listOf(image))))
        val c = QuestionCollection(id = "bridge-c", title = "原生题集")
        val services = listOf(source, target).map { LibraryBackupService(app, it, knowledge) }
        try {
            source.dao().save(q); source.dao().save(c); source.dao().add(CollectionItem(c.id, q.id, 0, 60, true))
            services[0].createArchive(setOf(q.id), setOf(c.id)).use { archive ->
                ZipFile(archive.file).use { zip ->
                    assertFalse(zip.entries().asSequence().any { it.name.startsWith("figures/") })
                    val manifest = JSONObject(zip.getInputStream(zip.getEntry("manifest.json")).reader().readText())
                    val question = manifest.getJSONArray("questions").getJSONObject(0)
                    assertEquals("stem", question.getJSONArray("figurePlacements").getString(0)); assertEquals("B", question.getJSONArray("figurePlacements").getString(1))
                    assertTrue(question.getJSONArray("figures").getString(0).startsWith("data:image/png;base64,"))
                }
                services[1].prepare(archive.file.inputStream()).use { pending -> services[1].restore(pending) }
            }
            val received = target.dao().question(q.id)!!
            assertEquals(1, QuestionFigures.decode(received.figures).size); assertEquals(1, OptionFigures.decode(received.optionFigures).getValue("B").size)
            assertTrue(QuestionFigures.file(app, QuestionFigures.decode(received.figures).single()).isFile)
            val item = target.dao().orderedItems(c.id).single(); assertEquals(60, item.solutionSpace); assertTrue(item.newPage)
            val layout = mapOf(received.id to item.questionLayout(received))
            val word = DocumentExporter.export(app, c.title, listOf(received), true, layouts = layout)
            try { ZipFile(word).use { zip -> assertTrue(zip.entries().asSequence().any { it.name.startsWith("word/media/") }); assertTrue(zip.getInputStream(zip.getEntry("word/document.xml")).reader().readText().contains("drawing")) } } finally { word.delete() }
            val pdf = DocumentExporter.export(app, c.title, listOf(received), false, layouts = layout)
            try { ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY).use { d -> PdfRenderer(d).use { assertTrue(it.pageCount > 0) } } } finally { pdf.delete() }
            services[1].createArchive(setOf(q.id), setOf(c.id)).use { archive -> services[0].prepare(archive.file.inputStream()).use { pending -> assertEquals(0, services[0].assess(pending).conflicts) } }
            // The native full backup keeps its older attachment format and all native features.
            services[1].createArchive().use { archive -> services[0].prepare(archive.file.inputStream()).use { pending -> assertEquals(1, pending.summary.figures) } }
        } finally {
            source.close(); target.close(); app.deleteDatabase(sourceName); app.deleteDatabase(targetName)
            QuestionFigures.delete(app, listOf(image))
        }
    }
}
