package com.mathector.app

import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LinkContentPolishTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private val app get()=ApplicationProvider.getApplicationContext<MathectorApplication>()
    private fun webViews(v: View): List<WebView> = when(v) { is WebView -> listOf(v); is ViewGroup -> (0 until v.childCount).flatMap { webViews(v.getChildAt(it)) }; else -> emptyList() }
    private fun fullContent(dark: Boolean = false): Boolean {
        val done=CountDownLatch(1); var valid=false
        compose.runOnUiThread {
            val view=webViews(compose.activity.window.decorView).firstOrNull { it.isShown && (it.tag as? String)?.contains("完整末尾条件九")==true }
            if(view!=null) assertEquals("System font size is applied once through CSS",100,view.settings.textZoom)
            val expectedColor=if(dark) "rgb(232, 232, 232)" else "rgb(38, 38, 38)"
            if(view==null) done.countDown() else view.evaluateJavascript("(function(){var c=document.getElementById('content');return document.fonts.status==='loaded' && c.clientHeight>98 && c.scrollHeight<=c.clientHeight+2 && c.textContent.includes('完整末尾条件九') && getComputedStyle(c).overflowY!=='hidden' && getComputedStyle(document.body).color==='$expectedColor';})()") { valid=it=="true"; done.countDown() }
        }
        return done.await(2,TimeUnit.SECONDS) && valid
    }
    private fun capture(name: String) {
        if(InstrumentationRegistry.getArguments().getString("captureMode")=="compact" && name !in setOf("link-light.png","selection-full-dark.png")) return
        compose.waitForIdle()
        val image=compose.onRoot().captureToImage().asAndroidBitmap()
        try { val dir=File(app.getExternalFilesDir(null),"link-polish").apply { mkdirs() }; File(dir,name).outputStream().use { image.compress(Bitmap.CompressFormat.PNG,100,it) } } finally {image.recycle()}
    }
    @Test fun longQuestionsRemainCompleteAcrossLibraryCollectionAndExchangeWithSharedSelection() {
        val q=Question(id="polish-long",title="长题目完整显示",body="已知函数 \\(f(x)=x^2-2x\\)。\n"+(1..8).joinToString("\n") { "（$it）讨论参数变化时的函数性质，写出推理过程。" }+"\n末尾条件 完整末尾条件九：求所有满足条件的实数。",grade="高一",difficulty="进阶",knowledge="函数单调性",reviewed=true)
        val c=QuestionCollection(id="polish-c",title="章节复习 · 函数与数列")
        runBlocking { app.settings.setTheme(ThemeMode.LIGHT); app.database.dao().save(q); app.database.dao().save(c); app.database.dao().add(CollectionItem(c.id,q.id,0)) }
        try {
            compose.onNodeWithTag("library-list").performScrollToNode(hasTestTag("library-question-${q.id}"))
            compose.waitUntil(20000) {fullContent()}; capture("library-full-light.png")
            compose.onNodeWithTag("nav-collections").performClick()
            capture("collections-light.png")
            compose.onNodeWithTag("collection-card-${c.id}").performClick()
            compose.waitUntil(20000) {fullContent()}; capture("collection-full-light.png")
            compose.onNodeWithContentDescription("返回").performClick()
            compose.onNodeWithTag("nav-profile").performClick()
            compose.onNodeWithTag("settings-list").performScrollToNode(hasTestTag("desktop-link-open"))
            compose.onNodeWithTag("desktop-link-open").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            compose.onNodeWithTag("desktop-scan").assertIsDisplayed()
            capture("link-light.png")
            compose.onNodeWithText("选择资料").performClick()
            compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-select-c-${c.id}"))
            compose.onNodeWithTag("desktop-select-c-${c.id}").assertIsToggleable().performClick().assertIsOn()
            compose.onNodeWithTag("desktop-link-list").performScrollToNode(hasTestTag("desktop-select-q-${q.id}"))
            compose.waitUntil(20000) {fullContent()}
            compose.onNodeWithTag("desktop-select-q-${q.id}").assertIsToggleable().performClick().assertIsOn()
            compose.onNodeWithTag("desktop-queue-selection").assertIsDisplayed().assertIsEnabled()
            capture("selection-full-light.png")
            compose.onNodeWithTag("desktop-link-list").performTouchInput { swipeUp() }
            capture("selection-end-light.png")
            runBlocking {app.settings.setTheme(ThemeMode.DARK)}
            compose.waitUntil(20000) {fullContent(true)}; capture("selection-full-dark.png")
        } finally {runBlocking {app.database.dao().deleteCollection(c.id); app.database.dao().deleteQuestion(q.id); app.settings.setTheme(ThemeMode.LIGHT)}}
    }
}
