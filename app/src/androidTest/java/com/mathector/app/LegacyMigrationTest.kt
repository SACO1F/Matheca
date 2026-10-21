package com.mathector.app

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.mathector.app.data.MathectorDatabase
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class LegacyMigrationTest {
    @Test fun legacyV5() = migrate(5, false)
    @Test fun legacyV6() = migrate(6, false)
    @Test fun legacyV7() = migrate(7, false)
    @Test fun unifiedV5() = migrate(5, true)
    @Test fun unifiedV8() = migrate(8, true)

    private fun migrate(version: Int, unified: Boolean): Unit = runBlocking {
        val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
        val name = "isolated-migration-${UUID.randomUUID()}.db"
        val schemaName = if(unified) "unified-schema-v$version.json" else "legacy-schema-v$version.json"
        val schema = InstrumentationRegistry.getInstrumentation().context.assets.open(schemaName).use { JSONObject(it.bufferedReader().readText()).getJSONObject("database") }
        val figureName = "a".repeat(64) + ".jpg"
        // Test image lives beside this isolated DB's expected legacy images directory.
        val image = File(app.filesDir, "question-images/$figureName")
        check(!image.exists())
        image.parentFile!!.mkdirs()
        val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
        image.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
        try {
            SQLiteDatabase.openOrCreateDatabase(app.getDatabasePath(name), null).use { db ->
                val entities = schema.getJSONArray("entities")
                repeat(entities.length()) { n ->
                    val e = entities.getJSONObject(n)
                    db.execSQL(e.getString("createSql").replace("\${TABLE_NAME}", e.getString("tableName")))
                    val indices = e.optJSONArray("indices") ?: org.json.JSONArray()
                    repeat(indices.length()) { i -> db.execSQL(indices.getJSONObject(i).getString("createSql").replace("\${TABLE_NAME}", e.getString("tableName"))) }
                }
                fun insert(table: String, overrides: ContentValues) {
                    val values = ContentValues()
                    db.rawQuery("PRAGMA table_info($table)", null).use { c ->
                        while(c.moveToNext()) {
                            val column = c.getString(c.getColumnIndexOrThrow("name"))
                            if(c.getString(c.getColumnIndexOrThrow("type")) == "INTEGER") values.put(column, 0) else values.put(column, "")
                        }
                    }
                    values.putAll(overrides)
                    check(db.insertOrThrow(table, null, values) != -1L)
                }
                insert("questions", ContentValues().apply {
                    put("id", "q"); put("body", "preserved body"); put("solution", "preserved solution"); put("sourcePath", "/unchanged.jpg"); put("createdAt", 9007199254740993L)
                    if(unified) { put("figuresJson", "[]"); put("figureWidthsJson", "[]"); put("figurePlacementsJson", "[]") }
                    else put("figures", "[\"$figureName\"]")
                })
                insert("collections", ContentValues().apply { put("id", "c"); put("title", "preserved collection"); if(unified) put("questionLayoutJson", "{\"q\":{\"answerSpaceMm\":60}}") })
                insert("collection_items", ContentValues().apply { put("collectionId", "c"); put("questionId", "q"); if(version >= 6 && !unified) { put("solutionSpace", 40); put("newPage", 1) } })
                db.version = version
            }
            val room = Room.databaseBuilder(app, MathectorDatabase::class.java, name).addMigrations(MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_6_9, MathectorDatabase.MIGRATION_7_9, MathectorDatabase.MIGRATION_8_9).build()
            try {
                val q = room.dao().question("q")!!
                assertEquals("preserved body", q.body); assertEquals("preserved solution", q.solution)
                assertEquals(9007199254740993L, q.createdAt); assertEquals("/unchanged.jpg", q.sourcePath)
                if(!unified) { assertTrue("raw=" + q.figures, q.figures.contains(figureName)); assertTrue("converted=" + q.figuresJson, org.json.JSONArray(q.figuresJson).getString(0).startsWith("data:image/png;base64,")) }
                val collection = room.dao().collections().first().single()
                if(unified) assertTrue(collection.questionLayoutJson.contains("60"))
                if(version >= 6 && !unified) {
                    val layout = JSONObject(collection.questionLayoutJson).getJSONObject("q")
                    assertEquals(40, layout.getInt("answerSpaceMm")); assertTrue(layout.getBoolean("pageBreakBefore"))
                    val item = room.dao().orderedItems("c").single(); assertEquals(40, item.solutionSpace); assertTrue(item.newPage)
                }
                assertEquals(1, room.dao().orderedItems("c").size)
                assertTrue(image.isFile)
            } finally { room.close() }
        } finally { app.deleteDatabase(name); image.delete() }
    }
}
