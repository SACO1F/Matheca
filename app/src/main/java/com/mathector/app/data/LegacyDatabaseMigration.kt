package com.mathector.app.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/** Android-only releases used schema 5–7 before the unified repository's schema 5.
 * Keep both sets of columns; never downgrade, drop tables, or delete legacy image files. */
internal object LegacyDatabaseMigration {
    fun from(version: Int): Migration = object : Migration(version, 9) {
        override fun migrate(db: SupportSQLiteDatabase) {
            fun add(table: String, column: String, definition: String) {
                val exists = db.query("PRAGMA table_info(`$table`)").use { c ->
                    val name = c.getColumnIndexOrThrow("name")
                    var found = false
                    while(c.moveToNext()) if(c.getString(name) == column) found = true
                    found
                }
                if(!exists) db.execSQL("ALTER TABLE `$table` ADD COLUMN `$column` $definition")
            }
            add("questions", "figures", "TEXT NOT NULL DEFAULT ''")
            add("questions", "optionFigures", "TEXT NOT NULL DEFAULT ''")
            listOf("figuresJson", "figureWidthsJson", "figurePlacementsJson").forEach { add("questions", it, "TEXT NOT NULL DEFAULT '[]'") }
            add("collections", "questionLayoutJson", "TEXT NOT NULL DEFAULT '{}'")
            add("collection_items", "solutionSpace", "INTEGER NOT NULL DEFAULT -1")
            add("collection_items", "newPage", "INTEGER NOT NULL DEFAULT 0")

            val imageRoot = File(File(db.path).parentFile!!.parentFile, "files/question-images")
            db.query("SELECT id, figures, optionFigures, figuresJson FROM questions").use { c ->
                while(c.moveToNext()) {
                    if(c.getString(3) != "[]") continue
                    val images = JSONArray(); val placements = JSONArray(); val widths = JSONArray()
                    fun append(raw: String, placement: String) {
                        val names = runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
                        repeat(names.length()) { i ->
                            val name = names.optString(i)
                            if(images.length() < 6 && Regex("[0-9a-f]{64}\\.(jpg|jpeg|png|webp)").matches(name)) {
                                png(File(imageRoot, name))?.let { images.put(it); widths.put(0); placements.put(placement) }
                            }
                        }
                    }
                    append(c.getString(1), "stem")
                    val options = runCatching { JSONObject(c.getString(2)) }.getOrElse { JSONObject() }
                    listOf("A", "B", "C", "D").forEach { key -> options.optJSONArray(key)?.let { append(it.toString(), key) } }
                    if(images.length() > 0) db.execSQL("UPDATE questions SET figuresJson=?, figureWidthsJson=?, figurePlacementsJson=? WHERE id=?", arrayOf(images.toString(), widths.toString(), placements.toString(), c.getString(0)))
                }
            }
            val layouts = mutableMapOf<String, JSONObject>()
            db.query("SELECT collectionId, questionId, solutionSpace, newPage FROM collection_items WHERE solutionSpace >= 0 OR newPage != 0").use { c ->
                while(c.moveToNext()) {
                    val item = JSONObject()
                    if(c.getInt(2) >= 0) item.put("answerSpaceMm", c.getInt(2).coerceIn(0, 160))
                    if(c.getInt(3) != 0) item.put("pageBreakBefore", true)
                    layouts.getOrPut(c.getString(0)) { JSONObject() }.put(c.getString(1), item)
                }
            }
            layouts.forEach { (id, layout) -> db.execSQL("UPDATE collections SET questionLayoutJson=? WHERE id=? AND questionLayoutJson='{}'", arrayOf(layout.toString(), id)) }
            // Previous unified releases kept desktop pictures/layouts but did not expose them
            // to the user's native editor. Materialize them without replacing native edits.
            db.query("SELECT id, figuresJson, figurePlacementsJson FROM questions WHERE figures='' AND optionFigures='' AND figuresJson!='[]'").use { c ->
                while(c.moveToNext()) {
                    val images = JSONArray(c.getString(1)); val placements = JSONArray(c.getString(2))
                    val stem = mutableListOf<String>(); val options = linkedMapOf<String, MutableList<String>>()
                    repeat(images.length()) { index ->
                        val bytes = Base64.decode(images.getString(index).substringAfter(','), Base64.DEFAULT)
                        val name = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) } + ".png"
                        val file = File(imageRoot, name)
                        if(!file.exists()) { imageRoot.mkdirs(); file.writeBytes(bytes) }
                        val placement = placements.optString(index, "stem")
                        if(placement == "stem") stem += name else options.getOrPut(placement) { mutableListOf() } += name
                    }
                    // Retain all desktop data even when the native per-option editor limit differs.
                    if(options.values.all { it.size <= OptionFigures.MAX_PER_OPTION })
                        db.execSQL("UPDATE questions SET figures=?, optionFigures=? WHERE id=?", arrayOf(QuestionFigures.encode(stem), OptionFigures.encode(options), c.getString(0)))
                }
            }
            db.query("SELECT id, questionLayoutJson FROM collections WHERE questionLayoutJson!='{}'").use { c ->
                while(c.moveToNext()) {
                    val layout = JSONObject(c.getString(1))
                    layout.keys().forEach { id ->
                        val item = layout.getJSONObject(id)
                        db.execSQL("UPDATE collection_items SET solutionSpace=?, newPage=? WHERE collectionId=? AND questionId=?", arrayOf(item.optInt("answerSpaceMm", -1), if(item.optBoolean("pageBreakBefore", false)) 1 else 0, c.getString(0), id))
                    }
                }
            }
        }
    }

    private fun png(file: File): String? {
        if(!file.isFile) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if(bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while(bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2
        val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        return try {
            val bytes = ByteArrayOutputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); out.toByteArray() }
            if(bytes.size > 2_000_000) null else "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        } finally { bitmap.recycle() }
    }
}
