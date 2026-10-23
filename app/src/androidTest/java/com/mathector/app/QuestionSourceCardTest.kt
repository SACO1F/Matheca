package com.mathector.app

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.Question
import com.mathector.app.data.AccentTheme
import com.mathector.app.ui.MathecaTheme
import com.mathector.app.ui.QuestionSummaryCard
import org.junit.Rule
import org.junit.Test
import java.io.File

class QuestionSourceCardTest {
    @get:Rule val compose = createComposeRule()

    @Test fun sourcesUseExistingMetadataAcrossSharedCardsInBothThemes() {
        val args = InstrumentationRegistry.getArguments()
        val dark = args.getString("sourceDark") == "true"
        val examples = listOf(
            Question(id = "pdf", body = "求函数的定义域。", sourceLabel = "高一函数专题.pdf · 第 2–3 页"),
            Question(id = "photo", body = "求数列的通项公式。", sourceLabel = "IMG_20261022_101530.jpg · 第 1 页"),
            Question(id = "manual", body = "证明两向量垂直。"),
            Question(id = "fallback", body = "计算积分。", sourceLabel = "", sourcePath = "/private/sources/试卷.png")
        )
        compose.setContent {
            MathecaTheme(AccentTheme.GRAPHITE, dark) {
                Column {
                    examples.forEachIndexed { index, q ->
                        QuestionSummaryCard(q, listOf("library", "collection", "picker", "exchange")[index], onClick = {})
                    }
                }
            }
        }
        compose.onNodeWithTag("library-source-pdf", useUnmergedTree = true).assertTextEquals("来源：高一函数专题.pdf · 第 2–3 页")
        compose.onNodeWithTag("collection-source-photo", useUnmergedTree = true).assertTextEquals("来源：IMG_20261022_101530.jpg · 第 1 页")
        compose.onNodeWithTag("picker-source-manual", useUnmergedTree = true).assertTextEquals("来源：手动录入")
        compose.onNodeWithTag("exchange-source-fallback", useUnmergedTree = true).assertTextEquals("来源：试卷.png")
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        try {
            File(context.getExternalFilesDir(null), "question-source").apply { mkdirs() }
                .resolve(if (dark) "dark.png" else "light.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } finally { bitmap.recycle() }
    }
}
