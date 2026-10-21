package com.mathector.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import androidx.lifecycle.ViewModelProvider
import com.mathector.app.data.Question
import kotlinx.coroutines.runBlocking
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DesktopLinkUiTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun shot(name: String) {
        compose.waitForIdle()
        val image = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { val folder = File(compose.activity.getExternalFilesDir(null), "phase2-ui").apply { mkdirs() }; File(folder, name).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { image.recycle() }
    }
    @Test fun nativeConnectionScreenUsesSystemInsetsAndSelectableLibraryInBothThemes() {
        compose.onNodeWithTag("nav-profile").performClick()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("desktop-link-open"))
        compose.onNodeWithTag("desktop-link-open").performClick()
        compose.onNodeWithTag("desktop-scan").assertIsDisplayed()
        compose.onNodeWithTag("desktop-address").assertIsDisplayed()
        shot("android-link-light.png")
        val photo = File(compose.activity.cacheDir, "native-ui-photo.png")
        val bitmap = Bitmap.createBitmap(200, 120, Bitmap.Config.ARGB_8888)
        try { val canvas = Canvas(bitmap); canvas.drawColor(android.graphics.Color.WHITE); canvas.drawText("x + 2 = 5", 12f, 70f, Paint().apply { textSize = 28f; color = android.graphics.Color.BLACK }); photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
        val model = ViewModelProvider(compose.activity)[AppViewModel::class.java]
        compose.runOnIdle { model.desktopPhotos(listOf(Uri.fromFile(photo))) }
        compose.waitUntil(10000) { model.desktopLink.queue.value.isNotEmpty() && !model.desktopBusy.value }
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasText("拍摄照片.jpg"))
        compose.waitUntil(10000) { compose.onAllNodesWithTag("desktop-photo-ready").fetchSemanticsNodes().isNotEmpty() }
        shot("android-queue-light.png")
        runBlocking { (compose.activity.application as MathectorApplication).database.dao().save(Question(id = "native-ui-fixture", title = "联动验证题", body = "求 2+2。", reviewed = true)) }
        compose.onNodeWithText("选择资料").performClick()
        compose.onNodeWithTag("desktop-queue-selection").assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-select-q-native-ui-fixture"))
        compose.onNodeWithTag("desktop-select-q-native-ui-fixture").assertIsToggleable().performClick().assertIsOn()
        compose.onNodeWithTag("desktop-export-zip").assertIsEnabled()
        shot("android-selection-light.png")
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("theme-DARK"))
        compose.onNodeWithTag("theme-DARK").performClick()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("desktop-link-open"))
        compose.onNodeWithTag("desktop-link-open").performClick()
        compose.onNodeWithTag("desktop-scan").assertIsDisplayed()
        shot("android-link-dark.png")
        compose.onNodeWithText("接收题库").performClick()
        shot("android-receive-dark.png")
        runBlocking {
            (compose.activity.application as MathectorApplication).database.dao().deleteQuestion("native-ui-fixture")
            model.desktopLink.queue.value.toList().forEach { model.desktopLink.remove(it.id) }
            (compose.activity.application as MathectorApplication).settings.setTheme(com.mathector.app.data.ThemeMode.LIGHT)
        }
    }
}
