package com.mathector.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class EditorReturnTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = compose.activity.application as MathectorApplication
    private fun waitFor(tag: String) = compose.waitUntil(15000) { runCatching { compose.onNodeWithTag(tag).assertIsDisplayed(); true }.getOrDefault(false) }
    private fun capture(name: String) {
        val bitmap=compose.onRoot().captureToImage().asAndroidBitmap()
        try { File(app.getExternalFilesDir(null),"editor-return").apply { mkdirs() }.resolve(name).outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) } } finally { bitmap.recycle() }
    }
    @Test fun returningFromLibraryAndCollectionRestoresOriginAndScrollWithoutStaleEditor() {
        val prefix="return-${UUID.randomUUID()}"
        val questions=(0..24).map { Question(id="$prefix-$it",body="返回位置验证题目 $it，求函数的取值范围。",title="返回位置验证 $it",favorite=true,reviewed=true,createdAt=it.toLong()) }
        val collection=QuestionCollection(id="$prefix-c",title="返回位置验证题集")
        val target=questions[18]
        runBlocking { questions.forEach { app.database.dao().save(it) }; app.database.dao().save(collection); questions.forEachIndexed { i,q -> app.database.dao().add(CollectionItem(collection.id,q.id,i)) } }
        try {
            val list=compose.onNodeWithTag("library-list")
            list.performScrollToNode(hasTestTag("library-filter-list"))
            compose.onNodeWithTag("library-filter-list").performScrollToNode(hasTestTag("library-filter-收藏"))
            compose.onNodeWithTag("library-filter-收藏").performClick()
            list.performScrollToNode(hasTestTag("library-question-${target.id}"))
            val card=compose.onNodeWithTag("library-question-${target.id}")
            val top=card.fetchSemanticsNode().boundsInRoot.top
            card.performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            waitFor("question-editor-header")
            compose.onNodeWithContentDescription("返回").performClick()
            waitFor("library-list")
            card.assertIsDisplayed()
            assertEquals(top,card.fetchSemanticsNode().boundsInRoot.top,3f)
            capture("library-restored.png")
            list.performScrollToNode(hasTestTag("library-filter-list"))
            compose.onNodeWithTag("library-filter-收藏").assertIsSelected()
            compose.onNodeWithTag("nav-collections").performClick()
            compose.onNodeWithTag("collections-list").performScrollToNode(hasTestTag("collection-card-${collection.id}"))
            compose.onNodeWithTag("collection-card-${collection.id}").performClick()
            waitFor("collection-detail")
            compose.onNodeWithTag("collection-detail").performScrollToNode(hasTestTag("collection-question-${target.id}"))
            val collectionCard=compose.onNodeWithTag("collection-question-${target.id}")
            val collectionTop=collectionCard.fetchSemanticsNode().boundsInRoot.top
            collectionCard.performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            waitFor("question-editor-header")
            compose.onNodeWithTag("question-editor-confirm").performClick()
            waitFor("collection-detail")
            collectionCard.assertIsDisplayed()
            assertEquals(collectionTop,collectionCard.fetchSemanticsNode().boundsInRoot.top,3f)
            capture("collection-restored.png")
            // An outside update must be visible when opening the same editor again.
            runBlocking { app.database.dao().save(app.database.dao().question(target.id)!!.copy(body="新的题干内容")) }
            collectionCard.performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            waitFor("question-editor-header")
            compose.onNodeWithTag("question-editor").performScrollToNode(hasTestTag("question-body-input"))
            compose.onNodeWithTag("question-body-input").assertTextContains("新的题干内容")
            InstrumentationRegistry.getInstrumentation().runOnMainSync { compose.activity.onBackPressedDispatcher.onBackPressed() }
            waitFor("collection-detail")
        } finally { runBlocking { app.database.dao().deleteCollection(collection.id); questions.forEach { app.database.dao().deleteQuestion(it.id) } } }
    }
}
