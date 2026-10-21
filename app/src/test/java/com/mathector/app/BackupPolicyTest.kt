package com.mathector.app

import com.mathector.app.data.*
import org.junit.Assert.*
import org.junit.Test

class BackupPolicyTest {
    private val first = Question(id = "one", body = "原题一")
    private val second = Question(id = "two", body = "原题二")
    private val collection = QuestionCollection(id = "set", title = "函数题集")
    private val data = LibraryBackupData(listOf(first, second), listOf(collection), listOf(CollectionItem("set", "two", 9), CollectionItem("set", "one", 3)),
        emptyList(), emptyMap(), emptySet(), 0, emptyMap(), 0)

    @Test fun archivePathsCannotEscapeTheControlledSourceDirectory() {
        assertTrue(BackupPolicy.allowedEntry("manifest.json"))
        assertTrue(BackupPolicy.sourceEntry("sources/${"a".repeat(64)}.jpg"))
        assertTrue(BackupPolicy.figureEntry("figures/${"a".repeat(64)}.png"))
        listOf("../manifest.json", "/manifest.json", "sources/../../outside.jpg", "sources\\outside.jpg", "sources/not-a-hash.jpg", "sources/${"a".repeat(64)}.exe",
            "figures/not-a-hash.jpg", "figures/${"a".repeat(64)}.gif", "figures/../../escape.jpg").forEach {
            assertFalse(it, BackupPolicy.allowedEntry(it))
        }
    }
    @Test fun missingReferencesAndNegativePositionsAreRejected() {
        listOf(CollectionItem("missing", "one", 0), CollectionItem("set", "missing", 0), CollectionItem("set", "one", -1)).forEach { item ->
            assertThrows(IllegalArgumentException::class.java) { BackupPolicy.validateReferences(data.questions, data.collections, listOf(item)) }
        }
    }
    @Test fun duplicateRecordsMembershipsAndPositionsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { BackupPolicy.validateReferences(listOf(first, first), data.collections, emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { BackupPolicy.validateReferences(data.questions, listOf(collection, collection), emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { BackupPolicy.validateReferences(data.questions, data.collections, listOf(CollectionItem("set", "one", 0), CollectionItem("set", "one", 1))) }
        assertThrows(IllegalArgumentException::class.java) { BackupPolicy.validateReferences(data.questions, data.collections, listOf(CollectionItem("set", "one", 0), CollectionItem("set", "two", 0))) }
    }
    @Test fun mergingSkipsLocalQuestionsAndStillRestoresTheirNewCollectionLinksInOrder() {
        val plan = LibraryRestorePlan.merge(data, setOf("one", "local-only"), emptySet())
        assertEquals(listOf(second), plan.questions)
        assertEquals(listOf(collection), plan.collections)
        assertEquals(listOf(CollectionItem("set", "one", 0), CollectionItem("set", "two", 1)), plan.items)
        assertEquals(1, plan.skippedQuestions)
    }
    @Test fun aRepeatedImportDoesNotDuplicateOrChangeExistingCollections() {
        val plan = LibraryRestorePlan.merge(data, setOf("one", "two"), setOf("set"))
        assertTrue(plan.questions.isEmpty()); assertTrue(plan.collections.isEmpty()); assertTrue(plan.items.isEmpty())
        assertEquals(2, plan.skippedQuestions); assertEquals(1, plan.skippedCollections)
    }
}
