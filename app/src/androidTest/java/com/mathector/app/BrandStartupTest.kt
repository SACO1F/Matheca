package com.mathector.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Build
import android.util.TypedValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.ThemeMode
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class BrandStartupTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun appNameRoundedLauncherAndLibraryLogoUseTheSameAsset() {
        val app = compose.activity.application as MathectorApplication
        assertEquals("Matheca", app.applicationInfo.loadLabel(app.packageManager).toString())
        val drawable = requireNotNull(app.getDrawable(R.drawable.ic_launcher))
        val bitmap = Bitmap.createBitmap(108,108,Bitmap.Config.ARGB_8888)
        try {
            drawable.setBounds(0,0,108,108); drawable.draw(Canvas(bitmap))
            assertEquals(0,Color.alpha(bitmap.getPixel(0,0)))
            assertEquals(Color.rgb(37,37,37),bitmap.getPixel(54,5))
            assertEquals(Color.WHITE,bitmap.getPixel(66,62))
        } finally { bitmap.recycle() }
        if (Build.VERSION.SDK_INT >= 31) {
            val value = TypedValue()
            assertTrue(compose.activity.theme.resolveAttribute(android.R.attr.windowSplashScreenAnimatedIcon,value,true))
            assertEquals(R.drawable.ic_splash,value.resourceId)
        }
        compose.waitUntil(5000) { runCatching { compose.onNodeWithTag("library-logo").assertIsDisplayed(); true }.getOrDefault(false) }
        val original = app.settings.state.value.theme
        try {
            for (theme in listOf(ThemeMode.LIGHT,ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                compose.onNodeWithTag("library-logo").assertIsDisplayed().assertContentDescriptionEquals("Matheca LOGO")
                compose.waitForIdle()
                val shot = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
                try { File(app.getExternalFilesDir(null),"brand-startup").apply {mkdirs()}.resolve("library-${theme.name.lowercase()}.png").outputStream().use {shot.compress(Bitmap.CompressFormat.PNG,100,it)} }
                finally {shot.recycle()}
            }
        } finally { app.settings.setTheme(original) }
    }
}
