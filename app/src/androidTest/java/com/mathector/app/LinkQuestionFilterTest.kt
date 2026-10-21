package com.mathector.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LinkQuestionFilterTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private val app get()=compose.activity.application as MathectorApplication
    private fun list()=compose.onNodeWithTag("desktop-link-list")
    private fun select(id: String,value: String) {
        list().performScrollToNode(hasTestTag("glide-select-$id"))
        compose.onNodeWithTag("glide-select-$id").performClick()
        compose.onNodeWithTag("glide-option-$id-$value").performScrollTo().performClick()
    }
    private fun capture(name: String) {
        val image=compose.onRoot().captureToImage().asAndroidBitmap()
        try {File(app.getExternalFilesDir(null),"link-filters").apply {mkdirs()}.resolve(name).outputStream().use {image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}} finally {image.recycle()}
    }
    @Test fun selectorsMatchLibraryAndKeepHiddenSelectionsAndFiltersAcrossTabs() {
        val id="filters-${UUID.randomUUID()}"
        val base=Question(id="$id-1",body="完整测试题干，求等差数列的前十项和。",grade="高一",kind="解答题",difficulty="进阶",knowledge="等差数列")
        val questions=listOf(base,base.copy(id="$id-2",difficulty="基础"),base.copy(id="$id-3",grade="高二"),base.copy(id="$id-4",kind="填空题",knowledge="函数单调性"))
        runBlocking {questions.forEach {app.database.dao().save(it)}}
        try {
            compose.onNodeWithTag("nav-profile").performClick()
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("app-version"))
            val installedVersion=compose.activity.packageManager.getPackageInfo(compose.activity.packageName,0).versionName
            compose.onNodeWithTag("app-version").assertTextContains("Matheca $installedVersion",substring=true)
            capture("version.png")
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("desktop-link-open"))
            compose.onNodeWithTag("desktop-link-open").performClick()
            compose.onNodeWithText("选择资料").performClick()
            select("grade","高一"); select("kind","解答题"); select("difficulty","进阶"); select("knowledge","等差数列")
            list().performScrollToNode(hasTestTag("desktop-filter-count"))
            compose.onNodeWithTag("desktop-filter-count").assertTextEquals("题目 · 1 道")
            list().performScrollToNode(hasTestTag("desktop-select-q-${base.id}"))
            compose.onNodeWithTag("desktop-select-q-${base.id}").performClick().assertIsOn()
            capture("filtered-selected.png")
            compose.onNodeWithText("接收题库").performClick()
            compose.onNodeWithTag("desktop-link-page-2").assertIsDisplayed()
            compose.onNodeWithText("连接与待传").performClick()
            compose.onNodeWithTag("desktop-link-page-0").assertIsDisplayed()
            compose.onNodeWithText("选择资料").performClick()
            compose.onNodeWithTag("desktop-select-q-${base.id}").assertIsDisplayed().assertIsOn()
            select("grade","高三")
            list().performScrollToNode(hasTestTag("desktop-filter-empty"))
            compose.onNodeWithTag("desktop-filter-empty").assertIsDisplayed()
            compose.onNodeWithTag("desktop-queue-selection").assertIsEnabled()
            list().performScrollToNode(hasTestTag("desktop-filter-reset"))
            compose.onNodeWithTag("desktop-filter-reset").performClick()
            list().performScrollToNode(hasTestTag("desktop-select-q-${base.id}"))
            compose.onNodeWithTag("desktop-select-q-${base.id}").assertIsOn()
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithTag("nav-library").performClick()
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("glide-select-knowledge"))
            compose.onNodeWithTag("glide-select-knowledge").performClick()
            compose.onNodeWithTag("glide-header-knowledge-函数").assertExists()
            compose.onNodeWithTag("glide-option-knowledge-等差数列").performScrollTo().performClick()
            compose.onNodeWithTag("glide-select-knowledge").assertTextContains("等差数列",substring=true)
        } finally {runBlocking {questions.forEach {app.database.dao().deleteQuestion(it.id)}}}
    }
}
