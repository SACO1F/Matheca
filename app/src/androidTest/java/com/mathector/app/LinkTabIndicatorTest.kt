package com.mathector.app

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.ui.*
import com.mathector.app.data.AccentTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class LinkTabIndicatorTest {
    @get:Rule val compose=createComposeRule()
    @Test fun selectedBackgroundSlidesBetweenAllThreeButtonsAndTracksRapidChanges() {
        var selected by mutableIntStateOf(0)
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val dark=(context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES
        compose.setContent {MathecaTheme(AccentTheme.GRAPHITE,dark) {DesktopLinkTabs(selected) {selected=it}}}
        fun bounds(tag: String)=compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        fun aligned(index: Int) {
            val indicator=bounds("link-tab-indicator"); val tab=bounds("link-tab-$index")
            assertEquals(tab.left,indicator.left,1.5f); assertEquals(tab.width,indicator.width,1.5f)
            assertEquals(tab.height,indicator.height,1.5f)
            compose.onNodeWithTag("link-tab-$index").assertIsSelected()
        }
        aligned(0)
        for(target in listOf(1,2,0)) {
            val start=bounds("link-tab-indicator").left
            val end=bounds("link-tab-$target").left
            compose.mainClock.autoAdvance=false
            compose.onNodeWithTag("link-tab-$target").performClick()
            compose.mainClock.advanceTimeByFrame(); compose.mainClock.advanceTimeBy(80)
            val middle=bounds("link-tab-indicator").left
            assertTrue("The selected background must move continuously",middle>minOf(start,end) && middle<maxOf(start,end))
            compose.mainClock.advanceTimeBy(1000); compose.mainClock.autoAdvance=true
            aligned(target)
        }
        compose.mainClock.autoAdvance=false
        compose.onNodeWithTag("link-tab-2").performClick(); compose.mainClock.advanceTimeByFrame(); compose.mainClock.advanceTimeBy(48)
        compose.onNodeWithTag("link-tab-1").performClick(); compose.mainClock.advanceTimeBy(1000); compose.mainClock.autoAdvance=true
        aligned(1)
        val bitmap=compose.onRoot().captureToImage().asAndroidBitmap()
        try {File(context.getExternalFilesDir(null),"link-tabs").apply {mkdirs()}.resolve("buttons-${context.resources.configuration.fontScale}-${if(dark) "dark" else "light"}.png").outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}} finally {bitmap.recycle()}
    }
}
