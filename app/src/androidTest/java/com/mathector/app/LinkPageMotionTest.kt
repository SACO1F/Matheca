package com.mathector.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mathector.app.ui.DesktopLinkPages
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LinkPageMotionTest {
    @get:Rule val compose=createComposeRule()
    @Test fun allThreePagesSlideInBothDirectionsAndRapidChangesFinishOnLatestPage() {
        var page by mutableIntStateOf(0)
        compose.setContent {DesktopLinkPages(page,Modifier.fillMaxSize()) {Text("页面 $it")}}
        fun x(index: Int)=compose.onNodeWithTag("desktop-link-page-$index").fetchSemanticsNode().positionInRoot.x
        fun transition(target: Int,forward: Boolean) {
            val previous=page
            compose.mainClock.autoAdvance=false
            compose.runOnIdle {page=target}
            compose.mainClock.advanceTimeByFrame()
            compose.mainClock.advanceTimeBy(112)
            assertTrue("Incoming page slides from the expected side",if(forward) x(target)>0f else x(target)<0f)
            assertTrue("Outgoing page moves in the same direction",if(forward) x(previous)<0f else x(previous)>0f)
            compose.mainClock.advanceTimeBy(400)
            compose.mainClock.autoAdvance=true
            compose.onNodeWithTag("desktop-link-page-$previous").assertDoesNotExist()
            assertEquals(0f,x(target),1f)
        }
        transition(1,true); transition(2,true); transition(1,false); transition(0,false)
        compose.mainClock.autoAdvance=false
        compose.runOnIdle {page=2}; compose.mainClock.advanceTimeByFrame(); compose.mainClock.advanceTimeBy(80)
        compose.runOnIdle {page=1}; compose.mainClock.advanceTimeBy(600); compose.mainClock.autoAdvance=true
        compose.onNodeWithText("页面 1").assertIsDisplayed()
        compose.onNodeWithTag("desktop-link-page-0").assertDoesNotExist()
        compose.onNodeWithTag("desktop-link-page-2").assertDoesNotExist()
    }
}
