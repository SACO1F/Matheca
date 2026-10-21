package com.mathector.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DesktopConnectedUiTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = compose.activity.application as MathectorApplication
    private fun shot(name: String) {
        compose.waitForIdle()
        val image = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { val folder = File(app.getExternalFilesDir(null), "phase2-connected-ui").apply { mkdirs() }; File(folder, name).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { image.recycle() }
    }
    @Test fun realNativeControlsPairReceivePreviewAndSendSelectedQuestion() {
        val link = InstrumentationRegistry.getArguments().getString("desktopUrl") ?: error("desktopUrl is required")
        runBlocking { app.settings.setTheme(ThemeMode.LIGHT); app.database.dao().save(Question(id = "native-only", title = "手机已有题目", body = "求 2+2。", reviewed = true, createdAt = 100L)) }
        compose.onNodeWithTag("nav-profile").performClick()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("desktop-link-open"))
        compose.onNodeWithTag("desktop-link-open").performClick()
        compose.onNodeWithTag("desktop-address").performTextInput(link)
        compose.onNodeWithTag("desktop-connect").performClick()
        val model = ViewModelProvider(compose.activity)[AppViewModel::class.java]
        compose.waitUntil(30000) { model.desktopLink.state.value?.optBoolean("approved") == true }
        compose.waitUntil(30000) { !model.desktopBusy.value }
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-remember"))
        compose.onNodeWithTag("desktop-remember").performClick()
        compose.waitUntil(10000) { model.desktopLink.savedDesktops.value.isNotEmpty() && !model.desktopBusy.value }
        // The confirmation snackbar temporarily covers controls at the bottom of the list.
        compose.waitUntil(15000) { model.notice.value == null }
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-reconnect"))
        shot("android-paired-light.png")
        compose.runOnIdle { model.desktopLink.disconnect() }
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-reconnect"))
        compose.onNodeWithTag("desktop-reconnect").assertIsEnabled().performClick()
        compose.waitUntil(30000) { model.desktopLink.state.value?.optBoolean("approved")==true && !model.desktopBusy.value }
        compose.onNodeWithText("接收题库").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("下载并预览").fetchSemanticsNodes().isNotEmpty() }
        shot("android-connected-receive.png")
        compose.onNodeWithText("下载并预览").performClick()
        compose.waitUntil(10000) { model.desktopAssessment.value != null && !model.desktopBusy.value }
        compose.onNodeWithTag("desktop-restore").assertIsDisplayed()
        compose.onNode(hasText("保留本机版本") and hasClickAction()).assertIsSelected()
        compose.onNode(hasText("使用收到的版本") and hasClickAction()).performClick().assertIsSelected()
        compose.onNode(hasText("保留本机版本") and hasClickAction()).performClick().assertIsSelected()
        shot("android-receive-preview.png")
        compose.onNodeWithTag("desktop-restore").performClick()
        compose.waitUntil(10000) { model.desktopAssessment.value == null && !model.desktopBusy.value }
        compose.waitUntil(15000) { model.notice.value == null }
        runBlocking { val q = app.database.dao().question("desktop-q")!!; assertEquals(1, org.json.JSONArray(q.figuresJson).length()); assertEquals("B", org.json.JSONArray(q.figurePlacementsJson).getString(0)) }
        compose.onNodeWithText("选择资料").performClick()
        compose.onNode(hasText("仅加入与电脑不同的资料") and hasClickAction()).performClick().assertIsOn()
        shot("android-incremental-light.png")
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-select-q-native-only"))
        compose.onNodeWithTag("desktop-select-q-native-only").assertIsToggleable().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithTag("desktop-queue-selection").performClick()
        compose.waitUntil(10000) { model.desktopLink.queue.value.any { it.kind == "library" && it.status == "queued" } && !model.desktopBusy.value }
        val photo = File(app.cacheDir, "connected-photo.png")
        val bitmap = Bitmap.createBitmap(200, 120, Bitmap.Config.ARGB_8888)
        try { val canvas = Canvas(bitmap); canvas.drawColor(android.graphics.Color.WHITE); canvas.drawText("x + 2 = 5", 12f, 70f, Paint().apply { textSize = 28f; color = android.graphics.Color.BLACK }); photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
        compose.runOnIdle { model.desktopPhotos(listOf(Uri.fromFile(photo))) }
        compose.waitUntil(10000) { model.desktopLink.queue.value.any { it.kind == "photo" && it.status == "queued" } && !model.desktopBusy.value }
        compose.waitUntil(15000) { model.notice.value == null }
        compose.onNodeWithText("连接与待传").performClick()
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-send"))
        compose.onNodeWithTag("desktop-send").assertIsEnabled().performClick()
        compose.waitUntil(30000) { model.desktopLink.queue.value.all { it.status == "sent" } && !model.desktopBusy.value }
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasContentDescription("待传照片预览"))
        compose.waitUntil(10000) { compose.onAllNodesWithTag("desktop-photo-ready").fetchSemanticsNodes().isNotEmpty() }
        shot("android-sent-queue.png")
        runBlocking { app.settings.setTheme(ThemeMode.DARK) }
        compose.onNodeWithText("接收题库").performClick()
        compose.onNodeWithText("下载并预览").assertIsDisplayed()
        shot("android-connected-dark.png")
        compose.onNodeWithText("连接与待传").performClick()
        compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-reconnect"))
        shot("android-paired-dark.png")
        compose.onNodeWithText("选择资料").performClick()
        shot("android-incremental-dark.png")
        runBlocking {
            val service = LibraryBackupService(app, app.database, app.knowledge)
            service.createArchive(setOf("desktop-q"), setOf("desktop-c")).use { it.file.copyTo(File(app.getExternalFilesDir(null), "phase2-roundtrip.zip"), overwrite = true) }
            File(app.getExternalFilesDir(null), "phase2-result.txt").writeText("Native UI pairing, preview, intake, checkbox selection, queue and send controls passed")
            assertTrue(DesktopLinkService(app).queue.value.all { it.status == "sent" })
        }
    }
}
