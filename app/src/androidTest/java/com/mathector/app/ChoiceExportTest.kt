package com.mathector.app

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.graphics.Bitmap
import android.graphics.Color
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.w3c.dom.Element
import java.io.File
import java.util.UUID
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import java.text.Normalizer

@RunWith(AndroidJUnit4::class)
class ChoiceExportTest {
    private val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
    @Test fun logarithmQuestionExportsOnlyTheFormulaAtItsOriginalBodyPosition(): Unit = runBlocking {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        var activity: MainActivity? = null
        scenario.onActivity { activity = it }
        val q = Question(kind = "选择题", reviewed = true,
            body = "函数 \\(f(x)=\\log_{0.5}(x^2-5x-6)\\) 的单调增区间是（ ）\nA. \\(\\left(\\frac{5}{2},+\\infty\\right)\\)\nB. \\(\\left(-\\infty,\\frac{5}{2}\\right)\\)\nC. \\(\\left(-\\infty,2\\right)\\)\nD. \\(\\left(-\\infty,-1\\right)\\)",
            latex = "f(x)=\\log_{\\frac{1}{2}}(x^2-5x-6)")
        val folder = File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }
        try {
            val pdf = DocumentExporter.export(activity!!, "重复公式修复验证", listOf(q), word = false)
            try {
                pdf.copyTo(File(folder, "duplicate-formula-export-0.6.0.pdf"), overwrite = true)
                ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                    PdfRenderer(descriptor).use { renderer ->
                        assertEquals(1, renderer.pageCount)
                        renderer.openPage(0).use { page ->
                            val text = normalizedPdfText(page.textContents.joinToString(" ") { it.text })
                            listOf("A.", "B.", "C.", "D.").forEach { assertTrue(text, text.contains(it)) }
                            // Validate the visible PDF, since imageContents can omit untagged bitmap objects.
                            val bitmap = Bitmap.createBitmap(page.width * 2, page.height * 2, Bitmap.Config.ARGB_8888)
                            try {
                                bitmap.eraseColor(Color.WHITE)
                                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                var stemInk = 0; var optionInk = 0; var unexpectedInk = 0
                                for(y in 80 until 1604) for(x in 80 until 1110) {
                                    if(Color.red(bitmap.getPixel(x,y)) < 180) {
                                        when { y < 130 -> stemInk++; y < 240 -> optionInk++; else -> unexpectedInk++ }
                                    }
                                }
                                assertTrue("The original stem formula must remain visible", stemInk > 100)
                                assertTrue("All original options must remain visible", optionInk > 100)
                                assertEquals("There must be no extra formula row pushing the options down", 0, unexpectedInk)
                            } finally { bitmap.recycle() }
                        }
                    }
                }
            } finally { pdf.delete() }
            val word = DocumentExporter.export(activity!!, "重复公式修复验证", listOf(q), word = true)
            try {
                word.copyTo(File(folder, "duplicate-formula-export-0.6.0.docx"), overwrite = true)
                ZipFile(word).use { zip ->
                    val xml = zip.getInputStream(zip.getEntry("word/document.xml")).use { DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(it) }
                    assertEquals(5, xml.getElementsByTagName("w:drawing").length)
                    val table = xml.getElementsByTagName("w:tbl").item(0) as Element
                    assertEquals(1, table.getElementsByTagName("w:tr").length)
                    assertEquals(4, table.getElementsByTagName("w:tc").length)
                }
            } finally { word.delete() }
        } finally { scenario.close() }
    }
    private fun examples() = listOf(
        Question(kind = "选择题", body = "选择题一：下列哪个值与 \\(\\sqrt{2}\\) 相等？\nA. \\(\\sqrt{2}\\)\nB. \\(\\sqrt{3}\\)\nC. 2\nD. 4", reviewed = true),
        Question(kind = "选择题", body = "选择题二：关于函数的单调性，下列说法正确的是（ ）\nA. 在任意区间内函数一定单调递增\nB. 在给定区间内导数为正则单调递增\nC. 定义域中的函数值一定全部为正数\nD. 具有相同最值的函数图像一定相同", reviewed = true),
        Question(kind = "选择题", body = "选择题三：分析题意后，选择正确表述。\nA. 判断函数单调性时，需要先确定定义域，再检查指定区间内函数值或导数的变化情况，不能忽略分段、端点以及表达式成立所需的条件。\nB. \\(x^2+\\frac{1}{2}\\)\nC. 是命题“p且q”的否定\nD. 条件不足，需要更多信息", reviewed = true)
    )
    // PdfRenderer can map visually identical Chinese glyphs to Unicode radical characters.
    private fun normalizedPdfText(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .replace('\u2ED3', '长').replace(Regex("\\s+"), "")
    private fun pdfText(file: File): Pair<Int, String> = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer -> renderer.pageCount to (0 until renderer.pageCount).joinToString("\n") { n ->
            renderer.openPage(n).use { page -> page.textContents.joinToString(" ") { it.text } }
        }.let(::normalizedPdfText) }
    }
    @Test fun fourShortOptionsUseOneRowAndLongOptionsUseTwoRowsInBothFormats(): Unit = runBlocking {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        var activity: MainActivity? = null
        scenario.onActivity { activity = it }
        val folder = File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }
        try {
            val questions = examples()
            val pdf = DocumentExporter.export(activity!!, "选择题排版验证", questions, word = false)
            try {
                pdf.copyTo(File(folder, "choices-export-0.5.0.pdf"), overwrite = true)
                val (pages, text) = pdfText(pdf)
                File(folder, "choices-export-text.txt").writeText(text)
                assertEquals(1, pages)
                assertTrue(text.contains("在给定区间内导数为正则单调递增"))
                assertTrue(text.contains("不能忽略分段、端点以及表达式成立所需的条件"))
                assertTrue(text.contains(normalizedPdfText("条件不足，需要更多信息")))
                assertFalse(text.contains("\\sqrt"))
            } finally { pdf.delete() }
            val word = DocumentExporter.export(activity!!, "选择题排版验证", questions, word = true)
            word.copyTo(File(folder, "choices-export-0.5.0.docx"), overwrite = true)
            try { ZipFile(word).use { zip ->
                val xml = zip.getInputStream(zip.getEntry("word/document.xml")).use { DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(it) }
                val tables = xml.getElementsByTagName("w:tbl")
                assertEquals(3, tables.length)
                val expectedRows = listOf(1, 2, 2)
                repeat(3) { index ->
                    val table = tables.item(index) as Element
                    val rows = table.getElementsByTagName("w:tr")
                    assertEquals(expectedRows[index], rows.length)
                    repeat(rows.length) { n ->
                        val cells = (rows.item(n) as Element).getElementsByTagName("w:tc")
                        assertEquals(if(index == 0) 4 else 2, cells.length)
                        repeat(cells.length) { cell ->
                            val text = (cells.item(cell) as Element).getElementsByTagName("w:t").item(0).textContent
                            assertTrue(text.startsWith("${('A'.code + if(index == 0) cell else n * 2 + cell).toChar()}. "))
                        }
                    }
                    val grid = table.getElementsByTagName("w:gridCol")
                    assertEquals(10300, (0 until grid.length).sumOf { (grid.item(it) as Element).getAttribute("w:w").toInt() })
                }
                zip.entries().asSequence().filter { it.name.endsWith(".xml") || it.name.endsWith(".rels") }.forEach { entry -> zip.getInputStream(entry).use { DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(it) } }
                assertTrue(zip.entries().asSequence().any { it.name.startsWith("word/media/") })
            } } finally { word.delete() }
        } finally { scenario.close() }
    }
    /** Rendered ink of every page, used to prove a per-option image really reaches the document. */
    private fun ink(file: File): Int = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer -> (0 until renderer.pageCount).sumOf { index -> renderer.openPage(index).use { page ->
            val bitmap = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                var count = 0
                for(y in 0 until bitmap.height) for(x in 0 until bitmap.width) if(Color.red(bitmap.getPixel(x, y)) < 180) count++
                count
            } finally { bitmap.recycle() }
        } } }
    }

    @Test fun optionImagesAreDrawnUnderTheirOwnChoiceInBothFormats(): Unit = runBlocking {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        var activity: MainActivity? = null
        scenario.onActivity { activity = it }
        val folder = File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }
        val context = activity!!
        val bitmap = Bitmap.createBitmap(600, 400, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.WHITE)
            Canvas(this).drawRect(120f, 90f, 480f, 310f, Paint().apply { color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = 12f })
        }
        val name = QuestionFigures.save(context, bitmap)
        bitmap.recycle()
        val withFigure = Question(kind = "选择题", reviewed = true, body = "下列图形是（ ）\nA. 三角形\nB. 圆形\nC. 正方形\nD. 菱形",
            optionFigures = OptionFigures.encode(mapOf("A" to listOf(name))))
        val plain = withFigure.copy(id = UUID.randomUUID().toString(), optionFigures = "")
        try {
            val pdf = DocumentExporter.export(context, "选项图片验证", listOf(withFigure), word = false)
            val plainPdf = DocumentExporter.export(context, "选项图片基准", listOf(plain), word = false)
            try { pdf.copyTo(File(folder, "option-figure-export.pdf"), overwrite = true); assertTrue("选项配图必须真的画进 PDF", ink(pdf) > ink(plainPdf)) }
            finally { pdf.delete(); plainPdf.delete() }
            val word = DocumentExporter.export(context, "选项图片验证", listOf(withFigure), word = true)
            try {
                word.copyTo(File(folder, "option-figure-export.docx"), overwrite = true)
                ZipFile(word).use { zip ->
                    assertEquals(1, zip.entries().asSequence().count { it.name.startsWith("word/media/") })
                    zip.getInputStream(zip.getEntry("word/document.xml")).use { DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(it) }
                }
            } finally { word.delete() }
        } finally { QuestionFigures.delete(context, listOf(name)) }
        scenario.close()
    }

    @Test fun veryLongChoiceCellsPaginateWithoutDroppingTheRemainingOptions(): Unit = runBlocking {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        var activity: MainActivity? = null
        scenario.onActivity { activity = it }
        try {
            val longOption = "分析函数时必须注意定义域与分段条件，".repeat(60) + "超长选项结束"
            val q = Question(kind = "选择题", body = "阅读下列说明并选择。\nA. $longOption\nB. 第二个选项\nC. 第三个选项\nD. 最后选项结束", reviewed = true)
            val pdf = DocumentExporter.export(activity!!, "超长选择题验证", listOf(q), word = false)
            try {
                val folder = File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }
                pdf.copyTo(File(folder, "long-choice-export-0.5.0.pdf"), overwrite = true)
                val (pages, text) = pdfText(pdf)
                File(folder, "long-choice-export-text.txt").writeText(text)
                assertTrue(pages > 1)
                assertTrue(text.contains("超长选项结束")); assertTrue(text.contains("最后选项结束"))
                ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                    PdfRenderer(descriptor).use { renderer -> renderer.openPage(0).use { page ->
                        assertTrue(page.textContents.any { it.text.contains("A.") })
                    } }
                }
            } finally { pdf.delete() }
        } finally { scenario.close() }
    }
}
