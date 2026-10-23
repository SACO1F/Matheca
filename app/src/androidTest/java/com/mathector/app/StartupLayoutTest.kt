package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.ui.StartupScreen
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class StartupLayoutTest {
    @get:Rule val compose = createComposeRule()
    @Test fun originalLogoPaddingAndTaglineRemainReadable() {
        compose.setContent { StartupScreen() }
        compose.onNodeWithTag("startup-tagline").assertIsDisplayed().assertTextEquals("收集你自己的好题")
        val logo = compose.onNodeWithTag("startup-logo")
        val logoBounds = logo.fetchSemanticsNode().boundsInRoot
        val captionBounds = compose.onNodeWithTag("startup-tagline").fetchSemanticsNode().boundsInRoot
        assertTrue("Tagline must sit beneath the logo",captionBounds.top > logoBounds.bottom)
        val bitmap = logo.captureToImage().asAndroidBitmap()
        try {
            var left = bitmap.width; var right = 0
            for(y in 0 until bitmap.height) for(x in 0 until bitmap.width) {
                val pixel = bitmap.getPixel(x,y)
                if(android.graphics.Color.red(pixel)>245 && android.graphics.Color.green(pixel)>245 && android.graphics.Color.blue(pixel)>245) {
                    left=minOf(left,x);right=maxOf(right,x)
                }
            }
            assertTrue("Original white mark needs left inset",left>bitmap.width*.15f)
            assertTrue("Original white mark needs right inset",right<bitmap.width*.85f)
        } finally {bitmap.recycle()}
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val shot=compose.onRoot().captureToImage().asAndroidBitmap()
        try {File(context.getExternalFilesDir(null),"startup-tagline").apply {mkdirs()}.resolve("screen-${context.resources.configuration.fontScale}.png").outputStream().use {shot.compress(Bitmap.CompressFormat.PNG,100,it)}} finally {shot.recycle()}
    }
}
