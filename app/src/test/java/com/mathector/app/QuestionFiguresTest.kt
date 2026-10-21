package com.mathector.app

import com.mathector.app.data.*
import org.junit.Assert.*
import org.junit.Test

class QuestionFiguresTest {
    private val hash = "a".repeat(64)

    @Test fun encodingKeepsOnlyContentAddressedNamesAndBlankListsStayEmpty() {
        assertEquals("", QuestionFigures.encode(emptyList()))
        assertEquals("[\"$hash.jpg\"]", QuestionFigures.encode(listOf("$hash.jpg", "$hash.jpg")))
        assertEquals(listOf("$hash.jpg"), QuestionFigures.decode(QuestionFigures.encode(listOf("$hash.jpg"))))
    }

    @Test fun decodingIgnoresGarbageAndKeepsAtMostSixDistinctNames() {
        assertEquals(emptyList<String>(), QuestionFigures.decode("not json"))
        assertEquals(listOf("$hash.jpg"), QuestionFigures.decode("[\"../escape.jpg\", \"$hash.jpg\", \"bad\"]"))
        assertTrue(QuestionFigures.validName("$hash.png"))
        assertFalse(QuestionFigures.validName("$hash.gif"))
        assertFalse(QuestionFigures.validName("not-a-hash.jpg"))
        val many = (0 until 8).map { index -> "%064x".format(index) + ".jpg" }
        assertEquals(QuestionFigures.MAX_FIGURES, QuestionFigures.decode(QuestionFigures.encode(many)).size)
    }

    @Test fun optionImagesRoundTripPerLabelAndIgnoreGarbage() {
        assertEquals("", OptionFigures.encode(emptyMap()))
        assertEquals(emptyMap<String, List<String>>(), OptionFigures.decode("not json"))
        assertEquals(emptyMap<String, List<String>>(), OptionFigures.decode("""{"A":[],"E":["$hash.jpg"]}"""))
        val encoded = OptionFigures.encode(mapOf("B" to listOf("$hash.jpg"), "a" to listOf("$hash.jpg"), "C" to emptyList()))
        assertEquals("""{"A":["$hash.jpg"],"B":["$hash.jpg"]}""", encoded)
        assertEquals(mapOf("A" to listOf("$hash.jpg"), "B" to listOf("$hash.jpg")), OptionFigures.decode(encoded))
        assertEquals(listOf("$hash.jpg"), OptionFigures.names(encoded))
        val many = (0 until 6).map { index -> "%064x".format(index) + ".jpg" }
        assertEquals(OptionFigures.MAX_PER_OPTION, OptionFigures.decode(OptionFigures.encode(mapOf("D" to many)))["D"]?.size)
        assertEquals(OptionFigures.MAX_PER_OPTION, OptionFigures.names(OptionFigures.encode(mapOf("D" to many))).size)
    }

    @Test fun aStemTitleIsDerivedFromTheFirstLineAndFallsBackToAPlaceholder() {
        assertEquals("已知函数求值", QuestionText.titleFromBody("已知函数求值\n（1）求 f(2)。"))
        assertEquals("待录入题目", QuestionText.titleFromBody("   "))
    }
}
