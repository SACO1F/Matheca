package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.AccentTheme
import com.mathector.app.ui.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class MobileUiConsistencyTest {
    @get:Rule val compose = createComposeRule()
    @Test fun sharedPickerControlsAndFloatingToastInBothThemes() {
        val dark = mutableStateOf(false)
        compose.setContent {
            MathecaTheme(AccentTheme.BLUE, dark.value) {
                val filters = rememberQuestionFilterState()
                val toast = remember { SnackbarHostState() }
                LaunchedEffect(Unit) { toast.showSnackbar("资料已接收，题库已更新", duration = SnackbarDuration.Indefinite) }
                Surface {
                    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("我的题库")
                        QuestionCategoryFilters(filters)
                        QuestionKnowledgeFilter(filters, listOf(GlideGroup("函数", listOf("函数单调性"))))
                        Text(filters.grade.orEmpty(), Modifier)
                        Spacer(Modifier.weight(1f))
                        IosToastHost(toast)
                    }
                }
            }
        }
        compose.onNodeWithTag("picker-filter-grade").performClick()
        compose.onNodeWithTag("picker-option-grade-高一").performClick()
        compose.onNodeWithTag("picker-filter-kind").assertIsDisplayed()
        compose.onNodeWithTag("picker-filter-difficulty").assertIsDisplayed()
        compose.onNodeWithTag("picker-filter-knowledge").performClick()
        compose.onNodeWithTag("picker-option-knowledge-函数单调性").performClick()
        compose.onNodeWithTag("ios-toast").assertIsDisplayed()
        capture("mobile-style-light.png")
        compose.runOnIdle { dark.value = true }
        compose.waitForIdle()
        capture("mobile-style-dark.png")
        compose.onNodeWithContentDescription("关闭提示").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("ios-toast").fetchSemanticsNodes().isEmpty() }
    }
    private fun capture(name: String) {
        val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
        compose.waitForIdle()
        val image = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        try { File(File(app.getExternalFilesDir(null), "validation").apply { mkdirs() }, name).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { image.recycle() }
    }
}
