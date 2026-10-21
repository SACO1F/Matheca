package com.mathector.app

import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mathector.app.ui.*
import com.mathector.app.data.AccentTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class GlideMenuLayoutTest {
    @get:Rule val compose=createComposeRule()
    @Test fun categoryAndOptionHierarchyWrapsAtLargeTypeAndHighlightTracksActualRow() {
        val title="函数、导数与综合应用"
        val option="函数单调性与含参数函数的综合应用"
        var selected by mutableStateOf<String?>(null)
        var dark by mutableStateOf(false)
        val systemScale=InstrumentationRegistry.getInstrumentation().targetContext.resources.configuration.fontScale
        compose.setContent {
            MathecaTheme(AccentTheme.GRAPHITE,dark) {GlideSelect("test","知识点",selected,listOf(GlideGroup(title,listOf(option,"函数零点"))),menuWidth=280.dp) {selected=it}}
        }
        fun layout(text: String): TextLayoutResult {
            val results=mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(text,useUnmergedTree=true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) {it(results)}
            return results.single()
        }
        fun assertComplete(text: String,result: TextLayoutResult) {
            // Paragraph width may retain the available width while Text wraps its own bounds.
            // Check the rendered glyphs and final character rather than that aggregate flag.
            assertEquals(text.length,result.getLineEnd(result.lineCount-1,visibleEnd=true))
            for(line in 0 until result.lineCount) {
                assertFalse(result.isLineEllipsized(line))
                assertTrue(result.getLineLeft(line)>=-1f)
                assertTrue(result.getLineRight(line)<=result.size.width+1f)
                assertTrue(result.getLineBottom(line)<=result.size.height+1f)
            }
        }
        for(isDark in listOf(false,true)) {
            compose.runOnIdle {dark=isDark; selected=null}
            compose.onNodeWithTag("glide-select-test").performClick()
            compose.onNodeWithTag("glide-highlight-test").assertDoesNotExist()
            val parent=layout(title); val child=layout(option)
            assertTrue(parent.layoutInput.style.fontSize.value>child.layoutInput.style.fontSize.value)
            assertComplete(title,parent); assertComplete(option,child)
            compose.onNodeWithTag("glide-header-test-$title").assertHasNoClickAction()
            compose.onNodeWithTag("glide-option-test-$option").performScrollTo().performClick()
            compose.onNodeWithTag("glide-select-test").performClick()
            compose.onNodeWithTag("glide-option-test-$option").performScrollTo().assertIsSelected()
            val row=compose.onNodeWithTag("glide-option-test-$option").getUnclippedBoundsInRoot()
            val highlight=compose.onNodeWithTag("glide-highlight-test").getUnclippedBoundsInRoot()
            assertEquals(row.top.value,highlight.top.value,1.5f)
            assertEquals((row.bottom-row.top).value,(highlight.bottom-highlight.top).value,1.5f)
            if(systemScale>1.5f) assertTrue((row.bottom-row.top).value>48f)
            val bitmap=compose.onNodeWithTag("glide-menu-test").captureToImage().asAndroidBitmap()
            try {
                File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),"link-filters").apply {mkdirs()}.resolve("knowledge-${systemScale}-${if(isDark) "dark" else "light"}.png").outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            } finally {bitmap.recycle()}
            androidx.test.espresso.Espresso.pressBack()
        }
    }
}
