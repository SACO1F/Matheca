package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.ThemeMode
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class PrivacyPolicyTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun settingsPolicyIsOfflineScrollableAndDismissible() {
        val app = compose.activity.application as MathectorApplication
        compose.waitUntil(5000) { runCatching { compose.onNodeWithTag("library-logo").assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText("我的", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("privacy-policy-open"))
        compose.onNodeWithTag("privacy-policy-open").performClick()
        compose.onNodeWithTag("privacy-policy-dialog").assertIsDisplayed()
        compose.onNodeWithText("Matheca 隐私政策").assertIsDisplayed()
        compose.onNodeWithTag("privacy-policy-close").assertIsDisplayed()
        val original = app.settings.state.value.theme
        try {
            for (theme in listOf(ThemeMode.LIGHT, ThemeMode.DARK)) {
                app.settings.setTheme(theme)
                compose.waitForIdle()
                compose.onNodeWithTag("privacy-policy-close").assertIsDisplayed()
                val screenshot = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
                try {
                    File(app.getExternalFilesDir(null), "privacy-policy").apply { mkdirs() }
                        .resolve("${theme.name}-${app.resources.configuration.fontScale}.png")
                        .outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
                } finally { screenshot.recycle() }
            }
            compose.onNodeWithText("政策更新与联系").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("privacy-policy-close").assertIsDisplayed().performClick()
            compose.onNodeWithTag("privacy-policy-dialog").assertDoesNotExist()
            compose.onNodeWithTag("privacy-policy-open").assertIsDisplayed().performClick()
            compose.onNodeWithText("适用范围与开发者").assertIsDisplayed()
            androidx.test.espresso.Espresso.pressBack()
            compose.onNodeWithTag("privacy-policy-dialog").assertDoesNotExist()
            compose.onNodeWithTag("privacy-policy-open").assertIsDisplayed()
        } finally { app.settings.setTheme(original) }
    }
}
